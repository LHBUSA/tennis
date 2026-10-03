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


test('PropSports service bridge exposes exactly the 25 approved Tennis routes', async () => {
  const env = {};
  const id = '11111111-1111-1111-1111-111111111111';
  const approved = [
    '/v1/today',
    '/v1/live',
    '/v1/tournaments',
    '/v1/tournaments/wimbledon/2026',
    `/v1/matches/${id}`,
    '/v1/players',
    '/v1/players/carlos-alcaraz',
    '/v1/players/carlos-alcaraz/dna',
    '/v1/rankings',
    '/v1/h2h/carlos-alcaraz/jannik-sinner',
    '/v1/schedule',
    '/v1/sources',
    '/v1/men',
    '/v1/men/players',
    '/v1/slams',
    `/v1/pbecast/${id}`,
    '/v1/matchups',
    `/v1/matchups/${id}`,
    '/v1/players-to-watch',
    '/v1/dna/leaders',
    '/v1/players/carlos-alcaraz/profile',
    '/v1/search?q=alcaraz',
    '/v1/venues/arthur-ashe-stadium',
    `/v1/matches/${id}/broadcast`,
    '/v1/coverage',
  ];
  assert.equal(approved.length, 25);
  for (const path of approved) {
    const res = await propsportsFetch(new Request(`https://internal.test${path}`), env);
    assert.notEqual(res.status, 404, `approved PropSports route must be bridged: ${path}`);
    assert.notEqual(res.status, 401, `approved PropSports route must bypass browser membership: ${path}`);
  }

  for (const path of ['/v1/news', '/v1/odds', '/v1/pbe-picks', '/v1/track-record', '/v1/breakout-watch', '/v1/doubles/pairs/example']) {
    const res = await propsportsFetch(new Request(`https://internal.test${path}`), env);
    assert.equal(res.status, 404, `unapproved route must stay outside the PropSports bridge: ${path}`);
  }
});

test('tennis-api keeps top-of-funnel PBEcast and capped DNA preview public', async () => {
  const pbecast = await get(api, '/v1/pbecast');
  assert.notEqual(pbecast.status, 401, 'PBEcast must remain public');
  const preview = await get(api, '/v1/dna/leaders?metric=pbe_rating&tour=wta&limit=5&preview=1');
  assert.notEqual(preview.status, 401, 'homepage DNA preview must remain public');
  for (const m of ['match_win_rate', 'game_win_rate']) {
    const r = await get(api, `/v1/dna/leaders?metric=${m}&tour=atp&limit=5&preview=1`);
    assert.notEqual(r.status, 401, `homepage Match DNA preview ${m} must remain public`);
  }
  for (const m of ['hold_rate', 'return_games_won', 'deciding_set_win_rate', 'set_win_rate', 'wins_above_expectation']) {
    const r = await get(api, `/v1/dna/leaders?metric=${m}&tour=wta&limit=5&preview=1`);
    assert.equal(r.status, 401, `non-preview DNA metric ${m} stays premium`);
  }
  const six = await get(api, '/v1/dna/leaders?metric=pbe_rating&tour=atp&limit=6&preview=1');
  assert.equal(six.status, 401, 'preview max is 5 rows');
  const five = await get(api, '/v1/dna/leaders?metric=game_win_rate&tour=wta&limit=5&preview=1');
  assert.notEqual(five.status, 401, '5 rows stay public');
  const deep = await get(api, '/v1/dna/leaders?metric=match_win_rate&tour=wta&limit=50&preview=1');
  assert.equal(deep.status, 401, 'preview is capped at 5 rows');
  const full = await get(api, '/v1/dna/leaders?metric=match_win_rate&tour=wta&limit=5');
  assert.equal(full.status, 401, 'without preview=1 the board stays premium');
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

test('tennis-api cache hits re-issue CORS for the current request (an Origin-less fill must not poison browsers)', async () => {
  const { withCors } = await import('../workers/tennis-api/src/index.js');
  const cached = new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' } });
  const browser = new Request('https://tennis-api.propbetedge.ai/v1/x', { headers: { Origin: 'https://tennis.propbetedge.ai' } });
  const r = withCors(cached.clone(), browser);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://tennis.propbetedge.ai');
  assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(await r.text(), '{"ok":true}');
  const credentialed = new Response('{}', { headers: { 'access-control-allow-origin': 'https://tennis.propbetedge.ai', 'access-control-allow-credentials': 'true' } });
  const other = withCors(credentialed, new Request('https://tennis-api.propbetedge.ai/v1/x'));
  assert.equal(other.headers.get('access-control-allow-origin'), '*');
  assert.equal(other.headers.get('access-control-allow-credentials'), null, 'never credentials with a wildcard');
});
