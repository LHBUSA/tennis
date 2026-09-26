// tennis_event/1.0.0 — live + replay event contract. PURE. docs/TENNISCAST.md §Events.
//
// Two qualities, never mixed:
//   score_snapshot — built by diffSnapshots() from two periodic observations. One observation change =
//                    ONE event. Facts are derived only when provable from the two states:
//                      * set won          — a set newly completed; winner from its final games
//                      * game won         — exactly one game added in the same set; winner = the side
//                                           whose games went up by one
//                      * hold / break     — game won AND the server was observed at the previous
//                                           snapshot (the game in progress then is the game that ended)
//                      * tiebreak started — point score switched to tiebreak numbering
//                      * break/set/match point at observation — state-derived (scoring rules), labelled
//                                           as observed at that moment
//                    Never: a point winner, a point reason, serve speed, rally length, coordinates.
//   point_event    — only from a source that publishes individual points (AO match centre). Points are
//                    replayed through the scoring engine and cross-checked against the source's own score
//                    strings; any disagreement rejects the whole feed rather than storing a wrong point.

import { startMatch, applyPoint, situation, resolveFormat, SIDES, other, currentSet } from './scoring.js';
import { sha256Hex } from '../archive.js';

export const CONTRACT = 'tennis_event/1.0.0';
export const QUALITIES = Object.freeze(['point_event', 'score_snapshot']);
export const POINT_TYPES = Object.freeze(['point', 'ace', 'double_fault', 'winner', 'forced_error', 'unforced_error', 'service_winner']);

const REGULAR = new Set(['0', '15', '30', '40', 'AD', 'A']);
export const inTiebreakScore = (p) => !!p && p.A != null && p.B != null && p.A !== '' && p.B !== '' && !(REGULAR.has(String(p.A).toUpperCase()) && REGULAR.has(String(p.B).toUpperCase()));

/** Canonical observed state from a stored/API match (sets + live point + server + status). */
export function snapshotOf(m) {
  return {
    status: m.status,
    sets: (m.sets || []).map((s) => ({ A: s.games?.A ?? s.A, B: s.games?.B ?? s.B, tb: s.tiebreak ? { A: s.tiebreak.A, B: s.tiebreak.B } : s.tb || null, mtb: !!(s.is_match_tiebreak ?? s.match_tiebreak) })),
    point: m.live?.point && (m.live.point.A || m.live.point.B) ? { A: String(m.live.point.A ?? ''), B: String(m.live.point.B ?? '') } : null,
    server: m.live?.server === 'A' || m.live?.server === 'B' ? m.live.server : null
  };
}

function setComplete(s, idx, format) {
  if (!s) return false;
  if (s.mtb) return !!s.tb && Math.max(s.tb.A, s.tb.B) >= format.final_set.tiebreak_to && Math.abs(s.tb.A - s.tb.B) >= 2;
  const hi = Math.max(s.A, s.B);
  const lead = Math.abs(s.A - s.B);
  const finalMode = idx === format.best_of - 1 ? format.final_set.mode : 'tiebreak';
  if (finalMode === 'advantage') return hi >= format.games_per_set && lead >= 2;
  return (hi >= format.games_per_set && lead >= 2) || (hi === format.tiebreak_at + 1 && Math.min(s.A, s.B) === format.tiebreak_at);
}

const setWinner = (s) => (s.mtb && s.tb ? (s.tb.A > s.tb.B ? 'A' : 'B') : s.A > s.B ? 'A' : 'B');
const completedCount = (st, f) => st.sets.filter((s, i) => setComplete(s, i, f)).length;
const lastOpen = (st, f) => { const i = st.sets.findIndex((s, k) => !setComplete(s, k, f)); return i === -1 ? null : i; };

/** Engine state rebuilt from an observation (for break/set/match-point detection). null if not rebuildable. */
export function engineStateOf(st, formatKey) {
  if (st.status !== 'in_progress' || !st.server || !st.point) return null;
  let format;
  try { format = resolveFormat(formatKey); } catch { return null; }
  const sets = st.sets.map((s, i) => ({ games: { A: s.A, B: s.B }, tiebreak: null, is_match_tiebreak: !!s.mtb, winner: setComplete(s, i, format) ? setWinner(s) : null }));
  if (!sets.length || sets[sets.length - 1].winner) sets.push({ games: { A: 0, B: 0 }, tiebreak: null, is_match_tiebreak: false, winner: null });
  const cur = sets[sets.length - 1];
  const won = { A: sets.filter((s) => s.winner === 'A').length, B: sets.filter((s) => s.winner === 'B').length };
  let game = { A: 0, B: 0 };
  if (inTiebreakScore(st.point)) {
    const a = Number(st.point.A); const b = Number(st.point.B);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    cur.tiebreak = { A: a, B: b, first_server: null };
  } else {
    const map = { 0: 0, 15: 1, 30: 2, 40: 3 };
    const pa = String(st.point.A).toUpperCase(); const pb = String(st.point.B).toUpperCase();
    if (pa === 'AD' || pa === 'A') game = { A: 4, B: 3 }; else if (pb === 'AD' || pb === 'A') game = { A: 3, B: 4 }; else if (map[pa] != null && map[pb] != null) game = { A: map[pa], B: map[pb] }; else return null;
  }
  return { format, status: 'in_progress', server: st.server, sets, game, sets_won: won, winner: null, end_reason: null, points_played: 0 };
}

function observedSituation(st, formatKey) {
  const e = engineStateOf(st, formatKey);
  if (!e) return null;
  const tb = currentSet(e).tiebreak;
  if (tb && tb.first_server === null) return null; // tiebreak server rotation needs the first server: not provable here
  try {
    const s = situation(e);
    const out = {};
    if (s.break_point) out.break_point = s.break_point;
    if (s.set_point.length) out.set_point = s.set_point;
    if (s.match_point.length) out.match_point = s.match_point;
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

const fmtPoint = (p) => (p ? `${p.A}–${p.B}` : null);
const fmtGames = (st) => st.sets.map((s) => `${s.A}-${s.B}`).join(' ');

/**
 * ONE score_snapshot event describing the change from prev -> next (or the first observation when prev
 * is null). Returns null when nothing observable changed.
 */
export function diffSnapshots(prev, next, formatKey) {
  let format;
  try { format = resolveFormat(formatKey); } catch { format = resolveFormat('BO3_TB7'); }
  const detail = {};
  let type = null;
  let winner = null;
  let derivation = null;
  if (!prev) {
    type = next.status === 'in_progress' ? 'observation_start' : next.status === 'scheduled' ? 'scheduled' : 'match_end';
    detail.to = { games: fmtGames(next), point: fmtPoint(next.point) };
  } else {
    const sameState = prev.status === next.status && JSON.stringify(prev.sets) === JSON.stringify(next.sets) && JSON.stringify(prev.point) === JSON.stringify(next.point) && prev.server === next.server;
    if (sameState) return null;
    detail.from = { games: fmtGames(prev), point: fmtPoint(prev.point), server: prev.server };
    detail.to = { games: fmtGames(next), point: fmtPoint(next.point), server: next.server };
    const cp = completedCount(prev, format);
    const cn = completedCount(next, format);
    if (cn > cp) {
      detail.sets_won = next.sets.slice(cp, cn).map((s, k) => ({ set: cp + k + 1, winner: setWinner(s), score: s.mtb && s.tb ? `[${s.tb.A}-${s.tb.B}]` : `${s.A}-${s.B}` }));
      derivation = 'set newly complete in the observed score; winner from its final games';
    }
    const ip = lastOpen(prev, format);
    const openNow = lastOpen(next, format);
    if (cn === cp && ip !== null && openNow === ip) {
      const a = next.sets[ip].A - prev.sets[ip].A;
      const b = next.sets[ip].B - prev.sets[ip].B;
      if (a + b === 1 && a >= 0 && b >= 0) {
        winner = a === 1 ? 'A' : 'B';
        detail.game_won = { set: ip + 1, game: next.sets[ip].A + next.sets[ip].B, winner };
        derivation = 'exactly one game added to one side between two observations';
        if (prev.server) {
          detail.game_won.server = prev.server;
          detail.game_won.result = winner === prev.server ? 'hold' : 'break';
          derivation += '; server observed at the previous snapshot served that game';
        }
      } else if (a + b > 1) {
        detail.games_between_observations = a + b;
      }
    }
    if (!inTiebreakScore(prev.point) && inTiebreakScore(next.point)) detail.tiebreak_started = true;
    if (prev.status !== next.status) detail.status = { from: prev.status, to: next.status };
    if (next.status === 'retired' || next.status === 'walkover') type = next.status;
    else if (['completed'].includes(next.status) && prev.status !== next.status) type = 'match_end';
    else if (prev.status === 'scheduled' && next.status === 'in_progress') type = 'match_start';
    else if (next.status === 'suspended' && prev.status !== 'suspended') type = 'suspended';
    else if (prev.status === 'suspended' && next.status === 'in_progress') type = 'resumed';
    else if (detail.sets_won) type = 'set_won';
    else if (detail.game_won) type = detail.game_won.result === 'break' ? 'break' : 'game_won';
    else if (detail.tiebreak_started) type = 'tiebreak';
    else type = 'score_update';
    if (detail.sets_won && !winner) winner = detail.sets_won[detail.sets_won.length - 1].winner;
  }
  const sit = observedSituation(next, formatKey);
  if (sit) detail.observed_situation = sit;
  return { quality: 'score_snapshot', event_type: type, winner_side: type === 'score_update' || type === 'tiebreak' ? null : winner, derivation, event_detail: detail, state: next, server_side: next.server || null };
}

// ---- point-by-point (AO match centre) ------------------------------------------------------------------

const REASONS = [
  [/wins the point with an Ace/i, 'ace', null],
  [/loses the point with a Double Fault/i, 'double_fault', null],
  [/wins the point with a Service Winner/i, 'service_winner', null],
  [/wins the point with an? (Forehand|Backhand|Volley|Overhead|Smash|Drop Shot|Lob|Passing Shot)[\w ]* Winner/i, 'winner', 1],
  [/loses the point with an? (Forehand|Backhand|Volley|Overhead|Smash|Drop Shot|Lob)[\w ]* Unforced Error/i, 'unforced_error', 1],
  [/loses the point with an? (Forehand|Backhand|Volley|Overhead|Smash|Drop Shot|Lob)[\w ]* Forced Error/i, 'forced_error', 1]
];

export function classifyReason(text) {
  for (const [re, type, g] of REASONS) {
    const m = re.exec(String(text || ''));
    if (m) return { type, stroke: g ? m[g].toLowerCase() : null };
  }
  return { type: 'point', stroke: null }; // reason not recognised: a plain point, raw text kept
}

const ptLabel = (e) => {
  const cs = currentSet(e);
  if (cs?.tiebreak && cs.winner === null) return { A: String(cs.tiebreak.A), B: String(cs.tiebreak.B) };
  const L = ['0', '15', '30', '40'];
  const { A, B } = e.game;
  if (A >= 3 && B >= 3) return A === B ? { A: '40', B: '40' } : A > B ? { A: 'AD', B: '40' } : { A: '40', B: 'AD' };
  return { A: L[A], B: L[B] };
};

/**
 * AO match-centre commentary -> point events. `sideOfTeam` maps the feed's team index (1|2) to 'A'|'B';
 * `nameSide(name)` returns the side whose player the serve row names (or null).
 * Throws on any inconsistency — the caller then stores nothing for this match.
 */
export function aoPointEvents(commentary, { formatKey, sideOfTeam, nameSide, finalSets = null }) {
  const rows = [...commentary].sort((a, b) => (a.id < b.id ? -1 : 1));
  const serveRows = rows.filter((r) => r.type === 'serve');
  const pointRows = rows.filter((r) => r.type === 'point' || ((r.type === 'game' || r.type === 'set' || r.type === 'match') && r.winner != null));
  if (!pointRows.length || !serveRows.length) throw new Error('no point rows');
  const first = nameSide(String(serveRows[0].commentary).replace(/ is serving.*$/i, ''));
  if (!first) throw new Error('first server not identifiable');
  let s = startMatch(formatKey, first);
  const servedBy = new Map(serveRows.map((r) => [r.id.split('-').slice(1, 3).join('-'), nameSide(String(r.commentary).replace(/ is serving.*$/i, ''))]));
  const out = [];
  for (const r of pointRows) {
    const key = r.id.split('-').slice(1, 3).join('-');
    const declared = servedBy.get(key);
    const inTb = !!currentSet(s).tiebreak;
    if (declared && !inTb && declared !== s.server) throw new Error(`server mismatch at ${r.id}`);
    const side = sideOfTeam(Number(r.winner));
    if (!SIDES.includes(side)) throw new Error(`bad winner at ${r.id}`);
    const server = s.server;
    s = applyPoint(s, side);
    // cross-check against the source's own server-first point score when it is a plain score
    const src = String(r.score || '').match(/^(\w+)\s*-\s*(\w+)$/);
    if (src && s.status === 'in_progress') {
      const lab = ptLabel(s);
      const exp = server === 'A' ? `${lab.A}-${lab.B}` : `${lab.B}-${lab.A}`;
      const got = `${src[1]}-${src[2]}`.replace(/\bA\b/g, 'AD');
      if (lab.A !== '0' || lab.B !== '0') if (exp.toUpperCase() !== got.toUpperCase()) throw new Error(`score mismatch at ${r.id}: engine ${exp} source ${got}`);
    }
    const reason = classifyReason(r.commentary);
    if (reason.type === 'ace' && side !== server) throw new Error(`ace by receiver at ${r.id}`);
    if (reason.type === 'double_fault' && side === server) throw new Error(`double fault won by server at ${r.id}`);
    out.push({
      quality: 'point_event', event_type: reason.type, winner_side: side, server_side: server, source_event_id: r.id,
      event_at: r.timestamp ? new Date(r.timestamp * 1000).toISOString() : null, set_number: Number(r.set) || null,
      game_number: Number(r.id.split('-')[2]) || null, derivation: null,
      event_detail: { stroke: reason.stroke, text: r.commentary, point_from_source: r.score || null },
      state: { status: s.status, sets: s.sets.filter((x) => x.games.A + x.games.B > 0 || x.tiebreak).map((x) => ({ A: x.games.A, B: x.games.B, tb: x.tiebreak ? { A: x.tiebreak.A, B: x.tiebreak.B } : null, mtb: !!x.is_match_tiebreak })), point: s.status === 'in_progress' ? ptLabel(s) : null, server: s.server }
    });
  }
  if (finalSets) {
    const eng = s.sets.filter((x) => x.winner).map((x) => `${x.games.A}-${x.games.B}`).join(' ');
    const src = finalSets.filter((x) => x.winner).map((x) => `${x.A}-${x.B}`).join(' ');
    if (s.status === 'completed' && eng !== src) throw new Error(`final score mismatch engine ${eng} vs stored ${src}`);
  }
  return out;
}

// ---- ids, moments, control ------------------------------------------------------------------------------

export async function eventId(matchId, quality, key) {
  return `evt_${(await sha256Hex(`${matchId}|${quality}|${key}`)).slice(0, 20)}`;
}

/** Semantic key moments, only from facts an event actually carries. */
export function keyMoments(events) {
  const out = [];
  for (const e of events) {
    const d = e.event_detail || {};
    if (e.quality === 'point_event') {
      const st = e.state;
      if (e.event_type === 'ace' || e.event_type === 'double_fault') continue;
      void st;
    }
    for (const sw of d.sets_won || []) out.push({ event_id: e.event_id, kind: 'SET', side: sw.winner, text: `Set ${sw.set} · ${sw.score}` });
    if (d.game_won?.result === 'break') out.push({ event_id: e.event_id, kind: 'BREAK', side: d.game_won.winner, text: `Break · set ${d.game_won.set}` });
    if (d.tiebreak_started) out.push({ event_id: e.event_id, kind: 'TIEBREAK', side: null, text: 'Tiebreak' });
    if (d.observed_situation?.match_point) out.push({ event_id: e.event_id, kind: 'MATCH POINT', side: d.observed_situation.match_point[0], text: 'Match point (observed)' });
    else if (d.observed_situation?.set_point) out.push({ event_id: e.event_id, kind: 'SET POINT', side: d.observed_situation.set_point[0], text: 'Set point (observed)' });
    if (['retired', 'walkover', 'suspended', 'resumed', 'match_end'].includes(e.event_type)) out.push({ event_id: e.event_id, kind: e.event_type.toUpperCase().replace('_', ' '), side: e.winner_side, text: e.event_type.replace('_', ' ') });
  }
  return out;
}

/**
 * MATCH CONTROL — descriptive, NOT a win probability. Share of the last N games whose winner is known
 * (from game_won/break snapshot events or point-by-point game ends), each break counting 1.5.
 * Returns null when fewer than 4 games have a known winner.
 */
export function matchControl(events, { window = 8 } = {}) {
  const games = [];
  for (const e of events) {
    if (e.event_detail?.game_won?.winner) games.push({ w: e.event_detail.game_won.winner, brk: e.event_detail.game_won.result === 'break' });
  }
  const recent = games.slice(-window);
  if (recent.length < 4) return null;
  const score = { A: 0, B: 0 };
  for (const g of recent) score[g.w] += g.brk ? 1.5 : 1;
  const t = score.A + score.B;
  return { A: Math.round((score.A / t) * 100), B: Math.round((score.B / t) * 100), games: recent.length, definition: `share of the last ${recent.length} games with a known winner; breaks weigh 1.5; descriptive, not a win probability` };
}

/** Game-by-game blocks for the timeline from point events (exact) — server + winner per game. */
export function gamesFromPoints(pointEvents) {
  const games = [];
  let prevSets = 0;
  let prevGames = null;
  for (const e of pointEvents) {
    const sets = e.state.sets;
    const done = sets.length;
    const last = sets[sets.length - 1];
    const key = `${done}:${last ? last.A + last.B : 0}`;
    if (prevGames !== null && key !== prevGames) {
      games.push({ set: e.set_number, winner: e.winner_side, server: e.server_side, result: e.winner_side === e.server_side ? 'hold' : 'break' });
    }
    prevGames = key;
    prevSets = done;
  }
  void prevSets;
  return games;
}

export { other };
