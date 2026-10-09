// 2026-10-09 P0 (owner: /track-record stuck on "Loading…"): the picks loader never stays on Loading — a hung read
// times out, a failed read or a render error shows a visible error with a retry, and only the page's own abort (route
// left) ends a load silently. The ledger readers run bounded-parallel R2 reads (one-by-one GETs took 16-18 s).
import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest } from '../src/data/api.js';
import { load } from '../src/pages/picks.js';
import { mapLimit, READ_CONCURRENCY } from '../workers/tennis-api/src/picker-ledger.js';

const hanging = (url, { signal }) => new Promise((_, reject) => {
  signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
});

test('apiRequest: a read that never answers resolves UNAVAILABLE at the timeout (never hangs)', async () => {
  const t0 = Date.now();
  const res = await apiRequest('https://x/v1/picks/track-record', { timeoutMs: 50, fetchImpl: hanging });
  assert.equal(res.ok, false);
  assert.equal(res.meta.freshness, 'UNAVAILABLE');
  assert.match(res.meta.semantics, /did not respond within/);
  assert.ok(Date.now() - t0 < 1000);
});

test('apiRequest: the caller leaving the page still rejects with AbortError (no error flash on navigation)', async () => {
  const c = new AbortController();
  const p = apiRequest('https://x/y', { signal: c.signal, timeoutMs: 5000, fetchImpl: hanging });
  c.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
});

test('apiRequest: a network error and a malformed body are errors, not hangs', async () => {
  const net = await apiRequest('https://x/y', { timeoutMs: 1000, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(net.meta.freshness, 'UNAVAILABLE');
  const bad = await apiRequest('https://x/y', { timeoutMs: 1000, fetchImpl: async () => ({ json: async () => ({ nope: 1 }) }) });
  assert.equal(bad.meta.freshness, 'ERROR');
});

function fakeRoot() {
  const listeners = [];
  const retry = { addEventListener: (ev, fn) => listeners.push(fn) };
  const body = { innerHTML: '', isConnected: true, querySelector: (s) => (s === '[data-retry]' && body.innerHTML.includes('data-retry') ? retry : null) };
  const meta = { innerHTML: '' };
  return { body, meta, clickRetry: () => listeners.shift()?.(), querySelector: (s) => (s === '[data-body]' ? body : s === '[data-meta]' ? meta : null) };
}
const okEnvelope = (data) => ({ ok: true, data, meta: { freshness: 'CURRENT', semantics: 'test' } });

test('load: a timed-out read shows the error with a retry, and the retry renders the data', async () => {
  const root = fakeRoot();
  let calls = 0;
  const fetcher = async (path, opts) => { calls += 1; return calls === 1 ? apiRequest('https://x' + path, { ...opts, fetchImpl: hanging }) : okEnvelope({ n: 7 }); };
  await load(root, '/v1/picks/track-record', (d) => `<p>rows ${d.n}</p>`, 'none', new AbortController().signal, { timeoutMs: 30, fetcher });
  assert.doesNotMatch(root.body.innerHTML, /Loading/);
  assert.match(root.body.innerHTML, /Could not load/);
  assert.match(root.body.innerHTML, /data-retry/);
  root.clickRetry();
  await new Promise((r) => setTimeout(r, 20));
  assert.match(root.body.innerHTML, /rows 7/);
});

test('load: a fetch that throws (non-abort) shows the error, never stays on Loading', async () => {
  const root = fakeRoot();
  await load(root, '/p', () => 'x', 'none', new AbortController().signal, { fetcher: async () => { throw new Error('boom'); } });
  assert.match(root.body.innerHTML, /Could not load/);
});

test('load: a renderer exception on unexpected data shows the error with a retry', async () => {
  const root = fakeRoot();
  const orig = console.error; console.error = () => {};
  try {
    await load(root, '/p', (d) => d.policy.scope.wta_main.toUpperCase(), 'none', new AbortController().signal, { fetcher: async () => okEnvelope({}) });
  } finally { console.error = orig; }
  assert.match(root.body.innerHTML, /could not be displayed/);
  assert.match(root.body.innerHTML, /data-retry/);
});

test('load: leaving the page (own abort) ends silently without touching the DOM', async () => {
  const root = fakeRoot();
  const c = new AbortController();
  const p = load(root, '/p', () => 'x', 'none', c.signal, { fetcher: (path, opts) => apiRequest('https://x', { ...opts, fetchImpl: hanging }) });
  const before = root.body.innerHTML;
  c.abort();
  await p;
  assert.equal(root.body.innerHTML, before);
});

test('mapLimit: keeps order and never exceeds the concurrency bound', async () => {
  let inFlight = 0; let peak = 0;
  const out = await mapLimit([...Array(50).keys()], READ_CONCURRENCY, async (x) => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight -= 1;
    return x * 2;
  });
  assert.deepEqual(out, [...Array(50).keys()].map((x) => x * 2));
  assert.ok(peak > 1 && peak <= READ_CONCURRENCY, `peak ${peak}`);
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
});
