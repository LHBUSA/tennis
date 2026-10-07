// 2026-10-03: PBEcast did not update in an open browser. A cached /v1/live or /v1/pbecast copy came back from the edge
// with the zone's browser TTL (Cache-Control: public, max-age=14400), and the browser client fetched with the default
// cache mode, so its 15 s polls could be answered from the browser's own HTTP cache for hours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/tennis-api/src/index.js';
import { LIVE_PATH } from '../src/data/api.js';

test('an edge cache hit is re-stamped with the route TTL, never the zone browser TTL', async () => {
  const stored = new Response(JSON.stringify({ ok: true, data: [], meta: { freshness: 'CURRENT' } }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=14400' } });
  const prev = globalThis.caches;
  globalThis.caches = { default: { match: async () => stored.clone(), put: async () => {} } };
  try {
    for (const [path, ttl] of [['/v1/live', 15], ['/v1/pbecast/a1ec927d-1673-5c9a-9187-c1f0854d8776', 15], ['/v1/today', 30], ['/v1/matches/a1ec927d-1673-5c9a-9187-c1f0854d8776', 20]]) {
      const res = await worker.fetch(new Request(`https://tennis-api.propbetedge.ai${path}`, { headers: { origin: 'https://tennis.propbetedge.ai' } }), {}, { waitUntil() {} });
      assert.equal(res.headers.get('cache-control'), `public, max-age=${ttl}`, path);
      assert.equal(res.headers.get('access-control-allow-origin'), 'https://tennis.propbetedge.ai');
    }
  } finally { globalThis.caches = prev; }
});

test('live-sensitive reads bypass the browser HTTP cache; static reads keep it', () => {
  for (const p of ['/v1/live', '/v1/today', '/v1/pbecast/x', '/v1/matches/x', '/v1/live?x=1']) assert.ok(LIVE_PATH.test(p), p);
  for (const p of ['/v1/players', '/v1/rankings', '/v1/tournaments/x/2026', '/v1/news', '/v1/matchups/x']) assert.ok(!LIVE_PATH.test(p), p);
});


test('archive routes ignore irrelevant query strings and use a long cache TTL', async () => {
  const seen = [];
  const stored = new Response(JSON.stringify({ ok: true, data: {}, meta: { freshness: 'CURRENT' } }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
  const prev = globalThis.caches;
  globalThis.caches = { default: { match: async (req) => { seen.push(req.url); return stored.clone(); }, put: async () => {} } };
  try {
    for (const path of ['/v1/slams?qa=1', '/v1/slams?cb=123', '/v1/men?qa=1', '/v1/men/players?cb=456']) {
      const res = await worker.fetch(new Request(`https://tennis-api.propbetedge.ai${path}`, { headers: { origin: 'https://tennis.propbetedge.ai' } }), {}, { waitUntil() {} });
      assert.equal(res.headers.get('cache-control'), 'public, max-age=21600', path);
    }
    assert.equal(seen[0], 'https://tennis-api.propbetedge.ai/v1/slams?__v=0.10.6');
    assert.equal(seen[1], seen[0], 'slams query params do not create new archive cache entries');
    assert.equal(seen[2], 'https://tennis-api.propbetedge.ai/v1/men?__v=0.10.6');
    assert.equal(seen[3], 'https://tennis-api.propbetedge.ai/v1/men/players?__v=0.10.6');
  } finally { globalThis.caches = prev; }
});
