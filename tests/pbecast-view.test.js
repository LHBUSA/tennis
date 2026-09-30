// PBEcast presentation derivations (src/lib/pbecast-view.js): display-only grouping, provable games, pulse facts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupMoments, groupTransition, gamesFrom, setsWon, liveContext, pulse } from '../src/lib/pbecast-view.js';

const S = (a, b, point, server = 'A', status = 'in_progress') => ({ sets: [{ A: a, B: b, tb: null, mtb: false }], point, server, status });
const upd = (id, games, from, to, st) => ({ event_id: id, event_type: 'score_update', quality: 'score_snapshot', observed_at: `2026-09-30T14:${id}:00Z`, state: st, event_detail: { from: { games, point: from }, to: { games, point: to } } });
// shaped like the observed Beijing feed (fa749741…): five point changes at 5-3, then the break to 5-4
const EVS = [
  upd('10', '5-3', '0–0', '15–0', S(5, 3, { A: '15', B: '0' })),
  upd('11', '5-3', '15–0', '15–15', S(5, 3, { A: '15', B: '15' })),
  upd('12', '5-3', '15–15', '40–15', S(5, 3, { A: '40', B: '15' })),
  upd('13', '5-3', '40–15', '40–40', S(5, 3, { A: '40', B: '40' })),
  upd('14', '5-3', '40–40', '40–Av', S(5, 3, { A: '40', B: 'Av' })),
  { event_id: '15', event_type: 'break', quality: 'score_snapshot', state: S(5, 4, { A: '0', B: '0' }, 'B'), event_detail: { from: { games: '5-3', point: '40–Av' }, to: { games: '5-4', point: '0–0' }, game_won: { set: 1, game: 9, result: 'break', server: 'A', winner: 'B' } } },
  upd('16', '5-4', '0–0', '0–15', S(5, 4, { A: '0', B: '15' }, 'B')),
  { event_id: '17', event_type: 'game_won', quality: 'score_snapshot', state: S(5, 5, { A: '0', B: '0' }), event_detail: { game_won: { set: 1, game: 10, result: 'hold', server: 'B', winner: 'B' } } }
];

test('consecutive observed score updates in one game collapse to one row; the events are untouched', () => {
  const before = JSON.stringify(EVS);
  const g = groupMoments(EVS, EVS.length - 1);
  assert.equal(JSON.stringify(EVS), before, 'underlying events are never mutated');
  assert.deepEqual(g.map((x) => [x.event.event_id, x.count]), [['17', 1], ['16', 1], ['15', 1], ['14', 5]]);
  assert.equal(g[0].current, true);
  assert.equal(groupTransition(EVS, g[3]), '0–0 → 40–Av', 'first "from" to last "to"');
  assert.equal(g.reduce((n, x) => n + x.count, 0), EVS.length, 'every event is represented exactly once');
});

test('grouping follows the viewer position (replay) and never merges across a game change or another event type', () => {
  const g = groupMoments(EVS, 2);
  assert.deepEqual(g.map((x) => [x.first, x.last, x.count]), [[0, 2, 3]]);
  const split = groupMoments([EVS[0], EVS[6]], 1);
  assert.equal(split.length, 2, 'different game scores stay separate');
});

test('games: only provable winners; holds / breaks and sets from the served state', () => {
  const games = gamesFrom(EVS, EVS.length - 1);
  assert.deepEqual(games.map((x) => [x.game, x.winner, x.result]), [[9, 'B', 'break'], [10, 'B', 'hold']]);
  const p = pulse({ events: EVS, statistics: null }, EVS.at(-1).state, EVS.length - 1);
  assert.deepEqual(p.rows.map((r) => [r.key, r.A, r.B]), [['holds', '0/1', '1/1'], ['breaks', '0/1', '1/1']]);
  assert.equal(p.basis, 2);
  assert.deepEqual(p.facts.map((f) => [f.key, f.value]), [['sets', '0–0'], ['set_now', '5–5 · G11'], ['games', '10']]);
  assert.ok(!p.rows.some((r) => r.key === 'aces'), 'no statistics rows without published statistics');
});

test('pulse statistics only from published numbers; missing stays a dash', () => {
  const st = { A: { aces: 3, double_faults: 1, service_points: 40, first_serves_in: 26, first_serve_points_won: 19, second_serve_points_won: 7, break_points_faced: 4, break_points_saved: 3 }, B: { aces: null, double_faults: 2, service_points: 38, first_serves_in: 20, first_serve_points_won: 12, second_serve_points_won: 9, break_points_faced: 0 } };
  const p = pulse({ events: [], statistics: st }, S(3, 2, null), -1);
  const row = (k) => p.rows.find((r) => r.key === k);
  assert.deepEqual([row('aces').A, row('aces').B], [3, '—']);
  assert.deepEqual([row('first_won').A, row('second_won').A], ['73%', '50%']);
  assert.deepEqual([row('bp_saved').A, row('bp_saved').B], ['3/4', '—']);
});

test('context: set / game / tiebreak from the state; nothing claimed when final', () => {
  assert.deepEqual(liveContext(S(5, 5, { A: '0', B: '15' })), { set: 1, game: 11, tiebreak: false });
  assert.deepEqual(liveContext(S(6, 6, { A: '3', B: '2' })), { set: 1, game: null, tiebreak: true });
  assert.equal(liveContext(S(6, 4, null, null, 'completed')), null);
  assert.equal(setsWon({ status: 'completed', sets: [{ A: 6, B: 4 }, { A: 3, B: 6 }, { A: 7, B: 6, tb: { A: 7, B: 5 } }] }, 'A'), 2);
});

test('landscape court is the same drawing rotated (no mirror): identical elements, swapped viewBox', async () => {
  const { courtSvg, COURT_VIEWBOX } = await import('../src/ui/court.js');
  const m = { server: 'A', point: { A: '15', B: '0' }, serveIndicator: true, surface: 'hard' };
  const p = String(courtSvg(m));
  const l = String(courtSvg({ ...m, landscape: true }));
  const inner = (s) => s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/^<g transform="[^"]*">/, '').replace(/<\/g>$/, '');
  assert.equal(inner(l), inner(p), 'geometry, serve indicator and service box are byte-identical');
  assert.match(l, new RegExp(`viewBox="0 0 ${COURT_VIEWBOX.h.toFixed(2)} ${COURT_VIEWBOX.w.toFixed(2)}"`));
  // matrix(0 1 -1 0 e 0) has determinant +1: a rotation, never a reflection
  assert.match(l, /<g transform="matrix\(0 1 -1 0 [\d.]+ 0\)">/);
  assert.ok(!/class="c-ball"/.test(l), 'still no tracked ball without coordinates');
});
