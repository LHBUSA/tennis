// tennis-web: data-backed heads index only real records; social cards never break on a missing photo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headFor, permanentRedirect } from '../workers/tennis-web/src/heads.js';
import { playerCard, matchCard } from '../workers/tennis-web/src/cards.js';
import { resolveRoute } from '../src/lib/routes.js';
import { routeMeta, headHtml, INDEX_ROBOTS, NOINDEX_ROBOTS } from '../src/seo/meta.js';

const envWith = (map) => ({ API: { fetch: async (req) => { const p = new URL(req.url).pathname + new URL(req.url).search; const d = map[p]; return d === undefined ? new Response('{}', { status: 404 }) : Response.json({ data: d }); } } });

test('player head: real record -> index + Person + player card; unknown slug -> noindex', async () => {
  const env = envWith({ '/v1/players/elena-rybakina': { slug: 'elena-rybakina', name: 'Elena Rybakina', nationality: 'KAZ', rankings: { wta_singles: { rank: 1, date: '2026-09-21' } }, recent_matches: [], photo: null } });
  const o = await headFor(env, resolveRoute('/players/elena-rybakina'));
  assert.equal(o.robots, INDEX_ROBOTS);
  assert.match(o.title, /^Elena Rybakina/);
  assert.match(o.image.url, /\/og\/player\/elena-rybakina\.png\?v=/);
  assert.ok(o.jsonld.some((n) => n['@type'] === 'Person'));
  const h = headHtml(routeMeta(resolveRoute('/players/elena-rybakina'), o));
  assert.ok(h.includes('<link rel="canonical" href="https://tennis.propbetedge.ai/players/elena-rybakina" />'));
  const miss = await headFor(env, resolveRoute('/players/nobody-here'));
  assert.equal(miss.robots, NOINDEX_ROBOTS);
});

test('match head: indexes only with statistics; PBEcast stays noindex with its own card', async () => {
  const m = { id: '00000000-0000-5000-8000-000000000001', status: 'completed', score: '6-4 6-3', round: 'F', event_type: 'WS', sides: { A: { players: [{ name: 'Ann Alpha', slug: 'a' }] }, B: { players: [{ name: 'Bea Beta', slug: 'b' }] } }, tournament: { tournament: 'Test Open', year: 2026, slug: 'test-open', start_date: '2026-09-20' }, statistics: { A: {}, B: {} } };
  const env = envWith({ [`/v1/matches/${m.id}`]: m });
  const o = await headFor(env, resolveRoute(`/matches/${m.id}`));
  assert.equal(o.robots, INDEX_ROBOTS);
  assert.match(o.description, /Ann Alpha vs Bea Beta.*Final.*6-4 6-3/);
  const p = await headFor(env, resolveRoute(`/pbecast/${m.id}`));
  assert.equal(p.robots, NOINDEX_ROBOTS);
  assert.match(p.image.url, /\/og\/pbecast\//);
  const noStats = await headFor(envWith({ [`/v1/matches/${m.id}`]: { ...m, statistics: null } }), resolveRoute(`/matches/${m.id}`));
  assert.equal(noStats.robots, NOINDEX_ROBOTS);
});

test('cards: missing photo renders the monogram tile, never an external image', () => {
  const s = playerCard({ name: 'Iga Swiatek', rank: 2, list: 'WTA SINGLES', nationality: 'POL', jpegB64: null });
  assert.ok(s.includes('>IS<'));
  assert.ok(!/href="https?:/.test(s), 'no remote fetches inside a card');
  const mc = matchCard({ a: { name: 'Guiomar Maristany Zuleta de Reales' }, b: { name: 'B' }, tournament: 'T', round: 'Final', status: 'in_progress' });
  assert.ok(mc.includes('>LIVE<'));
});

test('news story head: published -> index + NewsArticle + article times; held -> noindex, no NewsArticle', async () => {
  const a = { slug: 'alpha-beats-no-6-beta-abc123', status: 'published', headline: 'Alpha beats No. 6 Beta in the Test Open quarterfinal', dek: 'Alpha won 4-6, 7-6(5), 6-3.', published_at: '2026-09-26T10:00:00Z', first_published_at: '2026-09-26T10:00:00Z', updated_at: '2026-09-26T10:05:00Z' };
  const env = envWith({ [`/v1/news/${a.slug}`]: a });
  const o = await headFor(env, resolveRoute(`/news/${a.slug}`));
  assert.equal(o.robots, INDEX_ROBOTS);
  assert.equal(o.type, 'article');
  const ld = o.jsonld.find((n) => n['@type'] === 'NewsArticle');
  assert.equal(ld.datePublished, a.first_published_at);
  assert.match(o.image.url, /\/og\/news\/alpha-beats-no-6-beta-abc123\.png/);
  const h = headHtml(routeMeta(resolveRoute(`/news/${a.slug}`), o));
  assert.ok(h.includes('article:published_time') && h.includes('name="twitter:site" content="@PROPBETEDGE"'));
  const held = await headFor(envWith({ [`/v1/news/${a.slug}`]: { ...a, status: 'held' } }), resolveRoute(`/news/${a.slug}`));
  assert.equal(held.robots, NOINDEX_ROBOTS);
  assert.ok(!held.jsonld.some((n) => n['@type'] === 'NewsArticle'));
});

// 2026-10-07: China Open WS orphans tombstoned -> the old URL 301s to the survivor; no survivor -> noindex record state
test('superseded match: /matches and /pbecast 301 to the resolved survivor; survivor keeps its own canonical; no survivor -> noindex record, never a redirect', async () => {
  const OLD = '95d3c15d-a6b2-5bb5-9d58-afc79f70ae2e';
  const NEW = '1acf3f48-bf28-5cf1-8206-1fa825ec9e8e';
  const LOST = '00000000-0000-5000-8000-0000000000ff';
  const survivor = { id: NEW, status: 'completed', score: '6-4 1-6 3-6', round: 'Q-1', event_type: 'WS', sides: { A: { players: [{ name: 'Yexin Ma', slug: 'yexin-ma' }] }, B: { players: [{ name: 'Yufei Ren', slug: 'yufei-ren' }] } }, tournament: { tournament: 'China Open', year: 2026, slug: 'china-open' }, statistics: { A: {}, B: {} } };
  const env = envWith({
    [`/v1/matches/${OLD}`]: { id: OLD, status: 'superseded', sides: {}, tournament: { tournament: 'China Open', year: 2026 }, superseded_by: NEW, canonical_match_id: NEW },
    [`/v1/matches/${NEW}`]: survivor,
    [`/v1/matches/${LOST}`]: { id: LOST, status: 'superseded', sides: {}, superseded_by: null, canonical_match_id: null }
  });
  for (const [kind, method] of [['matches', 'GET'], ['pbecast', 'GET'], ['matches', 'HEAD']]) {
    const o = await headFor(env, resolveRoute(`/${kind}/${OLD}`));
    const r = permanentRedirect(o, method);
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), `https://tennis.propbetedge.ai/${kind}/${NEW}`, 'absolute survivor path, no query');
  }
  assert.equal(permanentRedirect(await headFor(env, resolveRoute(`/matches/${OLD}`)), 'POST'), null, 'GET/HEAD only');
  // survivor: 200 page with its own canonical and JSON-LD naming only the survivor
  const s = await headFor(env, resolveRoute(`/matches/${NEW}`));
  assert.equal(permanentRedirect(s, 'GET'), null);
  const meta = routeMeta(resolveRoute(`/matches/${NEW}`), s);
  assert.equal(meta.canonical, `https://tennis.propbetedge.ai/matches/${NEW}`);
  const html = headHtml(meta);
  assert.ok(!html.includes(OLD), 'old id never in the survivor head / JSON-LD');
  // no valid survivor: no redirect, noindex record state without JSON-LD
  const lost = await headFor(env, resolveRoute(`/matches/${LOST}`));
  assert.equal(permanentRedirect(lost, 'GET'), null);
  assert.equal(lost.robots, NOINDEX_ROBOTS);
  assert.match(lost.title, /^Superseded match record/);
  assert.deepEqual(lost.jsonld, []);
  assert.ok(!/ vs Preview/.test(headHtml(routeMeta(resolveRoute(`/matches/${LOST}`), lost))));
});
