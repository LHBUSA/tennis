// Article market freeze (network contract article-market/1, propbetedge-workers
// workers/propsports-markets/docs/POST_EVENT_MARKET_RESULT.md, newsroom contract rule 3): when the shared API answers
// freeze = EMBED_THIS_PACKET for a published story's canonical match, the sealed post_event_market_result/1 packet and
// its sha256 are stored ONCE in the story's own evidence (tennis_article_evidence.packet.market_snapshot.freeze) and the
// story renders from that stored copy forever. Prose is never touched. Only stories whose frozen packet carries a
// market_snapshot (packet 4.1.0+, first published at/after the shared activation) are considered — no backfill.
// Read-only against propsports-markets (public route); bounded per cron run.

export const MARKETS_ORIGIN = 'https://propsports-markets.sales-fd3.workers.dev';
export const ARTICLE_MARKET_ACTIVATED_AT = '2026-10-04T14:31:40Z';
const WINDOW_D = 14;
const PER_RUN = 4;

/** Pure: the freeze record for a shared-API answer, or null when it must not be frozen (yet). */
export function freezeRecord(body, { publishedAt, now }) {
  if (!body?.eligible || body.freeze !== 'EMBED_THIS_PACKET') return null;
  const p = body.packet;
  if (!p || p.packet_state !== 'FINAL' || typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256)) return null;
  return { contract: body.contract || 'article-market/1', packet: p, sha256: p.sha256, published_at: publishedAt, stored_at: now };
}

export async function freezeArticleMarkets(store, { fetchImpl = (...a) => globalThis.fetch(...a), now = new Date(), origin = MARKETS_ORIGIN } = {}) {
  const since = new Date(Math.max(Date.parse(ARTICLE_MARKET_ACTIVATED_AT), now.getTime() - WINDOW_D * 86400e3)).toISOString();
  const rows = await store.select('tennis_articles', `select=article_id,slug,first_published_at,match_id,tennis_article_evidence(market:packet->market_snapshot)&status=eq.published&match_id=not.is.null&first_published_at=gte.${encodeURIComponent(since)}&order=first_published_at.asc&limit=60`);
  const due = rows.filter((r) => {
    const ev = Array.isArray(r.tennis_article_evidence) ? r.tennis_article_evidence[0] : r.tennis_article_evidence;
    const m = ev?.market;
    return m && m.sport === 'tennis' && m.canonical_event_id === r.match_id && !m.freeze;
  });
  const out = { candidates: due.length, checked: [], frozen: [] };
  for (const r of due.slice(0, PER_RUN)) {
    let body = null;
    try {
      const res = await fetchImpl(`${origin}/v1/article-market/tennis/${encodeURIComponent(r.match_id)}?published_at=${encodeURIComponent(new Date(r.first_published_at).toISOString())}`);
      body = res.ok ? await res.json() : null;
    } catch { body = null; }
    const rec = freezeRecord(body, { publishedAt: r.first_published_at, now: now.toISOString() });
    out.checked.push({ slug: r.slug, freeze: body?.freeze || null, state: body?.packet?.packet_state || null });
    if (!rec) continue;
    const cur = (await store.select('tennis_article_evidence', `select=packet&article_id=eq.${r.article_id}`))[0];
    if (!cur?.packet?.market_snapshot || cur.packet.market_snapshot.freeze) continue; // written once
    const packet = { ...cur.packet, market_snapshot: { ...cur.packet.market_snapshot, freeze: rec } };
    await store.req('PATCH', `tennis_article_evidence?article_id=eq.${r.article_id}`, { body: { packet }, prefer: 'return=minimal' });
    out.frozen.push({ slug: r.slug, sha256: rec.sha256 });
  }
  return out;
}
