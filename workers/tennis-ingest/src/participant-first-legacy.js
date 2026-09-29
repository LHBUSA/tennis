// The PRE-2026-09-28 participant-first queries, kept VERBATIM for parity checks only (read-only probe lane and tests).
// Production code does not call these: they are the 57014 timeout class (participant_key list + inner LATERAL embeds +
// ORDER BY match_id + LIMIT/OFFSET -> the planner can walk whole primary-key indexes). Delete once parity is settled.
import { inList } from '../../shared/store/postgrest.js';

/** espn-jobs.js mapOfficialEdition candidate step: match_id -> { keys, m } (the old byMatch map). */
export async function legacyOfficialEditionMatches(store, year, keys) {
  const byMatch = new Map();
  for (let i = 0; i < keys.length; i += 60) {
    for (let off = 0; ; off += 1000) {
      const rows = await store.select('tennis_match_participants', `select=match_id,participant_key,tennis_matches!inner(edition_id,event_type,tennis_tournament_editions!inner(year,start_date,end_date,source_family,surface,indoor,name))&participant_key=${inList(keys.slice(i, i + 60))}&tennis_matches.event_type=eq.WS&tennis_matches.tennis_tournament_editions.year=eq.${year}&order=match_id.asc&limit=1000&offset=${off}`);
      for (const r of rows) { if (!byMatch.has(r.match_id)) byMatch.set(r.match_id, { keys: [], m: r.tennis_matches }); byMatch.get(r.match_id).keys.push(r.participant_key); }
      if (rows.length < 1000) break;
    }
  }
  return byMatch;
}

/** wta-history-job.js playerIndex row fetch: every participant row of the player's keys, with the match embed. */
export async function legacyPlayerRows(store, mine) {
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const page = await store.select('tennis_match_participants', `select=match_id,participant_key,tennis_matches!inner(edition_id,event_type,round,source_family,tennis_tournament_editions(start_date,end_date,source_family),tennis_match_participants(participant_key))&participant_key=${inList([...mine])}&order=match_id.asc&limit=1000&offset=${off}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}
