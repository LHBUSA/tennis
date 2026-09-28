// Phase 6 Player DNA profile + Players to Watch: splits only from the ledger, no guessed hand, no interpolation,
// no future information, minimum samples flagged; the Match DNA metrics themselves are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerEntry, ratingRun, buildMatchDna, buildProfile, ratingHistory, PROFILE_MIN, PROFILE_DEFINITIONS } from '../workers/shared/dna/match-dna.js';
import { playersToWatch, writeWatch } from '../workers/tennis-ingest/src/dna-v2-job.js';
import { MemKV } from './helpers/memstore.js';

const tourOf = (pid) => (pid.startsWith('m') ? 'ATP' : null);
let n = 0;
const row = (A, B, winner, day, extra = {}) => ({ match_id: `p${String((n += 1)).padStart(5, '0')}`, event_type: 'MS', round: '1', format_key: 'BO3_TB7', status: 'completed', winner_side: winner, scheduled_at: `${day}T12:00:00Z`, surface: 'hard', source_family: 'espn', sets: [{ set_no: 1, games_a: 6, games_b: 3 }, { set_no: 2, games_a: 6, games_b: 4 }], A, B, edition: { start_date: day, end_date: day, competition_key: extra.level ?? null }, ...extra });
const day = (i) => new Date(Date.parse('2024-01-01') + i * 86400e3).toISOString().slice(0, 10);

function world() {
  const rows = [];
  // m1 plays everybody; m2 is left-handed, m3 right-handed, m4/m5 have no sourced hand
  for (let i = 0; i < 120; i += 1) {
    const opp = ['m2', 'm3', 'm4', 'm5'][i % 4];
    rows.push(row('m1', opp, i % 3 ? 'A' : 'B', day(i * 2), { round: ['Q-1', '1', '3', 'Q', 'S', 'F'][i % 6], level: i % 5 ? null : 'grand_slam', surface: i % 2 ? 'clay' : 'hard' }));
    rows.push(row('m2', 'm3', i % 2 ? 'A' : 'B', day(i * 2)));
  }
  const L = rows.map((r) => ledgerEntry(r, tourOf)).filter(Boolean);
  L.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : 1));
  L.forEach((e, i) => { e.seq = i; });
  return { L, run: ratingRun(L) };
}
const splitSum = (o) => Object.values(o).reduce((t, x) => t + x.W + x.L, 0);

test('profile: every split sums to the ledger record; hand only where sourced; style archetypes stated unavailable', () => {
  const { L, run } = world();
  const mine = L.filter((e) => e.A === 'm1' || e.B === 'm1');
  const asOf = '2024-09-01';
  const p = buildProfile('m1', mine, asOf, { pre: run.pre, hand: new Map([['m2', 'left'], ['m3', 'right']]) });
  const total = mine.filter((e) => e.day < asOf).length;
  assert.equal(splitSum(p.vs_hand), total);
  assert.equal(splitSum(p.by_round), total);
  assert.equal(splitSum(p.by_level), total);
  assert.equal(splitSum(p.vs_strength), total);
  assert.ok(p.vs_hand.unknown.W + p.vs_hand.unknown.L > 0, 'opponents without a sourced hand are unknown, not guessed');
  assert.equal(p.vs_hand.left.W + p.vs_hand.left.L, mine.filter((e) => e.day < asOf && e.B === 'm2').length);
  assert.deepEqual(Object.keys(p.by_round).sort(), ['early', 'final', 'middle', 'qualifying', 'quarterfinal', 'semifinal']);
  assert.ok(p.by_level.grand_slam && p.by_level.unclassified, 'no level is invented for unclassified editions');
  assert.ok(PROFILE_DEFINITIONS.style_archetypes.startsWith('not available'));
  const early = buildProfile('m1', mine, '2024-01-20', { pre: run.pre });
  assert.ok(Object.values(early.by_round).some((x) => x.W + x.L < PROFILE_MIN), 'small splits are kept (flagged by the reader), not dropped');
});

test('profile: week windows read only matches before as_of and inside the window', () => {
  const { L, run } = world();
  const mine = L.filter((e) => e.A === 'm1' || e.B === 'm1');
  const asOf = '2024-05-01';
  const p = buildProfile('m1', mine, asOf, { pre: run.pre });
  for (const [k, w] of Object.entries(p.windows)) assert.equal(w.W + w.L, mine.filter((e) => e.day < asOf && e.day >= w.from).length, k);
  assert.ok(p.windows['5w'].W + p.windows['5w'].L <= p.windows['52w'].W + p.windows['52w'].L);
});

test('profile never changes Match DNA metrics (additive key only)', () => {
  const { L, run } = world();
  const mine = L.filter((e) => e.A === 'm1' || e.B === 'm1');
  const before = JSON.stringify(buildMatchDna('m1', mine, '2024-09-01', { pre: run.pre }).metrics);
  buildProfile('m1', mine, '2024-09-01', { pre: run.pre });
  assert.equal(JSON.stringify(buildMatchDna('m1', mine, '2024-09-01', { pre: run.pre }).metrics), before);
});

test('rating history: one point per month played (no idle-month interpolation), current point, 92-day inflections', () => {
  const h = ratingHistory([['2024-01-03', 1500, 25], ['2024-01-20', 1510, 26], ['2024-04-02', 1600, 30], ['2024-06-01', 1450, 40]], { value: 1470, rated_matches: 41 }, '2024-07-01');
  assert.deepEqual(h.series.map((x) => x[0]), ['2024-01', '2024-04', '2024-06', '2024-07']);
  assert.equal(h.series[0][1], 1500, 'the rating entering the first match of the month');
  assert.equal(h.peak.rating, 1600);
  assert.equal(h.gain_3m.change, 100);
  assert.equal(h.drop_3m.change, -150);
});

test('surface profile history uses the pre-match SURFACE ratings of that surface only', () => {
  const { L, run } = world();
  const clay = L.filter((e) => (e.A === 'm1' || e.B === 'm1') && e.surface === 'clay');
  const p = buildProfile('m1', clay, '2024-09-01', { pre: run.pre, run: run.pre, surface: 'clay', rating: { value: 1, rated_matches: 30 } });
  const first = run.pre.surface(clay[0]);
  assert.equal(p.rating_history.series[0][1], Math.round(clay[0].A === 'm1' ? first.sra : first.srb));
});

const wr = (pid, rating, extra = {}) => ({ pid, rating, n: 40, first_day: '2015-01-01', last_day: '2024-09-20', m30: 3, m90: 8, r30: { r: rating, n: 35 }, r90: { r: rating, n: 30 }, surf: {}, rank: null, ...extra });

test('players to watch: minimum samples enforced; inactive and provisional players never listed', () => {
  const rows = [
    wr('a', 1900, { r30: { r: 1800, n: 35 } }),
    wr('b', 1700, { r30: { r: 1750, n: 35 } }),
    wr('c', 1950, { r30: { r: 1700, n: 35 }, last_day: '2024-01-01' }), // inactive
    wr('d', 1800, { n: 12, r30: { r: 1500, n: 5 } }), // provisional
    wr('e', 1600, { r90: { r: 1400, n: 25 }, m90: 2 }), // too few matches for the 90-day list
    wr('f', 1650, { first_day: '2023-02-01' }),
    wr('g', 1500, { rank: { rank: 5 } }), wr('h', 2000, { rank: { rank: 90 } }), wr('i', 1800, { rank: { rank: 40 } }), wr('j', 2100, { rank: { rank: 500 } }),
    wr('s', 1600, { surf: { clay: { now: 1700, then: 1600, n_now: 20, n_then: 15, matches_90d: 4 }, grass: { now: 1700, then: 1500, n_now: 12, n_then: 8, matches_90d: 4 } } })
  ];
  const w = playersToWatch(rows, '2024-10-01', { published: true });
  assert.deepEqual(w.biggest_30d_change.risers.map((x) => x.pbe_player_id), ['a']);
  assert.deepEqual(w.biggest_30d_change.fallers.map((x) => x.pbe_player_id), ['b']);
  assert.deepEqual(w.fastest_rising_90d, []);
  assert.deepEqual(w.surface_risers_90d.clay.map((x) => x.pbe_player_id), ['s']);
  assert.deepEqual(w.surface_risers_90d.grass, [], 'surface rating below 10 rated matches at the start is not a riser');
  assert.deepEqual(w.emerging.map((x) => x.pbe_player_id), ['f']);
  // set = ranked inside the top 200 (g 5, i 40, h 90; j at 500 is outside): ranking order g,i,h; rating order h,i,g
  assert.equal(w.ranking_comparison_set, 3);
  assert.deepEqual(w.outperforming_ranking.map((x) => [x.pbe_player_id, x.ranking_gap]), [['h', 2]]);
  assert.deepEqual(w.underperforming_ranking.map((x) => [x.pbe_player_id, x.ranking_gap]), [['g', -2]]);
  const ids = new Set(JSON.stringify(w).match(/"pbe_player_id":"\w+"/g).map((x) => x.split(':')[1]));
  assert.ok(!ids.has('"c"') && !ids.has('"d"'));
});

test('players to watch: the weekly edition is frozen on Monday and never rewritten', async () => {
  const kv = new MemKV();
  await writeWatch(kv, { tours: { ATP: { watch: { x: 1 } } } }, '2024-09-30');
  await writeWatch(kv, { tours: { ATP: { watch: { x: 2 } } } }, '2024-09-30');
  assert.equal(JSON.parse(await kv.get('dna:v2:watch:week:2024-09-30')).tours.ATP.x, 1);
  assert.equal(JSON.parse(await kv.get('dna:v2:watch:current')).tours.ATP.x, 2);
  await writeWatch(kv, { tours: { ATP: { watch: { x: 3 } } } }, '2024-10-01');
  assert.equal(await kv.get('dna:v2:watch:week:2024-10-01'), null);
  assert.deepEqual(JSON.parse(await kv.get('dna:v2:watch:weeks')), ['2024-09-30']);
});
