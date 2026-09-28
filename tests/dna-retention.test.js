// Snapshot retention (owner-approved): 14 daily + the earliest snapshot of each month + the newest date, per
// definition version; bounded per run; dry run writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retentionPlan, runRetention, MAX_DATES_PER_RUN } from '../workers/tennis-ingest/src/dna-retention.js';
import { MemStore, MemKV } from './helpers/memstore.js';

const days = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400e3).toISOString().slice(0, 10));

test('plan: dailies older than 14 days go; each month keeps its earliest date; recent 14 days all stay', () => {
  const dates = ['2025-02-01', '2026-08-01', '2026-09-01', ...days('2026-09-26', 30)]; // 09-26 .. 10-25
  const p = retentionPlan(dates, '2026-10-25');
  assert.equal(p.cutoff, '2026-10-11');
  assert.deepEqual(p.remove, [...days('2026-09-26', 5).filter((d) => d !== '2026-09-01'), ...days('2026-10-02', 10)]);
  const kept = Object.fromEntries(p.keep.map((k) => [k.as_of, k.why]));
  assert.equal(kept['2026-09-01'], 'monthly');
  assert.equal(kept['2026-10-01'], 'monthly', 'October keeps its earliest date');
  assert.equal(kept['2025-02-01'], 'monthly');
  assert.equal(p.keep.filter((k) => k.why === 'daily').length, 14);
  assert.ok(!p.remove.includes('2026-10-12'));
});

test('plan: nothing to remove while every old date is a month start (production 2026-09-28)', () => {
  const p = retentionPlan(['2025-02-01', '2026-08-01', '2026-09-01', '2026-09-26', '2026-09-27', '2026-09-28'], '2026-09-28');
  assert.deepEqual(p.remove, []);
});

test('plan: the newest date is never removed even when builds stopped long ago', () => {
  const p = retentionPlan(['2026-01-01', '2026-01-10', '2026-01-20'], '2026-06-01');
  assert.deepEqual(p.remove, ['2026-01-10']);
  assert.equal(p.keep.find((k) => k.as_of === '2026-01-20').why, 'newest');
});

test('run: deletes only planned dates of the right version, bounded per run; dry run deletes nothing', async () => {
  const s = new MemStore();
  const rows = [];
  for (const dv of [1, 2]) for (const d of ['2026-09-01', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-30']) for (const sf of ['all', 'clay']) rows.push({ pbe_player_id: `p${dv}${sf}`, as_of: d, surface: sf, definition_version: dv, metrics: {} });
  await s.upsert('tennis_dna_snapshots', rows);
  const kv = new MemKV();
  const dry = await runRetention({ store: s, kv }, { today: '2026-09-30', write: false });
  assert.equal(s.rows('tennis_dna_snapshots').length, rows.length);
  assert.deepEqual(dry.versions[1].to_remove, ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08']);
  const r = await runRetention({ store: s, kv }, { today: '2026-09-30' });
  const total = r.versions[1].deleted.length + r.versions[2].deleted.length;
  assert.equal(total, MAX_DATES_PER_RUN);
  assert.equal(r.versions[1].deleted[0].rows, 2, 'every surface of the date');
  await runRetention({ store: s, kv }, { today: '2026-09-30' });
  await runRetention({ store: s, kv }, { today: '2026-09-30' });
  const left = [...new Set(s.rows('tennis_dna_snapshots').map((x) => `${x.definition_version}|${x.as_of}`))].sort();
  assert.deepEqual(left, ['1|2026-09-01', '1|2026-09-30', '2|2026-09-01', '2|2026-09-30']);
  assert.ok(await kv.get('dna:retention:last'));
});
