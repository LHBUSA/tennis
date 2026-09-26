// PBEcast truth tests: snapshots never become points; nothing unobserved is fabricated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots, aoPointEvents, classifyReason, keyMoments, matchControl, inTiebreakScore, POINT_TYPES, engineStateOf } from '../workers/shared/canonical/events.js';

const st = (sets, point = null, server = null, status = 'in_progress') => ({ status, sets: sets.map(([A, B, tb]) => ({ A, B, tb: tb || null, mtb: false })), point: point ? { A: point[0], B: point[1] } : null, server });

test('a large jump between snapshots is ONE score_snapshot event, never synthetic points', () => {
  const e = diffSnapshots(st([[4, 3]], ['15', '0'], 'A'), st([[4, 3]], ['40', '30'], 'A'), 'BO3_TB7');
  assert.equal(e.quality, 'score_snapshot');
  assert.equal(e.event_type, 'score_update');
  assert.equal(e.winner_side, null, 'no point winner from snapshots');
  assert.deepEqual(e.event_detail.from.point, '15–0');
  assert.deepEqual(e.event_detail.to.point, '40–30');
  assert.ok(!POINT_TYPES.includes(e.event_type));
});

test('game won + hold/break only when provable (one game added, server observed before)', () => {
  const brk = diffSnapshots(st([[4, 3]], ['30', '40'], 'A'), st([[4, 4]], ['0', '0'], 'B'), 'BO3_TB7');
  assert.equal(brk.event_type, 'break');
  assert.equal(brk.winner_side, 'B');
  assert.equal(brk.event_detail.game_won.result, 'break');
  const noServer = diffSnapshots(st([[4, 3]], ['30', '40'], null), st([[4, 4]], ['0', '0'], null), 'BO3_TB7');
  assert.equal(noServer.event_type, 'game_won');
  assert.equal(noServer.event_detail.game_won.result, undefined, 'unknown server: GAME, not HOLD/BREAK');
  const two = diffSnapshots(st([[4, 3]], ['0', '0'], 'A'), st([[5, 4]], ['0', '0'], 'A'), 'BO3_TB7');
  assert.equal(two.event_type, 'score_update');
  assert.equal(two.event_detail.game_won, undefined, 'two games between observations: no winner attributed');
  assert.equal(two.event_detail.games_between_observations, 2);
});

test('set won, tiebreak start, observed set/match point, match end', () => {
  const set = diffSnapshots(st([[5, 4]], ['40', '15'], 'A'), st([[6, 4], [0, 0]], ['0', '0'], 'B'), 'BO3_TB7');
  assert.equal(set.event_type, 'set_won');
  assert.deepEqual(set.event_detail.sets_won, [{ set: 1, winner: 'A', score: '6-4' }]);
  const tb = diffSnapshots(st([[6, 6]], ['0', '0'], 'A'), st([[6, 6]], ['2', '1'], 'B'), 'BO3_TB7');
  assert.equal(tb.event_type, 'tiebreak');
  const mp = diffSnapshots(st([[6, 4], [5, 3]], ['15', '0'], 'A'), st([[6, 4], [5, 3]], ['40', '0'], 'A'), 'BO3_TB7');
  assert.deepEqual(mp.event_detail.observed_situation.match_point, ['A']);
  const end = diffSnapshots(st([[6, 4], [5, 3]], ['40', '0'], 'A'), st([[6, 4], [6, 3]], null, null, 'completed'), 'BO3_TB7');
  assert.equal(end.event_type, 'match_end');
  const ret = diffSnapshots(st([[6, 4], [2, 1]], ['15', '0'], 'A'), st([[6, 4], [2, 1]], null, null, 'retired'), 'BO3_TB7');
  assert.equal(ret.event_type, 'retired');
  assert.equal(diffSnapshots(st([[4, 3]], ['15', '0'], 'A'), st([[4, 3]], ['15', '0'], 'A'), 'BO3_TB7'), null, 'no change => no event');
});

test('unknown coordinates / serve speed never appear on snapshot events', () => {
  const e = diffSnapshots(null, st([[1, 0]], ['15', '0'], 'A'), 'BO3_TB7');
  assert.equal(e.event_type, 'observation_start');
  for (const k of ['serve_speed_kmh', 'rally_length', 'coordinates', 'serve_number']) assert.equal(e[k], undefined);
});

test('tiebreak numbering detection and unrebuildable states', () => {
  assert.ok(inTiebreakScore({ A: '3', B: '5' }));
  assert.ok(!inTiebreakScore({ A: '40', B: 'AD' }));
  assert.equal(engineStateOf(st([[2, 1]], ['15', '0'], null), 'BO3_TB7'), null, 'no server => no situation derivation');
});

// Synthetic AO-shaped feed: 2 players, A (team 1) serves first. Server-first score strings.
function feed(points, firstServerName = 'A. Alpha') {
  const rows = [];
  let g = 1;
  let p = 0;
  rows.push({ id: `X-001-001-000`, type: 'serve', commentary: `${firstServerName} is serving game 1`, set: 1, winner: null, score: '' });
  for (const pt of points) {
    if (pt.newGame) { g += 1; p = 0; rows.push({ id: `X-001-${String(g).padStart(3, '0')}-000`, type: 'serve', commentary: `${pt.newGame} is serving game ${g}`, set: 1, winner: null, score: '' }); continue; }
    p += 1;
    rows.push({ id: `X-001-${String(g).padStart(3, '0')}-${String(p).padStart(3, '0')}`, type: pt.type || 'point', commentary: pt.text, set: 1, winner: pt.w, score: pt.score, timestamp: 1768700000 + p });
  }
  return rows;
}
const opts = { formatKey: 'BO3_TB7', sideOfTeam: (t) => (t === 1 ? 'A' : t === 2 ? 'B' : null), nameSide: (n) => (/Alpha/.test(n) ? 'A' : /Beta/.test(n) ? 'B' : null) };

test('AO point feed: genuine point events with reasons, replayed and cross-checked', () => {
  const ev = aoPointEvents(feed([
    { w: 1, text: 'A. Alpha wins the point with an Ace', score: '15 - 0' },
    { w: 2, text: 'A. Alpha loses the point with a Double Fault', score: '15 - 15' },
    { w: 1, text: 'A. Alpha wins the point with a Forehand Winner', score: '30 - 15' },
    { w: 1, text: 'B. Beta loses the point with a Backhand Unforced Error', score: '40 - 15' },
    { w: 1, text: 'B. Beta loses the point with a Forehand Forced Error', score: 'Game', type: 'game' },
    { newGame: 'B. Beta' },
    { w: 2, text: 'B. Beta wins the point with a Service Winner', score: '15 - 0' }
  ]), opts);
  assert.deepEqual(ev.map((e) => e.event_type), ['ace', 'double_fault', 'winner', 'unforced_error', 'forced_error', 'service_winner']);
  assert.ok(ev.every((e) => e.quality === 'point_event'));
  assert.equal(ev[2].event_detail.stroke, 'forehand');
  assert.deepEqual(ev[4].state.sets[0], { A: 1, B: 0, tb: null, mtb: false });
  assert.equal(ev[5].server_side, 'B');
  assert.deepEqual(ev[5].state.point, { A: '0', B: '15' });
  for (const e of ev) { assert.equal(e.serve_speed_kmh, undefined); assert.equal(e.coordinates, undefined); }
});

test('AO feed that disagrees with the engine is rejected whole, never partially stored', () => {
  assert.throws(() => aoPointEvents(feed([{ w: 1, text: 'x', score: '0 - 15' }]), opts), /score mismatch/);
  assert.throws(() => aoPointEvents(feed([{ w: 2, text: 'A. Alpha wins the point with an Ace', score: '0 - 15' }]), opts), /ace by receiver/);
  assert.throws(() => aoPointEvents(feed([{ w: 1, text: 'x', score: '15 - 0' }], 'Z. Nobody'), opts), /first server/);
});

test('unrecognised reasons stay plain points; never invented', () => {
  assert.deepEqual(classifyReason('Something odd happened'), { type: 'point', stroke: null });
  assert.equal(classifyReason('X wins the point with a Backhand Volley Winner').type, 'winner');
});

test('key moments and match control only from carried facts; control is descriptive', () => {
  const evs = [
    { event_id: 'e1', event_detail: { game_won: { winner: 'A', result: 'hold' } } },
    { event_id: 'e2', event_detail: { game_won: { winner: 'B', result: 'break' } } },
    { event_id: 'e3', event_detail: { game_won: { winner: 'B', result: 'hold' } } },
    { event_id: 'e4', event_detail: { game_won: { winner: 'A' } } },
    { event_id: 'e5', event_detail: { sets_won: [{ set: 1, winner: 'B', score: '4-6' }] } }
  ];
  const km = keyMoments(evs);
  assert.deepEqual(km.map((k) => k.kind), ['BREAK', 'SET']);
  const c = matchControl(evs);
  assert.equal(c.A + c.B, 100);
  assert.match(c.definition, /not a win probability/);
  assert.equal(matchControl(evs.slice(0, 2)), null, 'too few known games');
});
