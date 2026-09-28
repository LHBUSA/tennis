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
  await kv.put('wh:queue:built_at', built);
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
  await kv.put('wh:queue:built_at', new Date().toISOString());
  await kv.put('wh:state', JSON.stringify({ i: 0, page: 0, built_at: new Date().toISOString(), players_done: 0 }));
  const calls = [];
  const r = await wtaHistoryStep({ kv }, { pages: 1, resume: { i: 1, page: 3 }, pageFn: async (c, id, page) => { calls.push(`${id}:${page}`); return { state: 'MORE' }; } });
  assert.deepEqual(calls, ['b:3']); assert.equal(r.position, 1); assert.equal(r.page, 4);
  const back = await wtaHistoryStep({ kv }, { pages: 1, resume: { i: 0, page: 0 }, pageFn: async (c, id, page) => { calls.push(`${id}:${page}`); return { state: 'MORE' }; } });
  assert.equal(calls.at(-1), 'b:4'); assert.equal(back.position, 1);
});

test('round-robin matchdays of small draws (WTA Finals) and scoreless D rows (walkovers) are mapped; anything else stays held', async () => {
  const base = { s_d_flag: 'S', qpm_flag: 'M', winner: 1, player_1: '320760', player_2: '316956', tournament: { tournamentGroup: { id: 808, name: 'WTA FINALS', level: 'WTA Finals' }, year: 2022, startDate: '2022-10-31', endDate: '2022-11-07', surface: 'Hard', inOutdoor: 'I', singlesDrawSize: 8, doublesDrawSize: 8 } };
  const rr = parseHistoryRow({ ...base, round_name: 'R1', reason_code: 'W', scores: '6-2  2-6  6-1' }, { today: '2026-09-27' });
  assert.equal(rr.match.stage, 'round_robin'); assert.equal(rr.match.round_code, 'RR'); assert.equal(rr.match.status, 'completed');
  // the same label in a 32 draw is not a round-robin day: held
  const ko = parseHistoryRow({ ...base, round_name: 'R1', reason_code: 'W', scores: '6-2  6-1', tournament: { ...base.tournament, singlesDrawSize: 32 } }, { today: '2026-09-27' });
  assert.equal(ko.match.status, null); assert.ok(ko.match.warnings.includes('unmapped_round:R1'));
  const wo = parseHistoryRow({ ...base, round_name: 'S', reason_code: 'D', scores: '' }, { today: '2026-09-27' });
  assert.equal(wo.match.status, 'walkover'); assert.equal(wo.match.end_reason, 'walkover'); assert.equal(wo.match.sets.length, 0); assert.ok(wo.match.winner_side);
  const dScore = parseHistoryRow({ ...base, round_name: 'S', reason_code: 'D', scores: '6-2  3-1' }, { today: '2026-09-27' });
  assert.equal(dScore.match.status, null, 'a D row with a score is held');
});

test('history backfill: a queue rebuild keeps the population and adds only new official top-list players (never every minted WTA id)', async () => {
  const { wtaHistoryStep } = await import('../workers/tennis-ingest/src/wta-history-job.js');
  const { MemKV } = await import('./helpers/memstore.js');
  const kv = new MemKV();
  await kv.put('wh:queue', JSON.stringify(['p1', 'p2']));
  await kv.put('wh:queue:built_at', '2020-01-01T00:00:00Z'); // stale -> rebuilt from the previous queue
  const store = {
    async select(t) {
      if (t === 'tennis_ranking_snapshots') return [{ snapshot_id: 's1' }];
      if (t === 'tennis_rankings') return [{ provider_player_id: 'p2', rank: 1 }, { provider_player_id: 'n9', rank: 2 }];
      if (t === 'tennis_players') throw new Error('must not scan every canonical WTA player on a rebuild');
      return [];
    }
  };
  await wtaHistoryStep({ kv, store }, { pages: 0 });
  assert.deepEqual(JSON.parse(await kv.get('wh:queue')), ['p1', 'p2', 'n9']);
});

test('precedence never turns a played match into "not played": an official walkover against a scored ESPN row attaches and is held', async () => {
  const s = new MemStore();
  await writeMatches(s, [sm('espn', '154-2016:67243', '2', '10', '20')], { edition_id: E }, { dedupe: true });
  const wo = sm('wta_history', '901-2016-WS-M-R32-10-20', '2', '10', '20', { status: 'walkover', end_reason: 'walkover', sets: [] });
  const r = await writeMatches(s, [wo], { edition_id: E }, { dedupe: true });
  assert.equal(r.taken_over, 0); assert.equal(r.attached, 1);
  const row = s.rows('tennis_matches')[0];
  assert.equal(row.status, 'completed'); assert.equal(row.source_family, 'espn');
  assert.ok(s.rows('tennis_ingest_holds').some((h) => h.entity_type === 'cross_source' && /walkover/.test(h.problems.join(' '))));
  // a 0-0 retirement is not "played": the official walkover takes it over
  const s2 = new MemStore();
  await writeMatches(s2, [sm('espn', '278-2008:12236', '2', '10', '20', { status: 'retired', end_reason: 'retirement', retired_side: 'B', sets: [{ games: { A: 0, B: 0 }, tiebreak: null, is_match_tiebreak: false }] })], { edition_id: E }, { dedupe: true });
  const r2 = await writeMatches(s2, [sm('wta_history', '1026-2008-WS-M-R16-10-20', '2', '10', '20', { status: 'walkover', end_reason: 'walkover', sets: [] })], { edition_id: E }, { dedupe: true });
  assert.equal(r2.taken_over, 1);
});

test('history: an HTTP 200 with an empty body ends that player (no match list), recorded for audit', async () => {
  const { historyPage } = await import('../workers/tennis-ingest/src/wta-history-job.js');
  const { MemKV, MemStore } = await import('./helpers/memstore.js');
  const kv = new MemKV();
  const ctx = { kv, store: new MemStore(), env: {}, upstream: 0, log: [], client: { stats: {}, async get(url) { return { url, status: 200, ok: true, body: '', bytes: 0, content_type: 'application/json', fetched_at: new Date().toISOString(), latency_ms: 1 }; } } };
  const r = await historyPage(ctx, '1022815', 0);
  assert.equal(r.state, 'END'); assert.equal(r.empty_body, true);
  assert.deepEqual(JSON.parse(await kv.get('wh:empty')), ['1022815']);
});

test('history: a 200 with a body that drifted is NOT treated as an empty history (it fails loudly)', async () => {
  const { historyPage } = await import('../workers/tennis-ingest/src/wta-history-job.js');
  const { MemKV, MemStore } = await import('./helpers/memstore.js');
  const ctx = { kv: new MemKV(), store: new MemStore(), env: {}, upstream: 0, log: [], client: { stats: {}, async get(url) { return { url, status: 200, ok: true, body: '{"unexpected":true}', bytes: 19, content_type: 'application/json', fetched_at: new Date().toISOString(), latency_ms: 1 }; } } };
  await assert.rejects(historyPage(ctx, '1', 0), /shape_drift/);
});

test('writeGroups: several editions in one pass keep per-edition identity (the same pair in two editions = two matches; takeover and attach decided per edition)', async () => {
  const { writeGroups } = await import('../workers/tennis-ingest/src/writer.js');
  const s = new MemStore();
  await writeMatches(s, [sm('espn', '402-2012:1', '2', '10', '20')], { edition_id: E }, { dedupe: true });
  await writeMatches(s, [sm('wta', '999-2012-LS007', 'M-2', '10', '20')], { edition_id: E2 }, { dedupe: true });
  const r = await writeGroups(s, [
    { edition: { edition_id: E, surface: 'clay' }, sourceMatches: [sm('wta_history', 'h-E-10-20', '2', '10', '20')] },
    { edition: { edition_id: E2, surface: 'hard' }, sourceMatches: [sm('wta_history', 'h-E2-10-20', '2', '10', '20'), sm('wta_history', 'h-E2-10-30', '2', '10', '30')] }
  ], { dedupe: true });
  assert.equal(r.taken_over, 1, 'E: history takes over the ESPN row');
  assert.equal(r.attached, 1, 'E2: history attaches to the official WTA API row');
  assert.equal(r.written, 2, 'the takeover + the new E2 match');
  const inE = s.rows('tennis_matches').filter((m) => m.edition_id === E);
  const inE2 = s.rows('tennis_matches').filter((m) => m.edition_id === E2);
  assert.equal(inE.length, 1); assert.equal(inE2.length, 2);
  assert.equal(inE[0].source_family, 'wta_history'); assert.equal(inE[0].surface, 'clay');
  assert.equal(inE2.find((m) => m.source_family === 'wta_history').surface, 'hard');
});
