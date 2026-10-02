// Matchup Model V2 — grade the RESEARCH-ONLY prospective shadow records (tennis-api mm2-shadow.js) after the results.
// Read-only: R2 research/mm2/shadow-index/<day>.json via wrangler + match results by SELECT. One graded row per match:
// the LAST record written before play (latest frozen_at), completed matches only (retirements / walkovers not graded).
// Champion = the probability exactly as frozen and served; challenger = mm2-B-context/1. Identical rows for both.
//   node scripts/research/mm2/grade-shadow.mjs [from=2026-10-02]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { metrics, pairedBootstrap } from './lib/model.mjs';

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
const last = new Map();
for (const r of recs) if (!last.has(r.match_id) || r.frozen_at > last.get(r.match_id).frozen_at) last.set(r.match_id, r);
const ids = [...last.keys()];
let results = [];
if (ids.length) {
  const q = `select json_agg(json_build_object('match_id', match_id, 'status', status, 'winner_side', winner_side, 'started_at', started_at))::text j from tennis_matches where match_id in (${ids.map((x) => `'${x}'`).join(',')})`;
  const out = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim());
  results = JSON.parse((Array.isArray(out) ? out[0] : out).j || '[]');
}
const res = new Map(results.map((r) => [r.match_id, r]));
const rows = []; const pending = { scheduled_or_live: 0, not_graded: {}, unscored: {} };
for (const r of last.values()) {
  const m = res.get(r.match_id);
  if (!r.challenger) { pending.unscored[r.reason] = (pending.unscored[r.reason] || 0) + 1; continue; }
  if (!m || !['completed'].includes(m.status) || !['A', 'B'].includes(m.winner_side)) { if (!m || ['scheduled', 'in_progress', 'suspended'].includes(m.status)) pending.scheduled_or_live += 1; else pending.not_graded[m.status] = (pending.not_graded[m.status] || 0) + 1; continue; }
  if (m.started_at && Date.parse(m.started_at) <= Date.parse(r.frozen_at)) { pending.not_graded.frozen_after_start = (pending.not_graded.frozen_after_start || 0) + 1; continue; }
  rows.push({ match_id: r.match_id, tour: r.tour, edition: r.match_id, y: m.winner_side === 'A' ? 1 : 0, champion: r.champion.probability.A, challenger: r.challenger.probability.A, frozen_at: r.frozen_at, feature_hash: r.feature_hash, model_version: r.model_version });
}
const by = (t) => rows.filter((r) => !t || r.tour === t);
const grade = (rs) => (rs.length ? { n: rs.length, champion: strip(metrics(rs.map((r) => r.champion), rs.map((r) => r.y))), challenger: strip(metrics(rs.map((r) => r.challenger), rs.map((r) => r.y))), paired: rs.length >= 30 ? pairedBootstrap(rs, rs.map((r) => r.challenger), rs.map((r) => r.champion)) : 'needs >= 30 graded matches' } : { n: 0 });
function strip(m) { const { reliability, ...x } = m; return x; }
const evidence = { generated_at: new Date().toISOString(), lane: 'mm2-shadow/1 (research-only; published probability never replaced)', from: FROM, shadow_records: recs.length, matches_with_shadow: last.size, graded: rows.length, pending, overall: grade(by()), ATP: grade(by('ATP')), WTA: grade(by('WTA')), rows, note: 'prospective: every challenger probability was written before play from the frozen coefficients; promotion remains an owner decision' };
fs.writeFileSync('docs/evidence/matchup-model-v2-shadow-latest.json', JSON.stringify(evidence, null, 1));
console.log(JSON.stringify({ records: recs.length, matches: last.size, graded: rows.length, pending, overall: evidence.overall.n ? { champion: evidence.overall.champion.log_loss, challenger: evidence.overall.challenger.log_loss } : null }));
