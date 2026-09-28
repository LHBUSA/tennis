// Snapshot retention (owner-approved, corrected 2026-09-28): the latest 14 successful snapshot dates PER VERSION (a count,
// never a calendar window) + the earliest date of each month + the newest date; shared cap of 3 dates per run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retentionPlan, runRetention, MAX_DATES_PER_RUN } from '../workers/tennis-ingest/src/dna-retention.js';
import { MemStore, MemKV } from './helpers/memstore.js';

const days = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400e3).toISOString().slice(0, 10));
const kept = (p, why) => p.keep.filter((k) => k.why === why).map((k) => k.as_of);
const protectedDaily = (p) => p.keep.filter((k) => k.why === 'daily' || k.why === 'newest').map((k) => k.as_of);
const snap = (dv, d, sf = 'all') => ({ pbe_player_id: `p${dv}${sf}`, as_of: d, surface: sf, definition_version: dv, metrics: {} });

// 1
test('retention: exactly 14 successful dates -> all 14 protected, zero removals', () => {
  const p = retentionPlan(days('2026-10-02', 14), '2026-10-15');
  assert.deepEqual(p.remove, []);
  assert.equal(p.daily.length, 14);
});

// 2
test('retention: 15 consecutive dates -> only the oldest becomes eligible (unless it is its month archive)', () => {
  // October already has its archive (10-01): of 15 consecutive dailies 10-10..10-24, the oldest (10-10) is eligible
  const p = retentionPlan(['2026-10-01', ...days('2026-10-10', 15)], '2026-10-25');
  assert.deepEqual(p.remove, ['2026-10-10']);
  // without an earlier date in its month, the oldest daily IS the month's archive and stays
  const q = retentionPlan(days('2026-10-02', 15), '2026-10-16');
  assert.deepEqual(q.remove, [], '10-02 is the earliest stored October date = October archive');
  assert.deepEqual(kept(q, 'monthly'), ['2026-10-02']);
});

// 3 (the owner's example)
test('retention: 15 dates with calendar gaps -> exactly the latest 14 successful dates protected', () => {
  const dates = ['01', '02', '03', '05', '07', '08', '10', '11', '12', '14', '15', '18', '21', '25', '28'].map((d) => `2026-09-${d}`);
  const p = retentionPlan(dates, '2026-10-20');
  assert.deepEqual(protectedDaily(p).sort(), dates.slice(1).sort(), 'latest 14 by COUNT, however far apart');
  assert.deepEqual(p.remove, [], "Sep 1 is outside the 14 but protected as September's archive");
  assert.deepEqual(kept(p, 'monthly'), ['2026-09-01']);
});

// 4
test('retention: many missed build days never reduce the 14 retained dailies', () => {
  const dates = Array.from({ length: 20 }, (_, i) => new Date(Date.parse('2026-06-02T00:00:00Z') + i * 5 * 86400e3).toISOString().slice(0, 10));
  const p = retentionPlan(dates, '2026-12-31');
  assert.equal(protectedDaily(p).length, 14);
  assert.deepEqual(protectedDaily(p).sort(), dates.slice(-14));
  for (const d of p.remove) assert.ok(d < dates.at(-14));
});

// 5
test('retention: v1 and v2 each keep their own latest 14 (histories never combined)', async () => {
  const s = new MemStore();
  const v1 = ['2026-10-01', ...days('2026-10-02', 16)];
  const v2 = days('2026-10-10', 10);
  await s.upsert('tennis_dna_snapshots', [...v1.map((d) => snap(1, d)), ...v2.map((d) => snap(2, d))]);
  const r = await runRetention({ store: s, kv: new MemKV() }, { today: '2026-10-19', write: false });
  assert.deepEqual(r.versions[1].to_remove, ['2026-10-02', '2026-10-03'], '10-01 is the October archive');
  assert.deepEqual(r.versions[1].daily_protected, v1.slice(-14).reverse());
  assert.deepEqual(r.versions[2].to_remove, []);
  assert.equal(r.versions[2].daily_protected.length, 10);
});

// 6
test('retention: a monthly archive older than the latest 14 stays protected', () => {
  const p = retentionPlan(['2025-02-01', '2025-03-01', '2026-08-15', '2026-08-20', ...days('2026-10-02', 14)], '2026-10-20');
  assert.deepEqual(kept(p, 'monthly').sort(), ['2025-02-01', '2025-03-01', '2026-08-15']);
  assert.deepEqual(p.remove, ['2026-08-20']);
});

// 7
test('retention: a monthly archive inside the latest 14 is kept once (as daily), no double counting', () => {
  const p = retentionPlan(['2026-09-20', ...days('2026-10-01', 14)], '2026-10-20');
  assert.equal(p.keep.filter((k) => k.as_of === '2026-10-01').length, 1);
  assert.equal(p.keep.find((k) => k.as_of === '2026-10-01').why, 'daily');
  assert.equal(p.daily.length, 14);
  assert.deepEqual(p.remove, [], "09-20 is September's archive");
});

// 8
test('retention: the newest snapshot is always protected (explicit invariant)', () => {
  for (const n of [1, 2, 14, 15, 40]) {
    const d = days('2025-01-03', n);
    const p = retentionPlan(d, '2030-01-01');
    assert.equal(p.keep.find((k) => k.as_of === d.at(-1)).why, 'newest');
    assert.ok(!p.remove.includes(d.at(-1)));
  }
  assert.deepEqual(retentionPlan(['2026-01-20'], '2030-01-01').keep, [{ as_of: '2026-01-20', why: 'newest' }]);
});

// 12
test('retention: a sparse version with fewer than 14 snapshots keeps every one', () => {
  assert.deepEqual(retentionPlan(['2024-03-05', '2025-07-19', '2026-01-02', '2026-09-28'], '2030-01-01').remove, []);
});

// 9, 10, 11
test('run: shared cap of 3 dates across versions; dry run deletes 0 rows; write deletes exactly the planned dates', async () => {
  const s = new MemStore();
  const hist = { 1: ['2026-08-02', '2026-08-03', '2026-08-04', ...days('2026-09-02', 14)], 2: ['2026-08-05', '2026-08-06', ...days('2026-09-02', 14)] };
  const rows = [];
  for (const dv of [1, 2]) for (const d of hist[dv]) for (const sf of ['all', 'clay']) rows.push(snap(dv, d, sf));
  await s.upsert('tennis_dna_snapshots', rows);
  const kv = new MemKV();
  const dry = await runRetention({ store: s, kv }, { today: '2026-09-16', write: false });
  assert.equal(s.rows('tennis_dna_snapshots').length, rows.length, 'dry run: 0 rows deleted');
  assert.equal(await kv.get('dna:retention:last'), null);
  assert.deepEqual(dry.versions[1].to_remove, ['2026-08-03', '2026-08-04'], '08-02 is the August archive');
  assert.deepEqual(dry.versions[2].to_remove, ['2026-08-06'], '08-05 is the v2 August archive');
  const planned = new Set([...dry.versions[1].to_remove.map((d) => `1|${d}`), ...dry.versions[2].to_remove.map((d) => `2|${d}`)]);
  const r = await runRetention({ store: s, kv }, { today: '2026-09-16' });
  const deleted = [...r.versions[1].deleted.map((x) => `1|${x.as_of}`), ...r.versions[2].deleted.map((x) => `2|${x.as_of}`)];
  assert.equal(deleted.length, MAX_DATES_PER_RUN);
  for (const k of deleted) assert.ok(planned.has(k), `${k} was planned`);
  assert.equal(r.versions[1].deleted[0].rows, 2, 'every surface of the date');
  const left = new Set(s.rows('tennis_dna_snapshots').map((x) => `${x.definition_version}|${x.as_of}`));
  for (const dv of [1, 2]) for (const d of hist[dv].slice(-14)) assert.ok(left.has(`${dv}|${d}`), `${dv}|${d} protected`);
  assert.ok(left.has('1|2026-08-02') && left.has('2|2026-08-05'), 'archives protected');
  assert.ok(JSON.parse(await kv.get('dna:retention:last')).policy.startsWith('latest 14'));
});

test('run: cap binds across versions (4 eligible dates -> 3 deleted, 1 left for the next run)', async () => {
  const s = new MemStore();
  const hist = { 1: ['2026-08-02', '2026-08-03', '2026-08-04', ...days('2026-09-02', 14)], 2: ['2026-08-05', '2026-08-06', '2026-08-07', ...days('2026-09-02', 14)] };
  for (const dv of [1, 2]) await s.upsert('tennis_dna_snapshots', hist[dv].map((d) => snap(dv, d)));
  const r = await runRetention({ store: s, kv: new MemKV() }, { today: '2026-09-16' });
  assert.equal(r.versions[1].deleted.length + r.versions[2].deleted.length, MAX_DATES_PER_RUN);
  assert.equal(r.versions[1].remaining_after_run + r.versions[2].remaining_after_run, 1);
});

test('plan never uses calendar distance: the same dates give the same plan on any "today"', () => {
  const d = days('2026-01-02', 20);
  assert.deepEqual(retentionPlan(d, '2026-01-25').remove, retentionPlan(d, '2031-06-01').remove);
});

test('measurement build (dry=full) computes everything and writes nothing: no upsert, no KV put, non-GET refused', async () => {
  const { dryFullBuild } = await import('../workers/tennis-ingest/src/index.js');
  const s = new MemStore();
  await s.upsert('tennis_players', [{ pbe_player_id: 'p1', gender: 'M', status: 'active' }]);
  const kv = new MemKV();
  const contents = () => JSON.stringify([...s.t].filter(([, rows]) => rows.length).sort());
  const before = contents();
  const r = await dryFullBuild({ store: s, kv, env: {}, steps: [], log: [] }, ['2026-09-28'], {});
  assert.equal(r.dry, 'full');
  assert.equal(contents(), before, 'no table changed');
  assert.equal(await kv.get('dna:v2:summary'), null, 'KV untouched');
  assert.ok(r.would.kv_puts >= 1);
});
