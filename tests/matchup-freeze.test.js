// Frozen pre-match matchup snapshots (workers/tennis-api/src/matchup-freeze.js): immutable, write-once, frozen only
// while the match is scheduled; live/finished dossiers serve the last pre-play snapshot untouched (no leakage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeOne, applyPreMatch, listSnapshots, preMatchSnapshot, stableJson, contentHash } from '../workers/tennis-api/src/matchup-freeze.js';

function memBucket() {
  const m = new Map();
  let puts = 0;
  return {
    m, get puts() { return puts; },
    async list({ prefix }) { return { objects: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false }; },
    async head(k) { return m.has(k) ? { key: k } : null; },
    async get(k) { return m.has(k) ? { text: async () => m.get(k) } : null; },
    async put(k, v) { if (m.has(k)) throw new Error(`overwrite attempted: ${k}`); puts += 1; m.set(k, v); }
  };
}
const ID = 'd54c6504-7fc1-5048-980a-6613cd15c383';
const dossier = (over = {}) => ({
  as_of: '2026-10-02', tour: 'ATP', matchup_version: '1.1.0', fixture: 'upcoming',
  match: { id: ID, status: 'scheduled', scheduled_at: '2026-10-03T02:00:00+00:00', score: null, winner_side: null },
  model: { status: 'published', probability: { A: 0.512, B: 0.488 }, basis: 'overall', model: { name: 'PBE Rating', method_version: 1, variant: 'standard' }, ratings: { A: { value: 1821 }, B: { value: 1813 } } },
  intel: { edge_map_version: 'edge-map/1', why: { model_inputs: [{ label: 'PBE Rating edge', value: 8 }] } }, context: { form: {} }, h2h: { record: { A: 0, B: 0 } }, ...over
});

test('freeze -> later results/ratings arrive -> the historical pre-match dossier is byte-identical (no leakage)', async () => {
  const b = memBucket();
  const pre = dossier();
  const w = await freezeOne(b, pre, { now: '2026-10-02T22:00:00.000Z' });
  assert.equal(w.written, true);
  // the match is played; ratings and DNA move; today's computation is different
  const after = dossier({ as_of: '2026-10-03', fixture: 'not_upcoming', match: { ...pre.match, status: 'completed', score: '6-4 6-4', winner_side: 'B' }, model: { ...pre.model, status: 'fixture_not_upcoming', probability: null, ratings: { A: { value: 1810 }, B: { value: 1829 } } } });
  const refused = await freezeOne(b, after, { now: '2026-10-03T06:00:00.000Z' });
  assert.equal(refused.written, false, 'a finished match is never frozen');
  const served = await applyPreMatch(b, after);
  const { pre_match: meta, current, ...payload } = served;
  assert.equal(stableJson(payload), stableJson(pre), 'semantically identical to what was frozen before play');
  assert.deepEqual(served.model.probability, { A: 0.512, B: 0.488 }, 'pre-match probability unchanged, never recomputed');
  assert.equal(meta.frozen, true);
  assert.equal(meta.content_hash, await contentHash(pre));
  assert.deepEqual(current, { status: 'completed', fixture: 'not_upcoming', score: '6-4 6-4', winner_side: 'B' });
});

test('write-once: same DNA day is not re-frozen; a new build day while still scheduled is a NEW revision; latest pre-play wins', async () => {
  const b = memBucket();
  await freezeOne(b, dossier(), { now: '2026-10-02T12:00:00.000Z' });
  assert.equal((await freezeOne(b, dossier(), { now: '2026-10-02T12:10:00.000Z' })).reason, 'already_frozen_for_as_of');
  const day2 = dossier({ as_of: '2026-10-03', model: { ...dossier().model, probability: { A: 0.52, B: 0.48 } } });
  assert.equal((await freezeOne(b, day2, { now: '2026-10-03T00:30:00.000Z' })).written, true);
  const all = await listSnapshots(b, ID);
  assert.equal(all.length, 2);
  assert.equal(b.puts, 2, 'nothing overwritten');
  const live = dossier({ as_of: '2026-10-03', fixture: 'live', match: { ...dossier().match, status: 'in_progress' } });
  assert.deepEqual((await applyPreMatch(b, live)).model.probability, { A: 0.52, B: 0.48 }, 'the LAST pre-play snapshot');
  assert.equal((await preMatchSnapshot(b, ID)).revisions, 2);
});

test('no pre-play snapshot -> "pre_match_snapshot_unavailable": never reconstructed afterwards from later data', async () => {
  const b = memBucket();
  const after = dossier({ fixture: 'not_upcoming', match: { ...dossier().match, status: 'completed' } });
  const served = await applyPreMatch(b, after);
  assert.equal(served.pre_match.status, 'pre_match_snapshot_unavailable');
  assert.equal(served.model.status, 'pre_match_snapshot_unavailable');
  assert.equal(served.model.probability, null);
  assert.equal(served.intel.why, null, 'no model-backed why-stack without a frozen probability');
  assert.match(served.context_basis, /^current/);
});

test('upcoming: served live, with the latest frozen metadata attached (or "not frozen yet")', async () => {
  const b = memBucket();
  assert.equal((await applyPreMatch(b, dossier())).pre_match.frozen, false);
  await freezeOne(b, dossier(), { now: '2026-10-02T22:00:00.000Z' });
  const s = await applyPreMatch(b, dossier());
  assert.equal(s.pre_match.frozen, true);
  assert.equal(s.pre_match.dna_as_of, '2026-10-02');
});
