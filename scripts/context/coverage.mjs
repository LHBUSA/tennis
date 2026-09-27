#!/usr/bin/env node
// Phase 5 context coverage report (counts only) -> docs/evidence/context-coverage-latest.json
//   node scripts/context/coverage.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 64 << 20 }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0); if (!at.length) return []; const v = JSON.parse(out.slice(Math.min(...at))); return Array.isArray(v) ? v : [v]; };
const kvCount = (prefix) => {
  try {
    const out = execFileSync('npx', ['wrangler', 'kv', 'key', 'list', '--namespace-id', 'a117d7b3846c4a39a27ee74c49574c99', '--remote', '--prefix', prefix], { cwd: 'workers/tennis-ingest', encoding: 'utf8', maxBuffer: 64 << 20, shell: true });
    return JSON.parse(out.slice(out.indexOf('['))).length;
  } catch { return null; }
};

const mappings = sql(`select entity_type, provider, status, method, confidence, count(*) n from tennis_source_mappings group by 1,2,3,4,5 order by 1,2,3,4,5`);
const surfaceByYear = sql(`select e.year, m.event_type, count(*) matches, count(*) filter (where coalesce(e.surface, m.surface) is not null) with_surface,
  count(*) filter (where exists (select 1 from tennis_edition_attributes a where a.edition_id = e.edition_id and a.attribute = 'surface' and a.method = 'direct')) sourced_direct,
  count(*) filter (where exists (select 1 from tennis_edition_attributes a where a.edition_id = e.edition_id and a.attribute = 'surface' and a.method = 'combined_event')) sourced_combined
  from tennis_matches m join tennis_tournament_editions e using (edition_id) where m.event_type in ('MS','WS') group by 1,2 order by 1,2`);
const surfaceTotals = sql(`select m.event_type, count(*) matches, count(*) filter (where coalesce(e.surface, m.surface) is not null) with_surface from tennis_matches m join tennis_tournament_editions e using (edition_id) where m.event_type in ('MS','WS') group by 1`);
const attributes = sql(`select attribute, source, method, count(*) n from tennis_edition_attributes group by 1,2,3 order by 1,2,3`);
const drawSlots = sql(`select source, e.year, count(distinct s.edition_id) editions, count(*) slots, count(*) filter (where s.participant_key is not null) resolved, count(*) filter (where s.seed is not null) seeded from tennis_draw_slots s join tennis_tournament_editions e using (edition_id) group by 1,2 order by 1,2`);
const records = sql(`select provider, kind, count(*) rows, count(distinct pbe_player_id) players from tennis_player_source_records group by 1,2 order by 1,2`);
const espnCoverage = sql(`select payload->>'league' league, period season, count(*) players, sum((payload->'eventlog'->>'played')::int) competitions_played, sum((payload->'eventlog'->>'held_in_graph')::int) held_in_graph, count(*) filter (where payload->'stats' is not null and payload->>'stats' <> 'null') with_stats from tennis_player_source_records where provider = 'espn' and kind = 'season_record' group by 1,2 order by 1,2`);
const disagreements = sql(`select source, field, entity_type, count(*) n from tennis_source_disagreements where resolved_at is null group by 1,2,3 order by 4 desc`);
const changes = sql(`select kind, source_family, count(*) n from tennis_source_changes where kind in ('duplicate_merged','edition_moved','edition_merged') and observed_at >= '2026-09-28' group by 1,2 order by 1,2`);
const history = sql(`select (select count(*) from tennis_matches where source_family = 'wta_history') rows_founded,
  (select count(*) from tennis_match_external_ids x join tennis_matches m using (match_id) where x.provider = 'wta_history' and m.source_family <> 'wta_history') attached_to_other_rows,
  (select count(*) from tennis_ingest_holds where provider = 'wta_history' and resolved_at is null) held_open,
  (select count(*) from tennis_ingest_holds where provider = 'wta_history' and resolved_at is null and problems::text like '%duplicate_candidate%') duplicate_candidates_held,
  (select count(*) from tennis_ingest_holds where provider = 'wta_history' and resolved_at is null and entity_type = 'cross_source') conflicts`)[0];
const holdReasons = sql(`select split_part(external_id, '-', 3) event, case when problems::text like '%score_invalid%' then 'score_invalid' when problems::text like '%winner_disagrees%' then 'winner_disagrees_with_score' when problems::text like '%unmapped_reason%' then 'unmapped_reason' when problems::text like '%unmapped_round%' then 'unmapped_round' when problems::text like '%duplicate_candidate%' then 'duplicate_candidate' else 'other' end reason, count(*) n from tennis_ingest_holds where provider = 'wta_history' and resolved_at is null group by 1,2 order by 3 desc`);
const identity = sql(`select provider, status, count(*) n from tennis_identity_queue where status in ('unresolved','ambiguous') group by 1,2 order by 3 desc`);
const queue = JSON.parse(execFileSync('npx', ['wrangler', 'kv', 'key', 'get', '--namespace-id', 'a117d7b3846c4a39a27ee74c49574c99', '--remote', 'wh:queue'], { cwd: 'workers/tennis-ingest', encoding: 'utf8', maxBuffer: 64 << 20, shell: true }));
const doneKeys = kvCount('wh:done:');

const doc = { generated_at: new Date().toISOString(), history_backfill: { population: queue.length, players_with_completion_record: doneKeys, ...history, open_holds_by_reason: holdReasons }, mappings, attributes, surface: { totals: surfaceTotals, by_year: surfaceByYear }, draw_slots: drawSlots, source_records: records, espn_eventlog_coverage: espnCoverage, disagreements, consolidation_changes: changes, identity_open: identity };
fs.writeFileSync('docs/evidence/context-coverage-latest.json', `${JSON.stringify(doc, null, 1)}\n`);
console.log(JSON.stringify({ history_backfill: doc.history_backfill, surface: surfaceTotals, records, disagreements: disagreements.slice(0, 6) }, null, 1));
