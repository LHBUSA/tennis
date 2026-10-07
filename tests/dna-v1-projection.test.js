// DNA v1 daily build memory (2026-10-07): the build reads only the stats keys its definitions use (PostgREST stats->key)
// instead of every stored stats jsonb (per-set splits included). The stored snapshots must be byte-identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDnaSnapshots, V1_STAT_KEYS, V1_STATS_SELECT } from '../workers/tennis-ingest/src/dna-job.js';
import { buildDna, DEFINITIONS } from '../workers/shared/dna/metric.js';
import { MemStore } from './helpers/memstore.js';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function seed() {
  const store = new MemStore();
  let seedN = 7;
  const rnd = (k) => { seedN = (seedN * 1103515245 + 12345) % 2147483648; return seedN % k; };
  for (let i = 0; i < 160; i += 1) {
    const id = uuid(i + 1);
    const day = `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`;
    await store.upsert('tennis_matches', [{ match_id: id, event_type: i % 9 === 0 ? 'WD' : 'WS', surface: ['hard', 'clay', 'grass'][i % 3], started_at: i % 5 ? `${day}T10:00:00+00:00` : null, source_updated_at: `${day}T13:00:00+00:00`, status: 'completed' }]);
    await store.upsert('tennis_sets', [{ match_id: id, set_no: 1, games_a: 6, games_b: rnd(5) }, { match_id: id, set_no: 2, games_a: rnd(7), games_b: 6 }]);
    await store.upsert('tennis_match_participants', [{ match_id: id, side: 'A', participant_key: `S:${uuid(900 + (i % 11))}` }, { match_id: id, side: 'B', participant_key: `S:${uuid(950 + (i % 13))}` }]);
    for (const side of ['A', 'B']) {
      const sp = 40 + rnd(60);
      const fsi = Math.floor(sp * 0.6);
      const stats = { service_points: sp, aces: rnd(9), double_faults: rnd(5), first_serves_in: fsi, first_serve_points_won: Math.floor(fsi * 0.7), second_serve_points_won: Math.floor((sp - fsi) * 0.5), service_games: 8 + rnd(5), break_points_faced: 3 + rnd(4), break_points_saved: rnd(3), winners: rnd(30), unforced_errors: rnd(30), per_set: [{ set_no: 1, aces: 1, service_points: 30 }, { set_no: 2, aces: 2 }] };
      if (i % 7 === 0) delete stats.break_points_faced; // a missing input stays missing
      if (i % 11 === 0) stats.aces = null;
      await store.upsert('tennis_match_stats', [{ match_id: id, side, source_family: 'wta', stats, captured_at: '2026-01-01T00:00:00Z' }], { onConflict: 'match_id,side' });
    }
  }
  return store;
}

/** The build exactly as it was before the projection (full stats jsonb), for comparison. */
async function referenceRows(store, dates) {
  const stats = await store.select('tennis_match_stats', 'select=match_id,side,source_family,stats&order=match_id.asc');
  const meta = new Map((await store.select('tennis_matches', 'select=*,tennis_sets(games_a,games_b)')).map((m) => [m.match_id, m]));
  const parts = new Map();
  for (const p of await store.select('tennis_match_participants', 'select=*')) { if (!parts.has(p.match_id)) parts.set(p.match_id, {}); parts.get(p.match_id)[p.side] = p.participant_key; }
  const byMatch = new Map();
  for (const s of stats) { if (!byMatch.has(s.match_id)) byMatch.set(s.match_id, {}); byMatch.get(s.match_id)[s.side] = s; }
  const perPlayer = new Map();
  for (const [mid, sides] of byMatch) {
    const m = meta.get(mid);
    const pk = parts.get(mid);
    if (!m || !pk || !['MS', 'WS'].includes(m.event_type) || !sides.A || !sides.B || !(m.started_at || m.source_updated_at)) continue;
    const sets = m.tennis_sets || [];
    for (const side of ['A', 'B']) {
      const pid = pk[side].slice(2);
      if (!perPlayer.has(pid)) perPlayer.set(pid, []);
      perPlayer.get(pid).push({ match_id: mid, match_date: (m.started_at || m.source_updated_at).slice(0, 10), surface: m.surface, sets_played: sets.length, games_played: sets.reduce((t, x) => t + x.games_a + x.games_b, 0), source_family: sides[side].source_family, side: sides[side].stats, opp: sides[side === 'A' ? 'B' : 'A'].stats });
    }
  }
  const rows = [];
  for (const asOf of dates) for (const [pid, list] of perPlayer) for (const surface of ['all', 'hard', 'clay', 'grass']) {
    const dna = buildDna(list, { asOf, surface: surface === 'all' ? null : surface });
    if (dna.matches_considered) rows.push({ pbe_player_id: pid, as_of: asOf, surface, metrics: dna.metrics });
  }
  return rows;
}

test('DNA v1 build: projected stats inputs give byte-identical snapshots to the full stats jsonb', async () => {
  const store = await seed();
  const dates = ['2025-07-01', '2026-01-01'];
  const ref = await referenceRows(store, dates);
  const r = await buildDnaSnapshots({ store }, { asOfs: dates });
  const got = store.rows('tennis_dna_snapshots').map((x) => ({ pbe_player_id: x.pbe_player_id, as_of: x.as_of, surface: x.surface, metrics: x.metrics }));
  const key = (x) => `${x.pbe_player_id}|${x.as_of}|${x.surface}`;
  assert.equal(r.snapshots, ref.length);
  assert.ok(ref.length > 40, 'a real population');
  assert.deepEqual(new Map(got.map((x) => [key(x), JSON.stringify(x.metrics)])), new Map(ref.map((x) => [key(x), JSON.stringify(x.metrics)])));
  assert.ok(ref.some((x) => Object.values(x.metrics).some((m) => m.coverage_status === 'partial')), 'missing inputs exercised');
});

test('DNA v1 build: the projection names every stats key a definition reads', () => {
  const used = new Set();
  const spy = new Proxy({}, { get: (_, k) => { used.add(k); return 1; } });
  for (const d of Object.values(DEFINITIONS)) { d.num(spy, spy); d.den(spy, spy); }
  assert.deepEqual([...used].sort(), [...V1_STAT_KEYS].sort());
  assert.match(V1_STATS_SELECT, /^select=match_id,side,source_family,service_points:stats->service_points,/);
});
