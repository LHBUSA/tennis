// 2026-10-07 tkmln read relief: DNA gate / population reads are memoised per DNA build version (memo.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tourDnaStatus, latestAsOfForGender } from '../workers/tennis-api/src/v2.js';
import { dnaMemo, withMemo, _resetMemoForTests } from '../workers/tennis-api/src/memo.js';

function kv(values) {
  return { async get(k, o) { const v = values[k]; return v === undefined ? null : (o?.type === 'json' ? JSON.parse(v) : v); } };
}
function fakeCaches() {
  const m = new Map();
  return { m, default: { match: async (r) => (m.has(r.url) ? new Response(m.get(r.url)) : undefined), put: async (r, res) => { m.set(r.url, await res.text()); } } };
}
// fake PostgREST over DNA snapshots: honours gender / as_of / order=as_of.desc / limit / offset; counts reads
function dnaStore(rows) {
  const s = {
    reads: 0,
    async select(table, q) {
      s.reads += 1;
      if (table !== 'tennis_dna_snapshots') return [];
      const g = (q.match(/tennis_players\.gender=eq\.(\w)/) || [])[1];
      const d = (q.match(/as_of=eq\.([\d-]+)/) || [])[1];
      let out = rows.filter((r) => (!g || r.gender === g) && (!d || r.as_of === d));
      if (/order=as_of\.desc/.test(q)) out = [...out].sort((a, b) => (a.as_of < b.as_of ? 1 : -1));
      const off = Number((q.match(/offset=(\d+)/) || [])[1] || 0);
      const lim = Number((q.match(/limit=(\d+)/) || [])[1] || 1000);
      return out.slice(off, off + lim).map((r) => ({ as_of: r.as_of, metrics: { service_points_won: { value: 0.6, confidence: r.conf } }, tennis_players: { gender: r.gender } }));
    }
  };
  return s;
}
const snaps = (gender, as_of, n, conf = 'medium') => Array.from({ length: n }, () => ({ gender, as_of, conf }));

test('without a memo context (tests, scheduled path) every call reads the store, exactly as before', async () => {
  _resetMemoForTests();
  const s = dnaStore(snaps('M', '2026-10-01', 31));
  const a = await tourDnaStatus(s, 'M');
  const n = s.reads;
  const b = await tourDnaStatus(s, 'M');
  assert.deepEqual(a, b);
  assert.equal(s.reads, 2 * n);
});

test('memoised gate: same value as uncached, one store read per DNA build version, new build -> recomputed', async () => {
  _resetMemoForTests();
  const prev = globalThis.caches;
  const fc = fakeCaches();
  globalThis.caches = fc;
  try {
    const rows = snaps('M', '2026-10-01', 31);
    const plain = await tourDnaStatus(dnaStore(rows), 'M');
    const values = { 'dna:last': '2026-10-01', 'dna:v2:summary': JSON.stringify({ built_at: '2026-10-01T05:00:00Z' }), 'dna:retention:day': '2026-10-01' };
    const env = { TENNIS_STATE: kv(values) };
    const s1 = withMemo(dnaStore(rows), env, { waitUntil() {} });
    assert.deepEqual(await tourDnaStatus(s1, 'M'), plain);
    const n = s1.reads;
    assert.ok(n > 0);
    const again = await tourDnaStatus(s1, 'M');
    assert.deepEqual(again, plain);
    assert.equal(s1.reads, n, 'second call served from the memo');
    again.qualified = -1; // a caller mutating its copy never leaks into the next response
    assert.deepEqual(await tourDnaStatus(s1, 'M'), plain);
    // a fresh isolate (empty local map) is served from the colo cache
    _resetMemoForTests();
    const s2 = withMemo(dnaStore(rows), env, { waitUntil() {} });
    assert.deepEqual(await tourDnaStatus(s2, 'M'), plain);
    assert.equal(s2.reads, 0, 'served from caches.default');
    // a new build (new version keys) recomputes from the store
    _resetMemoForTests();
    const rows2 = [...rows, ...snaps('M', '2026-10-02', 12)];
    values['dna:last'] = '2026-10-02';
    const s3 = withMemo(dnaStore(rows2), env, { waitUntil() {} });
    const st = await tourDnaStatus(s3, 'M');
    assert.deepEqual([st.as_of, st.qualified, st.ready], ['2026-10-02', 12, false]);
    assert.equal(await latestAsOfForGender(s3, 'M'), '2026-10-02');
    assert.ok(s3.reads > 0);
  } finally { globalThis.caches = prev; _resetMemoForTests(); }
});

test('memo falls back to an uncached read when the build version cannot be read', async () => {
  _resetMemoForTests();
  const env = { TENNIS_STATE: { async get() { throw new Error('kv down'); } } };
  const s = withMemo({ reads: 0 }, env, null);
  let calls = 0;
  assert.equal(await dnaMemo(s, 'x', async () => { calls += 1; return 7; }), 7);
  assert.equal(await dnaMemo(s, 'x', async () => { calls += 1; return 7; }), 7);
  assert.equal(calls, 2);
  _resetMemoForTests();
});
