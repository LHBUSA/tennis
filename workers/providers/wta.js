// WTA adapters — api.wtatennis.com (the JSON API wtatennis.com itself renders from). No key, no challenge.
// Shapes and code tables below are taken from captured responses (docs/evidence, tests/fixtures/wta),
// not from documentation. Codes we have not observed are NOT guessed: they surface as warnings.
//
// Rights: the WTA terms restrict automated harvesting (docs/TENNIS_SOURCE_MATRIX.md §Rights).
// These adapters run as read-only canaries; production ingestion waits on the owner's rights decision.

import { requirePaths, safeJson } from '../shared/adapter.js';

const API = 'https://api.wtatennis.com/tennis';
export const WTA_HOST = 'api.wtatennis.com';
// Observed: ~40-50% of connections reset and succeed on retry. Slow and patient, never faster.
export const WTA_POLICY = { min_interval_ms: 1500, max_concurrency: 1, jitter_ms: 500, retries: 4, backoff_ms: 2500, timeout_ms: 20000 };

const PARSER = '1';

/** Most recent Monday (UTC) on or before `date` — WTA ranking lists are dated Mondays. */
export function rankingMonday(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

const member = (p, gender = 'F') => ({ provider: 'wta', provider_id: String(p.id), first_name: p.firstName || null, last_name: p.lastName || null, full_name: p.fullName || null, country: p.countryCode || null, dob: p.dateOfBirth || null, gender });

// ---- rankings --------------------------------------------------------------------------------------
function rankingsAdapter(kind) {
  const doubles = kind === 'doubles';
  return {
    key: `wta.rankings.${kind}`,
    family: 'wta',
    capabilities: [doubles ? 'rankings_doubles' : 'rankings_singles', 'player_identity', 'player_bio', 'history'],
    parser_version: PARSER,
    cadence: { class: 'weekly', min_interval_s: 6 * 3600 },
    request: ({ at = rankingMonday(), pageSize = 100, page = 0 } = {}) => ({
      url: `${API}/players/ranked?page=${page}&pageSize=${pageSize}&type=${doubles ? 'rankDoubles' : 'rankSingles'}&sort=asc&metric=${doubles ? 'DOUBLES' : 'SINGLES'}&at=${at}`
    }),
    shape: (body) => {
      const j = safeJson(body);
      if (!Array.isArray(j)) return ['not_an_array'];
      if (!j.length) return ['empty_list'];
      return requirePaths(j[0], ['player.id', 'player.fullName', 'ranking', 'rankedAt']);
    },
    parse: (body) => safeJson(body).map((r) => ({
      type: 'ranking_row',
      list_key: doubles ? 'wta_doubles' : 'wta_singles',
      ranking_date: String(r.rankedAt).slice(0, 10),
      rank: r.ranking,
      points: r.points ?? null,
      tournaments_played: r.tournamentsPlayed ?? null,
      movement: r.movement ?? null,
      player: member(r.player)
    }))
  };
}

// ---- calendar ---------------------------------------------------------------------------------------
const SURFACE = { hard: 'hard', clay: 'clay', grass: 'grass', carpet: 'carpet' };
export const calendar = {
  key: 'wta.calendar',
  family: 'wta',
  capabilities: ['calendar'],
  parser_version: PARSER,
  cadence: { class: 'daily', min_interval_s: 12 * 3600 },
  request: ({ from, to, pageSize = 50 } = {}) => ({ url: `${API}/tournaments/?page=0&pageSize=${pageSize}&from=${from}&to=${to}` }),
  shape: (body) => {
    const j = safeJson(body);
    if (!j || !Array.isArray(j.content)) return ['missing_content'];
    return j.content.length ? requirePaths(j.content[0], ['tournamentGroup.id', 'year', 'startDate', 'endDate', 'level']) : [];
  },
  parse: (body) => safeJson(body).content.map((t) => ({
    type: 'tournament_edition',
    provider: 'wta',
    provider_tournament_id: String(t.tournamentGroup.id),
    live_scoring_id: t.liveScoringId ? String(t.liveScoringId) : null,
    year: t.year,
    name: t.tournamentGroup.name,
    title: t.title,
    level: t.level || t.tournamentGroup.level || null,
    start_date: t.startDate,
    end_date: t.endDate,
    surface: SURFACE[String(t.surface || '').toLowerCase()] || null,
    surface_raw: t.surface ?? null,
    indoor: t.inOutdoor === 'I' ? true : t.inOutdoor === 'O' ? false : null,
    city: t.city || null,
    country: t.country || null,
    singles_draw_size: t.singlesDrawSize ?? null,
    doubles_draw_size: t.doublesDrawSize ?? null,
    status: t.status ?? null
  }))
};

// ---- matches (results + live state) -------------------------------------------------------------------
// Observed code tables (tests/fixtures/wta/matches-1152.json):
//   MatchState: F = final, P = in progress
//   Winner:     0 = undecided, 2 = side A won, 3 = side B won, 4 = side A won, B retired ("Ret'd"),
//               6 = side A won by walkover (B withdrew). 5 / 7 (presumably the B-side mirrors) have NOT
//               been observed and are therefore not mapped.
//   ScoreSys:   1 = best of 3, tiebreak sets (singles); 9 = best of 3, no-ad, match tiebreak (doubles)
//   DrawMatchType: S / D.  DrawLevelType: M = main draw, Q = qualifying.
const WINNER = { 0: null, 2: { side: 'A', end: 'completed' }, 3: { side: 'B', end: 'completed' }, 4: { side: 'A', end: 'retirement', retired: 'B' }, 6: { side: 'A', end: 'walkover', withdrawn: 'B' } };
const STATE = { F: 'final', P: 'in_progress' };
export const SCORE_SYS = { 1: 'BO3_TB7', 9: 'DOUBLES_TOUR' };

const hms = (s) => {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(s || ''));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export function parseWtaMatch(m) {
  const warnings = [];
  const doubles = m.DrawMatchType === 'D';
  const sideMembers = (s) => {
    const one = { provider: 'wta', provider_id: String(m[`PlayerID${s}`]), first_name: m[`PlayerNameFirst${s}`] || null, last_name: m[`PlayerNameLast${s}`] || null, country: m[`PlayerCountry${s}`] || null, gender: 'F' };
    if (!doubles) return [one];
    return [one, { provider: 'wta', provider_id: String(m[`PlayerID${s}2`]), first_name: m[`PlayerNameFirst${s}2`] || null, last_name: m[`PlayerNameLast${s}2`] || null, country: m[`PlayerCountry${s}2`] || null, gender: 'F' }];
  };
  const format_key = SCORE_SYS[m.ScoreSys] || null;
  if (!format_key) warnings.push(`unmapped_score_system:${m.ScoreSys}`);
  const sets = [];
  // NumSets bounds the set fields: rows have been observed carrying stale ScoreSet fields beyond it
  // (1178-2026-LD013: NumSets 1, ScoreString "0-3", leftover "6-7" in set 2). Stale fields are dropped
  // and flagged; the remaining score still has to pass validation downstream.
  const numSets = Number.isInteger(m.NumSets) && m.NumSets > 0 ? m.NumSets : 5;
  for (let i = 1; i <= 5; i++) {
    if (i > numSets) {
      if (num(m[`ScoreSet${i}A`]) !== null) warnings.push(`stale_set_fields_ignored:set${i}`);
      continue;
    }
    const a = num(m[`ScoreSet${i}A`]);
    const b = num(m[`ScoreSet${i}B`]);
    if (a === null || b === null) continue;
    const tbLoser = num(m[`ScoreTbSet${i}`]);
    const matchTb = format_key === 'DOUBLES_TOUR' && i === 3 && a + b === 1;
    let tiebreak = null;
    if (tbLoser !== null && (matchTb || Math.max(a, b) === 7 && Math.min(a, b) === 6)) {
      const to = matchTb ? 10 : 7;
      const win = Math.max(to, tbLoser + 2);
      tiebreak = a > b ? { A: win, B: tbLoser, winner_points_derived: true } : { A: tbLoser, B: win, winner_points_derived: true };
    } else if (matchTb) {
      warnings.push(`match_tiebreak_points_missing:set${i}`);
    }
    sets.push({ games: { A: a, B: b }, tiebreak, is_match_tiebreak: matchTb });
  }
  const state = STATE[m.MatchState];
  if (!state) warnings.push(`unmapped_match_state:${m.MatchState}`);
  const w = Object.prototype.hasOwnProperty.call(WINNER, Number(m.Winner)) ? WINNER[Number(m.Winner)] : undefined;
  if (w === undefined) warnings.push(`unmapped_winner_code:${m.Winner}`);
  let status = null;
  if (state === 'in_progress') status = 'in_progress';
  if (state === 'final' && w) status = w.end === 'retirement' ? 'retired' : w.end === 'walkover' ? 'walkover' : 'completed';
  if (state === 'final' && !w) warnings.push('final_without_mapped_winner');
  const live = state === 'in_progress' ? { point: { A: m.PointA || null, B: m.PointB || null }, server: m.Serve === 'A' || m.Serve === 'B' ? m.Serve : null } : null;
  return {
    type: 'match',
    provider: 'wta',
    provider_match_id: `${m.EventID}-${m.EventYear}-${m.MatchID}`,
    provider_event: { id: String(m.EventID), year: m.EventYear },
    event_type: doubles ? 'WD' : 'WS',
    stage: m.DrawLevelType === 'Q' ? 'qualifying' : m.DrawLevelType === 'M' ? 'main' : null,
    round_code: `${m.DrawLevelType}-${m.RoundID}`,
    format_key,
    status,
    winner_side: w?.side ?? null,
    end_reason: w?.end ?? null,
    retired_side: w?.retired ?? null,
    withdrawn_side: w?.withdrawn ?? null,
    sets: status === 'walkover' ? [] : sets,
    live,
    sides: { A: sideMembers('A'), B: sideMembers('B') },
    seeds: { A: num(m.SeedA), B: num(m.SeedB) },
    entry: { A: m.EntryTypeA || null, B: m.EntryTypeB || null },
    court_id: m.CourtID ?? null,
    duration_s: hms(m.MatchTimeTotal),
    source_updated_at: m.LastUpdated || null,
    source_text: m.ResultString || null,
    warnings
  };
}

export const matches = {
  key: 'wta.matches',
  family: 'wta',
  capabilities: ['schedule', 'live_state', 'set_game_scoring', 'doubles', 'qualifying', 'withdrawals_ret_wo'],
  parser_version: PARSER,
  cadence: { class: 'dynamic', active_s: 15, today_s: 300, idle_s: 3600 },
  request: ({ eventId, year }) => ({ url: `${API}/tournaments/${eventId}/${year}/matches` }),
  shape: (body) => {
    const j = safeJson(body);
    if (!j || !Array.isArray(j.matches)) return ['missing_matches'];
    return j.matches.length ? requirePaths(j.matches[0], ['MatchID', 'MatchState', 'DrawMatchType', 'PlayerIDA', 'PlayerIDB', 'Winner', 'ScoreSys']) : [];
  },
  parse: (body) => safeJson(body).matches.map(parseWtaMatch)
};

// ---- match statistics --------------------------------------------------------------------------------
// Observed semantics (verified against set scores in the LS002 capture):
//   totservplayedX = service points played by X; ptsplayed1stservX = X's first serves in;
//   ptswon1stservX = X's first-serve points won; ptstotwonservX = X's service points won;
//   breakptsplayedX / breakptsconvX = break points X HAD / CONVERTED as returner; setnum 0 = match totals.
export function canonicalStats(row, s) {
  const o = s === 'a' ? 'b' : 'a';
  const n = (k) => (row[k] === undefined || row[k] === null || row[k] === '' ? null : Number(row[k]));
  const sub = (x, y) => (x == null || y == null ? null : x - y);
  return {
    service_points: n(`totservplayed${s}`),
    aces: n(`aces${s}`),
    double_faults: n(`dblflt${s}`),
    first_serves_in: n(`ptsplayed1stserv${s}`),
    first_serve_points_won: n(`ptswon1stserv${s}`),
    second_serve_points_won: sub(n(`ptstotwonserv${s}`), n(`ptswon1stserv${s}`)),
    service_games: n(`servgamesplayed${s}`),
    break_points_faced: n(`breakptsplayed${o}`),
    break_points_saved: sub(n(`breakptsplayed${o}`), n(`breakptsconv${o}`)),
    total_points_won: n(`totptswon${s}`)
  };
}

/** Internal consistency: every point is someone's service point, and per-set rows sum to the totals. */
export function statsConsistency(rows) {
  const errors = [];
  const total = rows.find((r) => Number(r.setnum) === 0);
  if (!total) return ['no_match_total_row'];
  if (total.totservplayeda + total.totservplayedb !== total.totptswona + total.totptswonb) errors.push('service_points_ne_points_won');
  const sets = rows.filter((r) => Number(r.setnum) > 0);
  for (const k of ['acesa', 'acesb', 'dblflta', 'dblfltb', 'totservplayeda', 'totservplayedb', 'totptswona', 'totptswonb']) {
    if (sets.length && sets.reduce((t, r) => t + Number(r[k] || 0), 0) !== Number(total[k])) errors.push(`set_sum_mismatch:${k}`);
  }
  return errors;
}

export const matchStats = {
  key: 'wta.match_stats',
  family: 'wta',
  capabilities: ['match_stats', 'serve_stats', 'return_stats'],
  parser_version: PARSER,
  cadence: { class: 'on_final', min_interval_s: 600 },
  request: ({ eventId, year, matchId }) => ({ url: `${API}/tournaments/${eventId}/${year}/matches/${matchId}/stats` }),
  shape: (body) => {
    const j = safeJson(body);
    if (!Array.isArray(j) || !j.length) return ['empty_stats'];
    return requirePaths(j.find((r) => Number(r.setnum) === 0) || {}, ['totservplayeda', 'totservplayedb', 'ptswon1stserva', 'breakptsplayeda']);
  },
  parse: (body) => {
    const rows = safeJson(body);
    const total = rows.find((r) => Number(r.setnum) === 0);
    return [{
      type: 'match_stats',
      provider: 'wta',
      provider_match_id: `${total.eventid}-${total.eventyear}-${total.matchid}`,
      sides: { A: canonicalStats(total, 'a'), B: canonicalStats(total, 'b') },
      per_set: rows.filter((r) => Number(r.setnum) > 0).map((r) => ({ set_no: Number(r.setnum), A: canonicalStats(r, 'a'), B: canonicalStats(r, 'b') })),
      consistency_errors: statsConsistency(rows)
    }];
  }
};

export const rankingsSingles = rankingsAdapter('singles');
export const rankingsDoubles = rankingsAdapter('doubles');
export const ADAPTERS = [rankingsSingles, rankingsDoubles, calendar, matches, matchStats];
