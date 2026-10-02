// tennis-live health keeps the configured polling intention and the measured user-visible cadence as DISTINCT
// fields (2026-10-02: "cadence_s: 18" read as the observation cadence; production measured ~60 s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { CADENCE } from '../workers/tennis-live/src/index.js';

test('cadence metadata: configured rounds/gap and measured effective cadence are separate, never one number', async () => {
  assert.equal(CADENCE.scheduler_interval_s, 60);
  assert.equal(CADENCE.configured_rounds_per_run, 3);
  assert.equal(CADENCE.configured_round_gap_ms, 18000);
  assert.match(CADENCE.measured_effective_observation_cadence.summary, /60 s/);
  assert.ok(CADENCE.measured_effective_observation_cadence.median_gap_s >= 45, 'measured, not the configured gap');
  const res = await worker.fetch(new Request('https://x/health'), {});
  const h = await res.json();
  const extra = JSON.stringify(h);
  assert.ok(!/"cadence_s"/.test(extra), 'the old single cadence_s number is gone');
  assert.match(extra, /configured_round_gap_ms/);
  assert.match(extra, /measured_effective_observation_cadence/);
});
