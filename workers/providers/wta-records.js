// WTA player aggregates (official WTA API), kept AS REPORTED for validation and for the history our match
// ledger cannot give. docs/TENNIS_SOURCE_MATRIX.md (wta.player).
//   /players/{id}/records   career W-L / titles / finals by tournament level, by surface, by tournament (with the
//                           player's best result per year); lastSyncedTimestamp. Tour-level counting (the WTA's
//                           own), not our ledger's — compared, never merged (scripts/context/records-compare.sql).
//   /players/{id}/year/{y}  one season's serve / return COUNTS (aces, double faults, serve and return points and
//                           games, break points), MatchCount, StatisticLevel TOUR, Surface All. Seasons before the
//                           WTA's stats coverage return the player object only (observed 2016 for 320760) -> absent.

import { safeJson, requirePaths } from '../shared/adapter.js';

const API = 'https://api.wtatennis.com/tennis';
const PARSER = '1';
const stat = (s) => (s ? { matches: s.matchesPlayed ?? null, wins: s.wins ?? null, losses: s.losses ?? null, titles: s.titles ?? null, finals: s.finals ?? null } : null);

export const playerRecords = {
  key: 'wta.player.records', family: 'wta', capabilities: ['player_records'], parser_version: PARSER, cadence: { class: 'weekly', min_interval_s: 7 * 86400 },
  request: ({ id }) => ({ url: `${API}/players/${id}/records` }),
  shape: (body) => { const j = safeJson(body); if (!j) return ['not_json']; return requirePaths(j, ['player.id', 'byTournamentLevel']); },
  parse: (body) => {
    const j = safeJson(body);
    return [{
      type: 'player_records', provider_player_id: String(j.player.id), synced_at: j.lastSyncedTimestamp || null,
      payload: {
        by_level: (j.byTournamentLevel || []).map((x) => ({ level: x.level, ...stat(x.statistics), best: x.bestResult?.resultCode ?? null })),
        by_surface: (j.bySurface || []).map((x) => ({ surface: String(x.surface || '').toLowerCase() || null, ...stat(x.statistics) })),
        by_tournament: (j.byTournament || []).map((x) => ({ group_id: x.tournament?.tournamentGroup?.id ?? null, name: x.tournament?.tournamentGroup?.name ?? null, ...stat(x.statistics), best: x.bestResult?.resultCode ?? null, years: (x.yearlyResults || []).map((y) => ({ year: y.year, level: y.tournamentLevel ?? null, result: y.result ?? null })) }))
      }
    }];
  }
};

const YEAR_FIELDS = ['Aces', 'Double_Faults', 'First_Serves_Played', 'First_Serves_Won', 'Second_Serves_Played', 'Second_Serves_Won', 'Service_Games_Played', 'Break_Points_Faced', 'Break_Points_Lost', 'First_Serve_Return_Chances', 'First_Return_Won', 'Second_Return_Chances', 'Second_Return_Won', 'Return_Games_Played', 'Break_Point_Chances', 'Break_Points_Converted', 'MatchCount'];

export const playerYear = {
  key: 'wta.player.year', family: 'wta', capabilities: ['season_stats'], parser_version: PARSER, cadence: { class: 'weekly', min_interval_s: 7 * 86400 },
  request: ({ id, year }) => ({ url: `${API}/players/${id}/year/${year}` }),
  shape: (body) => { const j = safeJson(body); if (!j) return ['not_json']; return requirePaths(j, ['player.id']); },
  parse: (body) => {
    const j = safeJson(body);
    const s = j.stats;
    if (!s || s.Scope !== 'YEAR') return []; // season outside the WTA's stats coverage: absent, not zero
    const out = { level: s.StatisticLevel ?? null, surface: s.Surface ?? null, is_final: s.IsFinal ?? null, year: s.AggregateData?.TournamentYear ?? null };
    for (const k of YEAR_FIELDS) out[k.toLowerCase()] = Number.isFinite(s[k]) ? s[k] : null;
    return [{ type: 'season_stats', provider_player_id: String(j.player.id), payload: out }];
  }
};
