// Live source router (2026-09-29 ATP/WTA parity): tennis-live used to be a WTA worker (it imported providers/wta.js
// and only ever called the WTA matches adapter), so an ATP match could never become live. Now a live edition routes to
// the provider that owns its live state, and BOTH land in the same canonical rows through the same writer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIVE_PROVIDERS, providerFor, livePolicies } from '../workers/tennis-live/src/router.js';
import { espnEditionId, espnLiveScan, liveCandidates, noteCurrentEvent, currentLiveEvents, KV_EVENTS } from '../workers/tennis-ingest/src/espn-live.js';
import { parseEspnEvent, parseEspnLinescores, espnLiveFormat, splitEventId } from '../workers/providers/espn.js';
import { mintPlayerId } from '../workers/shared/canonical/identity.js';
import { MemStore, MemKV, fakeClient } from './helpers/memstore.js';

const ESPN_EVENT = JSON.parse(readFileSync(new URL('./fixtures/espn/event-959-2026-live.json', import.meta.url), 'utf8'));
const WTA_MATCHES = JSON.parse(readFileSync(new URL('./fixtures/wta/matches-1152.json', import.meta.url), 'utf8')).payload;
const NOW = Date.parse('2026-09-30T06:00:00Z'); // MS 183447 scheduled 03:00Z, MD 183472 05:30Z: both started
const WTA_ED = { edition_id: '00000000-0000-4000-8000-00000000a001', event_id: '1152', year: 2026, level: 'WTA 250', end_date: '2099-01-01' };
const status = (name, period = 2) => ({ period, type: { id: name === 'STATUS_IN_PROGRESS' ? '2' : '1', name, state: name === 'STATUS_IN_PROGRESS' ? 'in' : 'pre', completed: false } });
const ls = (...sets) => ({ count: sets.length, items: sets.map(([v, tb], i) => ({ period: i + 1, value: v, displayValue: String(v), ...(tb != null ? { tiebreak: tb } : {}) })) });
// ATP founding ids for the fixture's ESPN athletes (as the espn_atp lane's stored crosswalk would hold them)
const CROSSWALK = { 2367: ['K09Z', 'Karen Khachanov'], 3209: ['AG37', 'Felix Auger-Aliassime'], 2865: ['BK92', 'Alexander Bublik'], 10073: ['S0H2', 'Shang Juncheng'], 3700: ['C0AU', 'Francisco Cerundolo'], 3511: ['RC91', 'Arthur Rinderknech'] };

async function seed() {
  const store = new MemStore();
  const parsed = parseEspnEvent(ESPN_EVENT, { league: 'atp' });
  const espnEd = await espnEditionId(parsed.edition);
  await store.upsert('tennis_tournament_editions', [{ edition_id: espnEd, surface: 'hard', indoor: false, source_family: 'espn' }, { edition_id: WTA_ED.edition_id, surface: 'hard', indoor: false, source_family: 'wta' }], { onConflict: 'edition_id' });
  for (const [espnId, [atp, name]] of Object.entries(CROSSWALK)) {
    const pid = await mintPlayerId('atp', atp);
    await store.upsert('tennis_players', [{ pbe_player_id: pid, founding_external_key: `atp:${atp}`, full_name: name, gender: 'M' }], { onConflict: 'pbe_player_id' });
    await store.upsert('tennis_player_external_ids', [{ provider: 'espn', external_id: espnId, pbe_player_id: pid }], { onConflict: 'provider,external_id' });
  }
  return { store, espnEd };
}

function clientFor(state) {
  return fakeClient([
    [/api\.wtatennis\.com\/tennis\/tournaments\/1152\/2026\/matches$/, JSON.stringify(WTA_MATCHES)],
    [/leagues\/atp\/events\/959-2026$/, () => state.event],
    [/competitions\/(\d+)\/status$/, (u) => status(state.status[/competitions\/(\d+)\/status/.exec(u)[1]] || 'STATUS_SCHEDULED')],
    [/competitors\/([\d-]+)\/linescores$/, (u) => state.ls[/competitors\/([\d-]+)\/linescores/.exec(u)[1]] || ls()]
  ]);
}
const hostOf = (u) => new URL(u).host;

test('router: WTA editions -> official WTA provider; ATP (ESPN) editions -> ESPN provider; unknown sources refused', () => {
  assert.equal(providerFor({ edition_id: 'x', event_id: '1152', year: 2026 }).key, 'wta', 'entries written before the router carry no source: WTA calendar editions');
  assert.equal(providerFor({ source: 'wta' }).key, 'wta');
  assert.equal(providerFor({ source: 'espn', event_id: '959-2026' }).key, 'espn');
  assert.throws(() => providerFor({ source: 'flashscore' }), /no live provider/);
  const { wta, espn } = LIVE_PROVIDERS;
  assert.deepEqual([...wta.events], ['WS', 'WD']);
  assert.deepEqual([...espn.events], ['MS', 'MD', 'XD']);
  assert.equal(wta.events.filter((e) => espn.events.includes(e)).length, 0, 'no event type has two live providers');
  assert.equal(espn.official, false, 'the ATP live feed is secondary and says so');
  assert.equal(espn.granularity, 'game');
  assert.deepEqual(Object.keys(livePolicies()).sort(), ['api.wtatennis.com', 'sports.core.api.espn.com']);
});

test('WS/WD edition and MS/MD edition both write canonical live match state + canonical events, with no source mixing', async () => {
  const { store, espnEd } = await seed();
  const state = { event: ESPN_EVENT, status: { 183447: 'STATUS_IN_PROGRESS', 183472: 'STATUS_IN_PROGRESS' }, ls: { 2367: ls([6], [3]), 3209: ls([4], [2]), '2865-10073': ls([7, 7], [2]), '3700-3511': ls([6, 5], [3]) } };
  const kv = new MemKV();
  const wtaCtx = { env: {}, store, kv, client: clientFor(state), log: [], upstream: 0, now: NOW };
  const espnCtx = { env: {}, store, kv, client: clientFor(state), log: [], upstream: 0, now: NOW };

  const w = await providerFor(WTA_ED).observe(wtaCtx, WTA_ED);
  const a = await providerFor({ source: 'espn', league: 'atp', event_id: '959-2026', edition_id: espnEd }).observe(espnCtx, { source: 'espn', league: 'atp', event_id: '959-2026', edition_id: espnEd });
  assert.equal(w.state, 'PASS'); assert.ok(w.live >= 1, 'the WTA fixture has a doubles match in progress');
  assert.equal(a.state, 'PASS'); assert.equal(a.live, 2); assert.equal(a.edition_id, espnEd);

  // each provider only ever spoke to its own host
  assert.deepEqual([...new Set(wtaCtx.client.calls.map(hostOf))], ['api.wtatennis.com']);
  assert.deepEqual([...new Set(espnCtx.client.calls.map(hostOf))], ['sports.core.api.espn.com']);
  assert.ok(!espnCtx.client.calls.some((u) => /186260/.test(u)), 'a competition with a result line is never polled for live state');

  const matches = store.rows('tennis_matches');
  const wtaRows = matches.filter((m) => m.source_family === 'wta');
  const atpRows = matches.filter((m) => m.source_family === 'espn');
  assert.ok(wtaRows.length >= 1 && wtaRows.every((m) => ['WS', 'WD'].includes(m.event_type) && m.edition_id === WTA_ED.edition_id));
  assert.equal(atpRows.length, 2);
  assert.ok(atpRows.every((m) => ['MS', 'MD', 'XD'].includes(m.event_type) && m.edition_id === espnEd), 'ESPN rows only in the ATP edition, only men/mixed events');
  const ms = atpRows.find((m) => m.event_type === 'MS');
  const md = atpRows.find((m) => m.event_type === 'MD');
  assert.equal(ms.status, 'in_progress'); assert.equal(ms.score_text, '6-4 3-2'); assert.equal(ms.format_key, 'BO3_TB7');
  assert.equal(md.status, 'in_progress'); assert.equal(md.format_key, 'DOUBLES_TOUR'); assert.match(md.score_text, /^7-6/);
  assert.deepEqual(ms.live_state, { point: null, server: null, granularity: 'game', period: 2 }, 'ESPN publishes no point score or server: null, never invented');
  const wtaLive = wtaRows.find((m) => m.status === 'in_progress');
  assert.ok(wtaLive.live_state.point, 'official WTA live rows keep their point score');
  // same canonical row shape whichever provider wrote it
  assert.deepEqual(Object.keys(ms).sort(), Object.keys(wtaLive).sort());
  assert.ok(ms.source_updated_at, 'every ESPN live row carries its observation time (API freshness gate)');

  const events = store.rows('tennis_match_events');
  const evWta = events.filter((e) => e.match_id === wtaLive.match_id);
  const evAtp = events.filter((e) => e.match_id === ms.match_id);
  assert.ok(evWta.length >= 1 && evWta.every((e) => e.source === 'wta' && e.quality === 'score_snapshot'));
  assert.ok(evAtp.length >= 1 && evAtp.every((e) => e.source === 'espn' && e.quality === 'score_snapshot'));
  assert.deepEqual(Object.keys(evAtp[0]).sort(), Object.keys(evWta[0]).sort(), 'one canonical event model');
  // the canonical players are the ATP founding ids (crosswalk), not ESPN-minted ids
  const parts = store.rows('tennis_match_participants').filter((p) => p.match_id === ms.match_id).map((p) => p.participant_key);
  assert.deepEqual(parts.sort(), [`S:${await mintPlayerId('atp', 'AG37')}`, `S:${await mintPlayerId('atp', 'K09Z')}`].sort());

  // next observation: the score moved -> a new snapshot event + a source change, still one row per match
  state.ls[2367] = ls([6], [4]);
  const a2 = await LIVE_PROVIDERS.espn.observe(espnCtx, { source: 'espn', event_id: '959-2026' });
  assert.equal(a2.live, 2);
  assert.equal(store.rows('tennis_matches').filter((m) => m.source_family === 'espn').length, 2);
  assert.equal(store.rows('tennis_matches').find((m) => m.match_id === ms.match_id).score_text, '6-4 4-2');
  assert.ok(store.rows('tennis_match_events').filter((e) => e.match_id === ms.match_id).length > evAtp.length);
  assert.ok(store.rows('tennis_source_changes').some((c) => c.entity_id === ms.match_id && c.source_family === 'espn'));

  // the match ends: ESPN prints the result line -> the previously-live competition is written final
  const done = structuredClone(ESPN_EVENT);
  const c = done.competitions.find((x) => x.id === '183447');
  c.notes = [{ type: 'Round 1 - Capital Group Diamond', text: 'Karen Khachanov (RUS) bt (2) Felix Auger-Aliassime (CAN) 6-4 6-4' }];
  c.competitors[0].winner = true; c.competitors[1].winner = false;
  state.event = done; delete state.status[183447];
  const a3 = await LIVE_PROVIDERS.espn.observe(espnCtx, { source: 'espn', event_id: '959-2026' });
  assert.equal(a3.live, 1, 'only the doubles is still live');
  const fin = store.rows('tennis_matches').find((m) => m.match_id === ms.match_id);
  assert.equal(fin.status, 'completed'); assert.equal(fin.score_text, '6-4 6-4'); assert.equal(fin.winner_side, 'A');
});

test('ownership: the ingest discovery scan never observes or writes an edition tennis-live owns', async () => {
  const { store, espnEd } = await seed();
  const kv = new MemKV();
  const today = '2026-09-30';
  await noteCurrentEvent(kv, today, { event: '959-2026', state: 'PASS', final: false, start_date: '2026-09-27', end_date: '2026-10-11', edition_id: espnEd, name: 'China Open' });
  assert.equal(currentLiveEvents(await kv.get(KV_EVENTS, 'json'), today).length, 1);
  const state = { event: ESPN_EVENT, status: { 183447: 'STATUS_IN_PROGRESS' }, ls: { 2367: ls([2]), 3209: ls([1]) } };
  const prev = { source: 'espn', league: 'atp', event_id: '959-2026', edition_id: espnEd, live: 1 };
  const owned = { env: {}, store, kv, client: clientFor(state), log: [], upstream: 0, now: NOW };
  await kv.put('espn:live:959-2026', JSON.stringify(['183447'])); // tennis-live is tracking a competition of this event
  const r = await espnLiveScan(owned, { today, owned: new Set([espnEd]), prevLive: new Map([[espnEd, prev]]) });
  assert.equal(r.out[0].state, 'OWNED_BY_LIVE');
  assert.equal(owned.client.calls.length, 0, 'no upstream read for an owned edition');
  assert.equal(store.rows('tennis_matches').length, 0, 'no write for an owned edition');
  assert.deepEqual(r.live, [prev], 'the owned edition stays in live:editions while a competition is tracked');
  await kv.put('espn:live:959-2026', JSON.stringify([]));
  // not owned: the scan observes it and hands it to tennis-live as an ESPN entry
  const free = { env: {}, store, kv, client: clientFor(state), log: [], upstream: 0, now: NOW };
  const r2 = await espnLiveScan(free, { today, owned: new Set(), prevLive: new Map() });
  assert.equal(r2.live.length, 1);
  assert.equal(r2.live[0].source, 'espn'); assert.equal(r2.live[0].event_id, '959-2026'); assert.equal(r2.live[0].edition_id, espnEd);
  assert.equal(providerFor(r2.live[0]).key, 'espn', 'the next tennis-live cycle routes it to the ESPN provider');
});

test('ESPN live parsing proves what it writes: contiguous sets, known formats, match tiebreak, no guessed state', () => {
  assert.deepEqual(parseEspnLinescores({ items: [{ period: 2, value: 3 }, { period: 1, value: 7, tiebreak: 7 }] }), [{ period: 1, games: 7, tiebreak: 7 }, { period: 2, games: 3, tiebreak: null }]);
  assert.equal(parseEspnLinescores({}), null);
  assert.equal(espnLiveFormat({ et: 'MS', year: 2026, stage: 'main' }), 'BO3_TB7');
  assert.equal(espnLiveFormat({ et: 'MD', year: 2026, stage: 'main' }), 'DOUBLES_TOUR');
  assert.equal(espnLiveFormat({ et: 'MS', slamKey: 'us-open', year: 2026, stage: 'main' }), 'BO5_FINAL_TB10');
  assert.equal(espnLiveFormat({ et: 'MD', slamKey: 'wimbledon', year: 2026, stage: 'main' }), null, 'Slam doubles formats vary: unknown, not guessed');
  const ev = structuredClone(ESPN_EVENT);
  const idMap = {};
  // a gap in the sets (set 2 missing) is not a provable observation
  let p = parseEspnEvent(ev, { idMap, league: 'atp', now: NOW, live: { 183447: { A: [{ period: 1, games: 6 }, { period: 3, games: 1 }], B: [{ period: 1, games: 4 }, { period: 3, games: 0 }] } } });
  assert.ok(p.skipped.some((s) => s.id === '959-2026:183447' && s.reason === 'live_unproven'));
  // doubles: split sets under DOUBLES_TOUR -> the third period is the match tiebreak (points), unfinished = no winner
  p = parseEspnEvent(ev, { idMap, league: 'atp', now: NOW, live: { 183472: { A: [{ period: 1, games: 6 }, { period: 2, games: 3 }, { period: 3, games: 5 }], B: [{ period: 1, games: 3 }, { period: 2, games: 6 }, { period: 3, games: 4 }] } } });
  const md = p.matches.find((m) => m.provider_match_id === '959-2026:183472');
  assert.equal(md.status, 'in_progress');
  assert.deepEqual(md.sets[2], { games: { A: 0, B: 0 }, tiebreak: { A: 5, B: 4, winner_points_derived: false }, is_match_tiebreak: true });
  // live candidates: only started, unfinished ATP-league competitions (never one with a result line)
  const cands = liveCandidates(ev, { now: NOW });
  assert.deepEqual(cands.map((c) => c.id), ['183447', '183472']);
  assert.deepEqual(liveCandidates(ev, { now: Date.parse('2026-09-30T04:00:00Z') }).map((c) => c.id), ['183447']);
  assert.deepEqual(splitEventId('959-2026'), { tid: 959, year: 2026 });
});

// ---- 2026-10-03 ATP live forensics: every candidate ends with a reason code; ownership is not self-perpetuating ----
import { espnLiveObserve as observeTraced } from '../workers/tennis-ingest/src/espn-live.js';
test('ESPN live observe: per-competition stage trace ends in a reason code for every candidate (no silent drop)', async () => {
  const { store, espnEd } = await seed();
  const state = { event: ESPN_EVENT, status: { 183447: 'STATUS_IN_PROGRESS', 183472: 'STATUS_IN_PROGRESS' }, ls: { 2367: ls([6], [3]), 3209: ls([4], [2]), '2865-10073': ls([7, 7], [2]), '3700-3511': ls([6, 5], [3]) } };
  const ctx = { env: {}, store, kv: new MemKV(), client: clientFor(state), log: [], upstream: 0, now: NOW };
  const r = await observeTraced(ctx, '959-2026', { maxStatus: 4 });
  assert.equal(r.state, 'PASS');
  for (const id of ['183447', '183472']) assert.deepEqual(r.trace[id].slice(-4), ['LIVE', 'NORMALIZED:in_progress', 'WRITE_ATTEMPTED', 'WRITTEN'], `${id}: ${r.trace[id]}`);
  for (const [id, codes] of Object.entries(r.trace)) assert.ok(codes.length && /^(WRITTEN|NOT_LIVE:|STATUS_|LINESCORES_|NOT_PARSED:|NOT_KEPT:|HELD:|ATTACHED|SKIPPED_|EDITION_PENDING|WRITE_FAILED:|STATUS_BUDGET_EXCEEDED)/.test(codes.at(-1)), `${id} ends without a reason: ${codes}`);
  assert.ok(!('outcomes' in r), 'per-row outcomes stay internal to the trace');
});
test('ESPN live observe: a failing write is WRITE_FAILED with its reason, never an opaque PASS', async () => {
  const { store } = await seed();
  const state = { event: ESPN_EVENT, status: { 183447: 'STATUS_IN_PROGRESS' }, ls: { 2367: ls([6], [3]), 3209: ls([4], [2]) } };
  const broken = new Proxy(store, { get: (t, k) => (k === 'upsert' ? async (table, ...a) => { if (table === 'tennis_matches') { const e = new Error('simulated 500'); e.status = 500; throw e; } return t.upsert(table, ...a); } : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
  const r = await observeTraced({ env: {}, store: broken, kv: new MemKV(), client: clientFor(state), log: [], upstream: 0, now: NOW }, '959-2026', { maxStatus: 4 });
  assert.equal(r.state, 'WRITE_FAILED');
  assert.match(r.trace['183447'].at(-1), /^WRITE_FAILED:simulated 500/);
});
test('ESPN live ownership is released when tennis-live tracks no competition of the event (Beijing 2026-09-30 regression)', async () => {
  const { espnLiveScan: scan } = await import('../workers/tennis-ingest/src/espn-live.js');
  const kv = new MemKV();
  const ed = { edition_id: 'ed-959', event_id: '959-2026', source: 'espn', live: 1 };
  await kv.put(KV_EVENTS, JSON.stringify({ '959-2026': { edition_id: 'ed-959', name: 'China Open', start_date: '2026-09-26', end_date: '2026-10-11', final: false } }));
  const ctx = { env: {}, store: new MemStore(), kv, client: clientFor({ event: ESPN_EVENT, status: {}, ls: {} }), log: [], upstream: 0, now: NOW };
  const owned = new Set(['ed-959']);
  const prevLive = new Map([['ed-959', ed]]);
  let r = await scan(ctx, { today: '2026-09-30', owned, prevLive });
  assert.equal(r.out[0].state, 'OWNERSHIP_RELEASED');
  assert.equal(r.live.length, 0, 'nothing tracked -> not handed back -> ingest writes the edition again');
  await kv.put('espn:live:959-2026', JSON.stringify(['183451']));
  r = await scan(ctx, { today: '2026-09-30', owned, prevLive });
  assert.equal(r.out[0].state, 'OWNED_BY_LIVE');
  assert.equal(r.live.length, 1, 'a tracked competition keeps tennis-live as owner');
});
