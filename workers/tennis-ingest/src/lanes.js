// Backfill lane scheduler — PURE (tests/lanes.test.js).
//
// Priority lanes (current / live-adjacent work, e.g. the AO current edition) run EVERY tick first while they
// have work. Rotating lanes (history backfills) share the remaining budget round-robin: exactly one runs per
// tick, so a long archive can never monopolise ingestion. Every lane keeps its own state: a failing or slow
// source backs off alone (exponential, capped) and never holds another source's slot.

export const LANE_STATE_KEY = (name) => `lane:${name}`;
const BASE_BACKOFF_MS = 4 * 60 * 1000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

/** Backoff after `failures` consecutive failures: 4 min, 8, 16 … capped at 6 h. */
export const backoffMs = (failures) => (failures <= 0 ? 0 : Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (failures - 1)));

const eligible = (l, now) => !l.done && !(l.backoff_until && Date.parse(l.backoff_until) > now);

/**
 * lanes: [{ name, priority: bool, done, backoff_until }] in declaration order; rr: index of the next rotating
 * lane to try. Returns { run: [names in order], rr } — all eligible priority lanes, then ONE rotating lane.
 */
export function planTick({ now, lanes, rr = 0 }) {
  const run = lanes.filter((l) => l.priority && eligible(l, now)).map((l) => l.name);
  const rot = lanes.filter((l) => !l.priority);
  let next = rr;
  for (let k = 0; k < rot.length; k += 1) {
    const idx = (rr + k) % rot.length;
    if (eligible(rot[idx], now)) { run.push(rot[idx].name); next = (idx + 1) % rot.length; break; }
  }
  return { run, rr: next };
}

/** New lane state after a run: success clears failures; failure backs off; `done` retires the lane. */
export function afterRun(state = {}, { ok, done = false, now }) {
  if (done) return { ...state, done: true, done_at: new Date(now).toISOString(), failures: 0, backoff_until: null };
  if (ok) return { ...state, failures: 0, backoff_until: null, last_ok: new Date(now).toISOString() };
  const failures = (state.failures || 0) + 1;
  return { ...state, failures, backoff_until: new Date(now + backoffMs(failures)).toISOString(), last_error_at: new Date(now).toISOString() };
}
