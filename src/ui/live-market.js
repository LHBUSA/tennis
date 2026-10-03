// Tennis LIVE MARKET module (Kalshi prediction market) — one lifecycle, never switched off once a market existed.
//   ACTIVE / UPCOMING  -> "LIVE MARKET" (green dot, match in play) or "MARKET OPEN · PRE-MATCH": price per player,
//                          the venue's own observation time, a sparkline of OUR stored observations, View market.
//   CLOSED / SETTLED    -> the shared "How the market closed" history (first observed / before start / final trade /
//                          settlement YES-NO / awaiting settlement, chart from observations only) + our match result as a
//                          SEPARATE fact. A finished match never implies a settlement.
// PropBetEdge = research; Kalshi = the market. Never sportsbook odds, never a PBE probability. No market -> ''.
// Pure HTML builder (tests/live-market.test.js); data comes from src/data/kalshi.js (our markets Worker, never Kalshi).

import { sparkline, ageLabel, marketHistoryCard } from '../vendor/kalshi/kalshi-market-ui.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cents = (bp) => (bp == null ? '—' : `${(bp / 100).toFixed(bp % 100 ? 1 : 0)}¢`); // 58.5¢ stays 58.5¢ (no rounding drift)
// a score is written from the WINNER's side (ours is stored side A first)
const winnerScore = (score, w) => (w === 'B' ? String(score).split(/\s+/).map((t) => t.replace(/^(\d+)-(\d+)/, (_, a, b) => `${b}-${a}`).replace(/^\[(\d+)-(\d+)\]/, (_, a, b) => `[${b}-${a}]`)).join(' ') : String(score));
const ROLE = { a: 'A', b: 'B' };
const FINAL = new Set(['completed', 'retired', 'walkover']);
const safeUrl = (u) => (/^https:\/\/kalshi\.com\//.test(String(u || '')) ? u : null);

/** The module's state for an entry + our match: null when no market exists for this match. */
export function marketState(entry, match) {
  const lc = entry?.market?.lifecycle || null;
  if (!entry || (!entry.kalshi && lc !== 'CLOSED' && lc !== 'SETTLED')) return null;
  if (lc === 'SETTLED') return { key: 'settled', label: 'MARKET SETTLED', live: false };
  if (lc === 'CLOSED') return { key: 'closed', label: FINAL.has(match?.status) ? 'MARKET CLOSED · AWAITING SETTLEMENT' : 'MARKET CLOSED', live: false };
  if (entry.kalshi?.state !== 'open') return null;
  return match?.status === 'in_progress' ? { key: 'live', label: 'LIVE MARKET', live: true } : { key: 'open', label: 'MARKET OPEN · PRE-MATCH', live: false };
}

/** Points for one side's sparkline: OUR stored observations only (mid when two-sided, else nothing drawn). */
const sparkFor = (entry, role) => (entry?.movement?.kalshi?.[role]?.points || []).filter((p) => p.mid_bp != null && Number.isFinite(Date.parse(p.t)));

/** Our final match result, a SEPARATE fact from any market settlement (winner-side score). '' unless final. */
export function finalLine(match, name) {
  if (!match || !FINAL.has(match.status) || !match.winner_side) return '';
  const loser = match.winner_side === 'A' ? 'B' : 'A';
  return `<p class="lm-result"><small>Final match result</small><b>${esc(name(match.winner_side))}</b> def. ${esc(name(loser))}${match.score ? ` <span class="tabnum">${esc(winnerScore(match.score, match.winner_side))}</span>` : ''}${match.status === 'retired' ? ' (ret.)' : ''}</p>`;
}

/**
 * entry: event-endpoint entry (kalshi, market, market_history, movement); match: our canonical match;
 * name(side) -> display name; nowMs for the age label.
 */
export function liveMarketPanel(entry, match, { name = (s) => s, nowMs = Date.now(), placement = 'pbecast' } = {}) {
  const st = marketState(entry, match);
  if (!st) return '';
  const url = safeUrl(entry.kalshi?.market_url || entry.market?.market_url || entry.market_history?.market_url);
  if (st.key === 'closed' || st.key === 'settled') {
    const hist = marketHistoryCard(entry, { placement: `${placement}-history` });
    if (!hist) return '';
    return `<section class="lm lm-${st.key}" data-lm="${st.key}" aria-label="${esc(st.label)}">
      <header class="lm-hd"><span class="lm-chip lm-chip-${st.key}">${esc(st.label)}</span></header>
      ${hist}
      ${finalLine(match, name)}
    </section>`;
  }
  const k = entry.kalshi;
  const rows = (k.outcomes || []).filter((o) => ROLE[o.role]).map((o) => {
    const side = ROLE[o.role];
    const pts = sparkFor(entry, o.role);
    return `<li class="lm-row s-${side}"><span class="lm-who">${esc(name(side))}</span><b class="lm-px tabnum">${cents(o.mid_bp ?? o.last_price_bp)}</b>${pts.length >= 2 ? `<span class="lm-spark" title="Our recorded observations of this market">${sparkline(pts, { width: 96, height: 24 })}</span>` : ''}</li>`;
  }).join('');
  const obsMs = Date.parse(k.observed_at || '');
  const age = Number.isFinite(obsMs) ? Math.max(0, Math.round((nowMs - obsMs) / 1000)) : null;
  return `<section class="lm lm-${st.key}" data-lm="${st.key}" aria-label="${esc(st.label)}">
    <header class="lm-hd"><span class="lm-chip lm-chip-${st.key}">${st.live ? '<i class="lm-dot" aria-hidden="true"></i>' : ''}${esc(st.label)}</span>${age != null ? `<time class="lm-age" datetime="${esc(k.observed_at)}">Updated ${esc(ageLabel(age))}</time>` : ''}</header>
    <ol class="lm-rows">${rows}</ol>
    <footer class="lm-ft"><small>Kalshi prediction market · price per $1 contract · not a PropBetEdge model</small>${url ? `<a class="lm-cta" href="${esc(url)}" target="_blank" rel="noopener noreferrer sponsored" data-kx-click data-kx-ticker="${esc(k.event_ticker || '')}" data-kx-placement="${esc(placement)}">View market →</a>` : ''}</footer>
  </section>`;
}
