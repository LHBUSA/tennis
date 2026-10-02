// Matchup Intelligence V2 (workers/tennis-api/src/matchup-intel.js): a deterministic DISPLAY layer over stored DNA.
// Canary: Denis Shapovalov vs Alejandro Tabilo (Tokyo 2026 R2), real stored snapshots + ATP validation summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DNA_METRICS, TECH_METRICS, compareMetrics, categoryEdge, edgeMap, collision, whyStack, h2hBySurface } from '../workers/tennis-api/src/matchup-intel.js';
import { modelBlock, contextBlock } from '../workers/tennis-api/src/matchup.js';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/matchup/shapovalov-tabilo-2026-10-02.json', import.meta.url), 'utf8'));
const snap = (pid, v, s) => FX.snapshots.find((r) => r.pbe_player_id === pid && r.definition_version === v && r.surface === s)?.metrics || {};
const strip = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('_')));
const slice = (pid) => ({ all: { r: snap(pid, 2, 'all')._rating, w: snap(pid, 2, 'all')._profile?.windows, wae: snap(pid, 2, 'all').wins_above_expectation, aor: snap(pid, 2, 'all').avg_opponent_rank }, hard: { r: snap(pid, 2, 'hard')._rating } });
const A = slice(FX.A);
const B = slice(FX.B);

test('canary: the validated ATP PBE Rating publishes a probability for Shapovalov–Tabilo (overall basis: Tokyo surface not sourced)', () => {
  assert.equal(FX.atp_summary.published, true, 'the ATP rating IS validated — "research-only/unvalidated" on /matches was wrong');
  const mb = modelBlock(FX.atp_summary, A, B, null);
  assert.equal(mb.status, 'published');
  assert.deepEqual(mb.probability, { A: 0.512, B: 0.488 });
  assert.equal(mb.basis, 'overall');
  assert.equal(mb.surface_ratings, null, 'no surface blend without a sourced surface (never inferred from "Tokyo")');
  assert.deepEqual([mb.ratings.A.value, mb.ratings.B.value, mb.rating_edge.points], [1821, 1813, 8]);
});

test('face-off: only metrics BOTH players hold at medium/high confidence; lower-is-better and neutral metrics compare correctly', () => {
  const f = compareMetrics(DNA_METRICS, strip(snap(FX.A, 2, 'all')), strip(snap(FX.B, 2, 'all')));
  assert.equal(f.rows.length, 19);
  const row = (k) => f.rows.find((r) => r.key === k);
  assert.equal(row('avg_opponent_rank').advantage, 'A', 'lower average opponent rank (53.1 vs 58.9) is the tougher schedule');
  assert.equal(row('outside100_loss_rate').advantage, 'even', 'lower is better; 29.4% vs 29.9% is within the even band');
  assert.equal(row('deciding_set_dependence').advantage, null, 'a style metric never awards an edge');
  assert.equal(row('wins_above_expectation').advantage, 'B');
  for (const r of f.rows) { assert.ok(['medium', 'high'].includes(r.A.confidence) && ['medium', 'high'].includes(r.B.confidence)); assert.ok(r.A.sample > 0); }
  const lowOnly = compareMetrics(DNA_METRICS, { match_win_rate: { value: 0.6, confidence: 'low', sample_matches: 3 } }, { match_win_rate: { value: 0.4, confidence: 'high', sample_matches: 300 } });
  assert.equal(lowOnly.rows.length, 0, 'a low-confidence value is never compared');
  assert.equal(lowOnly.withheld, 1);
});

test('technical DNA and collision: never built from result-only data (Shapovalov has 2 stat matches -> withheld)', () => {
  const t = compareMetrics(TECH_METRICS, snap(FX.A, 1, 'all'), snap(FX.B, 1, 'all'));
  assert.equal(t.rows.length, 0);
  assert.ok(t.withheld > 0);
  const c = collision(snap(FX.A, 1, 'all'), snap(FX.B, 1, 'all'));
  assert.equal(c.available, false);
  const ok = (v) => ({ value: v, confidence: 'high', sample_matches: 30 });
  const c2 = collision({ first_serve_won: ok(0.73), second_serve_won: ok(0.52) }, { first_return_won: ok(0.31), second_return_won: ok(0.49) });
  assert.equal(c2.available, true);
  assert.deepEqual(c2.A_serving.map((r) => [r.label, r.server_edge]), [['1st serve', 0.04], ['2nd serve', 0.01]]);
  assert.equal(c2.read.A_serving.strongest_server, '1st serve');
});

test('edge map (edge-map/1): never forced — insufficient below 2 qualified, no_edge when mixed, a lean only at >= 2/3 of >= 2 decided', () => {
  const r = (adv) => ({ better: 'high', advantage: adv });
  assert.equal(categoryEdge([r('A')]).edge, 'insufficient');
  assert.equal(categoryEdge([r('A'), r('B')]).edge, 'no_edge');
  assert.equal(categoryEdge([r('A'), r('A'), r('B')]).edge, 'A');
  assert.equal(categoryEdge([r('A'), r('even'), r('even')]).edge, 'no_edge', 'one decided comparison is not enough');
  const f = compareMetrics(DNA_METRICS, strip(snap(FX.A, 2, 'all')), strip(snap(FX.B, 2, 'all')));
  const ctx = contextBlock(A, B, null);
  const map = edgeMap({ dna: f.rows, tech: [], form: ctx.form, surface: ctx.surface });
  const e = Object.fromEntries(map.categories.map((c) => [c.key, c.edge]));
  assert.deepEqual(e, { overall: 'A', serve: 'insufficient', return: 'insufficient', pressure: 'A', surface: 'insufficient', form: 'B', opposition: 'A' });
  assert.deepEqual(map.tally, { A: 3, B: 1, no_edge: 0, insufficient: 3 });
  assert.match(map.rule, /not a prediction/);
});

test('why stack: model inputs are only the rating (and a used surface rating); context agrees or disagrees separately', () => {
  const f = compareMetrics(DNA_METRICS, strip(snap(FX.A, 2, 'all')), strip(snap(FX.B, 2, 'all')));
  const ctx = contextBlock(A, B, null);
  const map = edgeMap({ dna: f.rows, tech: [], form: ctx.form, surface: ctx.surface });
  const w = whyStack(modelBlock(FX.atp_summary, A, B, null), map, { A: 'Denis Shapovalov', B: 'Alejandro Tabilo' });
  assert.deepEqual(w.model_inputs, [{ label: 'PBE Rating edge', value: 8, unit: 'points' }]);
  assert.deepEqual(w.supporting, ['Overall', 'Pressure', 'Opposition']);
  assert.deepEqual(w.counterpoint, ['Form']);
  assert.equal(whyStack({ status: 'not_validated' }, map), null, 'no why-stack without a published probability');
  const hard = modelBlock(FX.atp_summary, A, B, 'hard');
  assert.equal(whyStack(hard, map).model_inputs.length, 2, 'a used surface blend is a model input');
});

test('H2H by surface only from >= 3 stored meetings (never overstated)', () => {
  assert.equal(h2hBySurface({ total: 2, meetings: [{ surface: 'hard', won_by: 'A' }, { surface: 'clay', won_by: 'B' }] }), null);
  assert.deepEqual(h2hBySurface({ total: 3, meetings: [{ surface: 'hard', won_by: 'A' }, { surface: 'hard', won_by: 'B' }, { surface: 'clay', won_by: 'A' }] }), { hard: { A: 1, B: 1 }, clay: { A: 1, B: 0 } });
});
