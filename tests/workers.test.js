// Worker handlers: /health everywhere, truthful NOT_CONFIGURED data routes, real /v1/sources, admin-gated runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import api, { propsportsFetch } from '../workers/tennis-api/src/index.js';
import ingest, { canaryPlan } from '../workers/tennis-ingest/src/index.js';
import live from '../workers/tennis-live/src/index.js';
import model from '../workers/tennis-model/src/index.js';
import news from '../workers/tennis-news/src/index.js';
import { validateAdapter } from '../workers/shared/adapter.js';

const get = async (w, path, init = {}, env = {}) => {
  const res = await w.fetch(new Request(`https://w.test${path}`, init), env);
  return { status: res.status, body: await res.json() };
};

test('every worker answers /health without leaking secret values', async () => {
  for (const [name, w] of [['tennis-api', api], ['tennis-ingest', ingest], ['tennis-live', live], ['tennis-model', model], ['tennis-news', news]]) {
    const r = await get(w, '/health', {}, { SUPABASE_SERVICE_ROLE_KEY: 'super-secret-value' });
    assert.equal(r.status, 200, name);
    assert.equal(r.body.worker, name);
    assert.ok(!JSON.stringify(r.body).includes('super-secret-value'), `${name} leaked a secret`);
  }
});

test('tennis-api data routes are NOT_CONFIGURED with null data — never a sample', async () => {
  for (const p of ['/v1/today', '/v1/live', '/v1/players', '/v1/h2h/a/b', '/v1/rankings', '/v1/tournaments/wimbledon/2025', '/v1/pbe-picks', '/v1/news', '/v1/odds']) {
    const r = await get(api, p);
    assert.equal(r.status, 200, p);
    assert.equal(r.body.data, null, p);
    assert.equal(r.body.meta.freshness, 'NOT_CONFIGURED', p);
    for (const k of ['source', 'fetched_at', 'source_updated_at', 'age_s', 'freshness', 'semantics', 'degraded']) assert.ok(k in r.body.meta, `${p} meta.${k}`);
  }
  assert.equal((await get(api, '/v1/nope')).status, 404);
  assert.equal((await get(api, '/v1/live', { method: 'POST' })).status, 405);
});


test('tennis-api premium intelligence fails closed without verified membership', async () => {
  for (const p of ['/v1/players/x/dna', '/v1/dna/leaders', '/v1/matchups', '/v1/players-to-watch']) {
    const r = await get(api, p);
    assert.equal(r.status, 401, p);
    assert.equal(r.body.error, 'membership_required', p);
    assert.equal(r.body.membership?.state, 'free', p);
    assert.equal(r.body.membership?.entitled, false, p);
  }
});


test('PropSports service bridge bypasses consumer membership only for Player DNA', async () => {
  const env = {};
  const dna = await propsportsFetch(new Request('https://internal.test/v1/players/x/dna'), env);
  assert.notEqual(dna.status, 401, 'trusted service path must not require browser membership');
  const other = await propsportsFetch(new Request('https://internal.test/v1/dna/leaders'), env);
  assert.equal(other.status, 404, 'service bridge must not become a general premium bypass');
});

test('tennis-api keeps top-of-funnel PBEcast and capped DNA preview public', async () => {
  const pbecast = await get(api, '/v1/pbecast');
  assert.notEqual(pbecast.status, 401, 'PBEcast must remain public');
  const preview = await get(api, '/v1/dna/leaders?metric=pbe_rating&tour=wta&limit=5&preview=1');
  assert.notEqual(preview.status, 401, 'homepage DNA preview must remain public');
  const tooDeep = await get(api, '/v1/dna/leaders?metric=match_win_rate&tour=wta&limit=5&preview=1');
  assert.equal(tooDeep.status, 401, 'non-preview DNA metrics stay premium');
});

test('tennis-api /v1/sources serves the committed registry + canary evidence', async () => {
  const r = await get(api, '/v1/sources');
  assert.ok(r.body.data.registry.sources.length > 10);
  assert.ok(Array.isArray(r.body.data.canary.results));
});

test('tennis-api refuses a store URL that is not the sports project', async () => {
  const r = await get(api, '/v1/live', {}, { TENNIS_MODEL_SUPABASE_URL: 'https://rlfyavnhbngwbldebrid.supabase.co', TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY: 'x' });
  assert.equal(r.body.meta.freshness, 'ERROR');
});

test('tennis-ingest runs are admin-gated and its canary plan is valid', async () => {
  assert.equal((await get(ingest, '/v1/runs', { method: 'POST' }, { INGEST_ADMIN_TOKEN: 't' })).status, 401);
  assert.equal((await get(ingest, '/v1/runs', { method: 'POST' }, {})).status, 401, 'no token configured => closed');
  for (const a of canaryPlan()) assert.deepEqual(validateAdapter(a), [], a.key);
});

test('tennis-live polls only live editions, stops an edition once nothing is live, and hands ownership to ingest', async () => {
  const { liveCycle } = await import('../workers/tennis-live/src/index.js');
  const mem = new Map([['live:editions', JSON.stringify([])]]);
  const kv = { get: async (k, t) => (mem.has(k) ? (t === 'json' ? JSON.parse(mem.get(k)) : mem.get(k)) : null), put: async (k, v) => { mem.set(k, v); }, delete: async (k) => mem.delete(k) };
  const env = { TENNIS_STATE: kv, TENNIS_MODEL_SUPABASE_URL: 'https://tkmlnhmylqnttmnsnief.supabase.co', TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY: 'k' };
  const r = await liveCycle(env, { sleep: async () => {} });
  assert.equal(r.editions, 0);
  assert.ok(mem.get('live:heartbeat'));
  assert.deepEqual(JSON.parse(mem.get('live:owned')), []);
});
