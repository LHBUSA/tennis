// Grand Slam adapters. Each Slam runs its own data system; each gets its own adapter.
//   Wimbledon — static JSON score feeds under /en_GB/scores/feeds/{year}/ (the site's own feeds).
//   Australian Open — prod-scores-api.ausopen.com (the API ausopen.com renders from; current edition only).
//   US Open — requests hung with zero bytes during the audit (BLOCKED/UNVERIFIED; not adapted).
//   Roland-Garros — data only inside the page's Nuxt payload with FFT-internal ids (DEGRADED; not adapted).
// Rights: Wimbledon's terms bar commercial use without an AELTC licence; see docs/TENNIS_SOURCE_MATRIX.md.

import { requirePaths, safeJson } from '../shared/adapter.js';

const PARSER = '1';

/** Slam feeds embed tour ids: 'atps0ag' -> atp:S0AG, 'wta324219' / 'WTA317790' -> wta:324219, 'ATPBK92' -> atp:BK92. */
export function tourIdFromSlamId(raw) {
  const s = String(raw || '').trim();
  let m = /^atp([a-z0-9]{4})$/i.exec(s);
  if (m) return { provider: 'atp', provider_id: m[1].toUpperCase() };
  m = /^wta(\d{3,})$/i.exec(s);
  if (m) return { provider: 'wta', provider_id: m[1] };
  return null;
}

// ---- Wimbledon -------------------------------------------------------------------------------------
// Observed: statusCode D = Completed, E = Retired; winner '1'/'2' = team1/team2; set entries carry BOTH
// tiebreak point totals when a tiebreak was played. Final-set 10-point tiebreak at 6-6 since 2022.
const WIM_STATUS = { D: 'completed', E: 'retired' };
const WIM_EVENTS = { MS: { event_type: 'MS', gender: 'M' }, LS: { event_type: 'WS', gender: 'F' } };

function wimFormat(eventCode, year) {
  if (year < 2022) return null; // pre-2022 final-set rules differ; not mapped until audited
  return eventCode === 'MS' ? 'BO5_FINAL_TB10' : eventCode === 'LS' ? 'BO3_FINAL_TB10' : null;
}

export function parseWimbledonMatch(m, year) {
  const warnings = [];
  const ev = WIM_EVENTS[m.eventCode];
  if (!ev) warnings.push(`unmapped_event:${m.eventCode}`);
  const team = (t) => {
    const out = [];
    for (const s of ['A', 'B']) {
      if (!t[`id${s}`]) continue;
      const tour = tourIdFromSlamId(t[`id${s}`]);
      if (!tour) warnings.push(`unmapped_player_id:${t[`id${s}`]}`);
      out.push({ provider: 'wimbledon', provider_id: String(t[`id${s}`]), tour_id: tour, first_name: t[`firstName${s}`] || null, last_name: t[`lastName${s}`] || null, country: t[`nation${s}`] || null, gender: ev?.gender || null });
    }
    return out;
  };
  const status = WIM_STATUS[m.statusCode] || null;
  if (!status) warnings.push(`unmapped_status:${m.statusCode}:${m.status}`);
  const winner = m.winner === '1' ? 'A' : m.winner === '2' ? 'B' : null;
  const sets = (m.scores?.sets || []).map((pair) => {
    const [a, b] = pair;
    const tbA = a.tiebreak ?? null;
    const tbB = b.tiebreak ?? null;
    return { games: { A: a.score, B: b.score }, tiebreak: tbA !== null && tbB !== null ? { A: tbA, B: tbB, winner_points_derived: false } : null, is_match_tiebreak: false };
  });
  const lastScore = m.scores?.gameScore || [];
  return {
    type: 'match',
    provider: 'wimbledon',
    provider_match_id: `${year}-${m.match_id}`,
    provider_event: { id: m.eventCode, year },
    event_type: ev?.event_type || null,
    stage: 'main',
    round_code: m.roundCode,
    format_key: wimFormat(m.eventCode, year),
    status,
    winner_side: winner,
    end_reason: status === 'retired' ? 'retirement' : status === 'completed' ? 'completed' : null,
    retired_side: status === 'retired' && winner ? (winner === 'A' ? 'B' : 'A') : null,
    sets,
    final_game_score: status === 'retired' ? { A: lastScore[0] ?? null, B: lastScore[1] ?? null } : null,
    live: null,
    sides: { A: team(m.team1), B: team(m.team2) },
    seeds: { A: m.team1.seed ?? null, B: m.team2.seed ?? null },
    entry: { A: m.team1.entryStatus ?? null, B: m.team2.entryStatus ?? null },
    court_name: m.courtName || null,
    duration_s: /^(\d+):(\d{2})$/.test(m.duration || '') ? Number(m.duration.split(':')[0]) * 3600 + Number(m.duration.split(':')[1]) * 60 : null,
    source_updated_at: m.epoch ? new Date(m.epoch).toISOString() : null,
    warnings
  };
}

export const wimbledonDraw = {
  key: 'wimbledon.draws',
  family: 'wimbledon',
  capabilities: ['draws', 'set_game_scoring', 'withdrawals_ret_wo', 'history', 'player_identity'],
  parser_version: PARSER,
  cadence: { class: 'event_window', active_s: 120, idle_s: 86400 },
  request: ({ year, eventCode = 'MS' }) => ({ url: `https://www.wimbledon.com/en_GB/scores/feeds/${year}/draws/${eventCode}.json` }),
  shape: (body) => {
    const j = safeJson(body);
    if (!j || !Array.isArray(j.matches)) return ['missing_matches'];
    return j.matches.length ? requirePaths(j.matches[0], ['match_id', 'eventCode', 'statusCode', 'team1', 'team2', 'scores.sets']) : ['empty_draw'];
  },
  parse: (body, meta) => {
    const j = safeJson(body);
    const year = Number(/feeds\/(\d{4})\//.exec(meta?.url || '')?.[1]) || null;
    return j.matches.filter((m) => m.team1?.idA && m.team2?.idA).map((m) => parseWimbledonMatch(m, year));
  }
};

// ---- Australian Open --------------------------------------------------------------------------------
export const ausopenDay = {
  key: 'ausopen.results',
  family: 'ausopen',
  capabilities: ['schedule', 'set_game_scoring', 'player_identity', 'player_bio'],
  parser_version: PARSER,
  cadence: { class: 'event_window', active_s: 60, idle_s: 86400 },
  request: ({ year, day = 1, kind = 'results' }) => ({ url: `https://prod-scores-api.ausopen.com/year/${year}/period/MD/day/${day}/${kind}` }),
  shape: (body) => {
    const j = safeJson(body);
    if (!j) return ['not_json'];
    return requirePaths(j, ['tournament.name', 'matches', 'players']);
  },
  // Match rows are not parsed yet (team/player linkage unverified); the player registry is, because it
  // carries tour ids, gender, DOB and nationality — identity evidence for the crosswalk.
  parse: (body) => (safeJson(body).players || []).map((p) => ({
    type: 'player_identity',
    provider: 'ausopen',
    provider_id: p.uuid,
    tour_id: tourIdFromSlamId(p.tour_id || p.player_id),
    full_name: p.full_name || null,
    first_name: p.first_name || null,
    last_name: p.last_name || null,
    gender: p.gender === 'M' || p.gender === 'F' ? p.gender : null,
    dob: p.dob || null,
    nationality: p.nationality?.code || null
  }))
};

export const ADAPTERS = [wimbledonDraw, ausopenDay];
