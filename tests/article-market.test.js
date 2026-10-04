// Article Market module on tennis news (contract article-market/1). Fixtures are REAL production responses of
// GET /v1/article-market/tennis/:id?published_at=2026-10-04T15:50:00Z captured 2026-10-04 ~16:00Z:
//   03cc06e7… Alcaraz v Munar (Tokyo SF): Kalshi + Polymarket RULE_MISMATCH ("RELATED MARKET · RULES DIFFER")
//   23643dd3… Djokovic v Medvedev (Beijing SF): Kalshi only
// Owner rules: prospective only (no backfill), canonical match link only, venues separate, nothing when ineligible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ARTICLE_MARKET_ACTIVATED_AT, articleMarketEvent, articleMarketHtml, articleMarketSlot, articleMarketWithin, frozenArticleMarket, loadArticleMarket } from '../src/data/article-market.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/markets/article-market-tennis-${n}.json`, import.meta.url), 'utf8'));
const TWO = fx('03cc06e7');
const ONE = fx('23643dd3');
const M2 = '03cc06e7-c755-5831-87ce-f96a431c538f';
const M1 = '23643dd3-b13e-5e11-af8b-e83d4cd59be5';
const story = (over = {}) => ({ status: 'published', first_published_at: '2026-10-04T15:50:00Z', published_at: '2026-10-04T15:50:00Z', evidence: { match: { id: M2 }, market: { contract: 'article-market/1', sport: 'tennis', canonical_event_id: M2 } }, ...over });
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('activation constant equals the production ARTICLE_MARKET_ACTIVATED_AT (never moved)', () => {
  assert.equal(ARTICLE_MARKET_ACTIVATED_AT, '2026-10-04T14:31:40Z');
  assert.equal(Date.parse(TWO.activated_at), Date.parse(ARTICLE_MARKET_ACTIVATED_AT));
});

test('eligibility: published + first published at/after activation + one canonical match id from the frozen evidence', () => {
  assert.equal(articleMarketEvent(story()), M2);
  assert.equal(articleMarketEvent(story({ first_published_at: '2026-10-04T14:31:39Z' })), null, 'pre-activation story: no module, ever');
  assert.equal(articleMarketEvent(story({ first_published_at: '2026-10-03T10:00:00Z', published_at: '2026-10-04T16:00:00Z' })), null, 'a revision never makes an old story eligible');
  assert.equal(articleMarketEvent(story({ status: 'held' })), null, 'held drafts: none');
  assert.equal(articleMarketEvent(story({ evidence: { match: { id: M1 } } })), M1, 'pre-4.1 packets: the packet match id');
  assert.equal(articleMarketEvent(story({ evidence: { player: { id: M1 } } })), null, 'ranking stories (no match): none');
  assert.equal(articleMarketEvent(story({ evidence: { match: { id: 'not-a-uuid' } } })), null);
  assert.equal(articleMarketEvent(story({ evidence: { match: { id: M1 }, market: { sport: 'soccer', canonical_event_id: M1 } } })), null, 'writer link for another sport: none');
});

test('slot: ineligible stories render no slot at all', () => {
  assert.equal(articleMarketSlot(story({ first_published_at: '2026-10-01T10:00:00Z' }), { now: TWO }), '');
  assert.equal(articleMarketSlot(story({ evidence: {} }), { now: TWO }), '');
});

test('real payload, two venues: Kalshi + Polymarket labelled RULES DIFFER, no PBE comparison, venues never averaged', () => {
  const h = articleMarketSlot(story(), { now: TWO });
  assert.match(h, /data-art-market/);
  const t = text(h);
  assert.match(t, /Live market watch/i);
  assert.match(t, /Kalshi/);
  assert.match(t, /Polymarket/);
  assert.match(h, /RULES DIFFER/);
  assert.match(t, /No official call/);
  assert.match(t, /never averaged/);
  assert.doesNotMatch(h, /\sstyle="/, 'strict CSP');
  assert.doesNotMatch(t, /consensus|average of/i);
});

test('real payload, one venue: Kalshi only (no venue that was not observed)', () => {
  const h = articleMarketHtml(ONE);
  assert.match(h, /Kalshi/);
  assert.doesNotMatch(h, /Polymarket/);
});

test('ineligible / failed reads render nothing (no placeholder); reads go through the same-origin rewrite with first_published_at', async () => {
  assert.equal(articleMarketHtml(null), '');
  assert.equal(articleMarketHtml({ ...TWO, eligible: false, packet: null, live: null }), '');
  assert.equal(await loadArticleMarket(M2, '2026-10-04T15:50:00Z', async () => ({ ok: false })), null);
  assert.equal(await loadArticleMarket(M2, '2026-10-04T15:50:00Z', async () => { throw new Error('net'); }), null);
  assert.equal(await loadArticleMarket(M2, '2026-10-04T15:50:00Z', async () => ({ ok: true, json: async () => ({ eligible: false }) })), null);
  let url = null;
  await articleMarketWithin(story({ published_at: '2026-10-05T09:00:00Z' }), 50, async (u) => { url = u; return { ok: false }; });
  assert.equal(url, `/api/markets/v1/article-market/tennis/${M2}?published_at=2026-10-04T15%3A50%3A00Z`, 'ORIGINAL first publication, never the revision time');
  const slow = await articleMarketWithin(story(), 5, () => new Promise(() => {}));
  assert.equal(slow.now, null);
  assert.ok(slow.pending, 'a late answer stays pending (inserted only below the viewport)');
});

test('a FINAL packet frozen into the story evidence renders from the stored copy and is never fetched', async () => {
  const packet = { ...TWO.packet, packet_state: 'FINAL' };
  const a = story({ evidence: { match: { id: M2 }, market: { sport: 'tennis', canonical_event_id: M2, freeze: { packet, sha256: packet.sha256 } } } });
  const p = frozenArticleMarket(a);
  assert.equal(p.mode, 'MARKET_RESULT');
  let called = false;
  const r = await articleMarketWithin(a, 50, async () => { called = true; return { ok: false }; });
  assert.equal(called, false);
  assert.equal(r.now.packet, packet);
  assert.equal(frozenArticleMarket(story({ evidence: { market: { sport: 'tennis', canonical_event_id: M2, freeze: { packet: { ...packet, packet_state: 'PROVISIONAL' } } } } })), null);
});

test('vercel: exact same-origin rewrite for the tennis article-market route only (before the app-shell catch-all)', () => {
  const v = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const i = v.rewrites.findIndex((x) => x.source === '/api/markets/v1/article-market/tennis/:id([0-9a-f-]+)');
  assert.ok(i >= 0);
  assert.equal(v.rewrites[i].destination, 'https://propsports-markets.sales-fd3.workers.dev/v1/article-market/tennis/:id');
  assert.ok(i < v.rewrites.findIndex((x) => x.source === '/(.*)'));
});

test('vendored article-market client pinned byte-for-byte to propbetedge-workers 3f7345e (SHA-256)', () => {
  const sha = (f) => createHash('sha256').update(readFileSync(`src/vendor/kalshi/${f}`, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  assert.equal(sha('article-market-ui.js'), ARTICLE_UI_SHA);
  assert.equal(sha('article-market-ui.css'), ARTICLE_CSS_SHA);
});
const ARTICLE_UI_SHA = '2149e2854142657a554ef119533680c77657f0d2b1ea8406fe4de711e4fbe635';
const ARTICLE_CSS_SHA = '582c879d9a634caa467f31896c928bf854fc16579a1565091bb5b0093ee0505c';

// ---- writer side (tennis-news): market_snapshot in the frozen evidence packet + the one-time FINAL freeze ----------
import { marketSnapshot, PACKET_VERSION } from '../workers/tennis-news/src/packet.js';
import { modelPacket } from '../workers/tennis-news/src/editorial.js';
import { freezeRecord, freezeArticleMarkets } from '../workers/tennis-news/src/market-freeze.js';

test('packet market_snapshot: one canonical match link, article-market/1, no prices; the model never sees it', () => {
  assert.equal(PACKET_VERSION, 'tennis-packet/4.1.0');
  const s = marketSnapshot(M1);
  assert.deepEqual(s, { contract: 'article-market/1', sport: 'tennis', canonical_event_id: M1, link: 'packet.match.id', freeze: null });
  const mp = modelPacket({ version: PACKET_VERSION, match: { id: M1 }, market_snapshot: s });
  assert.equal(mp.market_snapshot, undefined);
  assert.equal(mp.match.id, M1);
});

test('freezeRecord: only EMBED_THIS_PACKET with a FINAL, hashed packet', () => {
  const fin = { ...TWO, freeze: 'EMBED_THIS_PACKET', packet: { ...TWO.packet, packet_state: 'FINAL' } };
  const r = freezeRecord(fin, { publishedAt: '2026-10-04T15:50:00Z', now: '2026-10-05T12:00:00Z' });
  assert.equal(r.sha256, TWO.packet.sha256);
  assert.equal(r.published_at, '2026-10-04T15:50:00Z');
  assert.equal(freezeRecord(TWO, { publishedAt: 'x', now: 'y' }), null, 'DO_NOT_FREEZE_YET');
  assert.equal(freezeRecord({ ...fin, packet: { ...fin.packet, packet_state: 'PROVISIONAL' } }, {}), null);
  assert.equal(freezeRecord({ ...fin, eligible: false }, {}), null);
});

test('freezeArticleMarkets: writes once into the story evidence, prose untouched; unlinked / already frozen skipped', async () => {
  const evid = { A: { packet: { version: PACKET_VERSION, match: { id: M2 }, market_snapshot: marketSnapshot(M2) } } };
  const patches = [];
  const store = {
    select: async (t, q) => {
      if (t === 'tennis_articles') {
        assert.match(q, /status=eq\.published/);
        assert.match(q, /first_published_at=gte\.2026-10-04T14%3A31%3A40\.000Z/, 'never before the activation');
        return [
          { article_id: 'A', slug: 'a', first_published_at: '2026-10-04T15:50:00+00:00', match_id: M2, tennis_article_evidence: { market: evid.A.packet.market_snapshot } },
          { article_id: 'B', slug: 'b', first_published_at: '2026-10-04T15:55:00+00:00', match_id: M1, tennis_article_evidence: { market: null } },
          { article_id: 'C', slug: 'c', first_published_at: '2026-10-04T15:56:00+00:00', match_id: M1, tennis_article_evidence: { market: { ...marketSnapshot(M1), freeze: { sha256: 'x' } } } }
        ];
      }
      return [evid[/article_id=eq\.(\w+)/.exec(q)[1]]];
    },
    req: async (m, path, { body }) => { patches.push({ m, path, body }); }
  };
  let url = null;
  const fin = { ...TWO, freeze: 'EMBED_THIS_PACKET', packet: { ...TWO.packet, packet_state: 'FINAL' } };
  const out = await freezeArticleMarkets(store, { now: new Date('2026-10-05T12:00:00Z'), fetchImpl: async (u) => { url = u; return { ok: true, json: async () => fin }; } });
  assert.equal(out.candidates, 1);
  assert.equal(url, `https://propsports-markets.sales-fd3.workers.dev/v1/article-market/tennis/${M2}?published_at=2026-10-04T15%3A50%3A00.000Z`);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].path, 'tennis_article_evidence?article_id=eq.A');
  assert.equal(patches[0].body.packet.market_snapshot.freeze.sha256, TWO.packet.sha256);
  assert.equal(patches[0].body.packet.match.id, M2, 'the rest of the frozen packet is unchanged');
  patches.length = 0;
  await freezeArticleMarkets(store, { now: new Date('2026-10-05T12:00:00Z'), fetchImpl: async () => ({ ok: true, json: async () => TWO }) });
  assert.equal(patches.length, 0, 'DO_NOT_FREEZE_YET writes nothing');
});
