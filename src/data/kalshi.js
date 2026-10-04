// Kalshi Market Intelligence for Tennis (contract market-intel/1).
//
// The browser never calls Kalshi. It reads the shared PropBetEdge propsports-markets Worker (our own runtime), which
// matches Kalshi prediction-market events to canonical tennis matches: canonical_event_id = our match UUID (the same id
// as /matches/:id). Outcome roles `a` / `b` are our match sides A / B; proposition `player_wins_match`.
// This is a prediction market — never sportsbook odds and never a PBE model. tennis-api /v1/odds is unrelated and
// stays as it is. The shared client + UI are vendored UNCHANGED in src/vendor/kalshi/.
// No entry -> nothing rendered; a failed or slow market read never blocks or blanks a page.

import { createKalshiClient } from '../vendor/kalshi/kalshi-market-client.js';
import { kalshiLine, marketCloseLine, venueChip, wireKalshi } from '../vendor/kalshi/kalshi-market-ui.js';

export const MARKETS_ORIGIN = 'https://propsports-markets.sales-fd3.workers.dev';
export const kalshi = createKalshiClient({ sport: 'tennis', base: MARKETS_ORIGIN });

/**
 * Venue desk cadence (Polymarket, …): the multi-venue desk is re-read on its OWN 30 s cadence while the page is visible,
 * independent of Kalshi's state (a venue never waits on another venue); "Updated Xs ago" re-renders every 10 s in place.
 */
export const DESK_POLL_MS = 30_000;
export const VENUE_AGE_TICK_MS = 10_000;

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

/** How long a CLOSED market (or a decided match whose market has not closed yet) waits between reads: 5 min. */
export const MARKET_CLOSED_POLL_MS = 300_000;

/**
 * Market-aware poll interval for a page showing one match (ms, or null = stop). The market lifecycle decides once the
 * market has closed: CLOSED -> 5 min until the venue settles; SETTLED -> no polling. Otherwise the match status lane:
 * live 20 s, pregame 45 s, no market yet 120 s; a decided match whose market still trades -> 5 min; a decided match
 * with no market -> none. So a page evolves on its own (live card -> "How the market closed") with no release.
 */
export function marketPollMs(entry, status) {
  const lc = entry?.market?.lifecycle;
  if (lc === 'SETTLED') return null;
  if (lc === 'CLOSED') return MARKET_CLOSED_POLL_MS;
  const lane = kalshiPollState(status);
  if (lane) return kalshi.pollMsFor(entry ? lane : 'idle');
  return entry ? MARKET_CLOSED_POLL_MS : null;
}

/** Compact cards show a live market line only for matches still to be decided. */
export const kalshiLineEligible = (m) => !!m?.id && ['scheduled', 'in_progress', 'suspended'].includes(m.status);
/** Decided matches (result cards) carry the subtle "how the market closed" line instead. */
export const kalshiCloseEligible = (m) => !!m?.id && ['completed', 'retired', 'walkover'].includes(m.status);

/**
 * Both market boards a list page needs, read together: the Kalshi board and the VENUE-NEUTRAL desk board (every match
 * with a market on any venue). Resolves with the Kalshi board (callers keep their shape); failures resolve, never throw.
 */
export const loadMarketBoards = () => Promise.all([kalshi.loadBoard(), kalshi.loadDeskBoard().catch(() => null)]).then(([b]) => b);

/**
 * The restrained schedule-card line for a match ('' when none). VENUE-NEUTRAL: the Kalshi line and the other-venue cue
 * ("MARKET · POLYMARKET ...") are independent — a match listed only on Polymarket still gets its cue.
 */
export const kalshiLineFor = (m) => (kalshiLineEligible(m) ? kalshiLine(kalshi.forEvent(m.id)) + venueChip(kalshi.deskFor(m.id)) : kalshiCloseEligible(m) ? marketCloseLine(kalshi.forEvent(m.id)) : '');

/** Fill every compact-card slot under `root` from the current boards (slots with no market on any venue stay empty). */
export function paintKalshiLines(root) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll('[data-kx-line]')) {
    const id = el.dataset.kxLine;
    const entry = kalshi.forEvent(id);
    const html = el.hasAttribute('data-kx-close') ? marketCloseLine(entry) : kalshiLine(entry) + venueChip(kalshi.deskFor(id));
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  wireKalshi(root);
}
