// Provider parsers against trimmed REAL captures (tests/fixtures/*, captured 2026-09-26 by the source audit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as wta from '../workers/providers/wta.js';
import * as slams from '../workers/providers/slams.js';
import * as open from '../workers/providers/open.js';
import { normalizeMatch } from '../workers/shared/canonical/normalize.js';
import { validateAdapter } from '../workers/shared/adapter.js';
import { mintPlayerId } from '../workers/shared/canonical/identity.js';
import { buildDna } from '../workers/shared/dna/metric.js';

const fx = (p) => JSON.stringify(JSON.parse(fs.readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8')).payload);

test('every adapter satisfies the contract', () => {
  for (const a of [...wta.ADAPTERS, ...slams.ADAPTERS, ...open.ADAPTERS]) assert.deepEqual(validateAdapter(a), [], a.key);
});

test('WTA rankings singles + doubles', () => {
  const s = fx('wta/rankings-singles.json');
  assert.deepEqual(wta.rankingsSingles.shape(s), []);
  const rows = wta.rankingsSingles.parse(s);
  assert.equal(rows[0].list_key, 'wta_singles');
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].ranking_date, '2026-09-21');
  assert.equal(rows[0].player.provider_id, '324166');
  assert.equal(rows[0].player.dob, '1999-06-17');
  const d = wta.rankingsDoubles.parse(fx('wta/rankings-doubles.json'));
  assert.equal(d[0].list_key, 'wta_doubles');
  assert.equal(wta.rankingsSingles.request({ at: '2015-01-05', pageSize: 5 }).url.includes('at=2015-01-05'), true);
  assert.deepEqual(wta.rankingsSingles.shape('[]'), ['empty_list']);
  assert.deepEqual(wta.rankingsSingles.shape('<html>'), ['not_an_array']);
});

test('WTA ranking Monday', () => {
  assert.equal(wta.rankingMonday(new Date('2026-09-26T12:00:00Z')), '2026-09-21');
  assert.equal(wta.rankingMonday(new Date('2026-09-21T00:00:00Z')), '2026-09-21');
  assert.equal(wta.rankingMonday(new Date('2026-09-20T23:59:00Z')), '2026-09-14');
});

test('WTA calendar incl. WTA 125, surface + indoor normalized', () => {
  const rows = wta.calendar.parse(fx('wta/tournaments.json'));
  assert.equal(rows[0].level, 'WTA 125');
  assert.equal(rows[0].surface, 'clay');
  assert.equal(rows[0].indoor, false);
  assert.match(rows[0].start_date, /^\d{4}-\d{2}-\d{2}$/);
});

test('WTA matches: singles, doubles, qualifying, tiebreaks, match tiebreak, retirement, walkover, live', async () => {
  const rows = wta.matches.parse(fx('wta/matches-1152.json'));
  const by = Object.fromEntries(rows.map((r) => [r.provider_match_id.split('-').pop(), r]));
  // qualifying singles, straight sets, A won (Winner 2)
  assert.equal(by.RS014.stage, 'qualifying');
  assert.equal(by.RS014.event_type, 'WS');
  assert.equal(by.RS014.winner_side, 'A');
  assert.equal(by.RS014.duration_s, 4747);
  // side B won 7-6(2): only the loser's tiebreak points are published, the winner's are derived
  assert.equal(by.RS013.winner_side, 'B');
  assert.deepEqual(by.RS013.sets[0].games, { A: 6, B: 7 });
  assert.deepEqual(by.RS013.sets[0].tiebreak, { A: 2, B: 7, winner_points_derived: true });
  // doubles: two members per side, no-ad match-tiebreak format
  assert.equal(by.LD010.event_type, 'WD');
  assert.equal(by.LD010.sides.A.length, 2);
  assert.equal(by.LD010.format_key, 'DOUBLES_TOUR');
  // match tiebreak published winner-first as "1-0(8)"; side B won it => [8-10] in A-B orientation
  assert.ok(by.LD013.sets[2].is_match_tiebreak);
  assert.deepEqual(by.LD013.sets[2].games, { A: 0, B: 1 });
  assert.deepEqual({ A: by.LD013.sets[2].tiebreak.A, B: by.LD013.sets[2].tiebreak.B }, { A: 8, B: 10 });
  // retirement (Winner 4) and walkover (Winner 6)
  assert.equal(by.LD007.status, 'retired');
  assert.equal(by.LD007.retired_side, 'B');
  assert.equal(by.LS010.status, 'walkover');
  assert.equal(by.LS010.sets.length, 0);
  // live doubles match: server + point score as published
  assert.equal(by.LD003.status, 'in_progress');
  assert.equal(by.LD003.live.server, 'B');
  assert.deepEqual(by.LD003.live.point, { A: '0', B: '0' });

  const n = await normalizeMatch(by.LD013);
  assert.equal(n.canonical, true, n.problems.join());
  assert.equal(n.match.score_text, '4-6 6-4 [8-10]');
  assert.equal(n.match.winner_side, 'B');
  assert.match(n.match.participants.A, /^D:/);
  const r = await normalizeMatch(by.LD007);
  assert.equal(r.canonical, true, r.problems.join());
  assert.equal(r.match.score_text, '4-6 0-0 RET');
  const w = await normalizeMatch(by.LS010);
  assert.equal(w.match.score_text, 'W/O');
  assert.equal(w.canonical, true, w.problems.join());
});

test('WTA order-of-play row (MatchState U) is a scheduled match; placeholder timestamp ignored', () => {
  const u = wta.parseWtaMatch({ DrawLevelType: 'M', DrawMatchType: 'D', EventID: '1135', EventYear: 2026, MatchID: 'LD001', MatchState: 'U', MatchTimeStamp: '2026-09-26T23:59+01:00', CourtName: 'Centre court', NotBefore: 'Followed By', NotBeforeISOTime: '', PlayerIDA: '1', PlayerIDA2: '2', PlayerIDB: '3', PlayerIDB2: '4', RoundID: 1, Unscheduled: true }, { level: 'WTA 125' });
  assert.equal(u.status, 'scheduled');
  assert.equal(u.format_key, 'DOUBLES_TOUR');
  assert.equal(u.scheduled_at, null);
  assert.equal(u.schedule_note, 'Followed By');
  const t = wta.parseWtaMatch({ MatchState: 'U', DrawMatchType: 'S', DrawLevelType: 'M', EventID: '1', EventYear: 2026, MatchID: 'LS001', NotBefore: 'Not Before', NotBeforeISOTime: '15:00+0300', PlayerIDA: '1', PlayerIDB: '2' }, { level: 'WTA 500' });
  assert.equal(t.scheduled_at, null, 'a time without a date is not a timestamp');
  assert.equal(t.schedule_note, 'Not Before');
  const t2 = wta.parseWtaMatch({ MatchState: 'U', DrawMatchType: 'S', DrawLevelType: 'M', EventID: '1', EventYear: 2026, MatchID: 'LS003', NotBefore: 'Starting at 3:00 PM', NotBeforeText: 'Starting at', NotBeforeISOTime: '15:00+0300', PlayerIDA: '1', PlayerIDB: '2' }, { level: 'WTA 125' });
  assert.equal(t2.schedule_note, 'Starting at 3:00 PM', 'no duplicated source fragments');
  const f = wta.parseWtaMatch({ MatchState: 'U', DrawMatchType: 'S', DrawLevelType: 'M', EventID: '1', EventYear: 2026, MatchID: 'LS002', NotBeforeISOTime: '2026-09-27T12:00:00+08:00', PlayerIDA: '1', PlayerIDB: '2' }, { level: 'WTA 500' });
  assert.equal(f.scheduled_at, '2026-09-27T12:00:00+08:00');
  assert.deepEqual(u.warnings, []);
});

test('Winner code 5 = side B won, A retired', () => {
  const [m] = JSON.parse(fx('wta/matches-1152.json')).matches;
  const r = wta.parseWtaMatch({ ...m, Winner: '5' });
  assert.equal(r.status, 'retired');
  assert.equal(r.winner_side, 'B');
  assert.equal(r.retired_side, 'A');
});

test('Slam level switches the deciding set to a 10-point tiebreak', () => {
  assert.equal(wta.formatFor('1', { level: 'Grand Slam', year: 2025 }), 'BO3_FINAL_TB10');
  assert.equal(wta.formatFor('1', { level: 'WTA 500', year: 2025 }), 'BO3_TB7');
  assert.equal(wta.formatFor('9', { level: 'Grand Slam', year: 2025 }), 'DOUBLES_TOUR');
});

test('WTA unmapped codes surface as warnings, never guesses', () => {
  const [m] = JSON.parse(fx('wta/matches-1152.json')).matches;
  const odd = wta.parseWtaMatch({ ...m, Winner: '7', ScoreSys: '42', MatchState: 'X' });
  assert.equal(odd.winner_side, null);
  assert.equal(odd.status, null);
  assert.ok(odd.warnings.includes('unmapped_winner_code:7'));
  assert.ok(odd.warnings.includes('unmapped_score_system:42'));
  assert.ok(odd.warnings.includes('unmapped_match_state:X'));
});

test('WTA contradictory row (observed live: 1178-2026-LD013) is held, not written', async () => {
  const [m] = JSON.parse(fx('wta/matches-1152.json')).matches;
  const row = { ...m, DrawMatchType: 'D', ScoreSys: '9', NumSets: 1, ScoreSet1A: '0', ScoreSet1B: '3', ScoreSet2A: '6', ScoreSet2B: '7', ScoreTbSet2: '4', ScoreString: '0-3', Winner: '3', PlayerIDA2: '1', PlayerIDB2: '2' };
  const p = wta.parseWtaMatch(row);
  assert.ok(p.warnings.includes('stale_set_fields_ignored:set2'));
  assert.equal(p.sets.length, 1);
  const n = await normalizeMatch(p);
  assert.equal(n.canonical, false);
  assert.ok(n.problems.some((x) => x.startsWith('score_invalid')));
});

test('WTA match stats: canonical keys, internal consistency, feeds DNA', () => {
  const [s] = wta.matchStats.parse(fx('wta/matchstats-LS002.json'));
  assert.deepEqual(s.consistency_errors, []);
  assert.equal(s.sides.A.service_points, 74);
  assert.equal(s.sides.A.first_serves_in, 47);
  assert.equal(s.sides.A.second_serve_points_won, 12);
  assert.equal(s.sides.A.break_points_faced, 8);
  assert.equal(s.sides.A.break_points_saved, 3);
  assert.equal(s.per_set.length, 3);
  const dna = buildDna([{ match_id: 'LS002', match_date: '2026-09-20', surface: 'hard', source_family: 'wta', side: s.sides.A, opp: s.sides.B }], { asOf: '2026-09-26' });
  assert.equal(dna.metrics.hold_rate.numerator, 13 - 5);
  assert.equal(dna.metrics.return_games_won.numerator, 5);
});

test('Wimbledon draw feed: tour ids embedded, extended tiebreak, retirement', async () => {
  const url = 'https://www.wimbledon.com/en_GB/scores/feeds/2025/draws/MS.json';
  const body = fx('wimbledon/draws-MS-2025.json');
  assert.deepEqual(slams.wimbledonDraw.shape(body), []);
  const rows = slams.wimbledonDraw.parse(body, { url });
  const by = Object.fromEntries(rows.map((r) => [r.provider_match_id, r]));
  const final = by['2025-1701'];
  assert.equal(final.format_key, 'BO5_FINAL_TB10');
  assert.deepEqual(final.sides.A[0].tour_id, { provider: 'atp', provider_id: 'S0AG' });
  const nf = await normalizeMatch(final);
  assert.equal(nf.canonical, true, nf.problems.join());
  assert.equal(nf.match.score_text, '4-6 6-4 6-4 6-4');
  assert.equal(nf.match.winner_side, 'A');
  // same player, two sources, one UUID — without any name matching
  assert.equal(nf.match.participants.A, `S:${await mintPlayerId('atp', 'S0AG')}`);
  const ret = by['2025-1107'];
  assert.equal(ret.status, 'retired');
  assert.deepEqual(ret.sets[0].tiebreak, { A: 10, B: 8, winner_points_derived: false });
  const nr = await normalizeMatch(ret);
  assert.equal(nr.canonical, true, nr.problems.join());
  assert.equal(slams.tourIdFromSlamId('wta324219').provider_id, '324219');
  assert.equal(slams.tourIdFromSlamId('ATPBK92').provider_id, 'BK92');
  assert.equal(slams.tourIdFromSlamId('fft39723'), null);
});

test('Wikidata crosswalk parse', () => {
  const rows = open.wikidataCrosswalk.parse(fx('wikidata/sample.json'));
  assert.equal(rows[0].provider_id, 'Q1426');
  assert.equal(rows[0].external.atp, 'F324');
  assert.equal(rows[0].label, null, 'a bare QID label is not a name');
  assert.match(rows[0].commons_file, /\.jpg$/);
});

test('ProTennisLive placeholder PDFs are not accepted as draws', () => {
  assert.deepEqual(open.protennisliveDraw.shape('%PDF-1.4 tiny -Tournament Information Not Yet Available-'), ['placeholder_pdf']);
  assert.deepEqual(open.protennisliveDraw.shape('<html>'), ['not_a_pdf']);
  assert.deepEqual(open.protennisliveDraw.shape(`%PDF-1.7${'x'.repeat(20000)}`), []);
});

test('Australian Open day results: men only, full tiebreak points, retirement, embedded ATP ids', async () => {
  const body = fx('ausopen/day2-2026.json');
  assert.deepEqual(slams.ausopenMatches.shape(body), []);
  const rows = slams.ausopenMatches.parse(body);
  assert.ok(rows.every((r) => r.event_type === 'MS'), "women's AO matches come from the WTA API, never twice");
  const by = Object.fromEntries(rows.map((r) => [r.provider_match_id, r]));
  assert.deepEqual(by['2026-MS125'].sets[2].tiebreak, { A: 7, B: by['2026-MS125'].sets[2].tiebreak.B, winner_points_derived: false });
  const ret = by['2026-MS132'];
  assert.equal(ret.status, 'retired');
  assert.equal(ret.winner_side, 'A');
  assert.equal(ret.retired_side, 'B');
  for (const r of rows) {
    assert.equal(r.sides.A[0].tour_id.provider, 'atp');
    const n = await normalizeMatch(r);
    assert.equal(n.canonical, true, `${r.provider_match_id}: ${n.problems.join()}`);
  }
});

test('WTA start time: trusted only once play has started (order-of-play 23:59 placeholder ignored)', () => {
  const base = { EventID: '1', EventYear: 2026, MatchID: 'LS001', DrawLevelType: 'M', DrawMatchType: 'S', RoundID: '1', PlayerIDA: '1', PlayerIDB: '2', PlayerNameFirstA: 'A', PlayerNameLastA: 'A', PlayerNameFirstB: 'B', PlayerNameLastB: 'B', ScoreSys: '1', MatchTimeStamp: '2026-09-19T02:47:24.373+00:00', MatchTimeTotal: '01:19:07' };
  const done = wta.parseWtaMatch({ ...base, MatchState: 'F', Winner: '2', ScoreSet1A: '6', ScoreSet1B: '2', ScoreSet2A: '6', ScoreSet2B: '1' }, {});
  assert.equal(done.started_at, '2026-09-19T02:47:24.373+00:00');
  const oop = wta.parseWtaMatch({ ...base, MatchState: 'U', MatchTimeStamp: '2026-09-20T23:59:00+00:00' }, {});
  assert.equal(oop.started_at, null);
});

test('AO match-centre stats -> canonical counts; opponent break points; inconsistent denominators rejected', () => {
  const t = (a, b) => ({ teamA: a, teamB: b });
  const stats = [
    { name: 'Aces', ...t({ primary: '8' }, { primary: '4' }) }, { name: 'Double faults', ...t({ primary: '1' }, { primary: '4' }) },
    { name: '1st serve in', ...t({ secondary: '56/83' }, { secondary: '66/91' }) }, { name: 'Win 1st serve', ...t({ secondary: '43/56' }, { secondary: '40/66' }) },
    { name: 'Win 2nd serve', ...t({ secondary: '18/27' }, { secondary: '11/25' }) }, { name: 'Break points won', ...t({ secondary: '4/10' }, { secondary: '1/1' }) },
    { name: 'Total points won', ...t({ primary: '101' }, { primary: '73' }) }
  ];
  const r = slams.parseAusopenStats({ stats: { key_stats: [{ name: 'Key', sets: [{ set: 'All', stats }] }] } });
  assert.deepEqual([r.sides.A.service_points, r.sides.A.first_serves_in, r.sides.A.first_serve_points_won, r.sides.A.second_serve_points_won], [83, 56, 43, 18]);
  assert.deepEqual([r.sides.B.break_points_faced, r.sides.B.break_points_saved], [10, 6], "B faced A's 10 break points, saved 6");
  assert.deepEqual([r.sides.A.break_points_faced, r.sides.A.break_points_saved], [1, 0]);
  const bad = stats.map((s) => (s.name === 'Win 2nd serve' ? { ...s, teamA: { secondary: '18/30' } } : s));
  assert.throws(() => slams.parseAusopenStats({ stats: { key_stats: [{ name: 'Key', sets: [{ set: 'All', stats: bad }] }] } }), /inconsistent/);
  assert.equal(slams.parseAusopenStats({ stats: {} }), null);
});
