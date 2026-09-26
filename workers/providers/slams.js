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

// AO match rows. Observed (2026 day 2-3 captures): match_status.code C = complete, R = retired; each
// team's score[] carries games per set plus BOTH tiebreak totals (`tie_break`) when one was played; the
// per-set `winner` flag is unreliable on unfinished sets (a 0-0 set after a retirement is flagged), so set
// winners are derived from games. Only men's and mixed events are taken: women's AO matches come from
// the WTA API, and taking them twice would duplicate matches.
const AO_EVENTS = { "Men's Singles": { event_type: 'MS', gender: 'M', format: 'BO5_FINAL_TB10' }, "Men's Doubles": { event_type: 'MD', gender: 'M', format: 'BO3_FINAL_TB10' }, 'Mixed Doubles': { event_type: 'XD', gender: null, format: 'DOUBLES_TOUR' },
  // qualifying: best of three with a 10-point final-set tiebreak (Grand Slam qualifying since 2022); rounds are Q-1..Q-3
  "Men's Qualifying Singles": { event_type: 'MS', gender: 'M', format: 'BO3_FINAL_TB10', stage: 'qualifying' } };
const AO_STATUS = { C: 'completed', R: 'retired' };
const AO_ROUNDS = { '1st Round': '1', '2nd Round': '2', '3rd Round': '3', '4th Round': '4', Quarterfinals: 'Q', 'Quarter-finals': 'Q', Semifinals: 'S', 'Semi-finals': 'S', Final: 'F' };

export function parseAusopenDay(j) {
  const events = new Map((j.events || []).map((e) => [e.uuid, e.name]));
  const rounds = new Map((j.rounds || []).map((r) => [r.uuid, r.name]));
  const teams = new Map((j.teams || []).map((t) => [t.uuid, t]));
  const players = new Map((j.players || []).map((p) => [p.uuid, p]));
  const year = Number(j.year?.year || j.year?.name) || null;
  const out = [];
  for (const m of j.matches || []) {
    const ev = AO_EVENTS[events.get(m.event_uuid)];
    if (!ev) continue;
    const warnings = [];
    const status = AO_STATUS[m.match_status?.code] || null;
    if (!status) warnings.push(`unmapped_status:${m.match_status?.code}`);
    const [tA, tB] = m.teams || [];
    const member = (pid) => {
      const p = players.get(pid) || {};
      return { provider: 'ausopen', provider_id: pid, tour_id: tourIdFromSlamId(p.tour_id || p.player_id), first_name: p.first_name || null, last_name: p.last_name || null, country: p.nationality?.code || null, gender: p.gender === 'M' || p.gender === 'F' ? p.gender : ev.gender, dob: p.dob || null };
    };
    const side = (t) => (teams.get(t?.team_id)?.players || []).map(member);
    const n = Math.max(tA?.score?.length || 0, tB?.score?.length || 0);
    const sets = [];
    for (let i = 0; i < n; i += 1) {
      const a = tA.score[i];
      const b = tB.score[i];
      if (!a || !b) { warnings.push(`ragged_score:set${i + 1}`); break; }
      const tb = a.tie_break != null && b.tie_break != null ? { A: Number(a.tie_break), B: Number(b.tie_break), winner_points_derived: false } : null;
      sets.push({ games: { A: Number(a.game), B: Number(b.game) }, tiebreak: tb, is_match_tiebreak: false });
    }
    const winner = tA?.status === 'Winner' ? 'A' : tB?.status === 'Winner' ? 'B' : null;
    const rn = rounds.get(m.round_id);
    out.push({
      type: 'match', provider: 'ausopen', provider_match_id: `${year}-${m.match_id}`, provider_event: { id: 'australian-open', year },
      event_type: ev.event_type, stage: ev.stage || 'main', round_code: ev.stage === 'qualifying' ? (/^(\d)(st|nd|rd|th) Round$/.test(rn || '') ? `Q-${rn[0]}` : null) : AO_ROUNDS[rn] || rn || null, format_key: ev.format,
      status, winner_side: winner, end_reason: status === 'retired' ? 'retirement' : status === 'completed' ? 'completed' : null,
      retired_side: status === 'retired' && winner ? (winner === 'A' ? 'B' : 'A') : null, sets, live: null,
      sides: { A: side(tA), B: side(tB) }, seeds: { A: Number(teams.get(tA?.team_id)?.seed) || null, B: Number(teams.get(tB?.team_id)?.seed) || null },
      entry: { A: teams.get(tA?.team_id)?.entry_status?.abbr || null, B: teams.get(tB?.team_id)?.entry_status?.abbr || null },
      duration_s: /^(\d+):(\d{2})$/.test(m.duration || '') ? Number(m.duration.split(':')[0]) * 3600 + Number(m.duration.split(':')[1]) * 60 : null,
      source_updated_at: m.date ? `${m.date}T00:00:00Z` : null, warnings
    });
  }
  return out;
}

export const ausopenMatches = {
  key: 'ausopen.matches',
  family: 'ausopen',
  capabilities: ['set_game_scoring', 'withdrawals_ret_wo', 'player_identity'],
  parser_version: PARSER,
  cadence: { class: 'event_window', active_s: 120, idle_s: 86400 },
  // period MD = main draw days, Q = qualifying days (same payload shape)
  request: ({ year, day, period = 'MD' }) => ({ url: `https://prod-scores-api.ausopen.com/year/${year}/period/${period === 'Q' ? 'Q' : 'MD'}/day/${day}/results` }),
  shape: ausopenDay.shape,
  parse: (body) => parseAusopenDay(safeJson(body))
};

// AO match centre: genuine point-by-point (winner, reason, server-first score), current edition only.
export const ausopenMatchCentre = {
  key: 'ausopen.match_centre',
  family: 'ausopen',
  capabilities: ['point_by_point', 'match_stats'],
  parser_version: PARSER,
  cadence: { class: 'on_final' },
  request: ({ matchId }) => ({ url: `https://prod-scores-api.ausopen.com/match-centre/${matchId}` }),
  shape: (body) => { const j = safeJson(body); return j ? requirePaths(j, ['match_id', 'teams']) : ['not_json']; },
  // keep every payload: statistics can exist without commentary; point events are built only from commentary
  parse: (body) => { const j = safeJson(body); return j?.match_id ? [j] : []; }
};

export const ADAPTERS = [wimbledonDraw, ausopenDay, ausopenMatches, ausopenMatchCentre];

// ---- AO match-centre statistics -> canonical stat keys ------------------------------------------------------
// Every value is a source count ("56/83" = n/d); nothing is derived except the opponent's break points
// faced/saved, which are exactly the other side's "Break points won" n/d. A set whose second-serve
// denominator disagrees with service points - first serves in is inconsistent: the whole match is rejected.
const aoInt = (v) => (v === undefined || v === null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const aoFrac = (x) => { const m = /^(\d+)\/(\d+)$/.exec(String(x?.secondary || '')); return m ? { n: Number(m[1]), d: Number(m[2]) } : null; };

function aoSetStats(stats) {
  const by = new Map(stats.map((s) => [String(s.name).toLowerCase(), s]));
  const side = (k, o) => {
    const g = (name) => by.get(name)?.[k];
    const fsIn = aoFrac(g('1st serve in'));
    const w1 = aoFrac(g('win 1st serve'));
    const w2 = aoFrac(g('win 2nd serve'));
    const bpOpp = aoFrac(by.get('break points won')?.[o]);
    const net = aoFrac(g('net points won'));
    if (!fsIn || !w1 || !w2) return null;
    if (w1.d !== fsIn.n || w2.d !== fsIn.d - fsIn.n) throw new Error(`ao_stats_inconsistent: ${fsIn.n}/${fsIn.d} vs ${w1.d} / ${w2.d}`);
    return {
      aces: aoInt(g('aces')?.primary), double_faults: aoInt(g('double faults')?.primary),
      service_points: fsIn.d, first_serves_in: fsIn.n, first_serve_points_won: w1.n, second_serve_points_won: w2.n,
      break_points_faced: bpOpp ? bpOpp.d : null, break_points_saved: bpOpp ? bpOpp.d - bpOpp.n : null,
      total_points_won: aoInt(g('total points won')?.primary), winners: aoInt(g('winners')?.primary), unforced_errors: aoInt(g('unforced errors')?.primary),
      net_points: net ? net.d : null, net_points_won: net ? net.n : null
    };
  };
  const A = side('teamA', 'teamB');
  const B = side('teamB', 'teamA');
  return A && B ? { A, B } : null;
}

/** { sides: {A,B}, per_set: [{set_no, A, B}] } or null when the feed has no usable serve stats. teamA = side A. */
export function parseAusopenStats(mc) {
  const key = (mc?.stats?.key_stats || []).find((g) => /key/i.test(g.name)) || mc?.stats?.key_stats?.[0];
  if (!key?.sets?.length) return null;
  const all = key.sets.find((s) => /^all$/i.test(String(s.set)));
  const total = all ? aoSetStats(all.stats) : null;
  if (!total) return null;
  const per_set = key.sets.filter((s) => /^\d+$/.test(String(s.set))).map((s) => { const x = aoSetStats(s.stats); return x ? { set_no: Number(s.set), A: x.A, B: x.B } : null; }).filter(Boolean);
  return { provider: 'ausopen', sides: total, per_set };
}
