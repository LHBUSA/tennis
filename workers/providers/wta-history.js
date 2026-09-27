// WTA player match history (official WTA API): /players/{id}/matches/?page=&pageSize= — a player's whole career,
// ITF included, one row per match: tournament group id + year (the same keys the WTA calendar lane uses), official
// surface / indoor / level / draw sizes, round, both players' WTA ids (and doubles partners), the entry ranks, the
// winner and the score. Rows carry NO match id and NO match time: identity of a match = edition + event + stage +
// the two participants (writer.js crossSource), and its day is the edition's end date (conservative).
//
// Observed codes (2026-09-27, players 320760 + others): s_d_flag S|D; qpm_flag M|Q; reason_code W (played),
// R (retired, partial score), B (bye: no match). Scores are winner-first, loser tiebreak points in brackets:
// "6-3  6-7(6)  7-5". Any other code is held, never guessed.

import { safeJson, requirePaths } from '../shared/adapter.js';
import { SLAMS } from '../shared/canonical/ids.js';
import { espnFormat } from './espn.js';

const API = 'https://api.wtatennis.com/tennis';
const PARSER = '1';
const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/** Round -> canonical code ('1'..'n', Q, S, F, Q-n) using the event's draw size. */
export function historyRound(roundName, qpm, drawSize, qualDrawSize = null) {
  const r = String(roundName || '').trim().toUpperCase();
  if (qpm === 'Q') {
    // qualifying rows print main-draw style labels against the QUALIFYING draw (DrawSizes "32M/32Q/16D"):
    // 32Q -> R32, R16, Q ; 64Q -> R64, R32, R16 ; the qualifying "Q" is the round after R16 (numbered as R8)
    const d = /^Q(\d)$/.exec(r);
    if (d) return { stage: 'qualifying', code: `Q-${d[1]}` };
    const n = r === 'Q' ? 8 : Number((/^R(\d+)$/.exec(r) || [])[1]);
    if (!n || !qualDrawSize) return null;
    const no = Math.log2(nextPow2(qualDrawSize)) - Math.log2(n) + 1;
    return Number.isInteger(no) && no >= 1 && no <= 4 ? { stage: 'qualifying', code: `Q-${no}` } : null;
  }
  if (r === 'F') return { stage: 'main', code: 'F' };
  if (r === 'S' || r === 'SF') return { stage: 'main', code: 'S' };
  if (r === 'Q' || r === 'QF') return { stage: 'main', code: 'Q' };
  if (r === 'RR') return { stage: 'round_robin', code: 'RR' };
  const m = /^R(\d+)$/.exec(r);
  if (!m || !drawSize) return null;
  const n = Number(m[1]);
  const total = Math.log2(nextPow2(drawSize));
  const no = total - Math.log2(n) + 1;
  return Number.isInteger(no) && no >= 1 && no <= total - 3 ? { stage: 'main', code: String(no) } : null;
}

/** "6-3  6-7(6)  10-7" (winner-first) -> [{ w, l, tb }] ; tb = loser's points when printed. */
export function historyScore(s) {
  const out = [];
  for (const t of String(s || '').trim().split(/\s+/).filter(Boolean)) {
    const m = /^\[?(\d+)-(\d+)\]?(?:\((\d+)\))?$/.exec(t);
    if (!m) return null;
    out.push({ w: Number(m[1]), l: Number(m[2]), tbLoser: m[3] !== undefined ? Number(m[3]) : null, bracket: t.startsWith('[') });
  }
  return out;
}

/** One history row -> provider-neutral SourceMatch (or { skip } / { hold }). */
export function parseHistoryRow(row, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const t = row.tournament || {};
  const g = t.tournamentGroup || {};
  if (!g.id || !t.year) return { hold: 'no_tournament' };
  if (!['S', 'D'].includes(row.s_d_flag)) return { skip: `event_flag:${row.s_d_flag}` };
  if (row.reason_code === 'B') return { skip: 'bye' };
  if (t.endDate && t.endDate >= new Date(Date.parse(today) - 7 * 86400e3).toISOString().slice(0, 10)) return { skip: 'recent_edition_owned_by_live_lanes' };
  const et = row.s_d_flag === 'S' ? 'WS' : 'WD';
  let ids = et === 'WS' ? [[row.player_1], [row.player_2]] : [[row.player_1, row.player_3], [row.player_2, row.player_4]];
  // deterministic orientation: side A = the team holding the lower WTA id, so both players' histories write the
  // same row the same way (the source lists each match once per player, from that player's side)
  const low = (t) => Math.min(...t.map(Number));
  const swap = ids.flat().every((x) => /^\d+$/.test(String(x || ''))) && low(ids[1]) < low(ids[0]);
  if (swap) ids = [ids[1], ids[0]];
  if (ids.flat().some((x) => !/^\d+$/.test(String(x || '')))) return { hold: 'player_ids' };
  const people = { [row.player_1]: null, [row.player_2]: row.opponent, [row.player_3]: row.partner, [row.player_4]: row.opponent_partner };
  const member = (id) => { const p = people[id] || {}; return { provider: 'wta', provider_id: String(id), first_name: p.firstName || null, last_name: p.lastName || null, country: p.countryCode || null, gender: 'F' }; };
  const rawWinner = row.winner === 1 ? 'A' : row.winner === 2 ? 'B' : null;
  const winner = rawWinner && swap ? (rawWinner === 'A' ? 'B' : 'A') : rawWinner;
  const warnings = [];
  if (!winner) warnings.push('winner_unknown');
  const status = row.reason_code === 'W' ? 'completed' : row.reason_code === 'R' ? 'retired' : null;
  if (!status) warnings.push(`unmapped_reason:${row.reason_code}`);
  const qd = Number((/(\d+)Q/.exec(row.DrawSizes || '') || [])[1]) || null;
  const rd = historyRound(row.round_name, row.qpm_flag, et === 'WS' ? t.singlesDrawSize : t.doublesDrawSize, qd);
  if (!rd) warnings.push(`unmapped_round:${row.round_name}`);
  const sc = historyScore(row.scores);
  if (!sc || (status === 'completed' && !sc.length)) warnings.push('unparseable_score');
  const slamKey = /grand slam/i.test(t.level || g.level || '') ? SLAMS[String(g.name || '').toLowerCase().trim()] || null : null;
  // Bo3 everywhere for women; a split-set third "set" of 10+ (or bracketed) in doubles is a match tiebreak
  let mtb = false;
  const sets = (sc || []).map((x, i) => ({ ...x, idx: i }));
  if (et === 'WD' && sets.length === 3 && ((sets[0].w > sets[0].l) !== (sets[1].w > sets[1].l)) && (sets[2].bracket || Math.max(sets[2].w, sets[2].l) >= 10)) { sets[2].mtb = true; mtb = true; }
  const format_key = status ? espnFormat({ slamKey, year: Number(t.year), bestOf: 3, matchTiebreak: mtb }) : null;
  if (status && !format_key) warnings.push('format_unprovable');
  const flip = winner === 'B';
  const orient = (w, l) => (flip ? { A: l, B: w } : { A: w, B: l });
  const outSets = sets.map((x) => {
    if (x.mtb) { const gm = orient(x.w, x.l); return { games: { A: gm.A > gm.B ? 1 : 0, B: gm.B > gm.A ? 1 : 0 }, tiebreak: { ...gm, winner_points_derived: false }, is_match_tiebreak: true }; }
    let tb = null;
    if (x.tbLoser != null) { const win = Math.max(7, x.tbLoser + 2); tb = x.w > x.l ? { ...orient(win, x.tbLoser), winner_points_derived: true } : { ...orient(x.tbLoser, win), winner_points_derived: true }; }
    return { games: orient(x.w, x.l), tiebreak: tb, is_match_tiebreak: false };
  });
  const blocking = warnings.some((w) => /^(winner_unknown|unmapped_reason|unmapped_round|unparseable_score|format_unprovable)/.test(w));
  const pair = (arr) => [...arr].sort().join('+');
  return {
    edition: { provider_tournament_id: String(g.id), live_scoring_id: t.liveScoringId ? String(t.liveScoringId) : null, name: g.name, title: t.title, level: t.level || g.level || null, year: Number(t.year), start_date: t.startDate || null, end_date: t.endDate || null, surface: /^(hard|clay|grass|carpet)$/i.test(t.surface || '') ? t.surface.toLowerCase() : null, indoor: t.inOutdoor === 'I' ? true : t.inOutdoor === 'O' ? false : null, city: t.city || null, country: null, singles_draw_size: t.singlesDrawSize || null, doubles_draw_size: t.doublesDrawSize || null, status: t.status || null },
    match: {
      type: 'match', provider: 'wta_history', provider_match_id: `${g.id}-${t.year}-${et}-${row.qpm_flag}-${String(row.round_name).trim()}-${pair(ids[0])}-${pair(ids[1])}`.replace(/\s+/g, ''),
      event_type: et, stage: rd?.stage || null, round_code: rd?.code || null, format_key, status: blocking ? null : status, winner_side: blocking ? null : winner,
      end_reason: status === 'retired' ? 'retirement' : 'completed', retired_side: status === 'retired' ? (winner === 'A' ? 'B' : 'A') : null,
      sets: outSets, live: null, sides: { A: ids[0].map(member), B: ids[1].map(member) },
      seeds: swap ? { A: row.seed_2 ?? null, B: row.seed_1 ?? null } : { A: row.seed_1 ?? null, B: row.seed_2 ?? null }, entry: { A: null, B: null },
      entry_rank: swap ? { A: row.rank_2 || null, B: row.rank_1 || null } : { A: row.rank_1 || null, B: row.rank_2 || null }, scheduled_at: null, started_at: null, source_updated_at: null, warnings
    }
  };
}

export const playerMatches = {
  key: 'wta.player.matches', family: 'wta', capabilities: ['match_history', 'history', 'set_game_scoring', 'withdrawals_ret_wo', 'qualifying', 'doubles'], parser_version: PARSER, cadence: { class: 'history', idle_s: 86400 * 30 },
  request: ({ id, page = 0, pageSize = 100 }) => ({ url: `${API}/players/${id}/matches/?page=${page}&pageSize=${pageSize}` }),
  shape: (body) => { const j = safeJson(body); return j ? requirePaths(j, ['matches']) : ['not_json']; },
  parse: (body) => { const j = safeJson(body); return j.matches.length ? [j] : []; }
};
