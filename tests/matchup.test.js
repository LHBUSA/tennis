// Phase 6 Matchup DNA: the probability is the validated PBE Rating model's, withheld outside its backtested
// range; context blocks never feed it; H2H is not a model feature; nothing is estimated where unsourced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelBlock, contextBlock, restBlock, serveReturn, MIN_PRIOR } from '../workers/tennis-api/src/matchup.js';

const band = (i, n, pred, obs) => ({ from: 0.5 + i * 0.05, to: 0.55 + i * 0.05, matches: n, predicted: pred, observed: obs });
const table = (n) => Array.from({ length: 10 }, (_, i) => band(i, n, 0.52 + i * 0.05, 0.5 + i * 0.05));
const tour = (extra = {}) => ({ published: true, surface_published: true, variant: 'standard', backtest: { standard: { matches: 90000, accuracy: 0.66, log_loss: 0.61, brier: 0.21, calibration: { overall: { all: table(5000), clay: table(900) }, surface_blend: { all: table(3000), clay: table(400) } } } }, ...extra });
const snap = (value, n, surf = {}) => ({ all: { r: { value, rated_matches: n, provisional: n < 20 }, w: surf.w || null, wae: null, aor: null }, ...Object.fromEntries(Object.entries(surf).filter(([k]) => k !== 'w').map(([k, v]) => [k, { r: v }])) });

test('probability = Elo expectation of the stored ratings; symmetric; model version and calibration attached', () => {
  const m = modelBlock(tour(), snap(1900, 80), snap(1700, 60), null);
  assert.equal(m.status, 'published');
  assert.equal(m.basis, 'overall');
  assert.equal(m.probability.A, Math.round((1 / (1 + 10 ** (-200 / 400))) * 1000) / 1000);
  assert.equal(Math.round((m.probability.A + m.probability.B) * 1000), 1000);
  assert.equal(m.model.variant, 'standard');
  assert.equal(m.confidence.similar_matches.all_surfaces.matches, 5000);
  assert.equal(m.confidence.level, 'standard');
});

test('withheld: tour not validated; either player below the backtested minimum; no rating', () => {
  assert.equal(modelBlock(tour({ published: false }), snap(1900, 80), snap(1700, 60), null).probability, null);
  const x = modelBlock(tour(), snap(1900, 80), snap(1700, MIN_PRIOR - 1), null);
  assert.equal(x.status, 'insufficient_history');
  assert.equal(x.probability, null);
  assert.ok(x.rating_edge, 'the rating edge is still shown as a fact');
  assert.equal(modelBlock(tour(), snap(1900, 80), undefined, null).status, 'no_rating');
});

test('surface blend only when the surface is sourced, the tour surface model is validated and both have 5+ surface matches', () => {
  const a = snap(1800, 80, { clay: { value: 1950, rated_matches: 30 } });
  const b = snap(1800, 80, { clay: { value: 1650, rated_matches: 30 } });
  const blend = modelBlock(tour(), a, b, 'clay');
  assert.equal(blend.basis, 'surface_blend');
  assert.ok(blend.probability.A > 0.5 && blend.overall_probability.A === 0.5);
  assert.equal(blend.confidence.similar_matches.same_surface.matches, 400, 'similar matches from the same surface');
  assert.equal(modelBlock(tour(), a, b, null).basis, 'overall', 'unsourced surface: overall only');
  assert.equal(modelBlock(tour({ surface_published: false }), a, b, 'clay').basis, 'overall');
  const thin = snap(1800, 80, { clay: { value: 1650, rated_matches: 4 } });
  assert.equal(modelBlock(tour(), a, thin, 'clay').basis, 'overall');
});

test('provisional player and thin calibration band lower the stated confidence', () => {
  assert.equal(modelBlock(tour(), snap(1900, 15), snap(1700, 60), null).confidence.level, 'provisional');
  const t = tour();
  t.backtest.standard.calibration.overall.all = table(50);
  assert.equal(modelBlock(t, snap(1900, 80), snap(1700, 60), null).confidence.level, 'thin_history');
});

test('context never changes the probability; form edge needs 10 rated matches for both players', () => {
  const w = (wae, n) => ({ '10w': { W: 5, L: 1, wae, n_rated: n }, '52w': { W: 30, L: 10, wae, n_rated: n } });
  const a = snap(1900, 80, { w: w(0.12, 40) });
  const b = snap(1700, 60, { w: w(-0.02, 8) });
  const c = contextBlock(a, b, null);
  assert.equal(c.form['52w'].wae_edge, null);
  assert.ok(c.form['52w'].note);
  const b2 = snap(1700, 60, { w: w(-0.02, 12) });
  assert.equal(contextBlock(a, b2, null).form['52w'].wae_edge, 0.14);
  assert.deepEqual(modelBlock(tour(), a, b, null).probability, modelBlock(tour(), snap(1900, 80), snap(1700, 60), null).probability);
  assert.ok(contextBlock(a, b, null).surface.note, 'no surface edge without a sourced surface');
});

test('rest: days since last match and load windows from matches before the match day only', () => {
  const r = restBlock([{ match_id: '1', day: '2026-09-27', score: '6-4 7-6' }, { match_id: '2', day: '2026-09-25', score: '6-4 3-6 6-2' }, { match_id: '3', day: '2026-09-10', score: '6-1 ret.' }, { match_id: '4', day: '2026-09-29', score: '6-0 6-0' }], '2026-09-29');
  assert.deepEqual(r, { last_match: '2026-09-27', days_since_last: 2, matches_7d: 2, sets_7d: 5, matches_14d: 2, sets_14d: 5 });
  assert.equal(restBlock([], '2026-09-29'), null, 'no stored matches: no rest block, not zero');
});

test('serve/return only from medium/high technical DNA of BOTH players; otherwise stated unavailable', () => {
  const t = (spw, rpw, conf = 'high') => ({ as_of: '2026-09-27', metrics: { service_points_won: { value: spw, confidence: conf, sample_matches: 40 }, return_points_won: { value: rpw, confidence: conf, sample_matches: 40 } } });
  const x = serveReturn(t(0.66, 0.40), t(0.62, 0.36));
  assert.equal(x.available, true);
  assert.equal(x.matchups.A_serve_vs_B_return, Math.round((0.66 - (1 - 0.36)) * 1000) / 1000);
  assert.equal(serveReturn(t(0.66, 0.40), t(0.62, 0.36, 'low')).available, false);
  assert.equal(serveReturn(null, t(0.62, 0.36)).available, false);
});
