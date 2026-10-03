// Kalshi Market Intelligence for Tennis (contract market-intel/1).
//
// The browser never calls Kalshi. It reads the shared PropBetEdge propsports-markets Worker (our own runtime), which
// matches Kalshi prediction-market events to canonical tennis matches: canonical_event_id = our match UUID (the same id
// as /matches/:id). Outcome roles `a` / `b` are our match sides A / B; proposition `player_wins_match`.
// This is a prediction market — never sportsbook odds and never a PBE model. tennis-api /v1/odds is unrelated and
// stays as it is. The shared client + UI are vendored UNCHANGED in src/vendor/kalshi/.
// No entry -> nothing rendered; a failed or slow market read never blocks or blanks a page.

import { createKalshiClient } from '../vendor/kalshi/kalshi-market-client.js';
import { kalshiLine, wireKalshi } from '../vendor/kalshi/kalshi-market-ui.js';

export const MARKETS_ORIGIN = 'https://propsports-markets.sales-fd3.workers.dev';
export const kalshi = createKalshiClient({ sport: 'tennis', base: MARKETS_ORIGIN });

/** Longest a page waits for the market read before its first paint (then it fills in when it arrives). */
export const KALSHI_FIRST_PAINT_MS = 800;

/** Resolves with the promise's value, or `undefined` after `ms` — never rejects. */
export function bounded(promise, ms = KALSHI_FIRST_PAINT_MS) {
  let t;
  const late = new Promise((ok) => { t = setTimeout(() => ok(undefined), ms); });
  return Promise.race([Promise.resolve(promise).catch(() => null), late]).finally(() => clearTimeout(t));
}

/** Canonical match status -> the client's poll lane: 'live' (20 s), 'pregame' (45 s), null (settled: stop polling). */
export function kalshiPollState(status) {
  if (status === 'in_progress') return 'live';
  if (status === 'scheduled' || status === 'suspended') return 'pregame';
  return null;
}

/** Compact cards show a market line only for matches still to be decided. */
export const kalshiLineEligible = (m) => !!m?.id && ['scheduled', 'in_progress', 'suspended'].includes(m.status);

/** The restrained schedule-card line for a match from the loaded board ('' when none). */
export const kalshiLineFor = (m) => (kalshiLineEligible(m) ? kalshiLine(kalshi.forEvent(m.id)) : '');

/** Fill every compact-card slot under `root` from the current board (slots with no market stay empty). */
export function paintKalshiLines(root) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll('[data-kx-line]')) {
    const html = kalshiLine(kalshi.forEvent(el.dataset.kxLine));
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  wireKalshi(root);
}
