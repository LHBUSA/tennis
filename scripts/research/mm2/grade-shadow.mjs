// Matchup Model V2 — grade the RESEARCH-ONLY prospective shadow records (tennis-api mm2-shadow.js) after the results.
// Read-only: R2 research/mm2/shadow-index/<day>.json via wrangler + match results by SELECT. One graded row per match:
// the LAST record written before play (latest frozen_at), completed matches only (retirements / walkovers not graded).
// Champion = the probability exactly as frozen and served; challenger = mm2-B-context/1. Identical rows for both.
//   node scripts/research/mm2/grade-shadow.mjs [from=2026-10-02]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { metrics, pairedBootstrap, FAV_BANDS } from './lib/model.mjs';
import { PROMOTION_GATE, gateStatus, pickGradeable } from './shadow-gate.mjs';

const FROM = process.argv[2] || '2026-10-02';
const env = { ...process.env, NODE_OPTIONS: '--require D:/Workers/exfat-readlink.cjs' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm2-shadow-'));
const days = [];
for (let d = new Date(`${FROM}T00:00:00Z`); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
const recs = [];
for (const d of days) {
  const f = path.join(tmp, `${d}.json`);
  try { execFileSync('npx', ['wrangler', 'r2', 'object', 'get', `tennis-source/research/mm2/shadow-index/${d}.json`, '--remote', '--file', f], { cwd: path.resolve('workers/tennis-api'), env, stdio: 'pipe', shell: process.platform === 'win32' }); recs.push(...JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* no shadows that day */ }
}
const byMatch = new Map();
for (const r of recs) { if (!byMatch.has(r.match_id)) byMatch.set(r.match_id, []); byMatch.get(r.match_id).push(r); }
const ids = [...byMatch.keys()];
let results = [];
if (ids.length) {
  const q = `select json_agg(json_build_object('match_id', m.match_id, 'status', m.status, 'winner_side', m.winner_side, 'started_at', m.started_at, 'scheduled_at', m.scheduled_at, 'edition', m.edition_id, 'surface', m.surface, 'level', e.competition_key))::text j from tennis_matches m left join tennis_tournament_editions e on e.edition_id = m.edition_id where m.match_id in (${ids.map((x) => `'${x}'`).join(',')})`;
  const out = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim());
  results = JSON.parse((Array.isArray(out) ? out[0] : out).j || '[]');
}
const res = new Map(results.map((r) => [r.match_id, r]));
// per tour: pending (not finished), excluded (finished but not gradeable), unscored (no challenger probability)
const pend = () => ({ pending_unfinished: 0, excluded: {}, unscored: {} });
const pending = { ATP: pend(), WTA: pend() };
const rows = [];
for (const [id, list] of byMatch) {
  const m = res.get(id);
  const tour = list[0].tour;
  const P = pending[tour] || (pending[tour] = pend());
  const pick = pickGradeable(list, m);
  if (pick.kind === 'unscored') { P.unscored[pick.reason] = (P.unscored[pick.reason] || 0) + 1; continue; }
  if (pick.kind === 'pending') { P.pending_unfinished += 1; continue; }
  if (pick.kind === 'excluded') { P.excluded[pick.reason] = (P.excluded[pick.reason] || 0) + 1; continue; }
  const r = pick.record;
  rows.push({ match_id: id, tour, edition: m.edition || id, surface: m.surface || 'unknown', level: m.level || 'unknown', shadow_key: r.key, records_for_match: list.length, y: m.winner_side === 'A' ? 1 : 0, champion: r.champion.probability.A, challenger: r.challenger.probability.A, frozen_at: r.frozen_at, started_at: m.started_at, feature_hash: r.feature_hash, model_version: r.model_version });
}
const by = (t) => rows.filter((r) => !t || r.tour === t);
const favBand = (p) => { const f = Math.max(p, 1 - p); return ['50-55', '55-60', '60-70', '70-80', '80-90', '90+'][FAV_BANDS.findIndex(([a, b]) => f >= a && f < b)]; };
const levelGroup = (l) => (/grand_slam/.test(l) ? 'slam' : /1000/.test(l) ? '1000' : /500/.test(l) ? '500' : /250/.test(l) ? '250' : /125|itf|challenger/.test(l) ? 'lower (125/ITF/Challenger)' : /finals|olympics/.test(l) ? 'finals/olympics' : 'unknown');
const SEG = { surface: (r) => r.surface, level: (r) => levelGroup(r.level), favourite_band: (r) => favBand(r.champion) };
function segTables(rs) {
  const out = {}; const fails = [];
  for (const [name, fn] of Object.entries(SEG)) {
    const g = new Map();
    for (const r of rs) { const k = fn(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    out[name] = [...g.entries()].sort().map(([k, xs]) => {
      const mc = metrics(xs.map((r) => r.champion), xs.map((r) => r.y)); const mx = metrics(xs.map((r) => r.challenger), xs.map((r) => r.y));
      const bt = xs.length >= 200 ? pairedBootstrap(xs, xs.map((r) => r.challenger), xs.map((r) => r.champion), { reps: 300 }) : null;
      if (bt && bt.ci95_log_loss[0] > 0) fails.push(`${name}:${k}`);
      return { group: k, n: xs.length, champion_log_loss: mc.log_loss, challenger_log_loss: mx.log_loss, delta: Math.round((mx.log_loss - mc.log_loss) * 1e4) / 1e4, champion_brier: mc.brier, challenger_brier: mx.brier, ci95: bt?.ci95_log_loss ?? null };
    });
  }
  return { out, fails };
}
const grade = (rs) => {
  if (!rs.length) return { n: 0 };
  const mc = metrics(rs.map((r) => r.champion), rs.map((r) => r.y)); const mx = metrics(rs.map((r) => r.challenger), rs.map((r) => r.y));
  const seg = segTables(rs);
  const surfaces = new Map(); for (const r of rs) surfaces.set(r.surface, (surfaces.get(r.surface) || 0) + 1);
  const t = { n: rs.length, clusters: new Set(rs.map((r) => r.edition)).size, surfaces_with_100: [...surfaces.entries()].filter(([k, v]) => k !== 'unknown' && v >= 100).length,
    champion: strip(mc), challenger: strip(mx), delta: { log_loss: Math.round((mx.log_loss - mc.log_loss) * 1e4) / 1e4, brier: Math.round((mx.brier - mc.brier) * 1e4) / 1e4, ece: Math.round((mx.ece - mc.ece) * 1e4) / 1e4 },
    paired: rs.length >= 30 ? pairedBootstrap(rs, rs.map((r) => r.challenger), rs.map((r) => r.champion), PROMOTION_GATE.bootstrap) : 'needs >= 30 graded matches',
    reliability: { champion: mc.reliability, challenger: mx.reliability }, segments: seg.out, segment_failures: seg.fails };
  t.gate = gateStatus(t);
  return t;
};
function strip(m) { const { reliability, ...x } = m; return x; }
const evidence = { generated_at: new Date().toISOString(), internal_only: true, lane: 'mm2-shadow/1 (research-only; published probability never replaced)', model_version: PROMOTION_GATE.model_version, coef_hash: PROMOTION_GATE.coef_hash, promotion_gate: PROMOTION_GATE, from: FROM, shadow_records: recs.length, matches_with_shadow: byMatch.size, graded: rows.length, pending, ATP: grade(by('ATP')), WTA: grade(by('WTA')), rows, note: 'prospective: every challenger probability was written before play from the frozen coefficients; promotion remains an owner decision' };
fs.writeFileSync('docs/evidence/matchup-model-v2-shadow-latest.json', JSON.stringify(evidence, null, 1));
const f4 = (x) => (x == null ? '–' : x);
const md = [`# Matchup Model V2 — shadow scoreboard (INTERNAL, research only)`, '', `Generated ${evidence.generated_at} · ${PROMOTION_GATE.model_version} · coef_hash ${PROMOTION_GATE.coef_hash.slice(0, 12)}… · gate ${PROMOTION_GATE.gate_version}`, '', 'Probability quality only: no ROI, units or betting claims. The published PBE Rating is unchanged.', ''];
for (const t of ['ATP', 'WTA']) {
  const g = evidence[t]; const P = pending[t];
  md.push(`## ${t}`, '', `Graded ${g.n || 0} · pending ${P.pending_unfinished} · excluded ${JSON.stringify(P.excluded)} · unscored ${JSON.stringify(P.unscored)}`);
  if (g.n) {
    md.push('', '| | Champion | B | Delta |', '|---|---|---|---|', `| Log loss | ${g.champion.log_loss} | ${g.challenger.log_loss} | ${g.delta.log_loss} |`, `| Brier | ${g.champion.brier} | ${g.challenger.brier} | ${g.delta.brier} |`, `| ECE | ${g.champion.ece} | ${g.challenger.ece} | ${g.delta.ece} |`, '',
      `Edition clusters ${g.clusters} · surfaces with 100+ graded ${g.surfaces_with_100} · paired 95% CI ${typeof g.paired === 'object' ? g.paired.ci95_log_loss.join(' to ') : g.paired}`, '');
    for (const [k, arr] of Object.entries(g.segments)) md.push(`**${k}:** ` + arr.map((x) => `${x.group} n=${x.n} Δ${x.delta}`).join(' · '));
    md.push('', `Gate met: **${g.gate.met}** — ${Object.entries(g.gate.checks).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join(', ')}`, '');
  } else md.push('', 'No graded predictions yet.', '');
}
fs.writeFileSync('docs/evidence/matchup-model-v2-shadow-latest.md', md.join('\n'));
console.log(JSON.stringify({ records: recs.length, matches: byMatch.size, graded: rows.length, pending, ATP: evidence.ATP.n ? { n: evidence.ATP.n, champion: evidence.ATP.champion.log_loss, challenger: evidence.ATP.challenger.log_loss, gate: evidence.ATP.gate.met } : 0, WTA: evidence.WTA.n ? { n: evidence.WTA.n, champion: evidence.WTA.champion.log_loss, challenger: evidence.WTA.challenger.log_loss, gate: evidence.WTA.gate.met } : 0 }));
