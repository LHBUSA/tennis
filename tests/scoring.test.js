// TennisCast scoring contract fixtures (docs/TENNISCAST.md §Test suite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startMatch, applyPoint, replay, retire, walkover, suspend, resume, situation, pointLabels,
  compareProgress, assertNoRegression, parseScore, validateScore, formatScore, currentSet, inTiebreak, ScoringError
} from '../workers/shared/canonical/scoring.js';

const pts = (side, n) => Array(n).fill(side);
const game = (side) => pts(side, 4);
const games = (seq) => seq.flatMap((s) => game(s));
/** alternate holds starting with `first` for n games */
const holds = (first, n) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? first : first === 'A' ? 'B' : 'A'));
const play = (s, winners) => winners.reduce((st, w) => applyPoint(st, w), s);

test('6-4 set: winner, games, server rotation into set 2', () => {
  const s = replay('BO3_TB7', 'A', games(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'A']));
  assert.deepEqual(s.sets[0].games, { A: 6, B: 4 });
  assert.equal(s.sets[0].winner, 'A');
  assert.equal(s.sets_won.A, 1);
  assert.equal(s.sets.length, 2);
  assert.equal(s.server, 'A', '10 games played: A serves game 11');
});

test('7-5 set (5-5 does not end, 6-5 does not end)', () => {
  let s = replay('BO3_TB7', 'A', games(holds('A', 10)));
  assert.deepEqual(currentSet(s).games, { A: 5, B: 5 });
  s = play(s, game('A'));
  assert.equal(currentSet(s).winner, null, '6-5 is not a set');
  s = play(s, game('A'));
  assert.deepEqual(s.sets[0].games, { A: 7, B: 5 });
  assert.equal(s.sets[0].winner, 'A');
});

test('7-6 tiebreak: serve rotation 1-2-2, winner by two, next-set server', () => {
  let s = replay('BO3_TB7', 'A', games(holds('A', 12)));
  assert.deepEqual(currentSet(s).games, { A: 6, B: 6 });
  assert.ok(inTiebreak(s));
  assert.equal(s.server, 'A', 'game-13 server serves first tiebreak point');
  s = applyPoint(s, 'A'); assert.equal(s.server, 'B');
  s = applyPoint(s, 'B'); assert.equal(s.server, 'B');
  s = applyPoint(s, 'A'); assert.equal(s.server, 'A');
  s = play(s, ['A', 'B', 'A', 'B', 'A', 'B']); // 5-4
  s = play(s, ['B']); // 5-5
  s = play(s, ['A']); // 6-5
  assert.equal(currentSet(s).winner, null, '6-5 in tiebreak is not won');
  s = play(s, ['A']); // 7-5
  assert.deepEqual(s.sets[0].games, { A: 7, B: 6 });
  assert.deepEqual({ A: s.sets[0].tiebreak.A, B: s.sets[0].tiebreak.B }, { A: 7, B: 5 });
  assert.equal(s.server, 'B', 'side that received first in the tiebreak serves set 2');
  assert.equal(formatScore(s.sets.filter((x) => x.winner)), '7-6(5)');
});

test('tiebreak extends past 7 until a two-point lead', () => {
  let s = replay('BO3_TB7', 'B', games(holds('B', 12)));
  for (let i = 0; i < 6; i++) s = play(s, ['A', 'B']);
  assert.equal(currentSet(s).tiebreak.A, 6);
  s = play(s, ['A', 'B', 'A', 'B', 'B', 'B']); // 8-10
  assert.equal(s.sets[0].winner, 'B');
  assert.equal(formatScore([s.sets[0]]), '6-7(8)');
});

test('10-point match tiebreak in lieu of a third set (tour doubles)', () => {
  let s = startMatch('DOUBLES_TOUR', 'A');
  s = play(s, games(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'A'])); // 6-4 A
  s = play(s, games(['B', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'])); // 4-6
  assert.equal(s.sets_won.A, 1); assert.equal(s.sets_won.B, 1);
  assert.ok(currentSet(s).is_match_tiebreak && inTiebreak(s));
  s = play(s, [...pts('A', 9), ...pts('B', 8)]); // 9-8
  assert.equal(s.status, 'in_progress');
  s = play(s, ['A']); // 10-8
  assert.equal(s.status, 'completed');
  assert.equal(s.winner, 'A');
  assert.deepEqual(s.sets[2].games, { A: 1, B: 0 });
  assert.equal(formatScore(s.sets), '6-4 4-6 [10-8]');
});

test('five-set match with a 10-point final-set tiebreak (Grand Slam singles)', () => {
  let s = startMatch('BO5_FINAL_TB10', 'A');
  const setA = games(['A', 'A', 'A', 'A', 'A', 'A']);
  const setB = games(['B', 'B', 'B', 'B', 'B', 'B']);
  s = play(s, [...setA, ...setB, ...setA, ...setB]);
  assert.deepEqual(s.sets_won, { A: 2, B: 2 });
  s = play(s, games(holds(s.server, 12)));
  assert.ok(inTiebreak(s));
  s = play(s, pts('A', 7));
  assert.equal(s.status, 'in_progress', '7-0 does not win a 10-point tiebreak');
  s = play(s, pts('A', 3));
  assert.equal(s.status, 'completed');
  assert.deepEqual(s.sets[4].games, { A: 7, B: 6 });
  assert.equal(s.sets[4].tiebreak.A, 10);
});

test('break of serve: break point is flagged and conversion changes games against serve', () => {
  let s = startMatch('BO3_TB7', 'A');
  s = play(s, ['B', 'B', 'A', 'B']); // 15-40 on A serve
  assert.deepEqual(pointLabels(s), { A: '15', B: '40' });
  assert.equal(situation(s).break_point, 'B');
  s = applyPoint(s, 'B');
  assert.deepEqual(currentSet(s).games, { A: 0, B: 1 });
  assert.equal(s.server, 'B');
});

test('love game labels 0/15/30/40', () => {
  let s = startMatch('BO3_TB7', 'B');
  const seen = [];
  for (let i = 0; i < 3; i++) { s = applyPoint(s, 'B'); seen.push(pointLabels(s).B); }
  assert.deepEqual(seen, ['15', '30', '40']);
  s = applyPoint(s, 'B');
  assert.deepEqual(currentSet(s).games, { A: 0, B: 1 });
  assert.deepEqual(pointLabels(s), { A: '0', B: '0' });
});

test('deuce / advantage cycles', () => {
  let s = startMatch('BO3_TB7', 'A');
  s = play(s, ['A', 'A', 'A', 'B', 'B', 'B']);
  assert.deepEqual(pointLabels(s), { A: '40', B: '40' });
  for (let i = 0; i < 5; i++) {
    s = applyPoint(s, 'A'); assert.deepEqual(pointLabels(s), { A: 'AD', B: '40' });
    s = applyPoint(s, 'B'); assert.deepEqual(pointLabels(s), { A: '40', B: '40' });
  }
  s = applyPoint(s, 'B'); assert.deepEqual(pointLabels(s), { A: '40', B: 'AD' });
  assert.equal(situation(s).break_point, 'B');
  s = applyPoint(s, 'B');
  assert.deepEqual(currentSet(s).games, { A: 0, B: 1 });
});

test('no-ad: deciding point at deuce', () => {
  let s = startMatch('DOUBLES_TOUR', 'A');
  s = play(s, ['A', 'B', 'A', 'B', 'A', 'B']);
  assert.equal(situation(s).break_point, 'B', 'receiver has a deciding break point');
  s = applyPoint(s, 'B');
  assert.deepEqual(currentSet(s).games, { A: 0, B: 1 });
});

test('retirement mid-game preserves the exact partial score; reason not inferred', () => {
  let s = startMatch('BO3_TB7', 'A');
  s = play(s, games(['A', 'B', 'A']));
  s = play(s, ['A', 'A', 'B']); // 30-15
  const r = retire(s, 'B');
  assert.equal(r.status, 'retired');
  assert.equal(r.winner, 'A');
  assert.equal(r.end_reason, 'retirement');
  assert.equal(r.retirement_reason, undefined);
  assert.deepEqual(r.game, { A: 2, B: 1 });
  assert.deepEqual(currentSet(r).games, { A: 2, B: 1 });
  assert.throws(() => applyPoint(r, 'A'), ScoringError);
});

test('retirement between sets', () => {
  let s = startMatch('BO3_TB7', 'A');
  s = play(s, games(Array(6).fill('B')));
  assert.deepEqual(currentSet(s).games, { A: 0, B: 0 });
  const r = retire(s, 'B');
  assert.equal(r.winner, 'A', 'B led by a set and retired: A wins');
  const v = validateScore(parseScore('0-6 RET', 'BO3_TB7'), 'BO3_TB7');
  assert.ok(v.ok, v.errors.join());
  assert.equal(v.winner, null, 'winner of a terminated match is a source fact');
});

test('walkover: no games, winner is the side that did not withdraw', () => {
  const w = walkover('BO3_TB7', 'B');
  assert.equal(w.status, 'walkover');
  assert.equal(w.winner, 'A');
  assert.equal(w.sets.length, 0);
  assert.ok(validateScore(parseScore('W/O', 'BO3_TB7'), 'BO3_TB7').ok);
  assert.ok(!validateScore(parseScore('6-4 W/O', 'BO3_TB7'), 'BO3_TB7').ok, 'games played => retirement, not walkover');
});

test('suspended then resumed next day continues from the identical state', () => {
  let s = startMatch('BO3_TB7', 'A');
  s = play(s, games(['A', 'B', 'A', 'B']));
  s = play(s, ['A']);
  const susp = suspend(s, 'rain');
  assert.equal(susp.status, 'suspended');
  assert.equal(susp.suspension_reason, 'rain');
  assert.throws(() => applyPoint(susp, 'A'), ScoringError);
  const res = resume(susp);
  assert.equal(res.status, 'in_progress');
  assert.deepEqual(res.game, s.game);
  assert.deepEqual(res.sets, s.sets);
  assert.equal(res.server, s.server);
  assert.equal(compareProgress(s, res), 0);
});

test('state never moves backward without a documented correction; deuce cycles are not regressions', () => {
  const a = replay('BO3_TB7', 'A', games(['A', 'B', 'A']));
  const b = applyPoint(a, 'A');
  assert.equal(compareProgress(a, b), 1);
  assert.throws(() => assertNoRegression(b, a), /state_regression/);
  assert.ok(assertNoRegression(b, a, { correction: { source: 'wta', reason: 'umpire overrule' } }).ok);
  let d = replay('BO3_TB7', 'A', ['A', 'A', 'A', 'B', 'B', 'B', 'A']); // AD-40
  const back = applyPoint(d, 'B'); // deuce again
  assert.equal(compareProgress(d, back), 0);
});

test('parseScore: derived winner tiebreak points follow the set format', () => {
  const p = parseScore('6-4 7-6(5)', 'BO3_TB7');
  assert.deepEqual(p.sets[1].tiebreak, { A: 7, B: 5, winner_points_derived: true });
  const slam = parseScore('6-3 3-6 6-4 4-6 7-6(8)', 'BO5_FINAL_TB10');
  assert.deepEqual(slam.sets[4].tiebreak, { A: 10, B: 8, winner_points_derived: true });
  assert.ok(validateScore(slam, 'BO5_FINAL_TB10').ok);
  const full = parseScore('6-7(7-9) 7-6(7-3)', 'BO3_TB7');
  assert.equal(full.sets[0].tiebreak.winner_points_derived, false);
});

test('validateScore accepts legal and rejects illegal lines', () => {
  const ok = (line, f) => validateScore(parseScore(line, f), f);
  assert.ok(ok('6-4 3-6 6-7(7) 7-6(3) 70-68', 'BO5_FINAL_ADV').ok, 'advantage final set');
  assert.equal(ok('6-4 3-6 6-7(7) 7-6(3) 70-68', 'BO5_FINAL_ADV').winner, 'A');
  assert.ok(ok('7-6 7-6', 'BO3_TB7').ok);
  assert.ok(ok('6-2 3-6 [10-7]', 'DOUBLES_TOUR').ok);
  assert.ok(ok('6-2 3-6 10-7', 'DOUBLES_TOUR').ok, 'match tiebreak without brackets');
  assert.ok(ok('6-2 3-1 RET', 'BO3_TB7').ok);
  assert.ok(!ok('6-5 6-4', 'BO3_TB7').ok, '6-5 is not a set');
  assert.ok(!ok('8-6 6-4', 'BO3_TB7').ok, '8-6 impossible with a tiebreak at 6-6');
  assert.ok(!ok('6-4 6-4 6-4', 'BO3_TB7').ok, 'set after match decided');
  assert.ok(!ok('6-4 4-6', 'BO3_TB7').ok, 'unfinished completed match');
  assert.ok(!ok('6-4 7-6(5-7)', 'BO3_TB7').ok, 'tiebreak winner disagrees with games');
  assert.ok(!ok('6-4 7-6(9-8)', 'BO3_TB7').ok, 'extended tiebreak must end by two');
  assert.ok(!ok('6-4 3-6 7-6(8-6)', 'BO3_FINAL_TB10').ok, 'final-set tiebreak is to 10');
  assert.ok(!ok('6-4 6-4 RET', 'BO3_TB7').ok, 'retirement after match decided');
  assert.throws(() => parseScore('6-4 banana', 'BO3_TB7'), /unparseable/);
});

test('formatScore round-trips canonical lines', () => {
  for (const [line, f] of [['6-4 7-6(5)', 'BO3_TB7'], ['6-2 3-6 [10-7]', 'DOUBLES_TOUR'], ['6-2 3-1 RET', 'BO3_TB7']]) {
    const p = parseScore(line, f);
    assert.equal(formatScore(p.sets, p.end_reason), line);
  }
});

test('situation: set point and match point', () => {
  let s = startMatch('BO3_TB7', 'A');
  s = play(s, games(['A', 'A', 'A', 'A', 'A']));
  s = play(s, ['A', 'A', 'A']);
  assert.deepEqual(situation(s).set_point, ['A']);
  s = applyPoint(s, 'A');
  s = play(s, games(['A', 'A', 'A', 'A', 'A']));
  s = play(s, ['A', 'A', 'A']);
  assert.deepEqual(situation(s).match_point, ['A']);
  assert.deepEqual(situation(s).set_point, []);
});

test('deciding-set tiebreak at 12-12 (Wimbledon 2019-2021): 13-12 with a tiebreak is valid, 7-6 in the fifth is not a tiebreak set', async () => {
  const { parseScore, validateScore } = await import('../workers/shared/canonical/scoring.js');
  const ok = validateScore(parseScore('6-4 3-6 6-3 3-6 13-12(3)', 'BO5_FINAL_TB7_AT12'), 'BO5_FINAL_TB7_AT12');
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.winner, 'A');
  const bad = validateScore(parseScore('6-4 3-6 6-3 3-6 7-6(3)', 'BO5_FINAL_TB7_AT12'), 'BO5_FINAL_TB7_AT12');
  assert.equal(bad.ok, false, 'a 7-6 deciding set is not finished under 12-12 rules');
  const normal = validateScore(parseScore('7-6(3) 6-4 6-4', 'BO5_FINAL_TB7_AT12'), 'BO5_FINAL_TB7_AT12');
  assert.equal(normal.ok, true, 'earlier sets still tiebreak at 6-6');
});
