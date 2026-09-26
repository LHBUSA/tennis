// Simulator truth tests: the exact Markov solver and the Monte Carlo (canonical scoring engine) agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdProb, tiebreakProb, exact, simulate, pointModel, rng } from '../workers/shared/sim/engine.js';

test('hold probability: closed form matches known values and symmetry', () => {
  assert.equal(holdProb(0.5), 0.5);
  assert.ok(Math.abs(holdProb(0.6) - 0.7357) < 1e-4);
  assert.ok(Math.abs(holdProb(0.5, true) - 0.5) < 1e-12);
  assert.ok(holdProb(0.65, true) < holdProb(0.65), 'no-ad deciding point lowers holds for the stronger server');
});

test('tiebreak and match are fair at equal strength, and monotone in serve strength', () => {
  assert.ok(Math.abs(tiebreakProb(0.62, 0.62, 7, 'A') - 0.5) < 1e-9);
  assert.ok(Math.abs(exact({ pA: 0.62, pB: 0.62, format: 'BO5_FINAL_TB10' }).p_a_wins - 0.5) < 1e-9);
  const a = exact({ pA: 0.62, pB: 0.60 }).p_a_wins;
  const b = exact({ pA: 0.64, pB: 0.60 }).p_a_wins;
  assert.ok(a > 0.5 && b > a);
  const d = exact({ pA: 0.63, pB: 0.58 });
  assert.ok(Math.abs(Object.values(d.set_scores).reduce((x, y) => x + y, 0) - 1) < 1e-9, 'set-score distribution sums to 1');
});

for (const format of ['BO3_TB7', 'BO5_FINAL_TB10', 'DOUBLES_TOUR', 'BO3_FINAL_ADV']) {
  test(`Monte Carlo on the canonical engine agrees with the exact solver (${format})`, () => {
    const pA = 0.64;
    const pB = 0.59;
    const ex = exact({ pA, pB, format, firstServer: 'A' });
    const mc = simulate({ pA, pB, format, iterations: 2000, seed: 7, firstServer: 'A' });
    assert.ok(Math.abs(mc.p_a_wins - ex.p_a_wins) < 4 * mc.se + 1e-3, `${mc.p_a_wins} vs ${ex.p_a_wins}`);
    assert.ok(Math.abs(mc.p_any_tiebreak - ex.p_any_tiebreak) < 0.04);
  });
}

test('seeded: same seed, same answer; different seed, different stream', () => {
  const a = simulate({ pA: 0.6, pB: 0.58, iterations: 300, seed: 42 });
  const b = simulate({ pA: 0.6, pB: 0.58, iterations: 300, seed: 42 });
  assert.deepEqual(a, b);
  assert.notEqual(rng(1)(), rng(2)());
});

test('point model: no data -> tour mean (fair); shrinkage bounds a tiny sample', () => {
  const none = pointModel({ a: {}, b: {} });
  assert.equal(none.pA, none.pB);
  const tiny = pointModel({ a: { serve_won: 0.9, serve_n: 20 }, b: {} });
  assert.ok(tiny.pA < 0.6, 'twenty points cannot make a player a 90% server');
});
