#!/usr/bin/env node
// WTA historical coverage report (ESPN WTA secondary lane + official WTA player history + rankings).
//   node scripts/coverage/wta.mjs [recon.json]   -> docs/evidence/wta-coverage-latest.json
// Counts only. `before` = the graph measured before the WTA lanes' first writes (2026-09-27 16:00 UTC).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 64 << 20 }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0); if (!at.length) return []; const v = JSON.parse(out.slice(Math.min(...at))); return Array.isArray(v) ? v : [v]; };
const one = (q) => sql(q)[0] || {};
const BEFORE = { captured_at: '2026-09-27T16:00Z', ws_matches: 9368, wd_matches: 2715, wta_years: '2025-2026', wta_singles_ledger: 9321, wta_ranking_snapshots_official: 7, wta_ranking_snapshots_espn: 0 };

const now = one(`select (select count(*) from tennis_matches where event_type='WS') ws_matches, (select count(*) from tennis_matches where event_type='WD') wd_matches,
  (select min(e.year)||'-'||max(e.year) from tennis_matches m join tennis_tournament_editions e using (edition_id) where m.event_type in ('WS','WD')) wta_years,
  (select count(*) from tennis_ranking_snapshots where list_key='wta_singles' and source_family='wta') wta_ranking_snapshots_official,
  (select count(*) from tennis_ranking_snapshots where list_key='wta_singles' and source_family='espn') wta_ranking_snapshots_espn,
  (select count(*) from tennis_players where gender='F') women_players`);
const espn = one(`select
  (select count(distinct substring(url from 'events/([0-9]+-[0-9]{4})')) from tennis_source_captures where adapter='espn.wta.event') events_captured,
  (select count(*) from tennis_matches where source_family='espn' and event_type in ('WS','WD')) founded,
  (select count(*) from tennis_matches where source_family='espn' and event_type='WS') founded_ws,
  (select count(*) from tennis_matches where source_family='espn' and event_type='WD') founded_wd,
  (select count(*) from tennis_matches where source_family='espn' and event_type in ('WS','WD') and round like 'Q-%') founded_qualifying,
  (select count(*) from tennis_match_external_ids x join tennis_matches m using (match_id) where x.provider='espn' and m.event_type in ('WS','WD') and m.source_family<>'espn') attached_to_official,
  (select count(*) from tennis_edition_external_ids where provider='espn_wta') editions_mapped_to_official,
  (select count(*) from tennis_ingest_holds where provider='espn' and resolved_at is null and entity_type='match' and problems::text like '%duplicate_candidate%' and (payload->>'provider_match_id') is not null and exists (select 1 from tennis_source_captures c where c.adapter='espn.wta.event' and c.url like '%/events/'||split_part(tennis_ingest_holds.external_id,':',1))) duplicate_candidates,
  (select count(*) from tennis_ingest_holds where provider='espn' and resolved_at is null and entity_type='cross_source' and exists (select 1 from tennis_matches m where m.match_id=(payload->>'match_id')::uuid and m.event_type in ('WS','WD'))) cross_source_disagreements`);
const hist = one(`select
  (select count(*) from tennis_matches where source_family='wta_history') founded,
  (select count(*) from tennis_matches where source_family='wta_history' and event_type='WS') founded_ws,
  (select count(*) from tennis_matches where source_family='wta_history' and event_type='WD') founded_wd,
  (select count(*) from tennis_match_external_ids x join tennis_matches m using (match_id) where x.provider='wta_history' and m.source_family<>'wta_history') attached_to_other_rows,
  (select count(*) from tennis_match_external_ids x join tennis_matches m using (match_id) where x.provider='espn' and m.source_family='wta_history') espn_rows_taken_over,
  (select min(e.year)||'-'||max(e.year) from tennis_matches m join tennis_tournament_editions e using (edition_id) where m.source_family='wta_history') years,
  (select count(*) from tennis_ingest_holds where provider='wta_history' and resolved_at is null) held`);
const ident = one(`select (select count(*) from tennis_player_external_ids x join tennis_players p using (pbe_player_id) where x.provider='espn' and p.gender='F') espn_women_resolved,
  (select count(*) from tennis_identity_queue q where q.provider='espn' and q.status in ('unresolved','ambiguous')) espn_unresolved_all_tours`);
const dup = one(`with k as (select m.edition_id, m.event_type, case when m.round like 'Q-%' then 'q' when m.round='RR' then 'rr' else 'm' end st, least(a.participant_key,b.participant_key) x, greatest(a.participant_key,b.participant_key) y from tennis_matches m join tennis_match_participants a on a.match_id=m.match_id and a.side='A' join tennis_match_participants b on b.match_id=m.match_id and b.side='B' where m.event_type in ('WS','WD')) select count(*) groups from (select 1 from k group by edition_id, event_type, st, x, y having count(*) > 1) d`);
const byYear = sql(`select e.year, count(*) filter (where m.event_type='WS') ws, count(*) filter (where m.event_type='WD') wd, count(*) filter (where m.source_family='espn') espn, count(*) filter (where m.source_family='wta_history') history, count(*) filter (where m.source_family not in ('espn','wta_history')) official_feeds from tennis_matches m join tennis_tournament_editions e using (edition_id) where m.event_type in ('WS','WD') group by 1 order by 1`);
const ranks = sql(`select substring(ranking_date::text from 1 for 4) year, source_family, count(*) lists from tennis_ranking_snapshots where list_key='wta_singles' group by 1,2 order by 1,2`);
let recon = null;
if (process.argv[2] && fs.existsSync(process.argv[2])) {
  const r = Object.values(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  const sum = (k) => r.reduce((t, x) => t + (x[k] || 0), 0);
  recon = { weeks_compared: r.length, espn_rows: sum('espn_rows'), linked: sum('linked'), in_official: sum('in_official'), rank_equal: sum('rank_equal'), points_equal: sum('points_equal'), rank_agreement: sum('in_official') ? Math.round((sum('rank_equal') / sum('in_official')) * 1000) / 1000 : null, points_agreement: sum('in_official') ? Math.round((sum('points_equal') / sum('in_official')) * 1000) / 1000 : null, days_apart: [...new Set(r.map((x) => x.days_apart))].sort(), weeks: r };
}
const doc = { generated_at: new Date().toISOString(), before: BEFORE, now, duplicate_groups_ws_wd: Number(dup.groups), espn_wta: espn, wta_history: hist, identity: ident, by_year: byYear, ranking_lists_by_year: ranks, ranking_reconciliation: recon };
fs.writeFileSync('docs/evidence/wta-coverage-latest.json', `${JSON.stringify(doc, null, 2)}\n`);
console.log(JSON.stringify({ now, duplicate_groups: dup.groups, espn_wta: espn, wta_history: hist, identity: ident, recon: recon && { ...recon, weeks: undefined } }, null, 1));
