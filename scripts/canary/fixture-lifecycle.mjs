#!/usr/bin/env node
// Fixture lifecycle canary (Phase 6 closeout). Read-only.
//   node scripts/canary/fixture-lifecycle.mjs baseline   -> docs/evidence/fixtures/baseline.json (every upcoming ESPN fixture)
//   node scripts/canary/fixture-lifecycle.mjs check      -> docs/evidence/fixtures/check-<ts>.json
// check, per baseline fixture that has since started: same match row, same natural key, same external id -> same row,
// exactly one row per (edition, natural key), status final with score + winner that agree with the ESPN source line,
// never back to scheduled, gone from /v1/matchups, and eligible for the DNA ledger (singles completed/retired).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseResultNote } from '../../workers/providers/espn.js';

const mode = process.argv[2];
const DIR = path.resolve('docs/evidence/fixtures');
fs.mkdirSync(DIR, { recursive: true });
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 64 << 20 }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((i) => i >= 0); if (!at.length) return []; const v = JSON.parse(out.slice(Math.min(...at))); return Array.isArray(v) ? v : [v]; };
const UA = { 'user-agent': 'PropBetEdge-Tennis/1.0 (+https://tennis.propbetedge.ai; data@propbetedge.ai)', accept: 'application/json' };
const rowsFor = (where) => sql(`select m.match_id, m.edition_id, e.name edition, m.event_type, m.round, m.status, m.winner_side, m.end_reason, m.score_text, m.scheduled_at, m.natural_key, m.source_family, m.updated_at,
  (select json_agg(json_build_object('provider', x.provider, 'external_id', x.external_id) order by x.provider, x.external_id) from tennis_match_external_ids x where x.match_id = m.match_id) ext,
  (select json_agg(json_build_object('side', p.side, 'key', p.participant_key, 'name', coalesce(pl.full_name, '')) order by p.side) from tennis_match_participants p left join tennis_participant_members pm on pm.participant_key = p.participant_key and pm.slot = 1 left join tennis_players pl on pl.pbe_player_id = pm.pbe_player_id where p.match_id = m.match_id) parts
  from tennis_matches m join tennis_tournament_editions e using (edition_id) where ${where} order by m.scheduled_at, m.match_id`);

if (mode === 'baseline') {
  const rows = rowsFor(`m.status = 'scheduled' and m.source_family = 'espn' and m.scheduled_at > now() - interval '6 hours'`);
  fs.writeFileSync(path.join(DIR, 'baseline.json'), `${JSON.stringify({ captured_at: new Date().toISOString(), fixtures: rows }, null, 1)}\n`);
  console.log(`baseline: ${rows.length} fixtures (${rows.filter((r) => r.event_type === 'MS').length} MS, ${rows.filter((r) => r.event_type === 'MD').length} MD)`);
  process.exit(0);
}
if (mode !== 'check') { console.error('usage: fixture-lifecycle.mjs baseline|check'); process.exit(2); }

const base = JSON.parse(fs.readFileSync(path.join(DIR, 'baseline.json'), 'utf8'));
const started = base.fixtures.filter((f) => Date.parse(f.scheduled_at) < Date.now());
const ids = started.map((f) => `'${f.match_id}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`;
const now = new Map(rowsFor(`m.match_id in (${ids})`).map((r) => [r.match_id, r]));
// duplicates: any other row with the same edition + natural key, or an ESPN id pointing elsewhere
const dups = started.length ? sql(`select m.edition_id, m.natural_key, count(*) n from tennis_matches m where (m.edition_id, m.natural_key) in (${started.map((f) => `('${f.edition_id}','${f.natural_key.replace(/'/g, "''")}')`).join(',')}) group by 1,2 having count(*) > 1`) : [];
const matchups = (await (await fetch(`https://tennis-api.propbetedge.ai/v1/matchups?lc=${Date.now()}`)).json()).data?.matchups || [];
const listed = new Set(matchups.map((x) => x.match.id));
const espnCache = new Map();
async function espnComp(extId) {
  const [ev, comp] = extId.split(':');
  if (!espnCache.has(ev)) espnCache.set(ev, (await fetch(`https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/events/${ev}`, { headers: UA })).json());
  const j = await espnCache.get(ev);
  return (j.competitions || []).find((c) => c.id === comp) || null;
}
const results = [];
for (const f of started) {
  const r = now.get(f.match_id);
  const ext = (f.ext || []).find((x) => x.provider === 'espn');
  const c = [];
  const ok = (name, pass, detail = null) => c.push({ name, pass: !!pass, ...(detail ? { detail } : {}) });
  ok('same canonical row exists', r);
  if (!r) { results.push({ match_id: f.match_id, checks: c }); continue; }
  ok('same natural_key', r.natural_key === f.natural_key, `${f.natural_key} -> ${r.natural_key}`);
  ok('same external ids', JSON.stringify(r.ext) === JSON.stringify(f.ext));
  ok('no second row for the pair', !dups.some((d) => d.edition_id === r.edition_id && d.natural_key === r.natural_key));
  const final = ['completed', 'retired', 'walkover'].includes(r.status);
  ok('not listed in /v1/matchups once started > 6 h ago or final', !(final || Date.parse(r.scheduled_at) < Date.now() - 6 * 3600e3) || !listed.has(r.match_id));
  let source = null;
  if (ext) {
    const comp = await espnComp(ext.external_id);
    const note = (comp?.notes || []).map((n) => n.text).find((t) => / bt /.test(String(t)));
    const pr = note ? parseResultNote(note) : null;
    const wFlag = (comp?.competitors || []).findIndex((x) => x.winner === true);
    source = { round: comp?.round?.description || null, note: note || null, winner_index: wFlag, date: comp?.date || null };
    if (final && pr) {
      const winnerSide = [...(comp.competitors || [])].sort((a, b) => (a.order ?? 9) - (b.order ?? 9)).findIndex((x) => x.winner === true) === 0 ? 'A' : 'B';
      ok('winner agrees with the source', r.winner_side === winnerSide, `${r.winner_side} vs source ${winnerSide}`);
      const wsets = pr.sets.map((s) => `${s.w}-${s.l}`);
      const stored = String(r.score_text || '').split(' ').filter((t) => /^\d/.test(t)).map((t) => t.replace(/\(.*\)/, '')).map((t) => (r.winner_side === 'B' ? t.split('-').reverse().join('-') : t));
      ok('final score agrees with the source line (games per set)', JSON.stringify(stored) === JSON.stringify(wsets), `${r.score_text} vs "${note}"`);
    }
  }
  const state = final ? 'final' : r.status === 'scheduled' ? (Date.parse(r.scheduled_at) < Date.now() - 6 * 3600e3 ? 'stale_scheduled' : 'scheduled_recent') : r.status;
  if (final) ok('DNA ledger eligible (singles completed/retired) or doubles (not a Match DNA input)', r.event_type === 'MD' || ['completed', 'retired'].includes(r.status));
  results.push({ match_id: r.match_id, edition: r.edition, event_type: r.event_type, round: r.round, players: (r.parts || []).map((p) => p.name).join(' v '), baseline_status: f.status, status: r.status, end_reason: r.end_reason, score: r.score_text, state, source, checks: c });
}
const out = { run_at: new Date().toISOString(), baseline_at: base.captured_at, baseline: base.fixtures.length, started: started.length,
  final: results.filter((x) => x.state === 'final').length, by_status: results.reduce((t, x) => ({ ...t, [x.status]: (t[x.status] || 0) + 1 }), {}),
  duplicate_groups: dups.length, failures: results.flatMap((x) => x.checks.filter((k) => !k.pass).map((k) => `${x.match_id} ${k.name} ${k.detail || ''}`)), results };
fs.writeFileSync(path.join(DIR, `check-${out.run_at.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ baseline: out.baseline, started: out.started, final: out.final, by_status: out.by_status, duplicate_groups: out.duplicate_groups, failures: out.failures.length }));
for (const f of out.failures.slice(0, 20)) console.log('FAIL', f);
