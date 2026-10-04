// ATP recalibration study holdout guard (scripts/research/atp-recal/holdout-guard.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { developmentEntries, openHoldout } from '../scripts/research/atp-recal/holdout-guard.mjs';

const E = [{ day: '2022-12-31' }, { day: '2023-01-01' }, { day: '2025-06-01' }];
test('development reader never returns a holdout-dated entry', () => {
  assert.deepEqual(developmentEntries(E).map((e) => e.day), ['2022-12-31']);
});
test('holdout opens only with --holdout + committed frozen config, and only once', () => {
  const files = new Map();
  const io = { readFile: (p) => files.get(p), exists: (p) => files.has(p), writeFile: (p, v) => files.set(p, v), now: '2026-10-04T00:00:00Z' };
  assert.throws(() => openHoldout(E, { argv: [], ...io }), /closed/);
  assert.throws(() => openHoldout(E, { argv: ['--holdout'], ...io }), /not committed/);
  files.set('docs/evidence/atp-recal/frozen.json', JSON.stringify({ method: 'temperature', T: 1.2, tau: 0.6 }));
  const h = openHoldout(E, { argv: ['--holdout'], ...io });
  assert.equal(h.holdout.length, 2);
  assert.throws(() => openHoldout(E, { argv: ['--holdout'], ...io }), /already evaluated/);
});
