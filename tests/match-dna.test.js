// Tennis DNA v2 (Match DNA + PBE Rating): definitions, as-of exclusivity, ranking-at-match, tour separation,
// rating leakage, and "never a technical metric from results".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerEntry, rankIndex, ratingRun, backtest, buildMatchDna, MATCH_DEFINITIONS } from '../workers/shared/dna/match-dna.js';
import { DEFINITIONS as V1 } from '../workers/shared/dna/metric.js';

const tourOf = (pid) => (pid.startsWith('m') ? 'ATP' : pid.startsWith('w') ? 'WTA' : null);
let n = 0;
const row = (A, B, winner, sets, day, extra = {}) => ({ match_id: `x${String((n += 1)).padStart(5, '0')}`, event_type: tourOf(A) === 'WTA' ? 'WS' : 'MS', round: '1', format_key: 'BO3_TB7', status: 'completed', winner_side: winner, scheduled_at: `${day}T12:00:00Z`, surface: 'hard', source_family: 'espn', sets: sets.map(([a, b], i) => ({ set_no: i + 1, games_a: a, games_b: b })), A, B, edition: { start_date: day, end_date: day }, ...extra });
const L = (rows) => rows.map((r) => ledgerEntry(r, tourOf)).filter(Boolean);

test('ledger: walkovers, undated rows and cross-tour pairs never enter; archive rows use the edition end date', () => {
  assert.equal(ledgerEntry(row('m1', 'm2', 'A', [], '2024-01-01', { status: 'walkover' }), tourOf), null);
  assert.equal(ledgerEntry(row('m1', 'w2', 'A', [[6, 0], [6, 0]], '2024-01-01'), tourOf), null, 'ATP and WTA are never mixed');
  assert.equal(ledgerEntry(row('m1', 'm2', 'A', [[6, 0], [6, 0]], '2024-01-01', { scheduled_at: null, edition: null }), tourOf), null);
  const e = ledgerEntry(row('m1', 'm2', 'A', [[6, 0], [6, 0]], '2024-01-01', { scheduled_at: null, edition: { start_date: '2024-06-24', end_date: '2024-07-07' } }), tourOf);
  assert.equal(e.day, '2024-07-07');
  assert.equal(e.rank_day, '2024-06-24');
});

test('definitions: every Match DNA metric is result-derived; no technical (serve/return) key is produced', () => {
  const e = L([row('m1', 'm2', 'A', [[6, 4], [7, 6]], '2024-01-02')]);
  const d = buildMatchDna('m1', e, '2024-02-01');
  for (const k of Object.keys(d.metrics)) { assert.ok(MATCH_DEFINITIONS[k], k); assert.ok(!V1[k], `${k} collides with a technical metric`); }
});

test('metrics: sets, games, tiebreaks, deciding sets, comebacks, close matches computed from the score', () => {
  const rows = [
    row('m1', 'm2', 'A', [[6, 4], [6, 4]], '2024-01-01'),           // straight
    row('m1', 'm3', 'A', [[4, 6], [7, 6], [6, 3]], '2024-01-02'),   // comeback, deciding, tiebreak won
    row('m4', 'm1', 'A', [[7, 6], [6, 7], [7, 5]], '2024-01-03'),   // lost deciding, tiebreaks 1-1, close
    row('m1', 'm5', 'B', [[6, 0], [1, 0]], '2024-01-04', { status: 'retired' })
  ];
  const d = buildMatchDna('m1', L(rows), '2024-02-01');
  const m = d.metrics;
  assert.deepEqual([m.match_win_rate.numerator, m.match_win_rate.denominator], [2, 4], 'a retirement is a played match; the flagged winner is not the retiree here');
  assert.deepEqual([m.deciding_set_win_rate.numerator, m.deciding_set_win_rate.denominator], [1, 2]);
  assert.deepEqual([m.tiebreak_win_rate.numerator, m.tiebreak_win_rate.denominator], [2, 3]);
  assert.deepEqual([m.comeback_win_rate.numerator, m.comeback_win_rate.denominator], [1, 2]);
  assert.deepEqual([m.straight_sets_win_rate.numerator, m.straight_sets_win_rate.denominator], [1, 2]);
  assert.deepEqual([m.close_match_win_rate.numerator, m.close_match_win_rate.denominator], [1, 2]);
  assert.equal(m.set_win_rate.denominator, 9, 'the unfinished 1-0 set is not a completed set');
  assert.equal(m.game_win_rate.denominator, 20 + 32 + 38 + 7, 'games include the unfinished set');
  assert.equal(m.match_win_rate.confidence, 'insufficient', 'four matches never reach a comparable sample');
  assert.equal(d.form.counts.bagels_won, 1);
});

test('as_of is exclusive: a match on day D is invisible to the snapshot at D', () => {
  const e = L([row('m1', 'm2', 'A', [[6, 4], [6, 4]], '2024-03-01'), row('m1', 'm2', 'B', [[4, 6], [4, 6]], '2024-03-02')]);
  assert.equal(buildMatchDna('m1', e, '2024-03-02').sample.matches, 1);
  assert.equal(buildMatchDna('m1', e, '2024-03-03').sample.matches, 2);
  assert.equal(buildMatchDna('m1', e, '2024-03-01').sample.matches, 0);
});

test('ranking at match time: list in force at the edition start, stale lists ignored, never a later list', () => {
  const at = rankIndex([{ date: '2024-01-01', size: 100, ranks: new Map([['m2', 5]]) }, { date: '2024-03-04', size: 100, ranks: new Map([['m2', 40]]) }]);
  assert.equal(at('m2', '2024-01-10').rank, 5);
  assert.equal(at('m2', '2024-03-03'), null, 'the 2024-01-01 list is older than 28 days; the 03-04 list is in the future');
  assert.equal(at('m2', '2024-03-04').rank, 40);
  assert.equal(at('m9', '2024-03-05').outside, 100);
  assert.equal(at('m2', '2023-12-31'), null);
  const e = L([row('m1', 'm2', 'A', [[6, 4], [6, 4]], '2024-01-12', { edition: { start_date: '2024-01-08', end_date: '2024-01-14' } })]);
  const d = buildMatchDna('m1', e, '2024-02-01', { rankAt: at });
  assert.deepEqual(d.metrics.top10_win_rate.record, { W: 1, L: 0 });
});

test('rating: predictions use only earlier matches; retirements do not move ratings; tours rated separately', () => {
  const rows = [];
  for (let i = 0; i < 40; i += 1) rows.push(row('mA', i % 2 ? 'mB' : 'mC', 'A', [[6, 3], [6, 3]], `2024-01-${String((i % 28) + 1).padStart(2, '0')}`));
  const e = L(rows).sort((a, b) => (a.order < b.order ? -1 : 1));
  const run = ratingRun(e);
  assert.equal(run.pre.get(e[0].id).ra, 1500, 'first prediction sees no history');
  assert.ok(run.ratings.get('mA').r > 1500);
  const ret = L([row('mX', 'mY', 'A', [[6, 3], [1, 0]], '2024-01-01', { status: 'retired' })]);
  assert.equal(ratingRun(ret).ratings.get('mX').r, 1500);
  // changing a FUTURE result never changes an earlier prediction
  const flipped = e.map((x, i) => (i === e.length - 1 ? { ...x, winner: 'B' } : x));
  assert.deepEqual(ratingRun(flipped).pre.get(e[20].id), run.pre.get(e[20].id));
  const bt = backtest(e, { standard: run }, () => null, { from: '2024-01-15', minPrior: 1 });
  assert.ok(bt.standard.matches > 0 && bt.standard.log_loss < bt.standard.coin_log_loss);
});

test('population: percentile needs 10 medium/high peers; each metric publishes its comparison at 30 on its own', async () => {
  const { applyPopulation } = await import('../workers/shared/dna/match-dna.js');
  const snap = (v, conf, extra = {}) => ({ metrics: { match_win_rate: { value: v, confidence: conf, comparable: true }, top10_win_rate: { value: v, confidence: extra.top10 || 'insufficient', comparable: true }, _rating: { value: 1500 + v * 100, rated_matches: 30 } }, provenance: { sample: { last_day: '2026-09-01' } } });
  const group = Array.from({ length: 35 }, (_, i) => snap(i / 35, 'medium', { top10: i < 12 ? 'medium' : 'low' }));
  const pop = applyPopulation(group, { asOf: '2026-09-27', ratingPublished: true });
  assert.equal(pop.match_win_rate, 35);
  assert.equal(group[20].metrics.match_win_rate.comparative_published, true);
  assert.ok(group[20].metrics.match_win_rate.percentile > 50);
  assert.equal(pop.top10_win_rate, 12);
  assert.equal(group[0].metrics.top10_win_rate.comparative_published, false, 'a thin metric stays building while another publishes');
  assert.notEqual(group[0].metrics.top10_win_rate.percentile, null, '12 peers >= 10: an individual percentile is allowed');
  assert.equal(group[30].metrics.top10_win_rate.percentile, null, 'the player\'s own sample is low: no percentile');
  const small = Array.from({ length: 5 }, (_, i) => snap(i / 5, 'high'));
  applyPopulation(small, { asOf: '2026-09-27', ratingPublished: true });
  assert.equal(small[3].metrics.match_win_rate.percentile, null);
  const held = Array.from({ length: 35 }, (_, i) => snap(i / 35, 'medium'));
  applyPopulation(held, { asOf: '2026-09-27', ratingPublished: false });
  assert.equal(held[10].metrics._rating.percentile, null, 'an unvalidated rating is never ranked');
});
