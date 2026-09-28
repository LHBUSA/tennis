// Production guard for bulk work (db-guard.js): health pause, breaker, concurrency ceiling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe, pausedReason, noteStoreError, acquireSlot, releaseSlot, MAX_HEAVY } from '../workers/tennis-ingest/src/db-guard.js';
import { MemKV } from './helpers/memstore.js';

test('health: two failed reads pause bulk lanes; a good read resets the count', async () => {
  const kv = new MemKV();
  const bad = { async select() { throw new Error('postgrest 521 GET tennis_players: error code: 521'); } };
  const good = { async select() { return [{}]; } };
  await probe(bad, kv); assert.equal(await pausedReason(kv), null);
  await probe(good, kv); await probe(bad, kv); assert.equal(await pausedReason(kv), null, 'not consecutive');
  await probe(bad, kv); assert.ok((await pausedReason(kv))?.reason.startsWith('health'));
});

test('health: one read slower than 8 s pauses at once', async () => {
  const kv = new MemKV();
  let t = 0;
  await probe({ async select() { t += 9000; return []; } }, kv, () => t);
  assert.ok(await pausedReason(kv));
});

test('breaker: three store 5xx errors pause bulk lanes; data errors never count', async () => {
  const kv = new MemKV();
  await noteStoreError(kv, 'wta history 1 p0: DEGRADED shape_drift');
  await noteStoreError(kv, 'postgrest 503 POST tennis_source_captures: PGRST002');
  await noteStoreError(kv, 'postgrest 520 GET x');
  assert.equal(await pausedReason(kv), null);
  await noteStoreError(kv, 'Network connection lost.');
  assert.ok((await pausedReason(kv))?.reason.startsWith('breaker'));
});

test('concurrency ceiling: at most MAX_HEAVY slots; a released slot is reusable', async () => {
  const kv = new MemKV();
  const slots = [];
  for (let i = 0; i < MAX_HEAVY; i += 1) slots.push(await acquireSlot(kv, `s${i}`));
  assert.ok(slots.every(Boolean));
  assert.equal(await acquireSlot(kv, 'extra'), null);
  await releaseSlot(kv, slots[2]);
  assert.equal(await acquireSlot(kv, 'extra'), 'heavy:slot:2');
});

test('ops driver never puts the admin token on a command line', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../scripts/ops/lane.mjs', import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(src.includes("readFileSync('D:/Workers/secrets/tennis-ingest-admin-token'"));
  assert.ok(!/spawn|execFile|exec\(|curl/.test(src), 'no child process that could expose the token in argv');
  assert.ok(!/console\.log\([^)]*TOKEN/.test(src));
});
