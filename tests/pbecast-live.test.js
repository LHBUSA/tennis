// PBEcast live entry (owner brief): /pbecast opens a live court when one exists, deterministically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveEntry, orderLive, switcherItems, isLive } from '../src/lib/pbecast-live.js';
import { __test as pbc } from '../src/pages/pbecast.js';

const m = (id, over = {}) => ({ id, status: 'in_progress', event_type: 'WS', round: 'M-2', tournament: { level: 'WTA 250', name: 'T' }, ...over });

test('zero live matches -> the replay hub (never an invented live state)', () => {
  assert.deepEqual(liveEntry([]), { mode: 'hub' });
  assert.deepEqual(liveEntry([m('a', { status: 'completed' }), m('b', { status: 'scheduled' })]), { mode: 'hub' });
});

test('one live match -> straight into its court, no switcher', () => {
  const e = liveEntry([m('only')]);
  assert.equal(e.mode, 'live');
  assert.equal(e.path, '/pbecast/only');
  assert.equal(e.switcher, false);
  assert.deepEqual(switcherItems([m('only')], 'only'), []);
});

test('multiple live -> first deterministic court + switcher; order is stable under any input order', () => {
  const list = [m('z-250', { tournament: { level: 'WTA 250' } }), m('slam-r2', { tournament: { level: 'Grand Slam' } }), m('slam-sf', { round: 'M-S', tournament: { level: 'Grand Slam' } }), m('d', { event_type: 'WD', round: 'M-S', tournament: { level: 'Grand Slam' } })];
  const e = liveEntry(list);
  assert.equal(e.id, 'slam-sf', 'deepest round at the highest level, singles first');
  assert.equal(e.switcher, true);
  for (let i = 0; i < 5; i += 1) assert.equal(liveEntry(list.slice().reverse().sort(() => (i % 2 ? 1 : -1))).id, 'slam-sf', 'refresh never swaps the featured court');
  assert.deepEqual(orderLive(list).map((x) => x.id), ['slam-sf', 'd', 'slam-r2', 'z-250']);
});

test('switching courts: items link to /pbecast/:id and the current one follows the URL', () => {
  const list = [m('a', { tournament: { level: 'WTA 500' } }), m('b')];
  const onA = switcherItems(list, 'a');
  assert.deepEqual(onA.map((x) => [x.href, x.current]), [['/pbecast/a', true], ['/pbecast/b', false]]);
  const onB = switcherItems(list, 'b');
  assert.equal(onB.find((x) => x.current).id, 'b');
  assert.deepEqual(switcherItems(list, 'finished-match').map((x) => x.current), [false, false], 'a replay viewer is offered the live courts');
});

test('completed and suspended matches are never labelled live; observed-live never claims point-by-point', () => {
  assert.equal(isLive(m('x', { status: 'completed' })), false);
  assert.equal(isLive(m('x', { status: 'suspended' })), false);
  assert.equal(isLive(m('x', { status: 'retired' })), false);
  assert.equal(liveEntry([m('s', { status: 'suspended' })]).mode, 'hub');
  assert.ok(!/point/i.test(pbc.MODE_LABEL.observed_live), pbc.MODE_LABEL.observed_live);
  assert.match(pbc.MODE_LABEL.point_by_point_live, /point/i);
});
