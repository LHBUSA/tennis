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
      // mixed doubles (DOUBLES_TOUR): the deciding set IS a 10-point match tiebreak, published as games 1-0 + the
      // tiebreak points; flag it so it validates as a match tiebreak, never as an unfinished 1-0 set
      const matchTb = ev.format === 'DOUBLES_TOUR' && i === 2 && tb && Math.max(Number(a.game), Number(b.game)) === 1 && Math.min(Number(a.game), Number(b.game)) === 0;
      sets.push({ games: { A: Number(a.game), B: Number(b.game) }, tiebreak: tb, is_match_tiebreak: !!matchTb });
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

// ---- Wimbledon draws archive (da.wimbledon.com) — men's history 1979+ -------------------------------------
// Each draw is a flat array of matches: team{1,2}.playerA/B_id (archive UUID), s1..s5 games, t1..t5 tiebreak
// points, won. No explicit retirement marker: an incomplete final set with a recorded winner = retired
// (never a cause). No scores + a winner = walkover. Player identity: archive UUID -> ATP id only through an
// exact mapping supplied by the caller (params.idMap); a player without one stays unresolved (held).
const ARCH_EVENTS = { MS: { event_type: 'MS', stage: 'main', gender: 'M' }, MD: { event_type: 'MD', stage: 'main', gender: 'M' }, QS: { event_type: 'MS', stage: 'qualifying', gender: 'M' } };
const ARCH_ROUND = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', Q: 'Q', S: 'S', F: 'F' };

/** Deciding-set rule at Wimbledon by year (men): advantage to 2018, 12-12 tiebreak 2019-21, 10-point from 2022. */
export function wimArchiveFormat(bestOf, year) {
  if (![3, 5].includes(bestOf) || !(year >= 1979)) return null;
  if (year >= 2022) return bestOf === 5 ? 'BO5_FINAL_TB10' : 'BO3_FINAL_TB10';
  if (year >= 2019) return bestOf === 5 ? 'BO5_FINAL_TB7_AT12' : 'BO3_FINAL_TB7_AT12';
  return bestOf === 5 ? 'BO5_FINAL_ADV' : 'BO3_FINAL_ADV';
}

export function parseWimbledonArchive(arr, { event, year, idMap = {} } = {}) {
  const ev = ARCH_EVENTS[event];
  if (!ev || !Array.isArray(arr)) return [];
  const out = [];
  for (const m of arr) {
    const warnings = [];
    const t1 = m.team1 || {};
    const t2 = m.team2 || {};
    const member = (t, k) => {
      const id = t[`player${k}_id`];
      if (!id) return null;
      const atp = idMap[id] || null;
      return { provider: 'wimbledon_archive', provider_id: String(id), tour_id: atp ? { provider: 'atp', provider_id: String(atp).toUpperCase() } : null, first_name: t[`player${k}_first_name`] || null, last_name: t[`player${k}_last_name`] || null, country: t[`player${k}_nat`] || null, gender: 'M' };
    };
    const side = (t) => ['A', 'B'].map((k) => member(t, k)).filter(Boolean);
    const A = side(t1);
    const B = side(t2);
    if (!A.length || !B.length) continue; // byes / empty slots
    const winner = t1.won === true ? 'A' : t2.won === true ? 'B' : null;
    const sets = [];
    for (let i = 1; i <= 5; i += 1) {
      const a = t1[`s${i}`];
      const b = t2[`s${i}`];
      if (a === '' || a == null || b === '' || b == null) break;
      const ga = Number(a);
      const gb = Number(b);
      if (!Number.isInteger(ga) || !Number.isInteger(gb)) { warnings.push(`bad_set_${i}`); break; }
      const ta = t1[`t${i}`] === '' || t1[`t${i}`] == null ? null : Number(t1[`t${i}`]);
      const tb = t2[`t${i}`] === '' || t2[`t${i}`] == null ? null : Number(t2[`t${i}`]);
      let tiebreak = null;
      if (ta != null && tb != null) tiebreak = { A: ta, B: tb, winner_points_derived: false };
      else if (ta != null || tb != null) {
        // only one side's tiebreak points: derive the set winner's total (to 7, by two) and flag it as derived
        const loserPts = ga > gb ? tb : ta;
        if (loserPts != null) { const w = Math.max(7, loserPts + 2); tiebreak = ga > gb ? { A: w, B: loserPts, winner_points_derived: true } : { A: loserPts, B: w, winner_points_derived: true }; }
        else warnings.push(`tiebreak_loser_points_missing:set${i}`);
      }
      sets.push({ games: { A: ga, B: gb }, tiebreak, is_match_tiebreak: false });
    }
    const setWon = (s) => { const hi = Math.max(s.games.A, s.games.B); const lo = Math.min(s.games.A, s.games.B); return hi >= 6 && (hi - lo >= 2 || (hi === 7 && lo === 6) || (hi === 13 && lo === 12)); };
    const wonBy = { A: 0, B: 0 };
    for (const s of sets) if (setWon(s)) wonBy[s.games.A > s.games.B ? 'A' : 'B'] += 1;
    let status = null;
    let bestOf = null;
    if (!sets.length && winner) status = 'walkover';
    else if (winner && (wonBy[winner] === 3 || wonBy[winner] === 2) && sets.every(setWon) && wonBy[winner] > wonBy[winner === 'A' ? 'B' : 'A']) {
      status = 'completed';
      bestOf = wonBy[winner] === 3 ? 5 : 3;
    } else if (winner) {
      status = 'retired';
      // best of five is provable when the match reached a fourth set or either side had two sets
      bestOf = sets.length >= 4 || wonBy.A >= 2 || wonBy.B >= 2 ? 5 : event === 'MS' ? 5 : null;
    } else warnings.push('no_winner');
    if (status === 'completed' && bestOf === 3 && event === 'MS') warnings.push('men_main_draw_best_of_three');
    const format_key = status === 'walkover' ? wimArchiveFormat(event === 'QS' ? 3 : 5, year) : wimArchiveFormat(bestOf, year);
    // a derived tiebreak total in the deciding set follows that set's rule: 10-point from 2022
    if (bestOf && year >= 2022) {
      const last = sets[bestOf - 1];
      if (last?.tiebreak?.winner_points_derived) { const lo = Math.min(last.tiebreak.A, last.tiebreak.B); const w = Math.max(10, lo + 2); last.tiebreak = last.games.A > last.games.B ? { A: w, B: lo, winner_points_derived: true } : { A: lo, B: w, winner_points_derived: true }; }
    }
    if (!format_key) warnings.push('format_unprovable');
    const roundRaw = String(m.round || '');
    const round_code = ev.stage === 'qualifying' ? (/^\d$/.test(roundRaw) ? `Q-${roundRaw}` : null) : ARCH_ROUND[roundRaw] || null;
    if (!round_code) warnings.push(`unmapped_round:${roundRaw}`);
    out.push({
      // the archive 'id' is a constant placeholder; two players meet at most once per event, so year + event +
      // round + the sorted archive UUIDs is a stable, order-independent key
      type: 'match', provider: 'wimbledon', provider_match_id: `arch-${year}-${event}-${roundRaw}-${[...A, ...B].map((x) => x.provider_id).sort().join('+')}`, provider_event: { id: event, year },
      event_type: ev.event_type, stage: ev.stage, round_code, format_key, status, winner_side: winner,
      end_reason: status === 'retired' ? 'retirement' : status === 'walkover' ? 'walkover' : status === 'completed' ? 'completed' : null,
      retired_side: status === 'retired' ? (winner === 'A' ? 'B' : 'A') : null, withdrawn_side: status === 'walkover' ? (winner === 'A' ? 'B' : 'A') : null,
      sets: status === 'walkover' ? [] : sets, live: null, sides: { A, B },
      seeds: { A: Number(t1.seed) || null, B: Number(t2.seed) || null }, entry: { A: null, B: null },
      court_name: m.crt || null, duration_s: null, source_updated_at: null, warnings
    });
  }
  return out;
}

export const wimbledonArchive = {
  key: 'wimbledon.archive',
  family: 'wimbledon',
  capabilities: ['draws', 'set_game_scoring', 'withdrawals_ret_wo', 'history', 'player_identity'],
  parser_version: PARSER,
  cadence: { class: 'history', idle_s: 86400 * 30 },
  request: ({ event, year }) => ({ url: `https://da.wimbledon.com/v1/draws_archive/draw/${event}/${year}` }),
  shape: (body) => { const j = safeJson(body); return Array.isArray(j) ? (j.length ? requirePaths(j[0], ['id', 'round', 'team1', 'team2']) : ['empty_draw']) : ['not_array']; },
  parse: (body, meta = {}) => parseWimbledonArchive(safeJson(body), { event: meta.params?.event, year: Number(meta.params?.year), idMap: meta.params?.idMap || {} })
};

export const wimbledonArchivePlayer = {
  key: 'wimbledon.archive_player',
  family: 'wimbledon',
  capabilities: ['player_identity'],
  parser_version: PARSER,
  cadence: { class: 'history', idle_s: 86400 * 30 },
  request: ({ uuid }) => ({ url: `https://da.wimbledon.com/v1/draws_archive/player/${uuid}` }),
  shape: (body) => { const j = safeJson(body); return j?.id ? [] : ['no_player']; },
  parse: (body) => { const j = safeJson(body); const t = tourIdFromSlamId(j.tourid); return [{ uuid: j.id, atp: t?.provider === 'atp' ? t.provider_id : null, name: [j.firstname, j.lastname].filter(Boolean).join(' '), country: j.country || null }]; }
};

/** Raw archive draw (identity mapping needs every UUID before parsing). */
export const wimbledonArchiveRaw = { ...wimbledonArchive, key: 'wimbledon.archive', parse: (body) => safeJson(body) || [] };
