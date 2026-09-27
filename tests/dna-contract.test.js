// Tennis DNA publication contract: measurements (L1) always; per-metric percentile (L2) needs 10 same-tour
// medium/high peers; full comparative DNA (L3) needs DNA_MIN_QUALIFIED qualified players.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dnaWithPercentiles, DNA_MIN_QUALIFIED } from '../workers/tennis-api/src/v2.js';

const metric = (value, confidence, n = 22) => ({ value, confidence, sample_matches: n, numerator: Math.round(value * 100), denominator: 100 });
function fakeStore({ peersSpw, peersHold, qualified }) {
  const me = { pbe_player_id: 'djok', metrics: { service_points_won: { ...metric(0.684, 'high'), metric_key: 'service_points_won' }, hold_rate: { ...metric(0.86, 'high'), metric_key: 'hold_rate' }, return_points_won: { ...metric(0.41, 'low', 3), metric_key: 'return_points_won' } }, as_of: '2026-09-26', surface: 'all', definition_version: 1, provenance: {}, tennis_players: { gender: 'M' } };
  const peers = Array.from({ length: Math.max(peersSpw, peersHold, qualified) }, (_, i) => ({ pbe_player_id: `p${i}`, tennis_players: { gender: 'M' }, metrics: { service_points_won: i < Math.max(peersSpw, qualified) ? metric(0.55 + i * 0.005, 'medium') : metric(0.6, 'low', 2), hold_rate: i < peersHold ? metric(0.7 + i * 0.005, 'medium') : null } }));
  return {
    async select(table, q) {
      if (table === 'tennis_players') return [{ gender: 'M' }];
      if (table !== 'tennis_dna_snapshots') return [];
      if (/select=as_of&order=as_of.desc/.test(q)) return [{ as_of: '2026-09-26' }];
      if (/pbe_player_id=eq.djok/.test(q)) return [me];
      if (/offset=0/.test(q) || !/offset=/.test(q)) return [me, ...peers];
      return [];
    }
  };
}

test('ATP at 7/30: individual measurements published, comparative view held, no percentile without 10 peers', async () => {
  const d = await dnaWithPercentiles(fakeStore({ peersSpw: 6, peersHold: 12, qualified: 6 }), 'djok');
  assert.equal(d.metrics.service_points_won.value, 0.684, 'L1: the measurement itself is published');
  assert.equal(d.comparative.published, false);
  assert.match(d.comparative.status, /still building: 7 of 30/);
  const dim = Object.fromEntries(d.dimensions.map((x) => [x.key, x]));
  assert.equal(dim.service_points_won.percentile, null, 'L2: 7 medium/high peers < 10');
  assert.equal(dim.service_points_won.percentile_status, 'peer_sample_not_mature');
  assert.ok(Number.isInteger(dim.hold_rate.percentile), 'L2: hold rate has 13 medium/high peers -> a percentile');
  assert.equal(dim.return_points_won.percentile_status, 'player_sample_low', 'low-confidence metric never gets a percentile');
  assert.equal(dim.break_points_saved.percentile_status, 'missing', 'missing stays missing');
});

test('full comparative DNA opens only at the tour threshold', async () => {
  const d = await dnaWithPercentiles(fakeStore({ peersSpw: DNA_MIN_QUALIFIED, peersHold: 12, qualified: DNA_MIN_QUALIFIED }), 'djok');
  assert.equal(d.comparative.published, true);
  assert.equal(DNA_MIN_QUALIFIED, 30);
});
