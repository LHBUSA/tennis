// Article Market module for tennis news (contract article-market/1; propbetedge-workers
// workers/propsports-markets/docs/POST_EVENT_MARKET_RESULT.md). ONE module with a lifecycle on a story linked to ONE
// match: LIVE MARKET WATCH while the market trades -> THE MARKET RESULT once the match is over.
//
// - Link = the story's frozen evidence: packet.market_snapshot.canonical_event_id (tennis-news writer, packet 4.1.0+),
//   else the packet's own match id (evidence.match.id). Both are our canonical match UUID = the id the propsports-markets
//   tennis-atp / tennis-wta lanes key Kalshi and Polymarket by. Never a title or name match.
// - Prospective only (owner 2026-10-04, NO BACKFILL): the shared API refuses stories first published before its activation
//   time. ACTIVATED_AT below only saves a request for older stories; the API stays the authority.
// - published_at = the ORIGINAL first publication (first_published_at); revisions never move the market baseline.
// - A FINAL packet the writer froze into the story's evidence (freeze = EMBED_THIS_PACKET) is rendered from that stored
//   copy forever and never refetched.
// - Read through the same-origin exact rewrite /api/markets/v1/article-market/tennis/:id (vercel.json). Never a venue.
// - Nothing eligible / nothing observed / a failed read -> nothing rendered (never a placeholder).
import { articleMarketModule, mountArticleMarket } from '../vendor/kalshi/article-market-ui.js';
import { bounded, KALSHI_FIRST_PAINT_MS } from './kalshi.js';

export const ARTICLE_MARKET_ACTIVATED_AT = '2026-10-04T14:31:40Z';
export const ARTICLE_MARKET_REFRESH_MS = 30_000;
export const ARTICLE_MARKET_BASE = '/api/markets';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The story's ORIGINAL first publication (never updated_at / revised_at). */
export const firstPublishedAt = (a) => a?.first_published_at || null;

/** The canonical match id of an eligible story, else null. */
export function articleMarketEvent(a) {
  if (a?.status !== 'published') return null;
  const pub = Date.parse(firstPublishedAt(a) || '');
  if (!Number.isFinite(pub) || pub < Date.parse(ARTICLE_MARKET_ACTIVATED_AT)) return null;
  const snap = a?.evidence?.market;
  const id = snap ? (snap.sport === 'tennis' ? snap.canonical_event_id : null) : a?.evidence?.match?.id;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

/** A FINAL packet frozen into the story's evidence by the writer, as a renderable payload (else null). */
export function frozenArticleMarket(a) {
  const f = a?.evidence?.market?.freeze;
  if (!f?.packet || f.packet.packet_state !== 'FINAL') return null;
  return { contract: 'article-market/1', sport: 'tennis', eligible: true, mode: 'MARKET_RESULT', freeze: 'EMBED_THIS_PACKET', packet: f.packet, live: { mode: 'MARKET_RESULT', in_play: false } };
}

export async function loadArticleMarket(id, publishedAt, fetchImpl = (...x) => globalThis.fetch(...x)) {
  try {
    const r = await fetchImpl(`${ARTICLE_MARKET_BASE}/v1/article-market/tennis/${encodeURIComponent(id)}?published_at=${encodeURIComponent(publishedAt)}`);
    if (!r.ok) return null;
    const body = await r.json();
    return body?.eligible ? body : null;
  } catch { return null; }
}

/** Load-time read inside the shared first-paint budget. { now } = render with it; { pending } = a late answer. */
export async function articleMarketWithin(a, ms = KALSHI_FIRST_PAINT_MS, fetchImpl) {
  const id = articleMarketEvent(a);
  if (!id) return { now: null, pending: null };
  const stored = frozenArticleMarket(a);
  if (stored) return { now: stored, pending: null };
  const p = loadArticleMarket(id, firstPublishedAt(a), fetchImpl);
  const now = await bounded(p, ms);
  return now === undefined ? { now: null, pending: p } : { now, pending: null };
}

export const articleMarketHtml = (payload) => (payload ? articleMarketModule(payload, { placement: 'tennis-article' }) : '');

/** The slot after the story's first section: present only for an eligible story (an empty slot renders nothing). */
export function articleMarketSlot(a, mk) {
  return articleMarketEvent(a) ? `<div class="nw-art-market" data-art-market>${articleMarketHtml(mk?.now)}</div>` : '';
}

/**
 * Mount on the rendered story. First paint already holds the module when the read beat the budget; a late answer is
 * inserted only while its slot is below the viewport (no visible layout shift), then refreshes ~30 s while visible.
 */
export function mountArticleMarketSlot(root, a, { now = null, pending = null } = {}) {
  const slot = root.querySelector('[data-art-market]');
  const id = articleMarketEvent(a);
  if (!slot || !id) return () => {};
  const start = (initial) => mountArticleMarket(slot, { base: ARTICLE_MARKET_BASE, sport: 'tennis', eventId: id, publishedAt: firstPublishedAt(a), initial, refreshMs: ARTICLE_MARKET_REFRESH_MS });
  if (now) return start(now);
  if (!pending) return () => {};
  let stop = () => {};
  let dead = false;
  pending.then((late) => {
    if (dead || !late || !slot.isConnected) return;
    if (slot.getBoundingClientRect().top < window.innerHeight) return; // would shift what the reader sees: skip
    stop = start(late);
  });
  return () => { dead = true; stop(); };
}
