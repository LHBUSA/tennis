// WTA player-history lane: parser (real rows), round mapping by draw size, precedence (ESPN < history < WTA API),
// cross-edition takeover of an ESPN row, idempotency across the two players' histories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHistoryRow, historyRound, historyScore } from '../workers/providers/wta-history.js';
import { normalizeMatch } from '../workers/shared/canonical/normalize.js';
import { writeMatches } from '../workers/tennis-ingest/src/writer.js';
import { MemStore } from './helpers/memstore.js';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/wta/player-matches-320760.json', import.meta.url), 'utf8'));
const rows = fx.matches;

test('rounds by draw size; qualifying; unknown rounds refused', () => {
  assert.deepEqual(historyRound('R16', 'M', 30), { stage: 'main', code: '2' });
  assert.deepEqual(historyRound('R16', 'M', 56), { stage: 'main', code: '3' });
  assert.deepEqual(historyRound('R64', 'M', 64), { stage: 'main', code: '1' });
  assert.deepEqual(historyRound('Q', 'M', 32), { stage: 'main', code: 'Q' });
  assert.deepEqual(historyRound('Q2', 'Q', 32), { stage: 'qualifying', code: 'Q-2' });
  assert.deepEqual(historyRound('R32', 'Q', 32, 32), { stage: 'qualifying', code: 'Q-1' });
  assert.deepEqual(historyRound('Q', 'Q', 32, 32), { stage: 'qualifying', code: 'Q-3' });
  assert.deepEqual(historyRound('R16', 'Q', 32, 64), { stage: 'qualifying', code: 'Q-3' });
  assert.equal(historyRound('R32', 'Q', 32, null), null, 'no qualifying draw size, no guess');
  assert.equal(historyRound('R16', 'M', null), null);
  assert.equal(historyRound('X', 'M', 32), null);
  assert.deepEqual(historyScore('6-3  6-7(6)  7-5').map((s) => [s.w, s.l, s.tbLoser]), [[6, 3, null], [6, 7, 6], [7, 5, null]]);
});

test('real rows: winner-first scores oriented to sides; retirement; bye skipped; doubles; all normalize', async () => {
  const [tb, lost, ret, bye, dbl] = rows.map((r) => parseHistoryRow(r, { today: '2026-09-27' }));
  assert.equal(tb.match.status, 'completed');
  const side = (p, id) => (p.match.sides.A[0].provider_id === id ? 'A' : 'B');
  const me = side(tb, '320760');
  assert.equal(tb.match.winner_side, me);
  const g2 = tb.match.sets[1].games;
  assert.deepEqual(me === 'A' ? [g2.A, g2.B] : [g2.B, g2.A], [6, 7], 'winner-first score oriented onto the winner');
  const t2 = tb.match.sets[1].tiebreak;
  assert.deepEqual(me === 'A' ? [t2.A, t2.B] : [t2.B, t2.A], [6, 8]);
  assert.notEqual(lost.match.winner_side, side(lost, '320760'));
  const lowA = (p) => Number(p.match.sides.A[0].provider_id) < Number(p.match.sides.B[0].provider_id);
  assert.ok([tb, lost, ret].every(lowA), 'side A always holds the lower WTA id (both histories agree)');
  assert.equal(ret.match.status, 'retired');
  assert.equal(bye.skip, 'bye');
  assert.equal(dbl.match.event_type, 'WD');
  assert.equal(dbl.match.sides.A.length, 2);
  assert.equal(tb.edition.surface, 'hard');
  for (const p of [tb, lost, ret, dbl]) assert.equal((await normalizeMatch(p.match)).canonical, true, p.match.provider_match_id);
  assert.equal(parseHistoryRow({ ...rows[0], tournament: { ...rows[0].tournament, endDate: '2026-09-25' } }, { today: '2026-09-27' }).skip, 'recent_edition_owned_by_live_lanes');
  assert.equal(parseHistoryRow({ ...rows[0], reason_code: 'Z' }, { today: '2026-09-27' }).match.status, null, 'unknown reason code is held');
});

const E = '00000000-0000-4000-8000-00000000e777';
const E2 = '00000000-0000-4000-8000-00000000e778';
const sm = (provider, id, round, A, B, extra = {}) => ({ type: 'match', provider, provider_match_id: id, event_type: 'WS', stage: 'main', round_code: round, format_key: 'BO3_TB7', status: 'completed', winner_side: 'A', end_reason: 'completed', sets: [{ games: { A: 6, B: 3 }, tiebreak: null, is_match_tiebreak: false }, { games: { A: 6, B: 3 }, tiebreak: null, is_match_tiebreak: false }], sides: { A: [{ provider: provider === 'espn' ? 'espn' : 'wta', provider_id: provider === 'espn' ? `e${A}` : A, tour_id: { provider: 'wta', provider_id: A }, gender: 'F' }], B: [{ provider: provider === 'espn' ? 'espn' : 'wta', provider_id: provider === 'espn' ? `e${B}` : B, tour_id: { provider: 'wta', provider_id: B }, gender: 'F' }] }, seeds: {}, entry: {}, warnings: [], ...extra });

test('precedence: history takes over ESPN (even from another edition); WTA API takes over history; history attaches to WTA API', async () => {
  const s = new MemStore();
  await writeMatches(s, [sm('espn', '402-2012:1', '2', '10', '20')], { edition_id: E2 }, { dedupe: true });
  const espnId = s.rows('tennis_matches')[0].match_id;
  const r = await writeMatches(s, [sm('wta_history', '999-2012-WS-M-R16-10-20', '2', '10', '20', { existing_match_id: espnId, existing_owner: 'espn' })], { edition_id: E }, { dedupe: true });
  assert.equal(r.taken_over, 1);
  assert.equal(s.rows('tennis_matches').length, 1);
  assert.equal(s.rows('tennis_matches')[0].edition_id, E, 'moved into the official edition');
  assert.equal(s.rows('tennis_matches')[0].source_family, 'wta_history');
  // the opponent's history lists the same match: same deterministic id -> idempotent
  await writeMatches(s, [sm('wta_history', '999-2012-WS-M-R16-10-20', '2', '20', '10')], { edition_id: E }, { dedupe: true });
  assert.equal(s.rows('tennis_matches').length, 1);
  // the WTA API later backfills the same edition: it takes the row over (same match_id)
  const w = await writeMatches(s, [sm('wta', '999-2012-LS007', 'M-2', '10', '20')], { edition_id: E }, { dedupe: true });
  assert.equal(w.taken_over, 1);
  assert.equal(s.rows('tennis_matches').length, 1);
  assert.equal(s.rows('tennis_matches')[0].source_family, 'wta');
  assert.equal(s.rows('tennis_match_external_ids').length, 3, 'espn + history + wta ids all on one match');
  const h2 = await writeMatches(s, [sm('wta_history', 'other-id', '2', '10', '20')], { edition_id: E }, { dedupe: true });
  assert.equal(h2.attached, 1, 'history attaches to the official WTA API row');
});

test('history editions are insert-only: an official calendar edition keeps its fields; only gaps are filled', async () => {
  const { ensureHistoryEdition } = await import('../workers/tennis-ingest/src/wta-history-job.js');
  const { tournamentId, tournamentKey, editionId } = await import('../workers/shared/canonical/ids.js');
  const s = new MemStore();
  const tid = await tournamentId(tournamentKey('wta', '1017', 'Cincinnati', 'WTA 1000'));
  const eid = await editionId(tid, 2018);
  await s.upsert('tennis_tournaments', [{ tournament_id: tid, slug: 'cincinnati', name: 'Cincinnati' }]);
  await s.upsert('tennis_tournament_editions', [{ edition_id: eid, tournament_id: tid, year: 2018, name: 'Western & Southern Open', venue_id: 'v1', city: 'Mason', surface: null, start_date: '2018-08-13', end_date: '2018-08-19', source_family: 'wta' }]);
  const got = await ensureHistoryEdition(s, { provider_tournament_id: '1017', name: 'Cincinnati', title: 'X', level: 'WTA 1000', year: 2018, start_date: '2018-08-12', end_date: '2018-08-20', surface: 'hard', indoor: false });
  assert.equal(got, eid);
  const row = s.rows('tennis_tournament_editions')[0];
  assert.deepEqual([row.name, row.venue_id, row.city, row.start_date], ['Western & Southern Open', 'v1', 'Mason', '2018-08-13'], 'official fields untouched');
  assert.equal(row.surface, 'hard', 'missing surface filled');
  const itf = await ensureHistoryEdition(s, { provider_tournament_id: '847', name: 'MINSK', level: 'ITF', year: 2012, start_date: '2012-11-05', end_date: '2012-11-11', surface: 'hard', indoor: true });
  assert.ok(s.rows('tennis_tournaments').some((t) => t.slug === 'minsk-itf' && t.name === 'Minsk'));
  assert.ok(itf);
});

test('ESPN attaches to a WTA API row whose round id is opaque (M-2 = round 1 at a 128 draw; qualifying "Q-")', async () => {
  const s = new MemStore();
  await writeMatches(s, [sm('wta', '0901-2026-LS101', 'M-2', '10', '20'), sm('wta', '0901-2026-QS001', 'Q-', '30', '40', { stage: 'qualifying' })], { edition_id: E });
  const r = await writeMatches(s, [sm('espn', '154-2026:1', '1', '10', '20'), sm('espn', '154-2026:2', 'Q-1', '30', '40', { stage: 'qualifying' })], { edition_id: E }, { dedupe: true });
  assert.equal(r.attached, 2);
  assert.equal(r.duplicate_candidates, 0);
  const r2 = await writeMatches(s, [sm('espn', '154-2026:3', 'S', '10', '20')], { edition_id: '00000000-0000-4000-8000-00000000e999' }, { dedupe: true });
  assert.equal(r2.attached, 0, 'different edition: not this match');
  const s2 = new MemStore();
  await writeMatches(s2, [sm('wta', 'X-F', 'M-F', '10', '20')], { edition_id: E });
  const r3 = await writeMatches(s2, [sm('espn', 'e:9', 'S', '10', '20')], { edition_id: E }, { dedupe: true });
  assert.equal(r3.duplicate_candidates, 1, 'Q/S/F must still agree');
});

test('cross-edition hints: only ESPN rows in ESPN editions of the same week; never another official edition', async () => {
  const src = fs.readFileSync(new URL('../workers/tennis-ingest/src/wta-history-job.js', import.meta.url), 'utf8');
  assert.match(src, /c\.source === 'espn' && c\.edition_source === 'espn' && sameEventWeek/);
  assert.doesNotMatch(src, /const overlaps =/);
});

test('self-heal: a row found by its own id that duplicates an official row in this edition is merged into it', async () => {
  const s = new MemStore();
  const OTHER = '00000000-0000-4000-8000-00000000e779';
  await writeMatches(s, [sm('espn', '414-2026:1', 'Q-1', '10', '20', { stage: 'qualifying' })], { edition_id: OTHER }, { dedupe: true });
  await writeMatches(s, [sm('wta', '0709-2026-RS033', 'Q-', '10', '20', { stage: 'qualifying' })], { edition_id: E });
  assert.equal(s.rows('tennis_matches').length, 2, 'two rows before (ESPN in its own edition)');
  const r = await writeMatches(s, [sm('espn', '414-2026:1', 'Q-1', '10', '20', { stage: 'qualifying' })], { edition_id: E }, { dedupe: true });
  assert.equal(r.merged, 1);
  assert.equal(s.rows('tennis_matches').length, 1);
  assert.equal(s.rows('tennis_matches')[0].source_family, 'wta');
  assert.equal(s.rows('tennis_match_external_ids').find((x) => x.provider === 'espn').match_id, s.rows('tennis_matches')[0].match_id);
  assert.ok(s.rows('tennis_source_changes').some((c) => c.kind === 'duplicate_merged'));
});

test('history backfill: completion ledger skips finished players across shard layouts; resume page; deadlock retry; cron yields to admin', async () => {
  const { wtaHistoryStep, ADMIN_FLAG } = await import('../workers/tennis-ingest/src/wta-history-job.js');
  const { MemKV } = await import('./helpers/memstore.js');
  const kv = new MemKV();
  const built = new Date().toISOString();
  await kv.put('wh:queue', JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f']));
  await kv.put('wh:done:b', '{"rows":3}');
  await kv.put('wh:page:c', '2');
  await kv.put('wh:state:0/2', JSON.stringify({ i: 0, page: 0, built_at: built, players_done: 0 }));
  await kv.put('wh:state:1/2', JSON.stringify({ i: 1, page: 0, built_at: built, players_done: 0 }));
  const calls = [];
  let deadlocked = false;
  const pageFn = async (ctx, id, page) => {
    calls.push(`${id}:${page}`);
    if (id === 'e' && !deadlocked) { deadlocked = true; throw new Error('postgrest 500 {"code":"40P01"} deadlock detected'); }
    return { state: id === 'a' && page === 0 ? 'MORE' : 'END', rows: 10, written: 7, attached: 2, held: 1 };
  };
  const ctx = { kv };
  const s0 = await wtaHistoryStep(ctx, { pages: 8, shard: 0, shards: 2, admin: true, pageFn });
  const s1 = await wtaHistoryStep(ctx, { pages: 8, shard: 1, shards: 2, admin: true, pageFn });
  assert.deepEqual(calls, ['a:0', 'a:1', 'c:2', 'e:0', 'e:0', 'd:0', 'f:0']);
  assert.equal(s0.done, true); assert.equal(s1.done, true); assert.equal(s1.skipped_done, 1);
  assert.deepEqual(JSON.parse(await kv.get('wh:done:a')).pages, 2);
  assert.equal(JSON.parse(await kv.get('wh:done:a')).written, 14);
  assert.equal(await kv.get('wh:page:c'), null);
  // the cron (unsharded) stands aside while an admin backfill is active, then finds every player done
  assert.deepEqual(await wtaHistoryStep(ctx, { pages: 2, pageFn }), { skipped: 'admin_backfill_active' });
  await kv.delete(ADMIN_FLAG);
  await kv.put('wh:state', JSON.stringify({ i: 0, page: 0, built_at: built, players_done: 0 }));
  const cron = await wtaHistoryStep(ctx, { pages: 2, pageFn });
  assert.equal(cron.skipped_done, 6); assert.equal(cron.done, true); assert.equal(calls.length, 7);
});

test('history backfill: a stale state read never moves the cursor backward (driver resume wins when further)', async () => {
  const { wtaHistoryStep } = await import('../workers/tennis-ingest/src/wta-history-job.js');
  const { MemKV } = await import('./helpers/memstore.js');
  const kv = new MemKV();
  await kv.put('wh:queue', JSON.stringify(['a', 'b', 'c']));
  await kv.put('wh:state', JSON.stringify({ i: 0, page: 0, built_at: new Date().toISOString(), players_done: 0 }));
  const calls = [];
  const r = await wtaHistoryStep({ kv }, { pages: 1, resume: { i: 1, page: 3 }, pageFn: async (c, id, page) => { calls.push(`${id}:${page}`); return { state: 'MORE' }; } });
  assert.deepEqual(calls, ['b:3']); assert.equal(r.position, 1); assert.equal(r.page, 4);
  const back = await wtaHistoryStep({ kv }, { pages: 1, resume: { i: 0, page: 0 }, pageFn: async (c, id, page) => { calls.push(`${id}:${page}`); return { state: 'MORE' }; } });
  assert.equal(calls.at(-1), 'b:4'); assert.equal(back.position, 1);
});
