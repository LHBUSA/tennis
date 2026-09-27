// ESPN ATP lane: parser, formats, identity (fail-closed), cross-source duplicate prevention, idempotency,
// rankings, blocked endpoints. Fixtures are trimmed real captures (tests/fixtures/espn, 2026-09-27); the
// Wikidata crosswalk rows and canonical players seeded below are synthetic test inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as espn from '../workers/providers/espn.js';
import { normalizeMatch } from '../workers/shared/canonical/normalize.js';
import { resolveEspnIdentity, wikidataEspnMap } from '../workers/shared/canonical/espn-identity.js';
import { mintPlayerId } from '../workers/shared/canonical/identity.js';
import { tournamentId, editionId } from '../workers/shared/canonical/ids.js';
import { writeMatches, naturalKey, winnerGames } from '../workers/tennis-ingest/src/writer.js';
import { espnEventStep, espnAtpStep, espnRankingStep } from '../workers/tennis-ingest/src/espn-jobs.js';
import { rankingAsOf, priorMatches } from '../workers/shared/features/asof.js';
import { MemStore, MemKV, fakeClient } from './helpers/memstore.js';

const fx = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/espn/${f}`, import.meta.url), 'utf8'));
// every athlete resolves to a synthetic ATP id (score / format tests); XD women resolve to WTA ids
const allResolve = (women = []) => new Proxy({}, { get: (_, k) => (typeof k === 'string' ? { provider: women.includes(k) ? 'wta' : 'atp', provider_id: `T${k}`, gender: women.includes(k) ? 'F' : 'M', method: 'external_id', evidence: 'test' } : undefined) });
const byComp = (r) => Object.fromEntries(r.matches.map((m) => [m.provider_match_id.split(':')[1], m]));

// ---- result line --------------------------------------------------------------------------------------
test('result line: winner-oriented sets, tiebreaks, endings (real ESPN lines)', () => {
  const a = espn.parseResultNote('Dusan Lajovic (SER) bt Facundo Diaz Acosta (ARG) 7-6 (7-3) 5-7 7-6 (10-3)');
  assert.deepEqual(a.sets.map((s) => [s.w, s.l, s.tb?.w ?? null, s.tb?.l ?? null]), [[7, 6, 7, 3], [5, 7, null, null], [7, 6, 10, 3]]);
  assert.equal(a.ending, 'completed');
  assert.equal(espn.parseResultNote('Hugo Grenier (FRA) bt Daniel Elahi Galan (COL) 7-6 (11-9) 1-0 ret').ending, 'retirement');
  assert.equal(espn.parseResultNote('(27) Alexander Blockx (BEL) bt Jaume Munar (ESP) w/o').ending, 'walkover');
  assert.equal(espn.parseResultNote('(4) Novak Djokovic (SER) bt (16) Jakub Mensik (CZE) ').ending, 'none');
  const d = espn.parseResultNote('Zhang Shuai (CHN) & Rohan Bopanna (IND) bt (4) Taylor Townsend (USA) & Hugo Nys (MON) w/o');
  assert.equal(d.loserText, '(4) Taylor Townsend (USA) & Hugo Nys (MON)');
  assert.equal(espn.parseResultNote('Andreas Haider-Maurer (Aut) bt (7) Marcel Granollers (Spa) 3-6 7-6 (8-6) 2-0 ret').sets.length, 3);
  assert.equal(espn.parseResultNote('no result here'), null);
  assert.equal(espn.parseResultNote('A (USA) bt B (USA) 6-4 6-4 suspended'), null, 'unknown ending is not a result');
});

test('rounds: canonical codes shared with the Slam feeds; qualifying final follows the numbered rounds', () => {
  assert.deepEqual(espn.espnRound({ description: 'Qualifying 2nd Round' }), { stage: 'qualifying', code: 'Q-2' });
  assert.deepEqual(espn.espnRound({ description: 'Qualifying Final' }, 2), { stage: 'qualifying', code: 'Q-3' });
  assert.deepEqual(espn.espnRound({ description: 'Round 3' }), { stage: 'main', code: '3' });
  assert.deepEqual(espn.espnRound({ description: 'Quarterfinal' }), { stage: 'main', code: 'Q' });
  assert.deepEqual(espn.espnRound({ description: 'Final' }), { stage: 'main', code: 'F' });
  assert.equal(espn.espnRound({ description: 'Bronze Medal Match' }), null);
});

test('formats: deciding-set rules by Slam and year; non-Slam tiebreak sets; doubles match tiebreak', () => {
  assert.equal(espn.espnFormat({ year: 2015, bestOf: 3 }), 'BO3_TB7');
  assert.equal(espn.espnFormat({ year: 2015, bestOf: 3, matchTiebreak: true }), 'DOUBLES_TOUR');
  assert.equal(espn.espnFormat({ slamKey: 'australian-open', year: 2018, bestOf: 5 }), 'BO5_FINAL_ADV');
  assert.equal(espn.espnFormat({ slamKey: 'australian-open', year: 2019, bestOf: 5 }), 'BO5_FINAL_TB10');
  assert.equal(espn.espnFormat({ slamKey: 'wimbledon', year: 2020, bestOf: 5 }), 'BO5_FINAL_TB7_AT12');
  assert.equal(espn.espnFormat({ slamKey: 'roland-garros', year: 2021, bestOf: 5 }), 'BO5_FINAL_ADV');
  assert.equal(espn.espnFormat({ slamKey: 'us-open', year: 2021, bestOf: 5 }), 'BO5_TB7');
  assert.equal(espn.espnFormat({ slamKey: 'us-open', year: 2022, bestOf: 3 }), 'BO3_FINAL_TB10');
  assert.equal(espn.espnFormat({ slamKey: 'us-open', year: 2026, bestOf: 3, matchTiebreak: true }), 'BO3_MATCH_TB10');
  assert.equal(espn.espnFormat({ year: 2026, bestOf: null }), null);
});

// ---- events ------------------------------------------------------------------------------------------
test('AO 2026: completed, qualifying, retirement, walkover (status-confirmed), doubles, mixed', async () => {
  const j = fx('event-154-2026.json');
  const first = espn.parseEspnEvent(j, { idMap: allResolve(['8104', '1273']) });
  assert.equal(first.edition.slam, 'australian-open');
  assert.deepEqual(first.needsStatus, ['168603'], 'an empty score asks for the competition status');
  const r = espn.parseEspnEvent(j, { idMap: allResolve(), statusById: { 168603: 'STATUS_WALKOVER' } });
  const m = byComp(r);
  const fin = m['168571'];
  assert.equal(fin.status, 'completed');
  assert.equal(fin.format_key, 'BO5_FINAL_TB10');
  assert.equal(fin.round_code, 'F');
  const w = fin.winner_side;
  assert.deepEqual(fin.sets.map((s) => (w === 'A' ? [s.games.A, s.games.B] : [s.games.B, s.games.A])), [[2, 6], [6, 2], [6, 3], [7, 5]]);
  assert.equal(m['171004'].round_code, 'Q-1');
  assert.equal(m['171004'].format_key, 'BO3_FINAL_TB10');
  assert.equal(m['168492'].status, 'retired');
  assert.equal(m['168603'].status, 'walkover');
  assert.equal(m['168603'].sets.length, 0);
  assert.equal(m['168678'].event_type, 'MD');
  assert.equal(m['168697'].event_type, 'XD');
  assert.equal(m['168697'].format_key, 'BO3_MATCH_TB10');
  assert.ok(m['168697'].sets[2].is_match_tiebreak);
  const other = espn.parseEspnEvent(j, { idMap: allResolve(), statusById: { 168603: 'STATUS_FINAL' } });
  assert.equal(byComp(other)['168603'].status, null, 'an empty score without a walkover status is held');
  for (const x of r.matches.filter((x) => x.event_type !== 'XD')) assert.equal((await normalizeMatch(x)).canonical, true, x.provider_match_id);
});

test('historical 2015 (non-Slam): seeds, long tiebreaks, retirement; all normalize', async () => {
  const r = espn.parseEspnEvent(fx('event-20-2015.json'), { idMap: allResolve() });
  assert.equal(r.edition.slam, null);
  assert.equal(r.edition.start_date, '2015-01-05');
  const m = byComp(r);
  assert.equal(m['57543'].status, 'retired');
  assert.equal(m['57539'].format_key, 'BO3_TB7');
  const w = m['57539'].winner_side;
  const set1 = m['57539'].sets[0];
  assert.deepEqual(w === 'A' ? [set1.tiebreak.A, set1.tiebreak.B] : [set1.tiebreak.B, set1.tiebreak.A], [11, 13]);
  assert.equal(m['57539'].seeds[w], 8);
  for (const x of r.matches) assert.equal((await normalizeMatch(x)).canonical, true, x.provider_match_id);
});

test('US Open 2026: final + text walkover written; short-set mixed format refused', async () => {
  const r = espn.parseEspnEvent(fx('event-189-2026.json'), { idMap: allResolve() });
  const m = byComp(r);
  assert.equal(m['182677'].format_key, 'BO5_FINAL_TB10');
  assert.equal(m['184769'].status, 'walkover');
  assert.equal(m['184825'].status, null, '4-1 3-5 [10-7]: no documented format proves it -> held');
  assert.ok(m['184825'].warnings.includes('format_unprovable'));
});

test('non-Slam doubles "1-0 (10-2)" and historical "13-11" / "1-0 (10-7)" are match tiebreaks', async () => {
  const c = byComp(espn.parseEspnEvent(fx('event-421-2026.json'), { idMap: allResolve() }));
  assert.equal(c['181857'].format_key, 'DOUBLES_TOUR');
  assert.equal(c['181778'].status, 'walkover');
  assert.equal((await normalizeMatch(c['181857'])).canonical, true);
  const x11 = espn.parseEspnEvent(fx('event-154-2011-xd.json'), { idMap: allResolve() }).matches[0];
  const x21 = espn.parseEspnEvent(fx('event-154-2021-xd.json'), { idMap: allResolve() }).matches[0];
  for (const x of [x11, x21]) { assert.equal(x.format_key, 'BO3_MATCH_TB10'); assert.ok(x.sets[2].is_match_tiebreak); }
  const tb = x11.sets[2].tiebreak;
  assert.deepEqual([Math.max(tb.A, tb.B), Math.min(tb.A, tb.B)], [13, 11]);
});

test('in-progress / scheduled competitions are not written by this lane', () => {
  const r = espn.parseEspnEvent(fx('event-441-2026-inprogress.json'), { idMap: allResolve() });
  assert.equal(r.matches.length, 0);
  assert.ok(r.skipped.every((s) => ['no_result', 'competitor_ids'].includes(s.reason)));
});

test('malformed / contradictory competitions are held with a reason, never guessed', async () => {
  const j = fx('event-154-2026.json');
  const c = j.competitions.find((x) => x.id === '168571');
  const mut = (f) => { const k = structuredClone(j); k.competitions = [f(structuredClone(c))]; return espn.parseEspnEvent(k, { idMap: allResolve() }); };
  const flipped = mut((x) => { x.competitors.forEach((p) => { p.winner = !p.winner; }); return x; }).matches[0];
  assert.equal(flipped.status, null);
  assert.ok(flipped.warnings.includes('result_line_names_disagree_with_winner_flag'));
  const two = mut((x) => { x.competitors.forEach((p) => { p.winner = true; }); return x; }).matches[0];
  assert.ok(two.warnings.includes('winner_flag'));
  assert.equal(mut((x) => { x.round = { description: 'Playoff' }; return x; }).matches[0].status, null);
  assert.equal(mut((x) => { x.competitors = x.competitors.slice(0, 1); return x; }).skipped[0].reason, 'competitors');
  assert.equal(mut((x) => { x.notes = [{ type: 'Final', text: 'garbled 6-x' }]; return x; }).skipped[0].reason, 'no_result');
  const bad = await (await import('../workers/shared/adapter.js')).runAdapter(espn.espnEvent, { client: fakeClient([[/./, '<html>denied</html>']]), params: { id: '1-2026' } });
  assert.equal(bad.state, 'DEGRADED');
  assert.equal(bad.error, 'shape_drift');
});

test('an athlete id that resolves to someone not printed in the result is held (ESPN id remaps)', () => {
  const j = fx('event-154-2026.json');
  const fin = j.competitions.find((x) => x.id === '168571');
  const idMap = allResolve();
  const wrong = new Proxy({}, { get: (_, k) => (k === fin.competitors[0].id ? { ...idMap[k], canonical_name: 'Lesley Pattinama Kerkhove' } : idMap[k]) });
  const m = espn.parseEspnEvent({ ...j, competitions: [fin] }, { idMap: wrong }).matches[0];
  assert.equal(m.status, null);
  assert.ok(m.warnings.includes('resolved_player_not_in_result_line'));
  const right = new Proxy({}, { get: (_, k) => (k === fin.competitors[0].id ? { ...idMap[k], canonical_name: fin.competitors[0].name } : idMap[k]) });
  assert.equal(espn.parseEspnEvent({ ...j, competitions: [fin] }, { idMap: right }).matches[0].status, 'completed');
});

test('exhibitions and a Slam id carrying another name are skipped', () => {
  const j = fx('event-20-2015.json');
  assert.equal(espn.parseEspnEvent({ ...j, name: 'Laver Cup' }).skipped[0].reason, 'exhibition');
  assert.equal(espn.parseEspnEvent({ ...j, id: '154-2015', name: 'Something Else' }).skipped[0].reason, 'slam_name_mismatch');
});

// ---- identity ---------------------------------------------------------------------------------------
const baseIdc = (extra = {}) => {
  const players = new Map([['atp:S0AG', { pbe_player_id: 'p-sinner', full_name: 'Jannik Sinner', dob: '2001-08-16', nationality: 'ITA' }]]);
  const { wd, wdShared } = wikidataEspnMap([
    { h: { value: 'http://www.wikidata.org/entity/Q1' }, e: { value: '3623' }, atp: { value: 's0ag' } },
    { h: { value: 'http://www.wikidata.org/entity/Q2' }, e: { value: '777' }, atp: { value: 'ZZ01' } },
    { h: { value: 'http://www.wikidata.org/entity/Q3' }, e: { value: '778' }, atp: { value: 'ZZ01' } },
    { h: { value: 'http://www.wikidata.org/entity/Q4' }, e: { value: '900' }, atp: { value: 'NEW1' } }
  ]);
  return { stored: new Map(), wd, wdShared, players, nameIndex: { byExternal: new Map(), players: [{ pbe_player_id: 'p-sinner', full_name: 'Jannik Sinner', dob: '2001-08-16', nationality: 'ITA', founding: 'atp:S0AG' }, { pbe_player_id: 'p-a', full_name: 'Twin Name', dob: '1999-01-01', nationality: 'USA', founding: 'atp:TW01' }, { pbe_player_id: 'p-b', full_name: 'Twin Name', dob: '1999-01-01', nationality: null, founding: 'atp:TW02' }] }, ...extra };
};

test('identity: crosswalk and Wikidata P11585->P536 resolve; corroboration conflicts and shared ids refuse', () => {
  const idc = baseIdc();
  assert.equal(resolveEspnIdentity('3623', { ...idc, athlete: { last_name: 'Sinner', dob: '2001-08-16' } }).tour.provider_id, 'S0AG');
  assert.equal(resolveEspnIdentity('3623', { ...idc, athlete: { last_name: 'Sinner', dob: '2001-08-16' } }).method, 'external_id');
  assert.equal(resolveEspnIdentity('3623', { ...idc, athlete: { last_name: 'Alcaraz' } }).status, 'conflict');
  assert.equal(resolveEspnIdentity('3623', { ...idc, athlete: { last_name: 'Sinner', dob: '2001-08-17' } }).status, 'conflict');
  assert.equal(resolveEspnIdentity('777', { ...idc, athlete: null }).status, 'ambiguous', 'one ATP id on two ESPN athletes');
  assert.equal(resolveEspnIdentity('900', { ...idc, athlete: { full_name: 'New Player' } }).tour.provider_id, 'NEW1', 'a player we do not hold yet is minted from the tour id');
  const stored = baseIdc({ stored: new Map([['5', 'atp:S0AG']]) });
  assert.equal(resolveEspnIdentity('5', { ...stored, athlete: null }).status, 'resolved');
});

test('identity step 4: Wikidata tour-id holder by exact name + day DOB, unique; several holders refuse', async () => {
  const { wikidataNameIndex } = await import('../workers/shared/canonical/espn-identity.js');
  const idc = baseIdc({ wdNames: wikidataNameIndex([['atp:Q111', 'Anton Newman', '2002-10-30'], ['atp:D001', 'Dup Name', '2000-01-02'], ['atp:D002', 'Dup Name', '2000-01-02'], ['atp:Y001', 'Year Only', '2000']]) });
  const r = resolveEspnIdentity('50', { ...idc, athlete: { full_name: 'Anton Newman', dob: '2002-10-30' } });
  assert.equal(r.status, 'resolved');
  assert.equal(r.tour.provider_id, 'Q111');
  assert.equal(r.method, 'name_dob');
  assert.equal(resolveEspnIdentity('51', { ...idc, athlete: { full_name: 'Anton Newman', dob: '2002-10-31' } }).status, 'unresolved');
  assert.equal(resolveEspnIdentity('52', { ...idc, athlete: { full_name: 'Dup Name', dob: '2000-01-02' } }).status, 'ambiguous');
  assert.equal(resolveEspnIdentity('53', { ...idc, athlete: { full_name: 'Anton Newman', dob: null } }).status, 'unresolved', 'no DOB, no match');
  assert.equal(resolveEspnIdentity('2', { ...idc, athlete: { full_name: 'Twin Name', dob: '1999-01-01', nationality: 'USA' } }).status, 'ambiguous', 'step 4 never overrides a canonical ambiguity');
  assert.equal(winnerGames('6-2 6-1 0-0 RET', 'A'), winnerGames('6-2 6-1 RET', 'A'));
});

test('identity: names are never identity — name-only and non-unique name+DOB stay unresolved', () => {
  const idc = baseIdc();
  assert.equal(resolveEspnIdentity('1', { ...idc, athlete: { full_name: 'Jannik Sinner', dob: null } }).status, 'unresolved');
  assert.equal(resolveEspnIdentity('1', { ...idc, athlete: null, observedName: 'Jannik Sinner' }).status, 'unresolved');
  const ok = resolveEspnIdentity('1', { ...idc, athlete: { full_name: 'Jannik Sinner', dob: '2001-08-16', nationality: 'ITA' } });
  assert.equal(ok.status, 'resolved');
  assert.equal(ok.method, 'name_dob');
  assert.equal(resolveEspnIdentity('2', { ...idc, athlete: { full_name: 'Twin Name', dob: '1999-01-01', nationality: 'USA' } }).status, 'ambiguous');
  assert.equal(resolveEspnIdentity('3', { ...idc, athlete: { full_name: 'Jannik Sinner', dob: '2001-08-16', nationality: 'GER' } }).status, 'unresolved');
});

// ---- rankings ---------------------------------------------------------------------------------------
test('rankings: weekly list, observation date = ESPN lastUpdated, previous rank kept as printed', () => {
  const r = espn.parseEspnRanking(fx('ranking-2026-w38.json'), { season: 2026, week: 38 });
  assert.equal(r.observed_date, '2026-09-17');
  assert.equal(r.rows[0].rank, 1);
  assert.equal(r.rows[0].espn_id, '3623');
  assert.equal(r.rows.at(-1).previous_rank, 156);
  assert.equal(espn.parseEspnRanking(fx('ranking-2010-w10.json')).observed_date, '2010-03-01');
  assert.equal(espn.parseEspnRanking({ ranks: [] }), null);
});

test('no future leakage: a feature date only sees rankings observed on/before it and matches strictly before it', () => {
  const snaps = [{ ranking_date: '2026-09-07', rank: 5 }, { ranking_date: '2026-09-17', rank: 3 }];
  assert.equal(rankingAsOf(snaps, '2026-09-16').rank, 5, 'the list ESPN observed on 09-17 is invisible on 09-16');
  assert.equal(rankingAsOf(snaps, '2026-09-17').rank, 3);
  assert.equal(rankingAsOf(snaps, '2026-09-01'), null);
  const ms = [{ match_day: '2026-09-15' }, { match_day: '2026-09-16' }, { match_day: '2026-09-17' }];
  assert.deepEqual(priorMatches(ms, '2026-09-16').map((m) => m.match_day), ['2026-09-15']);
});

// ---- canonical writes: idempotency + cross-source duplicates ----------------------------------------------
const E = '00000000-0000-4000-8000-00000000e001';
const sm = (provider, id, event, round, A, B, sets, winner = 'A', extra = {}) => ({
  type: 'match', provider, provider_match_id: id, event_type: event, stage: /^Q-/.test(round) ? 'qualifying' : 'main', round_code: round, format_key: event === 'MS' ? 'BO3_TB7' : 'DOUBLES_TOUR',
  status: 'completed', winner_side: winner, end_reason: 'completed', sets: sets.map(([a, b]) => ({ games: { A: a, B: b }, tiebreak: null, is_match_tiebreak: false })),
  sides: { A: A.map((t) => ({ provider, provider_id: `${provider}-${t}`, tour_id: { provider: 'atp', provider_id: t }, gender: 'M', first_name: 'F', last_name: t })), B: B.map((t) => ({ provider, provider_id: `${provider}-${t}`, tour_id: { provider: 'atp', provider_id: t }, gender: 'M', first_name: 'F', last_name: t })) }, seeds: {}, entry: {}, warnings: [], ...extra
});
const count = (s, t) => s.rows(t).length;

test('secondary source attaches to an official match (no second row); re-ingest creates zero duplicates', async () => {
  const s = new MemStore();
  const ed = { edition_id: E, surface: 'hard', indoor: false };
  await writeMatches(s, [sm('ausopen', 'AO-1', 'MS', '1', ['AAAA'], ['BBBB'], [[6, 4], [6, 4]])], ed, { dedupe: true });
  assert.equal(count(s, 'tennis_matches'), 1);
  // ESPN: same match with sides flipped; plus a match the official feed does not have
  const esp = [sm('espn', '154-2026:1', 'MS', '1', ['BBBB'], ['AAAA'], [[4, 6], [4, 6]], 'B'), sm('espn', '154-2026:2', 'MS', '2', ['AAAA'], ['CCCC'], [[6, 1], [6, 1]])];
  const r1 = await writeMatches(s, esp, ed, { dedupe: true });
  assert.equal(r1.attached, 1);
  assert.equal(r1.written, 1);
  assert.equal(count(s, 'tennis_matches'), 2);
  const official = s.rows('tennis_matches').find((m) => m.source_family === 'ausopen');
  assert.equal(s.rows('tennis_match_external_ids').find((x) => x.provider === 'espn' && x.external_id === '154-2026:1').match_id, official.match_id);
  assert.equal(s.rows('tennis_ingest_holds').filter((h) => h.entity_type === 'cross_source').length, 0, 'orientation-free comparison: same result');
  for (let i = 0; i < 3; i += 1) await writeMatches(s, esp, ed, { dedupe: true });
  assert.equal(count(s, 'tennis_matches'), 2, 'reruns add nothing');
  assert.equal(count(s, 'tennis_match_external_ids'), 3);
  assert.equal(count(s, 'tennis_sets'), 4);
});

test('an official source arriving later takes over the ESPN row (same match_id), even with flipped sides', async () => {
  const s = new MemStore();
  const ed = { edition_id: E, surface: 'clay', indoor: false };
  await writeMatches(s, [sm('espn', '172-2012:9', 'MS', '3', ['AAAA'], ['BBBB'], [[6, 4], [3, 6], [6, 2]])], ed, { dedupe: true });
  const id = s.rows('tennis_matches')[0].match_id;
  const r = await writeMatches(s, [sm('rolandgarros', '2012-SM099', 'MS', '3', ['BBBB'], ['AAAA'], [[4, 6], [6, 3], [2, 6]], 'B')], ed, { dedupe: true });
  assert.equal(r.taken_over, 1);
  assert.equal(count(s, 'tennis_matches'), 1);
  assert.equal(s.rows('tennis_matches')[0].match_id, id);
  assert.equal(s.rows('tennis_matches')[0].source_family, 'rolandgarros');
  assert.equal(s.rows('tennis_match_participants').length, 2);
  assert.equal(s.rows('tennis_match_external_ids').filter((x) => x.match_id === id).length, 2, 'both sources linked to one match');
});

test('ambiguity is held: round conflict, same-source collision, disagreeing result recorded', async () => {
  const s = new MemStore();
  const ed = { edition_id: E, surface: 'hard', indoor: false };
  await writeMatches(s, [sm('wimbledon', 'W-1', 'MD', 'Q', ['AAAA', 'BBBB'], ['CCCC', 'DDDD'], [[6, 4], [6, 4]])], ed, { dedupe: true });
  const r = await writeMatches(s, [sm('espn', '188-2019:5', 'MD', 'F', ['AAAA', 'BBBB'], ['CCCC', 'DDDD'], [[6, 4], [6, 4]])], ed, { dedupe: true });
  assert.equal(r.duplicate_candidates, 1);
  assert.equal(count(s, 'tennis_matches'), 1);
  assert.match(s.rows('tennis_ingest_holds')[0].problems[0], /round_conflict:wimbledon=Q,espn=F/);
  const r2 = await writeMatches(s, [sm('wimbledon', 'W-2', 'MD', 'Q', ['AAAA', 'BBBB'], ['CCCC', 'DDDD'], [[6, 4], [6, 4]])], ed, { dedupe: true });
  assert.equal(r2.duplicate_candidates, 1);
  const r3 = await writeMatches(s, [sm('espn', '188-2019:6', 'MD', 'Q', ['AAAA', 'BBBB'], ['CCCC', 'DDDD'], [[6, 4], [7, 5]])], ed, { dedupe: true });
  assert.equal(r3.attached, 1);
  assert.ok(s.rows('tennis_ingest_holds').some((h) => h.entity_type === 'cross_source' && /6-4 6-4 vs espn completed 6-4 7-5/.test(h.problems[0])));
  assert.equal(count(s, 'tennis_matches'), 1);
});

test('one match listed twice by the source: identical listing links both ids to one row; a different result is held', async () => {
  const s = new MemStore();
  const ed = { edition_id: E, surface: 'hard', indoor: false };
  const a = sm('espn', '119-2022:116012', 'MS', 'Q-1', ['AAAA'], ['BBBB'], [[6, 4], [7, 6]]);
  const b = sm('espn', '119-2022:168902', 'MS', 'Q-1', ['AAAA'], ['BBBB'], [[6, 4], [7, 6]]);
  const r = await writeMatches(s, [a, b], ed, { dedupe: true });
  assert.equal(count(s, 'tennis_matches'), 1);
  assert.equal(r.aliased, 1);
  assert.equal(new Set(s.rows('tennis_match_external_ids').map((x) => x.match_id)).size, 1);
  assert.equal(count(s, 'tennis_match_external_ids'), 2);
  const c = sm('espn', '119-2022:999', 'MS', 'Q-1', ['AAAA'], ['CCCC'], [[6, 4], [6, 4]]);
  const d = sm('espn', '119-2022:998', 'MS', 'Q-1', ['AAAA'], ['CCCC'], [[6, 3], [6, 4]]);
  const r2 = await writeMatches(s, [c, d], ed, { dedupe: true });
  assert.equal(r2.duplicate_candidates, 1);
  assert.equal(count(s, 'tennis_matches'), 2);
});

test('WTA path unchanged: without dedupe the writer never reads the edition index', async () => {
  const s = new MemStore();
  await writeMatches(s, [sm('wta', 'X-1', 'MS', 'M-1', ['AAAA'], ['BBBB'], [[6, 4], [6, 4]])], { edition_id: E });
  assert.equal(s.log.filter(([m, t, q]) => m === 'GET' && t === 'tennis_matches' && /edition_id=eq/.test(q)).length, 0);
  assert.equal(naturalKey('MS', 'Q-2', 'S:b', 'S:a'), naturalKey('MS', 'Q-1', 'S:a', 'S:b'));
  assert.notEqual(naturalKey('MS', 'Q-2', 'S:a', 'S:b'), naturalKey('MS', '1', 'S:a', 'S:b'));
  assert.equal(winnerGames('4-6 6-3 RET', 'B'), '6-4 3-6 RET');
});

// ---- the lane end to end (fake ESPN + Wikidata, in-memory Supabase + KV) --------------------------------
function laneCtx({ blocked = [], wdRows = [] } = {}) {
  const ev = fx('event-154-2026.json');
  const routes = [
    [/query\.wikidata\.org/, { head: { vars: [] }, results: { bindings: wdRows } }],
    [/events\?dates=2026/, { count: 2, pageIndex: 1, pageSize: 200, pageCount: 1, items: [{ $ref: 'http://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/events/154-2026?lang=en&region=us' }, ...fx('events-2026.json').items.slice(0, 1)] }],
    [/events\?dates=/, { count: 0, items: [], pageCount: 0 }],
    [/events\/154-2026\/competitions\/168603\/status/, fx('status-walkover.json')],
    [/events\/154-2026$/, ev],
    [/events\/\d+-\d{4}$/, { __status: 404, body: '{"error":{"code":404}}' }],
    [/athletes\/(\d+)$/, (url) => { const id = /athletes\/(\d+)$/.exec(url)[1]; return { id, firstName: 'P', lastName: `L${id}`, fullName: `P L${id}` }; }],
    [/weeks\/38\/rankings\/1/, fx('ranking-2026-w38.json')]
  ];
  const s = new MemStore();
  const kv = new MemKV();
  return { ctx: { env: {}, store: s, kv, client: fakeClient(routes, { blocked }), log: [], steps: [], upstream: 0 }, s, kv };
}
const athletesOf = (j) => [...new Set(j.competitions.flatMap((c) => c.competitors.flatMap((x) => espn.competitorAthletes(x))))];

test('lane: identity lookups first, then writes; rerun is idempotent; unmapped athletes are held', async () => {
  const ids = athletesOf(fx('event-154-2026.json'));
  const unmapped = ids[0];
  const wdRows = ids.filter((id) => id !== unmapped).map((id, i) => ({ h: { value: `http://www.wikidata.org/entity/Q${id}` }, e: { value: id }, ...(['8104', '1273'].includes(id) ? { wta: { value: String(900000 + i) } } : { atp: { value: `A${id}` } }) }));
  const { ctx, s } = laneCtx({ wdRows });
  const p1 = await espnEventStep(ctx, '154-2026', { lookups: 5 });
  assert.equal(p1.state, 'IDENTITY_PENDING');
  assert.equal(count(s, 'tennis_matches'), 0, 'nothing written while athletes are still being looked up');
  let r;
  for (let i = 0; i < 10; i += 1) { ctx.espnIdentity = null; r = await espnEventStep(ctx, '154-2026', { lookups: 5 }); if (r.state !== 'IDENTITY_PENDING') break; }
  assert.equal(r.state, 'PASS');
  const writtenOnce = count(s, 'tennis_matches');
  assert.ok(writtenOnce >= 4, `written ${writtenOnce}`);
  assert.ok(r.held >= 1, 'matches with the unmapped athlete are held');
  assert.ok(s.rows('tennis_identity_queue').some((q) => q.external_id === unmapped && q.status === 'unresolved'));
  assert.ok(s.rows('tennis_ingest_holds').some((h) => h.problems.some((p) => p === `unresolved_identity:espn:${unmapped}`)));
  assert.ok(s.rows('tennis_tournament_editions').some((e) => e.edition_id && e.name === 'Australian Open 2026'));
  const ext = s.rows('tennis_player_external_ids').filter((x) => x.provider === 'espn');
  assert.ok(ext.length > 0 && ext.every((x) => x.method === 'external_id' && /P11585/.test(x.evidence[0])), 'ESPN ids stored with their Wikidata evidence');
  assert.ok(s.rows('tennis_matches').every((m) => m.source_family === 'espn' && m.stats_status !== 'pending'), 'ESPN carries no statistics');
  assert.ok(s.rows('tennis_matches').some((m) => m.event_type === 'XD'), 'mixed doubles: women resolve through P597 (WTA id)');
  ctx.espnIdentity = null;
  await espnEventStep(ctx, '154-2026', { lookups: 5 });
  assert.equal(count(s, 'tennis_matches'), writtenOnce, 'rerun: zero new canonical matches');
  const eid = await editionId(await tournamentId('slam:australian-open'), 2026);
  assert.ok(s.rows('tennis_matches').every((m) => m.edition_id === eid), 'Slam matches join the existing Slam edition id');
  const minted = await Promise.all(ids.filter((id) => id !== unmapped && !['8104', '1273'].includes(id)).map((id) => mintPlayerId('atp', `A${id}`)));
  const have = new Set(s.rows('tennis_players').map((p) => p.pbe_player_id));
  assert.ok(minted.filter((p) => have.has(p)).length >= 10, 'players minted from the tour id');
  assert.ok(s.rows('tennis_players').every((p) => /^(atp|wta):/.test(p.founding_external_key)), 'no player founded on an ESPN id');
});

test('lane: an athlete id ESPN refuses with 400 is recorded as having no bio record, not retried forever', async () => {
  const ids = athletesOf(fx('event-154-2026.json'));
  const { ctx, kv } = laneCtx();
  ctx.client = fakeClient([[/query\.wikidata\.org/, { results: { bindings: [{ h: { value: 'Q1' }, e: { value: '1' }, atp: { value: 'Z1' } }] } }], [/status/, fx('status-walkover.json')], [/events\/154-2026$/, fx('event-154-2026.json')], [new RegExp(`athletes/${ids[0]}$`), { __status: 400, body: '{"error":{"message":"Sports Athletes not supported for tennis","code":400}}' }], [/athletes\/(\d+)$/, (url) => ({ id: /athletes\/(\d+)$/.exec(url)[1] })]]);
  let r;
  for (let i = 0; i < 10; i += 1) { ctx.espnIdentity = null; r = await espnEventStep(ctx, '154-2026', { lookups: 8 }); if (r.state !== 'IDENTITY_PENDING') break; }
  assert.equal(r.state, 'PASS');
  assert.equal((await kv.get('espn:ath', 'json'))[ids[0]], 0);
});

test('lane: a blocked ESPN endpoint fails closed — error thrown, cursor unchanged, nothing written', async () => {
  const { ctx, s, kv } = laneCtx({ blocked: [/events\/154-2026$/] });
  await assert.rejects(espnAtpStep(ctx, { budget: 10, today: '2026-09-27' }), /BLOCKED_BY_ACCESS_CONTROL/);
  const st = await kv.get('bf:espn', 'json');
  assert.ok(st.cur.queue.includes('154-2026'), 'the blocked event stays queued');
  assert.equal(count(s, 'tennis_matches'), 0);
  const { ctx: c2 } = laneCtx({ blocked: [/events\?dates=/] });
  await assert.rejects(espnAtpStep(c2, { budget: 10, today: '2026-09-27' }), /espn events 2026/);
});

test('lane: rankings snapshot written as source espn with its observation date; rerun idempotent', async () => {
  const { ctx, s } = laneCtx({ wdRows: [{ h: { value: 'http://www.wikidata.org/entity/Q1' }, e: { value: '3623' }, atp: { value: 'S0AG' } }] });
  await s.upsert('tennis_players', [{ pbe_player_id: await mintPlayerId('atp', 'S0AG'), founding_external_key: 'atp:S0AG', full_name: 'Jannik Sinner', status: 'active' }]);
  const kv = ctx.kv;
  await kv.put('bf:espnrank', JSON.stringify({ season: 2026, week: 38, hist: { season: 2006, week: 1 }, cur_checked: null, relinked: new Date().toISOString() }));
  const r = await espnRankingStep(ctx, { weeks: 3, today: '2026-09-27' });
  assert.equal(r.lists[0].state, 'PASS');
  const snap = s.rows('tennis_ranking_snapshots')[0];
  assert.deepEqual([snap.list_key, snap.source_family, snap.ranking_date, snap.row_count], ['atp_singles', 'espn', '2026-09-17', 6]);
  assert.ok(s.rows('tennis_rankings').every((x) => x.provider_player_id.startsWith('espn:')));
  assert.equal(s.rows('tennis_rankings').filter((x) => x.pbe_player_id).length, 1, 'only the crosswalked player is linked');
  await kv.put('bf:espnrank', JSON.stringify({ season: 2026, week: 38, hist: { season: 2006, week: 1 }, cur_checked: null, relinked: new Date().toISOString() }));
  await espnRankingStep(ctx, { weeks: 3, today: '2026-09-27' });
  assert.equal(count(s, 'tennis_ranking_snapshots'), 1);
  assert.equal(count(s, 'tennis_rankings'), 6);
});
