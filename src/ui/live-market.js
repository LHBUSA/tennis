// Tennis Market Pulse module (Kalshi prediction market) — MLB market-presentation standard (owner 2026-10-03).
// One module directly under the scoreboard for the whole match lifecycle, with a lifecycle label:
//   UPCOMING / ACTIVE  -> "MARKET OPEN · PRE-MATCH" / "LIVE MARKET" / "MATCH FINAL · MARKET STILL TRADING" + the FULL
//                         shared kalshiCard (Market Pulse, Mid-market, Updated Ns ago, stored movement + sparkline,
//                         bid / ask, "View market on Kalshi ↗").
//   CLOSED / SETTLED   -> "MARKET CLOSED · AWAITING SETTLEMENT" / "MARKET SETTLED" + the shared "How the market closed"
//                         history (marketHistoryCard) + our match result as a SEPARATE fact. A finished match never
//                         implies a settlement.
// Kalshi = the market, never sportsbook odds, never a PBE probability. No market -> ''.
// Pure HTML builder (tests/live-market.test.js); data comes from src/data/kalshi.js (our markets Worker, never Kalshi).

import { kalshiCard, kalshiLine, marketHistoryCard } from '../vendor/kalshi/kalshi-market-ui.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// a score is written from the WINNER's side (ours is stored side A first)
const winnerScore = (score, w) => (w === 'B' ? String(score).split(/\s+/).map((t) => t.replace(/^(\d+)-(\d+)/, (_, a, b) => `${b}-${a}`).replace(/^\[(\d+)-(\d+)\]/, (_, a, b) => `[${b}-${a}]`)).join(' ') : String(score));
const FINAL = new Set(['completed', 'retired', 'walkover']);

/** The module's state for an entry + our match: null when no market exists for this match. */
export function marketState(entry, match) {
  const lc = entry?.market?.lifecycle || null;
  if (!entry || (!entry.kalshi && lc !== 'CLOSED' && lc !== 'SETTLED')) return null;
  if (lc === 'SETTLED') return { key: 'settled', label: 'MARKET SETTLED', live: false };
  if (lc === 'CLOSED') return { key: 'closed', label: FINAL.has(match?.status) ? 'MARKET CLOSED · AWAITING SETTLEMENT' : 'MARKET CLOSED', live: false };
  if (entry.kalshi?.state !== 'open') return null;
  if (FINAL.has(match?.status)) return { key: 'final-open', label: 'MATCH FINAL · MARKET STILL TRADING', live: false };
  return match?.status === 'in_progress' ? { key: 'live', label: 'LIVE MARKET', live: true } : { key: 'open', label: 'MARKET OPEN · PRE-MATCH', live: false };
}

/** Our final match result, a SEPARATE fact from any market settlement (winner-side score). '' unless final. */
export function finalLine(match, name) {
  if (!match || !FINAL.has(match.status) || !match.winner_side) return '';
  const loser = match.winner_side === 'A' ? 'B' : 'A';
  return `<p class="lm-result"><small>Final match result</small><b>${esc(name(match.winner_side))}</b> def. ${esc(name(loser))}${match.score ? ` <span class="tabnum">${esc(winnerScore(match.score, match.winner_side))}</span>` : ''}${match.status === 'retired' ? ' (ret.)' : ''}</p>`;
}

/**
 * entry: event-endpoint entry (kalshi, market, market_history, movement); match: our canonical match;
 * name(side) -> display name (for our separate result line); compact: PBEcast layout.
 */
export function liveMarketPanel(entry, match, { name = (s) => s, placement = 'pbecast', compact = false } = {}) {
  const st = marketState(entry, match);
  if (!st) return '';
  const done = st.key === 'closed' || st.key === 'settled';
  const body = done ? marketHistoryCard(entry, { placement: `${placement}-history` }) : kalshiCard(entry, { placement, compact });
  if (!body) return '';
  return `<section class="lm lm-${st.key}" data-lm="${st.key}" aria-label="${esc(st.label)}">
    <p class="lm-phase lm-chip-${st.key}">${st.live ? '<i class="lm-dot" aria-hidden="true"></i>' : '<i class="lm-dot lm-dot-still" aria-hidden="true"></i>'}${esc(st.label)}</p>
    ${body}
    ${done ? finalLine(match, name) : ''}
  </section>`;
}

// ---- live-rail market line ("MKT  Alcaraz 88.5¢ · Shapovalov 13.5¢") -------------------------------------------------
const centsShort = (bp) => { const c = bp / 100; return `${Number.isInteger(c) ? c : c.toFixed(1)}¢`; };
const lastName = (p) => p?.last_name || String(p?.name || '').split(' ').slice(-1)[0] || '';

/**
 * Compact market text for a live-rail card, or '' (no line). Only an exact match for THIS match (canonical id + both
 * singles players by id, side A then side B like the score rows) and only what the shared client would show on a
 * compact card (kalshiLine: open, every Mid-market present, not stale). Decided matches carry no line.
 */
export function tickerMarketText(entry, match) {
  if (!entry || !match || !['in_progress', 'scheduled', 'suspended'].includes(match.status)) return '';
  if (String(entry.event?.canonical_event_id ?? '') !== String(match.id)) return '';
  if (!kalshiLine(entry)) return '';
  const outs = entry.kalshi?.outcomes || [];
  if (outs.length !== 2) return '';
  const a = outs.find((o) => o.role === 'a');
  const b = outs.find((o) => o.role === 'b');
  const pa = match.sides?.A?.players || [];
  const pb = match.sides?.B?.players || [];
  if (!a || !b || pa.length !== 1 || pb.length !== 1) return '';
  if (String(a.team_id) !== String(pa[0].id) || String(b.team_id) !== String(pb[0].id)) return '';
  if (!Number.isFinite(a.mid_bp) || !Number.isFinite(b.mid_bp)) return '';
  return `${lastName(pa[0])} ${centsShort(a.mid_bp)} · ${lastName(pb[0])} ${centsShort(b.mid_bp)}`;
}

/** The line's markup (inside the rail card; never a link — the card click stays the PBEcast court). */
export const tickerMarketHtml = (text) => (text ? `<span class="tk-mkt" title="Kalshi prediction market · Mid-market (not sportsbook odds)"><b>MKT</b><span class="tk-mkt-px">${esc(text)}</span></span>` : '');

/** Write (or remove) one card's market line in place; nothing else in the card changes. */
export function patchTickerMarket(card, text) {
  const el = card.querySelector('.tk-mkt');
  if (!text) { if (el) el.remove(); return; }
  if (!el) { card.querySelector('.tk-go')?.insertAdjacentHTML('beforebegin', tickerMarketHtml(text)); return; }
  const px = el.querySelector('.tk-mkt-px');
  if (px && px.textContent !== text) px.textContent = text;
}
