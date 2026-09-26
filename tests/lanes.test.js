// Regression: archive backfill can never starve current / point-by-point ingestion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTick, afterRun, backoffMs } from '../workers/tennis-ingest/src/lanes.js';

const lanes = (over = {}) => [
  { name: 'ao_current', priority: true, done: false, ...over.ao_current },
  { name: 'rank_history', priority: false, done: false, ...over.rank_history },
  { name: 'wimbledon_archive', priority: false, done: false, ...over.wimbledon_archive },
  { name: 'wta_calendar', priority: false, done: false, ...over.wta_calendar }
];
const now = Date.parse('2026-09-26T20:00:00Z');

test('current AO work runs first on EVERY tick, whatever the rotation position', () => {
  let rr = 0;
  for (let t = 0; t < 12; t += 1) {
    const p = planTick({ now, lanes: lanes(), rr });
    assert.equal(p.run[0], 'ao_current');
    assert.equal(p.run.length, 2, 'priority lane + exactly one rotating lane');
    rr = p.rr;
  }
});

test('the archive never takes consecutive ticks: rotating lanes share turns round-robin', () => {
  let rr = 0;
  const seen = [];
  for (let t = 0; t < 9; t += 1) { const p = planTick({ now, lanes: lanes(), rr }); seen.push(p.run[1]); rr = p.rr; }
  assert.deepEqual(seen, ['rank_history', 'wimbledon_archive', 'wta_calendar', 'rank_history', 'wimbledon_archive', 'wta_calendar', 'rank_history', 'wimbledon_archive', 'wta_calendar']);
});

test('a failing / slow archive backs off alone and never holds another lane slot', () => {
  let arch = {};
  for (let i = 0; i < 3; i += 1) arch = afterRun(arch, { ok: false, now });
  assert.equal(arch.failures, 3);
  assert.equal(Date.parse(arch.backoff_until) - now, backoffMs(3));
  let rr = 1; // it would be the archive's turn
  const p = planTick({ now, lanes: lanes({ wimbledon_archive: arch }), rr });
  assert.deepEqual(p.run, ['ao_current', 'wta_calendar'], 'the next eligible lane gets the slot');
  const later = planTick({ now: Date.parse(arch.backoff_until) + 1, lanes: lanes({ wimbledon_archive: arch }), rr });
  assert.equal(later.run[1], 'wimbledon_archive', 'back after its own backoff');
  assert.equal(afterRun(arch, { ok: true, now }).failures, 0, 'success clears it');
});

test('finished lanes retire; AO backing off does not stop history, and vice versa', () => {
  const doneAo = afterRun({}, { ok: true, done: true, now });
  const p = planTick({ now, lanes: lanes({ ao_current: doneAo }), rr: 0 });
  assert.deepEqual(p.run, ['rank_history']);
  const allHistoryDone = planTick({ now, lanes: lanes({ rank_history: { done: true }, wimbledon_archive: { done: true }, wta_calendar: { done: true } }), rr: 2 });
  assert.deepEqual(allHistoryDone.run, ['ao_current']);
  assert.equal(backoffMs(20), 6 * 3600e3, 'capped at 6 hours');
});

test('a blocked or failing edition never advances a backfill cursor; only a proven-absent one does', async () => {
  const { sourceAbsent } = await import('../workers/tennis-ingest/src/lanes.js');
  assert.equal(sourceAbsent({ state: 'BLOCKED_BY_ACCESS_CONTROL', error: 'blocked 403 forbidden' }), false);
  assert.equal(sourceAbsent({ state: 'DEGRADED', error: 'http_503' }), false);
  assert.equal(sourceAbsent({ state: 'DEGRADED', error: 'shape_drift', drift: ['not_array'] }), false);
  assert.equal(sourceAbsent({ state: 'DEGRADED', error: 'http_404' }), true);
  assert.equal(sourceAbsent({ state: 'DEGRADED', error: 'zero_records' }), true);
  assert.equal(sourceAbsent({ state: 'DEGRADED', error: 'shape_drift', drift: ['empty_draw'] }), true);
});
