// Daily Tennis DNA v2 build split into bounded units (workers/tennis-ingest/src/dna-daily.js): the unit sequence must
// write exactly what the single-invocation build writes, resume after a killed unit, never run two units at once, and
// load one tour's ledger per unit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemStore, MemKV } from './helpers/memstore.js';
import { buildDnaV2 } from '../workers/tennis-ingest/src/dna-v2-job.js';
import { runDnaV2Unit, planUnits, unitOptions, loadPlan, acquireLease, releaseLease, PLAN_KEY, LEASE_KEY, LEASE_MS } from '../workers/tennis-ingest/src/dna-daily.js';

const DAY = '2026-10-05'; // a Monday: the weekly Players to Watch edition is frozen too
const HIST = '2025-10-01';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const uuid = (n) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function seed(store) {
  const r = rng(20261009);
  const surfaces = ['hard', 'clay', 'grass'];
  let mid = 1;
  for (const [tour, g, ev] of [['ATP', 'M', 'MS'], ['WTA', 'F', 'WS']]) {
    const players = Array.from({ length: 14 }, (_, i) => `${tour.toLowerCase()}-p${String(i).padStart(2, '0')}`);
    store.rows('tennis_players').push(...players.map((pid, i) => ({ pbe_player_id: pid, gender: g, status: 'active', plays: i % 3 === 0 ? 'left' : 'right' })));
    const strength = new Map(players.map((p, i) => [p, 2000 - i * 40]));
    for (let m = 0; m < 22; m += 1) {
      const start = new Date(Date.UTC(2024, 11 + m, 3));
      const sd = start.toISOString().slice(0, 10);
      const ed = new Date(start.getTime() + 6 * 86400e3).toISOString().slice(0, 10);
      const edition = `${tour}-ed-${m}`;
      store.rows('tennis_tournament_editions').push({ edition_id: edition, start_date: sd, end_date: ed, competition_key: m % 4 === 0 ? 'grand_slam' : null, level: tour === 'WTA' ? 'WTA 500' : null, year: start.getUTCFullYear() });
      const surface = surfaces[m % 3];
      for (let k = 0; k < 28; k += 1) {
        const a = players[Math.floor(r() * players.length)];
        let b = players[Math.floor(r() * players.length)];
        if (a === b) b = players[(players.indexOf(a) + 1) % players.length];
        const pa = 1 / (1 + 10 ** ((strength.get(b) - strength.get(a)) / 400));
        const winner = r() < pa ? 'A' : 'B';
        const id = uuid(mid++);
        const day = new Date(start.getTime() + (k % 6) * 86400e3).toISOString();
        store.rows('tennis_matches').push({ match_id: id, edition_id: edition, event_type: ev, round: ['R32', 'R16', 'QF', 'SF', 'F'][k % 5], format_key: 'BO3', status: k % 17 === 0 ? 'retired' : 'completed', winner_side: winner, scheduled_at: day, started_at: day, surface, source_family: 'espn', updated_at: '2026-10-01T00:00:00Z' });
        const sets = [[6, 3 + (k % 3)], [4 + (k % 3), 6], [6, 2 + (k % 4)]].slice(0, 2 + (k % 2));
        sets.forEach(([x, y], i) => store.rows('tennis_sets').push({ match_id: id, set_no: i + 1, games_a: winner === 'A' ? x : y, games_b: winner === 'A' ? y : x }));
        store.rows('tennis_match_participants').push({ match_id: id, side: 'A', participant_key: `S:${a}` }, { match_id: id, side: 'B', participant_key: `S:${b}` });
      }
    }
    const listKey = tour === 'ATP' ? 'atp_singles' : 'wta_singles';
    for (let w = 0; w < 20; w += 1) {
      const date = new Date(Date.UTC(2024, 11 + w, 1)).toISOString().slice(0, 10);
      const snapshot_id = `${listKey}-${date}`;
      store.rows('tennis_ranking_snapshots').push({ snapshot_id, ranking_date: date, row_count: players.length, source_family: 'official', list_key: listKey });
      players.forEach((pid, i) => store.rows('tennis_rankings').push({ snapshot_id, provider_player_id: `${snapshot_id}-${i}`, pbe_player_id: pid, rank: ((i + w) % players.length) + 1 }));
    }
  }
}

function fresh() {
  const store = new MemStore();
  seed(store);
  const kv = new MemKV();
  return { store, kv, ctx: { store, kv, env: {} } };
}
const sortRows = (rows, keys) => [...rows].map((x) => JSON.parse(JSON.stringify(x))).sort((a, b) => keys.map((k) => String(a[k])).join('|').localeCompare(keys.map((k) => String(b[k])).join('|')));
const dropBuiltAt = (s) => { const o = JSON.parse(s); delete o.built_at; return o; };

async function monolithic() {
  const f = fresh();
  await f.kv.put('dna2:hist', HIST);
  // the pre-2026-10-09 step: one invocation builds [day, hist], then advances the cursors
  await buildDnaV2(f.ctx, { asOfs: [DAY, HIST], mode: 'full' });
  await f.kv.put('dna2:last', DAY);
  const d = new Date(`${HIST}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); await f.kv.put('dna2:hist', d.toISOString().slice(0, 10));
  return f;
}

async function unitwise({ failAt = null } = {}) {
  const f = fresh();
  await f.kv.put('dna2:hist', HIST);
  const results = [];
  let failed = false;
  for (let i = 0; i < 20; i += 1) {
    const build = async (ctx, opts) => {
      if (failAt && !failed && opts.tours[0] === failAt.tour && (opts.surfaces && !opts.overall ? 'surfaces' : opts.primary ? 'overall' : 'hist') === failAt.part) {
        failed = true;
        // a unit dying part-way: some rows already upserted, then the invocation is killed
        await buildDnaV2(ctx, { ...opts, write: true });
        throw new Error('simulated exceededMemory');
      }
      return buildDnaV2(ctx, opts);
    };
    let r;
    try { r = await runDnaV2Unit(f.ctx, { day: DAY, build }); } catch (e) { results.push({ error: String(e.message) }); continue; }
    results.push(r);
    if (r.complete) break;
  }
  return { ...f, results };
}

test('unit plan: per tour overall, surfaces, historical date; finalize last', () => {
  assert.deepEqual(planUnits([DAY, HIST]), ['ATP:overall', 'ATP:surfaces', 'ATP:hist', 'WTA:overall', 'WTA:surfaces', 'WTA:hist', 'finalize']);
  assert.deepEqual(planUnits([DAY]), ['ATP:overall', 'ATP:surfaces', 'WTA:overall', 'WTA:surfaces', 'finalize']);
  const plan = { as_ofs: [DAY, HIST], mode: 'auto' };
  assert.deepEqual(unitOptions('WTA:hist', plan), { tours: ['WTA'], mode: 'auto', finalize: false, asOfs: [HIST], primary: false, overall: true, surfaces: false });
  assert.deepEqual(unitOptions('ATP:surfaces', plan), { tours: ['ATP'], mode: 'auto', finalize: false, asOfs: [DAY], primary: true, overall: false, surfaces: true });
});

test('unit-by-unit build writes exactly the single-invocation build (rows, ratings, summary, watch, cursors)', async () => {
  const a = await monolithic();
  const b = await unitwise();
  assert.equal(b.results.length, 7, JSON.stringify(b.results.map((r) => r.unit || r)));
  assert.ok(b.results.at(-1).complete);
  const snaps = (s) => sortRows(s.rows('tennis_dna_snapshots'), ['pbe_player_id', 'as_of', 'surface', 'definition_version']);
  assert.ok(snaps(a.store).length > 50, 'fixture produces snapshots');
  assert.ok(snaps(a.store).some((x) => x.as_of === HIST) && snaps(a.store).some((x) => x.surface === 'clay'), 'fixture covers hist + surface snapshots');
  assert.deepEqual(snaps(b.store), snaps(a.store));
  const ratings = (s) => sortRows(s.rows('tennis_surface_ratings'), ['pbe_player_id', 'surface', 'as_of', 'method_version']);
  assert.ok(ratings(a.store).length > 0);
  assert.deepEqual(ratings(b.store), ratings(a.store));
  assert.deepEqual(dropBuiltAt(await b.kv.get('dna:v2:summary')), dropBuiltAt(await a.kv.get('dna:v2:summary')));
  assert.equal(await b.kv.get('dna:v2:summary').then((s) => Object.keys(JSON.parse(s)).join()), await a.kv.get('dna:v2:summary').then((s) => Object.keys(JSON.parse(s)).join()), 'summary key order unchanged');
  assert.deepEqual(dropBuiltAt(await b.kv.get('dna:v2:watch:current')), dropBuiltAt(await a.kv.get('dna:v2:watch:current')));
  assert.deepEqual(dropBuiltAt(await b.kv.get(`dna:v2:watch:week:${DAY}`)), dropBuiltAt(await a.kv.get(`dna:v2:watch:week:${DAY}`)));
  assert.equal(await b.kv.get('dna:v2:watch:weeks'), await a.kv.get('dna:v2:watch:weeks'));
  for (const k of ['dna2:last', 'dna2:hist']) assert.equal(await b.kv.get(k), await a.kv.get(k), k);
  assert.equal(await b.kv.get(LEASE_KEY), null, 'lease released');
});

test('each unit loads only its own tour ledger', async () => {
  const f = fresh();
  await f.kv.put('dna2:hist', HIST);
  for (const unit of planUnits([DAY, HIST]).filter((u) => u !== 'finalize')) {
    const before = f.store.log.length;
    const r = await runDnaV2Unit(f.ctx, { day: DAY });
    assert.equal(r.unit, unit);
    const scans = f.store.log.slice(before).filter(([m, t, q]) => m === 'GET' && t === 'tennis_matches' && /event_type=eq\./.test(q)).map(([, , q]) => /event_type=eq\.(\w+)/.exec(q)[1]);
    assert.deepEqual([...new Set(scans)], [unit.startsWith('ATP') ? 'MS' : 'WS'], unit);
  }
});

test('a unit killed part-way is re-run by the next tick; outputs unchanged (idempotent per day x unit)', async () => {
  const a = await monolithic();
  const b = await unitwise({ failAt: { tour: 'WTA', part: 'overall' } });
  assert.ok(b.results.some((r) => r.error === 'simulated exceededMemory'));
  assert.ok(b.results.at(-1).complete);
  const snaps = (s) => sortRows(s.rows('tennis_dna_snapshots'), ['pbe_player_id', 'as_of', 'surface', 'definition_version']);
  assert.deepEqual(snaps(b.store), snaps(a.store));
  assert.deepEqual(dropBuiltAt(await b.kv.get('dna:v2:summary')), dropBuiltAt(await a.kv.get('dna:v2:summary')));
  assert.equal(await b.kv.get('dna2:hist'), await a.kv.get('dna2:hist'));
});

test('lease: a second invocation never starts a unit while one is running; an expired lease is taken over', async () => {
  const kv = new MemKV();
  const t = Date.parse('2026-10-09T00:00:06Z');
  const mine = await acquireLease(kv, t);
  assert.ok(mine);
  assert.equal(await acquireLease(kv, t + 4 * 60e3), null, 'tick 4 min later is refused');
  let built = 0;
  const r = await runDnaV2Unit({ kv }, { day: DAY, build: async () => { built += 1; return {}; }, now: () => t + 120e3 });
  assert.equal(r, 'unit_in_progress');
  assert.equal(built, 0);
  const later = await acquireLease(kv, t + LEASE_MS + 1);
  assert.ok(later, 'killed holder: lease expires and the next tick resumes');
  await releaseLease(kv, mine);
  assert.equal(await kv.get(LEASE_KEY), later, 'a stale holder never removes the current lease');
  await releaseLease(kv, later);
  assert.equal(await kv.get(LEASE_KEY), null);
});

test('plan is per UTC day: a new day starts a fresh plan from the cursors; completed day is not rebuilt', async () => {
  const kv = new MemKV();
  await kv.put('dna2:hist', HIST);
  await kv.put('dna2:mode', 'auto');
  const p1 = await loadPlan(kv, DAY);
  assert.deepEqual(p1.as_ofs, [DAY, HIST]);
  assert.equal(p1.mode, 'auto');
  p1.done['ATP:overall'] = { at: 'x' };
  await kv.put(PLAN_KEY, JSON.stringify(p1));
  assert.deepEqual((await loadPlan(kv, DAY)).done, { 'ATP:overall': { at: 'x' } }, 'same day resumes');
  const p2 = await loadPlan(kv, '2026-10-06');
  assert.deepEqual(p2.done, {}, 'next day starts over');
  await kv.put('dna2:hist', '2007-12-01');
  assert.deepEqual((await loadPlan(kv, '2026-10-07')).as_ofs, ['2026-10-07'], 'history lane finished: primary date only');
});
