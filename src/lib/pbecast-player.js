// PBEcast playback controller — PURE (tests/pbecast-v3.test.js). The page owns timers and DOM; this module
// owns every decision: where playback starts, when it advances, when it pauses, how live mode follows.
//
// Pacing is PRESENTATION timing only — how long the UI dwells on an observed/official event. It is never
// shown or stored as match-event duration.

export const DEFAULT_SPEED = 1.5;
export const SPEEDS = [1, 1.5, 2, 4];
const DWELL = { score_update: 800, observation_start: 800, match_start: 900, point: 800, ace: 950, double_fault: 950, winner: 900, unforced_error: 850, forced_error: 850, service_winner: 900, game_won: 1100, tiebreak: 1150, break: 1500, set_won: 1900, match_end: 2000, retired: 2000, walkover: 1500, suspended: 1200, resumed: 1000 };

/** ms the UI dwells on an event at a replay speed (presentation only). */
export function dwellMs(eventType, speed = DEFAULT_SPEED) {
  const base = DWELL[eventType] ?? 850;
  return Math.round(base / (SPEEDS.includes(speed) ? speed : DEFAULT_SPEED));
}

/**
 * Initial playback state.
 *   live  -> follow the latest event, nothing to press.
 *   replay -> start at event 0 and autoplay, unless a deep link (?t=) selects an event: then hold there.
 */
export function initialState({ live, count, deepLinkIndex = -1, speed = DEFAULT_SPEED }) {
  const last = Math.max(0, count - 1);
  if (live) return { mode: 'live', pos: last, playing: false, following: true, paused: false, done: false, speed };
  if (deepLinkIndex >= 0 && deepLinkIndex <= last) return { mode: 'replay', pos: deepLinkIndex, playing: false, following: false, paused: true, done: false, speed };
  return { mode: 'replay', pos: 0, playing: count > 1, following: false, paused: false, done: count <= 1, speed };
}

/** One autoplay tick. Stops at the final state; never loops. */
export function advance(st, count) {
  if (st.mode !== 'replay' || !st.playing) return st;
  const last = count - 1;
  if (st.pos >= last) return { ...st, playing: false, done: true };
  const pos = st.pos + 1;
  return { ...st, pos, playing: pos < last, done: pos >= last };
}

/** Any manual navigation (scrub, previous, next, marker, key moment) pauses playback / live following. */
export function seek(st, pos, count) {
  const p = Math.max(0, Math.min(count - 1, pos));
  if (st.mode === 'live') return { ...st, pos: p, following: p === count - 1 && !st.paused ? st.following : false, paused: p !== count - 1 || st.paused };
  return { ...st, pos: p, playing: false, paused: true, done: false };
}

export const step = (st, delta, count) => seek(st, st.pos + delta, count);

/** Play/pause toggle for replays. Playing from the final state restarts. */
export function togglePlay(st, count) {
  if (st.mode !== 'replay') return st;
  if (st.playing) return { ...st, playing: false, paused: true };
  const pos = st.pos >= count - 1 ? 0 : st.pos;
  return { ...st, pos, playing: count > 1, paused: false, done: false };
}

export const replayAgain = (st, count) => ({ ...st, pos: 0, playing: count > 1, paused: false, done: false });
export const jumpToStart = (st) => ({ ...st, pos: 0, playing: false, paused: true, done: false });

/** Live: pause updates to inspect history; return to live snaps to the latest event and follows again. */
export const pauseLive = (st) => (st.mode === 'live' ? { ...st, paused: true, following: false } : st);
export const returnToLive = (st, count) => (st.mode === 'live' ? { ...st, paused: false, following: true, pos: Math.max(0, count - 1) } : st);

/**
 * New events arrived from the live feed. Following viewers get the queue of new positions to animate through
 * (in order, one real event at a time); paused viewers stay exactly where they are.
 */
export function liveArrivals(st, prevCount, count) {
  if (st.mode !== 'live' || count <= prevCount) return { st, queue: [] };
  if (!st.following || st.paused) return { st: { ...st }, queue: [] };
  const queue = [];
  for (let i = Math.max(prevCount, st.pos + 1); i < count; i += 1) queue.push(i);
  return { st, queue };
}
