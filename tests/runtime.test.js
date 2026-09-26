// DNA metric contract, envelope, polite source client, raw archive, adapter isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDna, metricObject, confidenceFor, DEFINITIONS } from '../workers/shared/dna/metric.js';
import { envelope, classifyFreshness, notConfigured } from '../workers/shared/envelope.js';
import { SourceClient, USER_AGENT } from '../workers/shared/http.js';
import { sha256Hex, payloadKey, requestIdentity, archiveCapture } from '../workers/shared/archive.js';
import { runIsolated, validateAdapter, requirePaths } from '../workers/shared/adapter.js';

const side = (o) => ({ service_points: 80, aces: 8, double_faults: 3, first_serves_in: 50, first_serve_points_won: 40, second_serve_points_won: 16, service_games: 12, break_points_faced: 4, break_points_saved: 3, ...o });

test('DNA: exclusive as-of, summed ratios, null-propagating missing inputs', () => {
  const rows = [
    { match_id: 'm1', match_date: '2026-09-01', surface: 'hard', sets_played: 2, games_played: 20, source_family: 'wta', side: side(), opp: side({ first_serve_points_won: 30, second_serve_points_won: 10, break_points_faced: 6, break_points_saved: 2 }) },
    { match_id: 'm2', match_date: '2026-09-10', surface: 'clay', sets_played: 3, games_played: 30, source_family: 'wta', side: side({ aces: 2 }), opp: side() },
    { match_id: 'm3', match_date: '2026-09-20', surface: 'hard', sets_played: 2, games_played: 18, source_family: 'itf', side: side({ aces: null }), opp: side() },
    { match_id: 'future', match_date: '2026-09-26', surface: 'hard', side: side({ aces: 80 }), opp: side() }
  ];
  const dna = buildDna(rows, { asOf: '2026-09-26' });
  assert.equal(dna.matches_considered, 3, 'match ON the as-of date is excluded');
  const ace = dna.metrics.ace_rate;
  assert.equal(ace.numerator, 10);
  assert.equal(ace.denominator, 160);
  assert.equal(ace.value, 0.0625);
  assert.equal(ace.sample_matches, 2, 'm3 has no ace count: excluded, not zero');
  assert.equal(ace.coverage_status, 'partial');
  assert.equal(ace.confidence, 'low');
  assert.deepEqual(ace.source_families, ['wta']);
  const hold = dna.metrics.hold_rate;
  assert.equal(hold.numerator, 33); // 3 x (12 - 1)
  assert.equal(hold.denominator, 36);
  assert.equal(dna.metrics.return_games_won.numerator, 4 + 1 + 1);
  const clay = buildDna(rows, { asOf: '2026-09-26', surface: 'clay' });
  assert.equal(clay.metrics.ace_rate.numerator, 2);
  assert.throws(() => buildDna(rows, { asOf: 'yesterday' }));
});

test('DNA: zero denominator -> null value, insufficient', () => {
  const m = metricObject({ key: 'break_points_saved', numerator: 0, denominator: 0, sample: { matches: 0, sets: 0, games: 0 }, coverage: 'none', sourceFamilies: [], asOf: '2026-09-26' });
  assert.equal(m.value, null);
  assert.equal(m.confidence, 'insufficient');
  assert.equal(m.definition_version, 1);
  assert.equal(m.origin, 'pbe_derived');
  assert.equal(confidenceFor(2000, 150, 30), 'high');
  for (const [k, d] of Object.entries(DEFINITIONS)) assert.ok(d.doc && d.min_den > 0, k);
});

test('envelope + freshness states', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  const e = envelope({ x: 1 }, { source: ['wta'], source_updated_at: '2026-09-26T11:59:00Z', policy: { currentS: 120, staleS: 3600 } }, now);
  assert.equal(e.meta.age_s, 60);
  assert.equal(e.meta.freshness, 'CURRENT');
  assert.equal(classifyFreshness(600, { currentS: 120, staleS: 3600 }), 'CACHED');
  assert.equal(classifyFreshness(7200, { currentS: 120, staleS: 3600 }), 'STALE');
  assert.equal(classifyFreshness(null, { currentS: 1, staleS: 2 }), 'UNAVAILABLE');
  const nc = notConfigured('rankings');
  assert.equal(nc.data, null);
  assert.equal(nc.meta.freshness, 'NOT_CONFIGURED');
  assert.throws(() => envelope({}, { freshness: 'LIVE-ISH' }));
});

function fakeFetch(script) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = script.shift();
    return new Response(r.status === 304 ? null : r.body ?? '', { status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}
function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms) => { t += ms; }, get t() { return t; } };
}

test('source client: honest UA, per-host spacing, conditional 304 reuse', async () => {
  const clock = fakeClock();
  const f = fakeFetch([
    { body: '{"a":1}', headers: { 'content-type': 'application/json', etag: '"v1"' } },
    { status: 304, body: '' }
  ]);
  const c = new SourceClient({ fetch: f, now: clock.now, sleep: clock.sleep, jitter: () => 0, policies: { 'x.test': { min_interval_ms: 5000 } } });
  const t0 = clock.t;
  const a = await c.get('https://x.test/r');
  const b = await c.get('https://x.test/r');
  assert.equal(f.calls[0].headers['user-agent'], USER_AGENT);
  assert.equal(f.calls[1].headers['if-none-match'], '"v1"');
  assert.equal(b.not_modified, true);
  assert.equal(b.body, a.body);
  assert.ok(clock.t - t0 >= 5000, 'second request waited for the host interval');
});

test('source client: 429 honours Retry-After; 403 and challenge pages are BLOCKED, not retried', async () => {
  const clock = fakeClock();
  const f = fakeFetch([{ status: 429, headers: { 'retry-after': '7' } }, { body: '{}' }]);
  const c = new SourceClient({ fetch: f, now: clock.now, sleep: clock.sleep, jitter: () => 0 });
  const t0 = clock.t;
  const r = await c.get('https://y.test/');
  assert.equal(r.status, 200);
  assert.ok(clock.t - t0 >= 7000);
  const blocked = new SourceClient({ fetch: fakeFetch([{ status: 403 }]), now: clock.now, sleep: clock.sleep, jitter: () => 0 });
  await assert.rejects(blocked.get('https://z.test/'), (e) => e.code === 'source_blocked');
  const chal = new SourceClient({ fetch: fakeFetch([{ status: 200, body: '<html><script src="/cdn-cgi/challenge-platform/x"></script>' }]), now: clock.now, sleep: clock.sleep, jitter: () => 0 });
  await assert.rejects(chal.get('https://w.test/'), (e) => e.code === 'source_blocked');
});

test('archive: content-addressed keys, canonical request identity, put-once payloads', async () => {
  const h = await sha256Hex('abc');
  assert.equal(h, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(payloadKey('wta', h), `tennis-source/wta/sha256/ba/${h}`);
  assert.equal(requestIdentity('get', 'https://a.test/p?b=2&a=1'), 'GET https://a.test/p?a=1&b=2');
  const puts = [];
  const store = new Map();
  const bucket = { head: async (k) => (store.has(k) ? {} : null), put: async (k, v) => { puts.push(k); store.set(k, v); } };
  const result = { url: 'https://a.test/p', body: 'abc', status: 200, content_type: 'application/json', fetched_at: '2026-09-26T12:00:00.000Z', bytes: 3, latency_ms: 5 };
  const r1 = await archiveCapture({ bucket, family: 'wta', adapter: 't', parserVersion: '1', result });
  await archiveCapture({ bucket, family: 'wta', adapter: 't', parserVersion: '1', result: { ...result, fetched_at: '2026-09-26T13:00:00.000Z' } });
  assert.equal(r1.content_sha256, h);
  assert.equal(puts.filter((k) => k.includes('/sha256/')).length, 1, 'identical payload stored once');
  assert.equal(puts.filter((k) => k.includes('/captures/')).length, 2, 'every capture recorded');
  assert.throws(() => payloadKey('../etc', h));
});

test('adapters fail independently', async () => {
  const good = { key: 'good.x', family: 'good', parser_version: '1', capabilities: ['rankings_singles'], request: () => ({ url: 'https://good.test/' }), shape: (b) => requirePaths(JSON.parse(b), ['rows.0']), parse: (b) => JSON.parse(b).rows };
  const bad = { ...good, key: 'bad.x', family: 'bad', request: () => { throw new Error('boom'); } };
  const drift = { ...good, key: 'drift.x', family: 'drift', request: () => ({ url: 'https://drift.test/' }) };
  assert.deepEqual(validateAdapter(good), []);
  const client = { get: async (url) => ({ url, ok: true, status: 200, body: url.includes('drift') ? '{"other":1}' : '{"rows":[{"r":1}]}', bytes: 10, latency_ms: 1, fetched_at: 'now' }) };
  const out = await runIsolated([bad, good, drift], { client });
  assert.deepEqual(out.map((o) => o.state), ['ERROR', 'PASS', 'DEGRADED']);
  assert.equal(out[2].error, 'shape_drift');
});
