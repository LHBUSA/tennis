// Cross-provider fixture identity (2026-09-29, China Open 2026 WS: 15 pairs). The ESPN WTA-league lane wrote each
// upcoming first-round fixture (round '1', natural key set); the pre-natural-key tennis-live bundle then wrote the
// official WTA row for the same fixture (round 'M-7', an opaque WTA round id, natural_key NULL -> invisible to the
// unique index). The current writer computes the key, collides with the ESPN row and was rejecting the OFFICIAL row on
// every write. Now our own higher-precedence row absorbs the lower row of the same fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeMatches, sameFixture, naturalKey } from '../workers/tennis-ingest/src/writer.js';
import { mintPlayerId } from '../workers/shared/canonical/identity.js';
import { matchId } from '../workers/shared/canonical/ids.js';
import { MemStore } from './helpers/memstore.js';

const E = '00000000-0000-4000-8000-000000001020';
const espnSide = (e, w) => [{ provider: 'espn', provider_id: e, tour_id: { provider: 'wta', provider_id: w }, gender: 'F' }];
const wtaSide = (w) => [{ provider: 'wta', provider_id: w, gender: 'F' }];
const base = { type: 'match', event_type: 'WS', stage: 'main', format_key: null, status: 'scheduled', winner_side: null, end_reason: null, sets: [], seeds: {}, entry: {}, warnings: [] };
const espnFixture = (comp, a, b, at, extra = {}) => ({ ...base, provider: 'espn', provider_match_id: `959-2026:${comp}`, round_code: '1', sides: { A: espnSide(`e${a}`, a), B: espnSide(`e${b}`, b) }, scheduled_at: at, ...extra });
const wtaFixture = (ls, a, b, extra = {}) => ({ ...base, provider: 'wta', provider_match_id: `1020-2026-${ls}`, round_code: 'M-7', sides: { A: wtaSide(a), B: wtaSide(b) }, scheduled_at: null, ...extra });

/** The legacy state: the official row exists WITHOUT a natural key next to the ESPN fixture row. */
async function legacyPair(s, { comp = '184263', ls = 'LS105', a = '320001', b = '320002', at = '2026-09-30T04:30:00Z' } = {}) {
  await writeMatches(s, [espnFixture(comp, a, b, at)], { edition_id: E }, { dedupe: true });
  const id = await matchId('wta', `1020-2026-${ls}`);
  const [pa, pb] = [await mintPlayerId('wta', a), await mintPlayerId('wta', b)];
  await s.upsert('tennis_matches', [{ match_id: id, edition_id: E, event_type: 'WS', round: 'M-7', status: 'scheduled', source_family: 'wta', natural_key: null, scheduled_at: null }], { onConflict: 'match_id' });
  await s.upsert('tennis_match_participants', [{ match_id: id, side: 'A', participant_key: `S:${pa}` }, { match_id: id, side: 'B', participant_key: `S:${pb}` }], { onConflict: 'match_id,side' });
  await s.upsert('tennis_match_external_ids', [{ provider: 'wta', external_id: `1020-2026-${ls}`, match_id: id }], { onConflict: 'provider,external_id' });
  return id;
}
const groups = (s) => {
  const parts = s.rows('tennis_match_participants');
  const g = new Map();
  for (const m of s.rows('tennis_matches')) {
    const p = parts.filter((x) => x.match_id === m.match_id);
    const k = `${m.edition_id}|${naturalKey(m.event_type, m.round, p.find((x) => x.side === 'A')?.participant_key, p.find((x) => x.side === 'B')?.participant_key)}`;
    g.set(k, (g.get(k) || 0) + 1);
  }
  return [...g.values()].filter((n) => n > 1).length;
};

test('China Open pattern: the official WTA row absorbs the ESPN fixture row of the same fixture; nothing is lost', async () => {
  const s = new MemStore();
  const wtaId = await legacyPair(s);
  assert.equal(groups(s), 1, 'the duplicate exists before');
  const r = await writeMatches(s, [wtaFixture('LS105', '320001', '320002')], { edition_id: E }, { dedupe: true });
  assert.equal(r.merged, 1);
  assert.equal(groups(s), 0);
  const rows = s.rows('tennis_matches');
  assert.equal(rows.length, 1, 'one fixture, one row');
  assert.equal(rows[0].match_id, wtaId, 'the official row survives');
  assert.ok(rows[0].natural_key, 'and now carries its natural key');
  const ext = s.rows('tennis_match_external_ids').map((x) => `${x.provider}:${x.external_id}->${x.match_id === wtaId}`).sort();
  assert.deepEqual(ext, ['espn:959-2026:184263->true', 'wta:1020-2026-LS105->true'], 'both source ids point at the surviving row');
  assert.ok(s.rows('tennis_source_changes').some((c) => c.kind === 'duplicate_merged' && c.to_value === wtaId));
  // the next ESPN read of the same competition attaches to the official row (no new row)
  await writeMatches(s, [espnFixture('184263', '320001', '320002', '2026-09-30T04:30:00Z')], { edition_id: E }, { dedupe: true });
  assert.equal(s.rows('tennis_matches').length, 1);
});

test('fifteen pairs in one pass: all absorbed, every fixture kept exactly once', async () => {
  const s = new MemStore();
  const pairs = Array.from({ length: 15 }, (_, i) => ({ comp: String(184200 + i), ls: `LS${100 + i}`, a: String(330000 + 2 * i), b: String(330001 + 2 * i) }));
  for (const p of pairs) await legacyPair(s, p);
  assert.equal(groups(s), 15);
  const r = await writeMatches(s, pairs.map((p) => wtaFixture(p.ls, p.a, p.b)), { edition_id: E }, { dedupe: true });
  assert.equal(r.merged, 15);
  assert.equal(groups(s), 0);
  assert.equal(s.rows('tennis_matches').length, 15);
  assert.ok(s.rows('tennis_matches').every((m) => m.source_family === 'wta' && m.natural_key));
});

test('never merged: fixtures scheduled days apart, a lower row with a result, a lower row with observed events', async () => {
  // same pair, same stage, but 4 days apart -> not the same fixture: both rows stay
  let s = new MemStore();
  await legacyPair(s, { at: '2026-09-30T04:30:00Z' });
  await writeMatches(s, [wtaFixture('LS105', '320001', '320002', { scheduled_at: '2026-10-04T04:30:00Z' })], { edition_id: E }, { dedupe: true });
  assert.equal(s.rows('tennis_matches').length, 2);
  // the ESPN row already carries a completed result, the official row is only a fixture -> no result is dropped
  s = new MemStore();
  const id = await legacyPair(s);
  const espnRow = s.rows('tennis_matches').find((m) => m.source_family === 'espn');
  espnRow.status = 'completed';
  const r = await writeMatches(s, [wtaFixture('LS105', '320001', '320002')], { edition_id: E }, { dedupe: true });
  assert.equal(r.merged || 0, 0);
  assert.ok(s.rows('tennis_matches').some((m) => m.match_id === id));
  // the ESPN row has observed events (append-only) -> held for review, never deleted
  s = new MemStore();
  await legacyPair(s);
  const e2 = s.rows('tennis_matches').find((m) => m.source_family === 'espn');
  await s.insert('tennis_match_events', [{ event_id: 'x', match_id: e2.match_id, quality: 'score_snapshot', event_sequence: 0 }]);
  const r3 = await writeMatches(s, [wtaFixture('LS105', '320001', '320002')], { edition_id: E }, { dedupe: true });
  assert.equal(r3.merged || 0, 0);
  assert.equal(s.rows('tennis_match_events').length, 1);
  assert.ok(s.rows('tennis_ingest_holds').some((h) => h.problems.some((p) => p.startsWith('duplicate_candidate:absorb_blocked_append_only_events'))));
});

test('sameFixture: provider round notations never veto; same-notation disagreements and far-apart times do', () => {
  const x = (round, at = null, status = 'scheduled') => ({ n: { match: { round_code: round, status } }, sm: { scheduled_at: at } });
  assert.equal(sameFixture({ round: '1', status: 'scheduled' }, x('M-7')), true, "ESPN '1' vs WTA 'M-7': different notations");
  assert.equal(sameFixture({ round: '1', status: 'scheduled' }, x('2')), false, 'two round numbers that disagree');
  assert.equal(sameFixture({ round: 'S', status: 'scheduled' }, x('M-F')), false, 'semifinal vs final');
  assert.equal(sameFixture({ round: 'M-Q', status: 'scheduled' }, x('Q')), true);
  assert.equal(sameFixture({ round: '1', status: 'scheduled', scheduled_at: '2026-09-30T04:30:00Z' }, x('M-7', '2026-09-30T09:00:00Z')), true);
  assert.equal(sameFixture({ round: '1', status: 'scheduled', scheduled_at: '2026-09-30T04:30:00Z' }, x('M-7', '2026-10-03T09:00:00Z')), false);
  assert.equal(sameFixture({ round: '1', status: 'completed' }, x('M-7')), false, 'a stored result is never dropped for a fixture');
});
