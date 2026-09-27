#!/usr/bin/env node
// ESPN ATP lane coverage / quality report (production store, read-only SQL).
//   node scripts/coverage/espn-atp.mjs   -> docs/evidence/espn-atp-coverage-latest.json
// Counts only. "before" is the graph measured immediately before the lane's first deploy (2026-09-27 10:2x UTC).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 64 << 20 }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0); if (!at.length) return []; const v = JSON.parse(out.slice(Math.min(...at))); return Array.isArray(v) ? v : [v]; };
const one = (q) => sql(q)[0] || {};
const BEFORE = { captured_at: '2026-09-27T10:20Z', men_matches_ms_md: 3725, ms: 3087, md: 638, xd: 31, men_editions: 56, tournaments: 918, editions: 1492, men_players: 648, espn_player_ids: 0, atp_ranking_snapshots: 0, men_years: '1979-2026' };

const now = one(`select
  (select count(*) from tennis_matches where event_type in ('MS','MD')) men_matches_ms_md,
  (select count(*) from tennis_matches where event_type='MS') ms, (select count(*) from tennis_matches where event_type='MD') md, (select count(*) from tennis_matches where event_type='XD') xd,
  (select count(distinct edition_id) from tennis_matches where event_type in ('MS','MD')) men_editions,
  (select count(*) from tennis_tournaments) tournaments, (select count(*) from tennis_tournament_editions) editions,
  (select count(*) from tennis_players where gender='M') men_players, (select count(*) from tennis_player_external_ids where provider='espn') espn_player_ids,
  (select count(*) from tennis_ranking_snapshots where list_key='atp_singles') atp_ranking_snapshots`);

const lane = one(`select
  (select count(*) from tennis_matches where source_family='espn') matches_added,
  (select count(*) from tennis_matches where source_family='espn' and event_type='MS') singles_added,
  (select count(*) from tennis_matches where source_family='espn' and event_type='MD') doubles_added,
  (select count(*) from tennis_matches where source_family='espn' and event_type='XD') mixed_added,
  (select count(*) from tennis_matches where source_family='espn' and round like 'Q-%') qualifying_added,
  (select count(*) from tennis_matches where source_family='espn' and status='retired') retirements_added,
  (select count(*) from tennis_matches where source_family='espn' and status='walkover') walkovers_added,
  (select count(*) from tennis_match_external_ids x join tennis_matches m using (match_id) where x.provider='espn' and m.source_family<>'espn') source_links_attached_to_existing,
  (select count(*) from tennis_tournament_editions where source_family='espn') editions_added,
  (select count(*) from tennis_tournaments t where exists (select 1 from tennis_tournament_external_ids x where x.tournament_id=t.tournament_id and x.provider='espn') and not exists (select 1 from tennis_tournament_external_ids x where x.tournament_id=t.tournament_id and x.provider<>'espn') and t.slug not in ('australian-open','roland-garros','wimbledon','us-open')) tournaments_added,
  (select count(*) from tennis_player_external_ids where provider='espn') player_identities_resolved,
  (select count(*) from tennis_player_external_ids where provider='espn' and method='external_id') resolved_by_exact_id,
  (select count(*) from tennis_player_external_ids where provider='espn' and method='name_dob') resolved_by_name_dob,
  (select count(*) from tennis_identity_queue where provider='espn' and status='unresolved') identities_unresolved,
  (select count(*) from tennis_identity_queue where provider='espn' and status='ambiguous') identities_ambiguous_or_conflict,
  (select count(*) from tennis_ingest_holds where provider='espn' and resolved_at is null and entity_type='match' and problems::text like '%duplicate_candidate%') duplicate_candidates_held,
  (select count(*) from tennis_ingest_holds where provider='espn' and resolved_at is null and entity_type='cross_source') cross_source_disagreements,
  (select count(*) from tennis_ingest_holds where provider='espn' and resolved_at is null and entity_type='match' and problems::text like '%unresolved_identity%') matches_held_for_identity,
  (select count(*) from tennis_ingest_holds where provider='espn' and resolved_at is null and entity_type='match' and problems::text not like '%unresolved_identity%' and problems::text not like '%duplicate_candidate%') rejected_malformed_or_unproven,
  (select max(captured_at) from tennis_source_captures where source_family='espn') latest_capture,
  (select count(*) from tennis_source_captures where source_family='espn') espn_captures,
  (select count(*) from tennis_rankings r join tennis_ranking_snapshots s using (snapshot_id) where s.source_family='espn') ranking_rows,
  (select count(*) from tennis_rankings r join tennis_ranking_snapshots s using (snapshot_id) where s.source_family='espn' and r.pbe_player_id is not null) ranking_rows_linked,
  (select min(ranking_date)||' .. '||max(ranking_date) from tennis_ranking_snapshots where source_family='espn') ranking_dates`);

const heldReasons = sql(`select regexp_replace(p, '[:=].*$', '') problem, count(*) n from tennis_ingest_holds h, jsonb_array_elements_text(h.problems) p where provider='espn' and resolved_at is null group by 1 order by 2 desc`);
const byYear = sql(`select e.year, count(distinct e.edition_id) filter (where m.source_family='espn') espn_editions, count(*) filter (where m.source_family='espn') espn_matches, count(*) filter (where m.source_family='espn' and m.event_type='MS') espn_ms, count(*) filter (where m.source_family='espn' and m.event_type='MD') espn_md, count(*) filter (where m.event_type in ('MS','MD')) all_men_matches, count(distinct x.match_id) espn_links_on_official from tennis_matches m join tennis_tournament_editions e using (edition_id) left join tennis_match_external_ids x on x.match_id=m.match_id and x.provider='espn' and m.source_family<>'espn' where m.event_type in ('MS','MD','XD') group by 1 order by 1`);
const discovered = sql(`select substring(url from 'events/[0-9]+-([0-9]{4})') as year, count(distinct substring(url from 'events/([0-9]+-[0-9]{4})')) events from tennis_source_captures where adapter='espn.atp.event' group by 1 order by 1`);
const byLevel = sql(`select coalesce(e.competition_key, 'level_not_in_source') level, count(distinct e.edition_id) editions, count(*) matches from tennis_matches m join tennis_tournament_editions e using (edition_id) where m.source_family='espn' group by 1 order by 3 desc`);
const earliest = one(`select min(e.year) earliest_year_written from tennis_matches m join tennis_tournament_editions e using (edition_id) where m.source_family='espn'`);

const growth = Object.fromEntries(Object.keys(BEFORE).filter((k) => typeof BEFORE[k] === 'number').map((k) => [k, { before: BEFORE[k], now: Number(now[k]), added: Number(now[k]) - BEFORE[k] }]));
const doc = { generated_at: new Date().toISOString(), source: 'production store (tkmln) via scripts/db/run_sql.ps1', lane: 'espn_atp + espn_rankings', earliest_reliable_year_in_source: 2007, earliest_year_written: earliest.earliest_year_written ?? null, growth, lane_totals: lane, held_reasons: heldReasons, events_captured_by_year: discovered, coverage_by_season: byYear, coverage_by_level: byLevel, notes: ['surface and ATP level are not in the ESPN payload: non-Slam ESPN editions carry surface=null and competition_key only when the event name states it (ATP Finals, Olympics, Davis/United Cup)', 'ESPN carries no match statistics: Tennis DNA inputs are unchanged by this lane'] };
fs.writeFileSync('docs/evidence/espn-atp-coverage-latest.json', `${JSON.stringify(doc, null, 2)}\n`);
console.log(JSON.stringify({ growth, lane_totals: lane, held_reasons: heldReasons }, null, 1));
