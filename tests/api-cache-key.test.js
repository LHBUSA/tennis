// 2026-10-07 tkmln read relief: the edge cache key no longer depends on the caller's host, so tennis-web's SSR reads
// (service binding, https://tennis-api.internal) and the browser's read of the same page share one cache entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { VERSION } from '../workers/tennis-api/src/index.js';

test('edge cache key ignores the caller host: service-binding SSR reads and browser reads share one entry', async () => {
  const seen = [];
  const stored = new Response(JSON.stringify({ ok: true, data: {}, meta: { freshness: 'CURRENT' } }), { headers: { 'content-type': 'application/json' } });
  const prev = globalThis.caches;
  globalThis.caches = { default: { match: async (req) => { seen.push(req.url); return stored.clone(); }, put: async () => {} } };
  try {
    for (const base of ['https://tennis-api.internal', 'https://tennis-api.propbetedge.ai', 'https://tennis-api.sales-fd3.workers.dev']) {
      await worker.fetch(new Request(`${base}/v1/tournaments/varna-itf/2015`), {}, { waitUntil() {} });
    }
    assert.deepEqual(seen, Array(3).fill(`https://tennis-api.propbetedge.ai/v1/tournaments/varna-itf/2015?__v=${VERSION}`));
  } finally { globalThis.caches = prev; }
});
