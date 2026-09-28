// crossSource() candidate discovery (2026-09-28 Seoul 57014 fix): the edition-first lookup must return EXACTLY the set the
// old participant-first query returned, for every shape of input. The old query is reproduced here verbatim and run
// through the same store (MemStore now models embedded filters + !inner before paging, as PostgREST does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateMatchIds, writeMatches, writeGroups } from '../workers/tennis-ingest/src/writer.js';
import { inList } from '../workers/shared/store/postgrest.js';
import { MemStore } from './helpers/memstore.js';

// the pre-fix query, unchanged (participant-first, inner-embedded tennis_matches filtered by edition, OFFSET-paged)
async function legacyCandidates(store, keys, eds) {
  const out = new Set();
  for (let i = 0; i < keys.length; i += 100) {
    for (let off = 0; ; off += 1000) {
      const rows = await store.select('tennis_match_participants', `select=match_id,tennis_matches!inner(edition_id)&participant_key=${inList(keys.slice(i, i + 100))}&tennis_matches.edition_id=${inList(eds)}&order=match_id.asc,side.asc&limit=1000&offset=${off}`);
      for (const r of rows) out.add(r.match_id);
      if (rows.length < 1000) break;
    }
  }
  return out;
}
const same = async (s, keys, eds, label) => {
  const a = [...await legacyCandidates(s, keys, eds)].sort();
  const b = [...await candidateMatchIds(s, keys, eds)].sort();
  assert.deepEqual(b, a, label);
  return a.length;
};

const E = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S = (p) => `S:${p}`;
const D = (a, b) => `D:${[a, b].sort().join('+')}`;
let seq = 0;
function add(s, ed, A, B, extra = {}) {
  const id = `10000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`;
  s.rows('tennis_matches').push({ match_id: id, edition_id: ed, event_type: A.startsWith('D:') ? 'WD' : 'WS', round: '1', status: 'completed', ...extra });
  s.rows('tennis_match_participants').push({ match_id: id, side: 'A', participant_key: A }, { match_id: id, side: 'B', participant_key: B });
  return id;
}
function world() {
  const s = new MemStore();
  seq = 0;
  // a veteran (p1) in 30 historical editions, singles and doubles; flipped sides; unrelated editions
  for (let e = 1; e <= 30; e += 1) {
    add(s, E(e), S('p1'), S(`o${e}`));
    add(s, E(e), S(`o${e}`), S('p1')); // flipped sides (the same pair can meet again in RR)
    add(s, E(e), D('p1', 'p2'), D(`o${e}`, `q${e}`));
    add(s, E(e), S(`x${e}`), S(`y${e}`)); // matches not involving any incoming key
  }
  add(s, E(100), S('p9'), S('p8'));
  return s;
}

test('candidates: singles, doubles, one and many target editions, veteran in many editions -> identical sets', async () => {
  const s = world();
  assert.equal(await same(s, [S('p1'), S('o3')], [E(3)], 'singles, one edition'), 2);
  assert.equal(await same(s, [D('p1', 'p2')], [E(3)], 'doubles key'), 1);
  assert.equal(await same(s, [S('p1'), D('p1', 'p2')], [E(1), E(2), E(3)], 'multiple editions'), 9);
  assert.equal(await same(s, [S('p1')], Array.from({ length: 30 }, (_, i) => E(i + 1)), 'veteran across 30 editions'), 60);
  assert.equal(await same(s, [S('p1')], [E(100)], 'incoming player appears only in unrelated editions'), 0);
  assert.equal(await same(s, [S('nobody')], [E(1)], 'no candidate'), 0);
  assert.equal(await same(s, [], [E(1)], 'no keys'), 0);
});

test('candidates: deterministic sweep of key / edition subsets -> 0 differences', async () => {
  const s = world();
  const allKeys = [S('p1'), D('p1', 'p2'), S('p9'), S('p8'), ...Array.from({ length: 30 }, (_, i) => S(`o${i + 1}`)), ...Array.from({ length: 30 }, (_, i) => S(`x${i + 1}`))];
  let diffs = 0;
  for (let k = 1; k <= 64; k += 7) for (let e = 1; e <= 31; e += 5) {
    const keys = allKeys.filter((_, i) => (i * 13 + k) % 5 !== 0).slice(0, k);
    const eds = [...Array.from({ length: e }, (_, i) => E(((i * 7) % 30) + 1)), E(100)];
    const a = [...await legacyCandidates(s, keys, eds)].sort().join();
    const b = [...await candidateMatchIds(s, keys, eds)].sort().join();
    if (a !== b) diffs += 1;
  }
  assert.equal(diffs, 0, 'SEMANTIC REGRESSION');
});

test('candidates: a full page is finished per edition with a match_id keyset (never OFFSET); editions grouped by 8', async () => {
  const s = new MemStore();
  seq = 0;
  for (let i = 0; i < 2350; i += 1) add(s, E(7), S('big'), S(`z${i}`));
  for (let e = 1; e <= 20; e += 1) add(s, E(200 + e), S('big'), S(`w${e}`));
  const eds = [E(7), ...Array.from({ length: 20 }, (_, i) => E(201 + i))];
  const got = await candidateMatchIds(s, [S('big')], eds, { page: 1000 });
  assert.equal(got.size, 2370);
  const gets = s.log.filter((x) => x[0] === 'GET' && x[1] === 'tennis_matches').map((g) => decodeURIComponent(g[2]));
  assert.ok(gets.every((g) => !/offset=/.test(g)), 'keyset, not offset');
  assert.equal(gets.filter((g) => /edition_id=in\./.test(g)).length, 3, '21 editions -> groups of 8, 8, 5');
  assert.ok(gets.filter((g) => /edition_id=in\./.test(g)).every((g) => (g.match(/edition_id=in\.\(([^)]*)\)/)[1].split(',').length) <= 8));
  assert.ok(gets.some((g) => /match_id=gt\./.test(g)), 'the full group was finished with a keyset');
  assert.equal([...got].sort().join(), [...await legacyCandidates(s, [S('big')], eds)].sort().join());
});

// end-to-end: the writer's dedupe outcomes with the new lookup (flipped sides, two providers, linked external id,
// source alias, concurrent writers)
const side = (id, provider = 'wta') => [{ provider, provider_id: id, tour_id: { provider: 'wta', provider_id: id }, gender: 'F' }];
const sm = (provider, pmid, a, b, extra = {}) => ({ type: 'match', provider, provider_match_id: pmid, event_type: 'WS', stage: 'main', round_code: '2', format_key: 'BO3_TB7', status: 'completed', winner_side: 'A', end_reason: 'completed', sets: [{ games: { A: 6, B: 3 }, tiebreak: null, is_match_tiebreak: false }, { games: { A: 6, B: 4 }, tiebreak: null, is_match_tiebreak: false }], sides: { A: side(a), B: side(b) }, seeds: {}, entry: {}, warnings: [], ...extra });
const ED = { edition_id: E(500) };

test('writer: flipped sides from a second provider attach to the one row; a linked external id is reused; alias holds', async () => {
  const s = new MemStore();
  await writeMatches(s, [sm('wta', 'W-1', '10', '20')], ED, { dedupe: true });
  const flipped = sm('espn', '9-2026:1', '20', '10', { winner_side: 'B', sets: [{ games: { A: 3, B: 6 }, tiebreak: null, is_match_tiebreak: false }, { games: { A: 4, B: 6 }, tiebreak: null, is_match_tiebreak: false }] });
  await writeMatches(s, [flipped], ED, { dedupe: true });
  assert.equal(s.rows('tennis_matches').length, 1, 'flipped + second provider -> same row');
  assert.equal(new Set(s.rows('tennis_match_external_ids').map((x) => x.match_id)).size, 1);
  await writeMatches(s, [sm('wta', 'W-1', '10', '20')], ED, { dedupe: true });
  await writeMatches(s, [sm('wta', 'W-1-alias', '10', '20')], ED, { dedupe: true });
  assert.equal(s.rows('tennis_matches').length, 1, 'repeat + alias id -> no second row');
});

test('writer: concurrent writers on the same match still leave one row (database key + new lookup)', async () => {
  const s = new MemStore();
  await Promise.all([
    writeGroups(s, [{ edition: ED, sourceMatches: [sm('wta_history', 'h-1', '31', '32')] }], { dedupe: true }),
    writeGroups(s, [{ edition: ED, sourceMatches: [sm('wta_history', 'h-2', '31', '32')] }], { dedupe: true })
  ]);
  assert.equal(s.rows('tennis_matches').length, 1);
  assert.equal(new Set(s.rows('tennis_match_external_ids').map((x) => x.match_id)).size, 1);
});

test('candidate_probe admin lane (read-only): runs both lookups, reports equality, writes nothing', async () => {
  const { tick } = await import('../workers/tennis-ingest/src/index.js');
  const { MemKV } = await import('./helpers/memstore.js');
  const s = new MemStore();
  seq = 0;
  add(s, E(900), S('a1'), S('b1'));
  add(s, E(900), D('a1', 'a2'), D('b1', 'b2'));
  add(s, E(901), S('a1'), S('c1'));
  const before = JSON.stringify([...s.t].filter(([, r]) => r.length).sort());
  const { runProbe } = await import('../workers/tennis-ingest/src/index.js');
  const r = await runProbe({ store: s, kv: new MemKV() }, { editions: `${E(900)},${E(901)}` });
  assert.equal(r.read_only, true);
  assert.deepEqual(r.cases.map((c) => [c.candidates, c.legacy_candidates, c.equal]), [[2, 2, true], [1, 1, true]]);
  assert.equal(JSON.stringify([...s.t].filter(([, rr]) => rr.length).sort()), before, 'no writes');
  assert.ok(typeof tick === 'function');
});
