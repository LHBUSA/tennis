// Per-edition observation heartbeat + tennis-live idle KV (2026-10-07, change-only writes).
// The writer no longer rewrites unchanged rows, so "newest updated_at" stops meaning "last confirmed with the source".
// The confirmation time lives per edition (KV) and tennis-api merges it back at read time: response freshness stays what
// it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeObserved, flushObserved, OBS_KEY, KEEP_MS } from '../workers/shared/observed.js';
import { applyHeartbeat, withHeartbeat, editionHeartbeat, resetHeartbeatMemo } from '../workers/tennis-api/src/store-heartbeat.js';
import { maxTime } from '../workers/tennis-api/src/shape.js';
import { MemKV } from './helpers/memstore.js';

class CountingKV extends MemKV {
  constructor() { super(); this.puts = 0; }
  async put(k, v) { this.puts += 1; return super.put(k, v); }
}

test('mergeObserved keeps the newest confirmation per edition and drops entries older than KEEP_MS', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const stored = { a: '2026-10-07T11:50:00Z', b: '2026-10-07T11:00:00Z', old: new Date(now - KEEP_MS - 1).toISOString() };
  const out = mergeObserved(stored, new Map([['a', '2026-10-07T11:40:00Z'], ['b', '2026-10-07T11:58:00Z'], ['c', '2026-10-07T11:59:00Z']]), now);
  assert.deepEqual(out, { c: '2026-10-07T11:59:00Z', b: '2026-10-07T11:58:00Z', a: '2026-10-07T11:50:00Z' });
});

test('flushObserved: one KV write per call and only when something was observed; the collector is emptied', async () => {
  const kv = new CountingKV();
  assert.equal(await flushObserved(kv, new Map()), 0);
  assert.equal(kv.puts, 0);
  const obs = new Map([['e1', new Date().toISOString()]]);
  assert.equal(await flushObserved(kv, obs), 1);
  assert.equal(kv.puts, 1);
  assert.equal(obs.size, 0);
  assert.ok((await kv.get(OBS_KEY, 'json')).e1);
});

test('applyHeartbeat: a stored row takes its edition confirmation when newer; in-progress rows and newer rows keep theirs', () => {
  const hb = new Map([['E', '2026-10-07T12:00:00.000Z']]);
  const rows = [
    { match_id: 1, edition_id: 'E', status: 'completed', updated_at: '2026-10-07T09:00:00+00:00' },
    { match_id: 2, edition_id: 'E', status: 'in_progress', updated_at: '2026-10-07T09:00:00+00:00' },
    { match_id: 3, edition_id: 'E', status: 'scheduled', updated_at: '2026-10-07T12:30:00+00:00' },
    { match_id: 4, edition_id: 'X', status: 'scheduled', updated_at: '2026-10-07T09:00:00+00:00' }
  ];
  applyHeartbeat(rows, hb);
  assert.deepEqual(rows.map((r) => r.updated_at), ['2026-10-07T12:00:00.000Z', '2026-10-07T09:00:00+00:00', '2026-10-07T12:30:00+00:00', '2026-10-07T09:00:00+00:00']);
  // response freshness = newest row time: what the every-tick rewrite used to give
  assert.equal(maxTime(rows.slice(0, 2)), '2026-10-07T12:00:00.000Z');
});

test('withHeartbeat: tennis_matches reads come back with the merged heartbeat (ingest key + live run record); other tables untouched', async () => {
  resetHeartbeatMemo();
  const kv = new MemKV();
  await kv.put(OBS_KEY, JSON.stringify({ E: '2026-10-07T12:00:00.000Z' }));
  await kv.put('tennis-live:last_run', JSON.stringify({ observed: { L: '2026-10-07T12:01:00.000Z', E: '2026-10-07T11:00:00.000Z' } }));
  const base = { async select(table) { return table === 'tennis_matches' ? [{ edition_id: 'E', status: 'completed', updated_at: '2026-10-01T00:00:00+00:00' }, { edition_id: 'L', status: 'scheduled', updated_at: '2026-10-01T00:00:00+00:00' }] : [{ edition_id: 'E', updated_at: '2026-10-01T00:00:00+00:00' }]; } };
  const store = withHeartbeat(base, { TENNIS_STATE: kv });
  assert.deepEqual((await store.select('tennis_matches', 'select=*')).map((r) => r.updated_at), ['2026-10-07T12:00:00.000Z', '2026-10-07T12:01:00.000Z']);
  assert.equal((await store.select('tennis_tournament_editions', 'select=*'))[0].updated_at, '2026-10-01T00:00:00+00:00');
  assert.equal(withHeartbeat(store, { TENNIS_STATE: kv }), store, 'never wrapped twice');
  resetHeartbeatMemo();
  const broken = { get: async () => { throw new Error('kv down'); } };
  assert.equal(await editionHeartbeat(broken), null, 'KV unreadable -> rows as stored');
  resetHeartbeatMemo();
});
