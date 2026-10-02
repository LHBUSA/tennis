// PBEcast Broadcast V4 — PURE derivations for the broadcast surface (tests/pbecast-broadcast.test.js).
// Three data modes, each shown for what it is:
//   point     — source point events (e.g. Australian Open): every point, its winner, server, source reason
//   observed  — periodic score + server observations (official WTA live): transitions, never reconstructed points
//   snapshot  — game-level state only (secondary ESPN ATP): sets/games; NO point score, NO server, NO feed invented
// Nothing here estimates; every count states its basis.

import { gamesFrom } from './pbecast-view.js';
import { gameSituation } from './pbecast-feed.js';

/** The data mode of a PBEcast payload. */
export function dataMode(data) {
  const evs = data?.events || [];
  if (data?.quality === 'point_event' || evs.some((e) => e.quality === 'point_event')) return 'point';
  if (evs.length && evs.some((e) => e.state?.point)) return 'observed';
  return 'snapshot';
}

const other = (s) => (s === 'A' ? 'B' : 'A');
const setNo = (e) => e?.set_number || e?.state?.sets?.length || null;

/**
 * Break-point pressure for the CURRENT match up to `upto`. Point mode: every point played at break point (state BEFORE
 * the point), per returner: chances, converted (returner won the point), and per server: faced, saved. Observed mode:
 * GAMES in which a break-point state was observed, and how each such game ended (break / hold) when provable.
 * Snapshot mode: null (no point states exist). scope 'set' limits to the set of the event at `upto`.
 */
export function breakPressure(events, upto, { mode, scope = 'match' } = {}) {
  if (mode === 'snapshot') return null;
  const evs = (events || []).slice(0, upto + 1);
  const curSet = setNo(evs.at(-1));
  const inScope = (e) => scope !== 'set' || setNo(e) === curSet;
  const z = () => ({ A: 0, B: 0 });
  if (mode === 'point') {
    const chances = z(); const converted = z(); const faced = z(); const saved = z();
    for (let i = 1; i < evs.length; i += 1) {
      const e = evs[i];
      if (e.quality !== 'point_event' || !inScope(e)) continue;
      const before = evs[i - 1].state;
      const g = before?.point && before.server ? gameSituation(before.point, before.server) : null;
      if (!g || g.kind !== 'break_point' || !e.winner_side) continue;
      const ret = g.side; const srv = other(ret);
      chances[ret] += 1; faced[srv] += 1;
      if (e.winner_side === ret) converted[ret] += 1; else saved[srv] += 1;
    }
    return { basis: 'points', scope, chances, converted, faced, saved, note: 'every point played at break point in this match (from the source point stream)' };
  }
  // observed: games with an observed break-point state, by returner, and how the game ended when the game is provable
  const games = new Map(); // key set:game -> { ret, outcome }
  for (const e of evs) {
    if (!inScope(e)) continue;
    const st = e.state;
    const g = st?.point && st.server && st.status === 'in_progress' ? gameSituation(st.point, st.server) : null;
    const sets = st?.sets || [];
    const cur = sets.at(-1);
    const key = cur ? `${sets.length}:${(cur.A || 0) + (cur.B || 0) + 1}` : null;
    if (g?.kind === 'break_point' && key && !games.has(key)) games.set(key, { ret: g.side, outcome: null });
    const gw = e.event_detail?.game_won;
    if (gw?.winner && gw.set && gw.game) { const k = `${gw.set}:${gw.game}`; if (games.has(k)) games.get(k).outcome = gw.result || null; }
  }
  const chances = z(); const converted = z(); const saved = z();
  for (const { ret, outcome } of games.values()) { chances[ret] += 1; if (outcome === 'break') converted[ret] += 1; if (outcome === 'hold') saved[other(ret)] += 1; }
  return { basis: 'observed_games', scope, chances, converted, saved, unknown: [...games.values()].filter((x) => !x.outcome).length, note: 'games in which a break-point score was observed (observations are periodic: break points between two observations are not seen)' };
}

/** "won N of the last M games with a provable winner" for both players (M <= window), or null. Point mode reads the
 *  winner of each real game-ending point; observed mode the provable games (exactly one game changed). */
export function recentGames(events, upto, { window = 8, mode = null } = {}) {
  const evs = (events || []).slice(0, upto + 1);
  const g = mode === 'point' ? gameEnds(evs).map((i) => ({ winner: evs[i].winner_side })).filter((x) => x.winner) : gamesFrom(evs, upto);
  if (g.length < 2) return null;
  const last = g.slice(-window);
  return { window: last.length, A: last.filter((x) => x.winner === 'A').length, B: last.filter((x) => x.winner === 'B').length, basis: 'games with a provable winner' };
}

/** First event index of each set (jump by set). */
export function setStarts(events) {
  const out = [];
  (events || []).forEach((e, i) => { const s = setNo(e); if (s && !out.some((x) => x.set === s)) out.push({ set: s, index: i }); });
  return out;
}

const endsGame = (e) => ['game_won', 'break', 'set_won', 'match_end'].includes(e.event_type) || !!e.event_detail?.game_won || (e.quality === 'point_event' && /^Game$/i.test(String(e.event_detail?.point_from_source || '')));
/** Indexes of events that close a game (real events only). */
export function gameEnds(events) { return (events || []).map((e, i) => (endsGame(e) ? i : -1)).filter((i) => i >= 0); }
/** Previous / next game boundary from a position (the game-ending event); null at the edges. */
export function prevGame(events, pos) { const g = gameEnds(events).filter((i) => i < pos); return g.length ? g.at(-1) : (pos > 0 ? 0 : null); }
export function nextGame(events, pos) { return gameEnds(events).find((i) => i > pos) ?? null; }

/**
 * The CURRENT MOMENT for the hero: where the match is and what just changed, in the mode's own terms.
 * state: the view state at the position; last: { tag, line } of the event at the position (or null).
 */
export function currentMoment(state, mode, { last = null } = {}) {
  const sets = state?.sets || [];
  const cur = sets.at(-1) || null;
  const final = ['completed', 'retired', 'walkover'].includes(state?.status);
  const tb = state?.point && /^\d+$/.test(String(state.point.A)) && /^\d+$/.test(String(state.point.B)) && !['0', '15', '30', '40'].includes(String(state.point.A));
  return {
    final, set: sets.length || null, game: cur && !final && !tb ? (cur.A || 0) + (cur.B || 0) + 1 : null, tiebreak: !!tb,
    games: cur ? { A: cur.A, B: cur.B } : null,
    point: mode === 'snapshot' || final ? null : state?.point || null,
    server: mode === 'snapshot' || final ? null : state?.server || null, // never invented: only a sourced server
    last
  };
}
