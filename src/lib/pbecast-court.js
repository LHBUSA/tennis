// PBEcast live court state machine — PURE (tests/pbecast-court.test.js). docs/PBECAST_LIVE_CAPABILITY_AUDIT.md.
//
// Two granularities, never flattened into each other:
//   point — score + server per observation (WTA live; point-event replays). Point winners only where two consecutive
//           observations differ by exactly one legal point (pbecast-feed.js singlePointWinner); never across a gap.
//   game  — set/game scores only (ATP live). No point score, no server, no hold/break (a break needs a known server).
// Every game is accounted for: a game whose winner is provable is its own entry; games completed between two
// observations by BOTH sides are one honest "span" entry (counts per side, order unknown); games completed before
// the first observation are an "unobserved" entry. Nothing here carries or produces a position, a trajectory, a
// bounce, a serve placement, a speed, a rally length or a shot sequence: no current source supplies any of them.

import { pointFeed } from './pbecast-feed.js';
import { isSetComplete } from './pbecast-state.js';

/** Fields that would mean spatial / shot tracking. A source that supplies none of them never gets a tracking view. */
export const SPATIAL_FIELDS = Object.freeze(['coordinates', 'trail', 'ball', 'bounce', 'placement', 'direction', 'player_position', 'serve_speed_kmh', 'rally_length', 'serve_number', 'shot_sequence']);

/** True only when a stored SOURCE point event carries coordinates (none does today). */
export function hasSpatial(events) {
  return (events || []).some((e) => e?.quality === 'point_event' && e.coordinates != null);
}

/** 'point' | 'game' | 'score': the richest truthful granularity this PBEcast payload supports. */
export function liveGranularity(data) {
  if (data?.live_granularity === 'point' || data?.live_granularity === 'game') return data.live_granularity;
  const evs = data?.events || [];
  if (evs.some((e) => e.quality === 'point_event' || e.state?.point) || data?.match?.live?.point) return 'point';
  if (evs.length || (data?.match?.sets || []).length) return 'game';
  return 'score';
}

const FINAL = new Set(['completed', 'retired', 'walkover']);
const zero = { A: 0, B: 0 };
const isTbGame = (p, c, s) => !s.mtb && Math.max(c.A, c.B) === 7 && Math.min(c.A, c.B) === 6 && p.A === 6 && p.B === 6;

/**
 * The completed-game ledger up to `upto`, OLDEST first. Entries:
 *   { kind: 'game', set, game, winner, server|null, result: 'hold'|'break'|null, tiebreak, after:{A,B}, set_end, idx, at, between }
 *   { kind: 'span', set, from, to, A, B, idx, at }          games completed between two observations by both sides
 *   { kind: 'unobserved', set, A, B, idx, at }              games already played at the first observation
 * `.corrections` lists source corrections (a game taken back retracts that side's latest entry in the set).
 * hold/break only when the server of THAT game was observed (the previous observation was inside the same game).
 */
export function gameLedger(events, upto = Infinity) {
  const evs = (events || []).slice(0, Number.isFinite(upto) ? Math.max(0, upto) + 1 : undefined);
  const out = [];
  const corrections = [];
  let prev = null;
  evs.forEach((e, idx) => {
    const st = e?.state;
    if (!st?.sets) return;
    const at = e.event_at || e.observed_at || null;
    if (!prev) {
      st.sets.forEach((s, i) => { if (s.A + s.B > 0) out.push({ kind: 'unobserved', set: i + 1, A: s.A, B: s.B, idx, at }); });
      prev = st;
      return;
    }
    const prevSet = prev.sets.length - 1; // the set the previous observation was in
    st.sets.forEach((c, i) => {
      // the ledger reconciles against its OWN totals: a source correction that takes a game back retracts the latest
      // entry of that side in that set (recorded), so a re-awarded game is never counted twice
      for (const s of ['A', 'B']) {
        while ((ledgerTotals(out)[i]?.[s] || 0) > c[s]) {
          const j = out.findLastIndex((g) => g.set === i + 1 && (g.kind === 'game' ? g.winner === s : g[s] > 0));
          if (j < 0) break;
          if (out[j].kind === 'game') out.splice(j, 1); else { out[j] = { ...out[j], [s]: out[j][s] - 1 }; if (!out[j].A && !out[j].B) out.splice(j, 1); }
          corrections.push({ set: i + 1, side: s, idx, at });
        }
      }
      const p = ledgerTotals(out)[i] || zero;
      const dA = c.A - p.A;
      const dB = c.B - p.B;
      if (dA < 0 || dB < 0 || dA + dB <= 0) return; // no new game
      const n = dA + dB;
      const done = isSetComplete(c);
      if (n === 1) {
        const winner = dA ? 'A' : 'B';
        const tiebreak = isTbGame(p, c, c) || !!c.mtb;
        const knownServer = !tiebreak && i === prevSet && (prev.server === 'A' || prev.server === 'B') ? prev.server : null;
        out.push({ kind: 'game', set: i + 1, game: c.A + c.B, winner, server: knownServer, result: knownServer ? (knownServer === winner ? 'hold' : 'break') : null, tiebreak, after: { A: c.A, B: c.B }, set_end: done, idx, at, between: false });
      } else if (!dA || !dB) {
        // one side won every game of the gap: each winner is proven, the order is trivial, the servers are not observed
        const winner = dA ? 'A' : 'B';
        for (let k = 1; k <= n; k += 1) {
          const before = winner === 'A' ? { A: p.A + k - 1, B: c.B } : { A: c.A, B: p.B + k - 1 };
          const after = winner === 'A' ? { A: p.A + k, B: c.B } : { A: c.A, B: p.B + k };
          out.push({ kind: 'game', set: i + 1, game: p.A + p.B + k, winner, server: null, result: null, tiebreak: !!c.mtb || isTbGame(before, after, c), after, set_end: done && k === n, idx, at, between: true });
        }
      } else {
        out.push({ kind: 'span', set: i + 1, from: p.A + p.B + 1, to: c.A + c.B, A: dA, B: dB, idx, at, set_end: done });
      }
    });
    prev = st;
  });
  out.corrections = corrections; // source corrections that took a game back (each retracted one entry)
  return out;
}

/** Games per set accounted for by a ledger (game + span + unobserved). Equals the score when the ledger is complete. */
export function ledgerTotals(ledger) {
  const t = [];
  for (const g of ledger || []) {
    const s = (t[g.set - 1] ||= { A: 0, B: 0 });
    if (g.kind === 'game') s[g.winner] += 1;
    else { s.A += g.A; s.B += g.B; }
  }
  return t.map((x) => x || { A: 0, B: 0 });
}

/** The game in play (null between sets, when final, or with no score). */
export function currentGame(state) {
  if (!state || state.status !== 'in_progress') return null;
  const cur = state.sets?.at(-1);
  if (!cur || isSetComplete(cur)) return null;
  return { set: state.sets.length, game: cur.A + cur.B + 1 };
}

/** Same side won the last N provable games in a row (N >= 2), plus a BREAK + HOLD pattern. Stops at any gap. */
export function gameRun(ledger) {
  const g = ledger || [];
  let n = 0;
  let side = null;
  for (let i = g.length - 1; i >= 0; i -= 1) {
    const x = g[i];
    if (x.kind !== 'game') break;
    if (side && x.winner !== side) break;
    side = x.winner;
    n += 1;
  }
  const last = g.at(-1);
  const before = g.at(-2);
  const breakHold = last?.kind === 'game' && before?.kind === 'game' && last.winner === before.winner && before.result === 'break' && last.result === 'hold' && !before.set_end;
  return n >= 2 || breakHold ? { side, games: n, break_hold: breakHold } : null;
}

/** Proven point winners in the game in play (oldest first) — only single-point steps. */
export function provenPoints(events, upto, match) {
  const items = pointFeed(events, match, { upto });
  const st = events?.[Math.min(upto, (events?.length || 1) - 1)]?.state;
  const g = currentGame(st);
  if (!g) return [];
  return items.filter((it) => it.kind === 'point' && it.winner && it.set === g.set && it.game === g.game).map((it) => ({ idx: it.idx, winner: it.winner, to: it.to, saved: !!it.saved }));
}

/** Consecutive proven points by one side, counted back from the latest event; any unproven step ends the run. */
export function pointRun(events, upto, match) {
  const items = pointFeed(events, match, { upto });
  let n = 0;
  let side = null;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (it.kind !== 'point' || !it.winner) break;
    if (side && it.winner !== side) break;
    side = it.winner;
    n += 1;
  }
  return n >= 3 ? { side, points: n } : null;
}

/**
 * What the court reacts to at `pos`: one reaction per real stored event, from the observed transition only.
 * -> { kind, side|null, label, tone } or null. kind: match | set | break | hold | game | games | bp_saved | point |
 *    advantage | deuce | advance | server | start. Point kinds never occur at game granularity.
 */
export function courtReaction(events, pos, { match = null, granularity = 'point', name = (s) => s } = {}) {
  const e = events?.[pos];
  if (!e) return null;
  const up = (s) => String(name(s)).toUpperCase();
  if (e.event_type === 'match_end' || e.event_type === 'retired' || FINAL.has(e.state?.status)) {
    const w = match?.winner_side || e.winner_side || null;
    return { kind: 'match', side: w, label: w ? `MATCH · ${up(w)}` : 'MATCH COMPLETE', tone: 'major' };
  }
  const fresh = gameLedger(events, pos).filter((g) => g.idx === pos && g.kind !== 'unobserved');
  const setEnd = fresh.find((g) => g.set_end);
  if (e.event_type === 'set_won' || setEnd) {
    const w = e.winner_side || setEnd?.winner || null;
    return { kind: 'set', side: w, label: w ? `SET · ${up(w)}` : 'SET COMPLETE', tone: 'major' };
  }
  if (fresh.length === 1 && fresh[0].kind === 'game') {
    const g = fresh[0];
    const kind = g.result === 'break' ? 'break' : g.result === 'hold' ? 'hold' : 'game';
    return { kind, side: g.winner, label: `${kind.toUpperCase()} · ${up(g.winner)}`, tone: kind === 'break' ? 'major' : 'game' };
  }
  if (fresh.length) {
    const n = fresh.reduce((k, g) => k + (g.kind === 'span' ? g.A + g.B : 1), 0);
    const one = fresh.every((g) => g.kind === 'game' && g.winner === fresh[0].winner) ? fresh[0].winner : null;
    return { kind: 'games', side: one, label: one ? `${n} GAMES · ${up(one)}` : `${n} GAMES BETWEEN OBSERVATIONS`, tone: 'game' };
  }
  if (e.event_type === 'match_start' || e.event_type === 'observation_start') return { kind: 'start', side: null, label: 'LIVE', tone: 'quiet' };
  if (granularity !== 'point') return null;
  const it = pointFeed(events, match, { upto: pos }).at(-1);
  if (it?.kind === 'point' && it.winner) {
    if (it.saved) return { kind: 'bp_saved', side: it.winner, label: `${/break/.test(it.line) ? 'BREAK POINT' : /set point/.test(it.line) ? 'SET POINT' : /match point/.test(it.line) ? 'MATCH POINT' : 'GAME POINT'} SAVED · ${up(it.winner)}`, tone: /break|set|match/.test(it.line) ? 'major' : 'point' };
    if (it.sit?.kind === 'deuce') return { kind: 'deuce', side: it.winner, label: 'DEUCE', tone: 'point' };
    if (it.sit?.kind === 'advantage') return { kind: 'advantage', side: it.winner, label: `ADVANTAGE · ${up(it.winner)}`, tone: 'point' };
    return { kind: 'point', side: it.winner, label: `POINT · ${up(it.winner)}`, tone: 'point' };
  }
  if (it?.kind === 'jump') return { kind: 'advance', side: null, label: 'SCORE ADVANCED', tone: 'quiet' };
  const prev = events[pos - 1]?.state;
  if (prev && e.state?.server && prev.server && prev.server !== e.state.server) return { kind: 'server', side: e.state.server, label: `${up(e.state.server)} TO SERVE`, tone: 'quiet' };
  return null;
}

/** The last `n` ledger entries for the action rail, newest LAST, with set boundaries marked. */
export function actionRail(ledger, n = 8) {
  const g = (ledger || []).filter((x) => x.kind !== 'unobserved');
  return g.slice(-n).map((x, i, a) => ({ ...x, new_set: i > 0 && a[i - 1].set !== x.set }));
}

/** Live but no new observation for a while (cadence is ~1/min): { stale, minutes } — never fills the gap with anything. */
export function staleness(lastAt, { now = Date.now(), live = true, afterS = 180 } = {}) {
  const t = Date.parse(lastAt || '');
  if (!live || !Number.isFinite(t)) return { stale: false, minutes: null };
  const s = Math.max(0, (now - t) / 1000);
  return { stale: s >= afterS, minutes: Math.floor(s / 60) };
}
