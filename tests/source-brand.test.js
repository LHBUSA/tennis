// Network source-brand standard (DATA · PropSports): customer surfaces and public serializers carry no upstream branding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../scripts/guard-source-brand.mjs';
import { envelope } from '../workers/shared/envelope.js';
import { TOUR_COVERAGE } from '../workers/tennis-api/src/tours.js';

test('source-brand guard: no upstream provider branding in customer surfaces or API serializers', () => {
  assert.deepEqual(scan(), []);
});
test('envelope names PropSports; upstream families stay only as the deprecated compatibility field', () => {
  const r = envelope([], { source: ['espn'], freshness: 'CURRENT' });
  assert.equal(r.meta.data_source, 'PropSports');
  assert.deepEqual(r.meta.source, ['espn']);
  assert.match(r.meta.deprecated['meta.source'], /compatibility only/);
});
test('API coverage carries no registry-only upstream detail', () => {
  assert.doesNotMatch(JSON.stringify(TOUR_COVERAGE), /ESPN|registry_source/);
});
