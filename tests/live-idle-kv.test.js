// tennis-live idle minutes write KV only when something changes (2026-10-07; was 3 puts every minute, ~4.3k/day).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idleCycle, IDLE_RUN_EVERY_MS } from '../workers/tennis-live/src/index.js';
import { liveOwnedSet } from '../workers/tennis-ingest/src/espn-live.js';
import { MemKV } from './helpers/memstore.js';

class CountingKV extends MemKV {
  constructor() { super(); this.puts = 0; }
  async put(k, v) { this.puts += 1; return super.put(k, v); }
}

test('tennis-live idle: no KV write while nothing changes; ownership released once; run record refreshed inside the canary window', async () => {
  const kv = new CountingKV();
  // a cycle that owned editions just ended
  await kv.put('live:heartbeat', '2026-10-07T12:00:00.000Z');
  await kv.put('live:owned', JSON.stringify(['ed1']));
  await kv.put('tennis-live:last_run', JSON.stringify({ worker: 'tennis-live', started_at: '2026-10-07T12:00:00.000Z', editions: 1 }));
  kv.puts = 0;
  const t0 = Date.parse('2026-10-07T12:01:00.000Z');
  let r = await idleCycle(kv, new Date(t0).toISOString());
  assert.equal(r.kv_writes, 3, 'release ownership + leaving live is a change');
  assert.deepEqual(await kv.get('live:owned', 'json'), []);
  assert.equal((await liveOwnedSet(kv)).size, 0);
  let minute = 1;
  let writes = 0;
  for (; minute <= 30; minute += 1) { r = await idleCycle(kv, new Date(t0 + minute * 60e3).toISOString()); writes += r.kv_writes; }
  assert.ok(writes <= 15, `${writes} writes in 30 idle minutes (was 90)`);
  const last = await kv.get('tennis-live:last_run', 'json');
  assert.ok(t0 + 30 * 60e3 - Date.parse(last.started_at) < IDLE_RUN_EVERY_MS + 60e3, 'the canary (cycled within 3 min) still holds');
  assert.equal((await liveOwnedSet(kv)).size, 0, 'ownership stays empty: ingest writes every edition');
});
