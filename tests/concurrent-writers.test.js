// Duplicate prevention under CONCURRENT writers (2026-09-28: concurrent backfill shards raced and wrote the same
// match twice). The writer's read-then-write check alone cannot stop a race; the database's natural-key index
// (migration 20260928000200, modelled by MemStore) refuses the second insert and the writer attaches instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeGroups } from '../workers/tennis-ingest/src/writer.js';
import { MemStore } from './helpers/memstore.js';

const E = '00000000-0000-4000-8000-00000000c001';
const E2 = '00000000-0000-4000-8000-00000000c002';
const side = (ids) => ids.map((id) => ({ provider: 'wta', provider_id: id, tour_id: { provider: 'wta', provider_id: id }, gender: 'F' }));
const sm = (provider, id, A, B, extra = {}) => ({ type: 'match', provider, provider_match_id: id, event_type: A.length === 2 ? 'WD' : 'WS', stage: 'main', round_code: '2', format_key: 'BO3_TB7', status: 'completed', winner_side: 'A', end_reason: 'completed', sets: [{ games: { A: 6, B: 3 }, tiebreak: null, is_match_tiebreak: false }, { games: { A: 6, B: 4 }, tiebreak: null, is_match_tiebreak: false }], sides: { A: side(A), B: side(B) }, seeds: {}, entry: {}, warnings: [], ...extra });
const naturalGroups = (s) => { const g = new Map(); for (const m of s.rows('tennis_matches')) { const k = `${m.edition_id}|${m.natural_key}`; g.set(k, (g.get(k) || 0) + 1); } return [...g.values()].filter((n) => n > 1).length; };

test('two writers racing on the same singles match (different source ids) leave ONE row; both ids point at it', async () => {
  const s = new MemStore();
  const [a, b] = await Promise.all([
    writeGroups(s, [{ edition: { edition_id: E }, sourceMatches: [sm('wta_history', 'h-R32-10-20', ['10'], ['20'])] }], { dedupe: true }),
    writeGroups(s, [{ edition: { edition_id: E }, sourceMatches: [sm('wta_history', 'h-R16-10-20', ['10'], ['20'])] }], { dedupe: true })
  ]);
  assert.equal(s.rows('tennis_matches').length, 1);
  assert.equal((a.raced || 0) + (b.raced || 0), 1, 'the race happened and was resolved by the database key');
  const ids = s.rows('tennis_match_external_ids');
  assert.equal(ids.length, 2); assert.equal(new Set(ids.map((x) => x.match_id)).size, 1);
});

test('five concurrent writers, overlapping doubles + singles across two editions: zero duplicate natural keys', async () => {
  const s = new MemStore();
  const pages = Array.from({ length: 5 }, (_, w) => [
    { edition: { edition_id: E }, sourceMatches: [sm('wta_history', `d-${w}`, ['1', '2'], ['3', '4']), sm('wta_history', `s-${w}`, ['1'], ['3'])] },
    { edition: { edition_id: E2 }, sourceMatches: [sm('wta_history', `d2-${w}`, ['1', '2'], ['3', '4'])] }
  ]);
  const out = await Promise.all(pages.map((g) => writeGroups(s, g, { dedupe: true })));
  assert.equal(naturalGroups(s), 0);
  assert.equal(s.rows('tennis_matches').length, 3, 'one WD + one WS in E, one WD in E2');
  assert.equal(s.rows('tennis_match_external_ids').length, 15, 'every source id linked');
  assert.ok(out.reduce((t, r) => t + (r.raced || 0), 0) >= 1);
});

test('an official writer racing a secondary writer still ends with one row (precedence settles on the next pass)', async () => {
  const s = new MemStore();
  await Promise.all([
    writeGroups(s, [{ edition: { edition_id: E }, sourceMatches: [sm('espn', '9-2026:1', ['e10'], ['e20'], { sides: { A: [{ provider: 'espn', provider_id: 'e10', tour_id: { provider: 'wta', provider_id: '10' }, gender: 'F' }], B: [{ provider: 'espn', provider_id: 'e20', tour_id: { provider: 'wta', provider_id: '20' }, gender: 'F' }] } })] }], { dedupe: true }),
    writeGroups(s, [{ edition: { edition_id: E }, sourceMatches: [sm('wta', '9-2026-LS001', ['10'], ['20'])] }], { dedupe: true })
  ]);
  assert.equal(naturalGroups(s), 0);
  assert.equal(s.rows('tennis_matches').length, 1);
  assert.equal(new Set(s.rows('tennis_match_external_ids').map((x) => x.match_id)).size, 1, 'both source ids on the one row');
  // the official source's next observation finds its own id on that row and takes it over
  await writeGroups(s, [{ edition: { edition_id: E }, sourceMatches: [sm('wta', '9-2026-LS001', ['10'], ['20'])] }], { dedupe: true });
  assert.equal(s.rows('tennis_matches').length, 1);
  assert.equal(s.rows('tennis_matches')[0].source_family, 'wta');
});
