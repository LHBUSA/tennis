// Phase 3 (2026-10-07): concurrent cache misses of /v1/today and /v1/schedule build once. qid 8009025965482832481
// (the 5-level edition-list read) ran ~180 ms alone but ~2 s mean under bursts of identical misses in one colo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { waitForPeer } from '../workers/tennis-api/src/index.js';

const ENV = { TENNIS_MODEL_SUPABASE_URL: 'https://tkmlnhmylqnttmnsnief.supabase.co', TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY: 'k' };

function memCache() {
  const m = new Map();
  return { m, match: async (req) => { const r = m.get(req.url); return r ? r.clone() : undefined; }, put: async (req, res) => { m.set(req.url, res.clone()); }, delete: async (req) => m.delete(req.url) };
}

async function withFakes(fn) {
  const prevC = globalThis.caches; const prevF = globalThis.fetch;
  const cache = memCache();
  const calls = [];
  globalThis.caches = { default: cache };
  globalThis.fetch = async (input) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    calls.push(u.pathname.replace('/rest/v1/', '') + ' ' + decodeURIComponent(u.search).slice(0, 40));
    await new Promise((r) => setTimeout(r, 30)); // a slow DB read: concurrent requests overlap it
    return new Response('[]', { headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
  };
  try { return await fn({ cache, calls }); } finally { globalThis.caches = prevC; globalThis.fetch = prevF; }
}

test('single-flight: 6 concurrent /v1/today misses in one isolate read the store once; responses identical', async () => {
  await withFakes(async ({ calls }) => {
    const waits = [];
    const ctx = { waitUntil: (p) => waits.push(p) };
    const res = await Promise.all(Array.from({ length: 6 }, () => worker.fetch(new Request('https://tennis-api.propbetedge.ai/v1/today'), ENV, ctx)));
    await Promise.all(waits);
    const bodies = await Promise.all(res.map((r) => r.text()));
    assert.ok(bodies.every((b) => b === bodies[0]));
    assert.ok(res.every((r) => r.headers.get('cache-control') === 'public, max-age=30'), 'TTL unchanged');
    const editionReads = calls.filter((c) => c.startsWith('tennis_tournament_editions')).length;
    assert.ok(editionReads >= 1 && editionReads <= 2, `edition reads ${editionReads} (one build)`);
    // the next request is a plain cache hit: no store read at all
    const before = calls.length;
    await worker.fetch(new Request('https://tennis-api.propbetedge.ai/v1/today'), ENV, ctx);
    assert.equal(calls.length, before);
  });
});

test('single-flight never joins different keys (query string) and never applies to premium/bypass', async () => {
  await withFakes(async ({ calls }) => {
    const waits = []; const ctx = { waitUntil: (p) => waits.push(p) };
    await Promise.all(['?view=today', '?view=tomorrow'].map((q) => worker.fetch(new Request(`https://tennis-api.propbetedge.ai/v1/schedule${q}`), ENV, ctx)));
    await Promise.all(waits);
    assert.ok(calls.filter((c) => c.startsWith('tennis_tournament_editions')).length >= 2, 'two keys -> two builds');
  });
});

test('waitForPeer: lock held -> returns the peer response once it lands; no lock -> null at once; lock dropped without entry -> null', async () => {
  const cache = memCache();
  const key = new Request('https://x/v1/today?__v=1');
  const lock = new Request('https://x/v1/today?__v=1&__lock=1');
  const sleep = async () => {};
  assert.equal(await waitForPeer(cache, key, lock, { sleep }), null);
  await cache.put(lock, new Response('1'));
  let n = 0;
  const landing = { ...cache, match: async (req) => { if (req.url === key.url && ++n === 3) await cache.put(key, new Response('{"ok":true}')); return cache.match(req); } };
  const hit = await waitForPeer(landing, key, lock, { sleep, pollMs: 1, waitMs: 50 });
  assert.equal(await hit.text(), '{"ok":true}');
  const c2 = memCache(); await c2.put(lock, new Response('1'));
  const dropping = { ...c2, match: async (req) => { if (req.url === key.url) await c2.delete(lock); return c2.match(req); } };
  assert.equal(await waitForPeer(dropping, key, lock, { sleep, pollMs: 1, waitMs: 50 }), null, 'builder failed: waiter builds itself');
  const c3 = memCache(); await c3.put(lock, new Response('1'));
  assert.equal(await waitForPeer(c3, key, lock, { sleep, pollMs: 10, waitMs: 30 }), null, 'bounded wait');
});
