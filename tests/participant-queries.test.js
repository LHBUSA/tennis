// 2026-09-28: bounded replacements for the participant-first history and ESPN-mapping queries. History: the new per-key
// keyset rows must equal the old single-query rows exactly (same rows, same order). ESPN mapping: the new edition-first
// candidates must give the same tally / decision (verified against the old query on production data by the read-only
// espn_map_probe lane; MemStore cannot model the old query's two-level nested !inner filter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerRows } from '../workers/tennis-ingest/src/wta-history-job.js';
import { officialEditionMatches, tallyEditions } from '../workers/tennis-ingest/src/espn-jobs.js';
import { legacyPlayerRows } from '../workers/tennis-ingest/src/participant-first-legacy.js';
import { MemStore } from './helpers/memstore.js';

const E = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let seq = 0;
function add(s, ed, A, B, extra = {}) {
  const id = `20000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`;
  s.rows('tennis_matches').push({ match_id: id, edition_id: ed, event_type: A.startsWith('D:') ? 'WD' : 'WS', round: '1', source_family: 'wta_history', ...extra });
  s.rows('tennis_match_participants').push({ match_id: id, side: 'A', participant_key: A }, { match_id: id, side: 'B', participant_key: B });
  return id;
}

test('history: new per-key keyset rows == old rows (long career over many pages, many editions, doubles, flipped sides)', async () => {
  const s = new MemStore();
  seq = 0;
  for (let e = 1; e <= 60; e += 1) s.rows('tennis_tournament_editions').push({ edition_id: E(e), start_date: '2024-01-01', end_date: '2024-01-07', source_family: 'wta' });
  for (let i = 0; i < 1300; i += 1) i % 2 ? add(s, E((i % 60) + 1), 'S:vet', `S:o${i}`) : add(s, E((i % 60) + 1), `S:o${i}`, 'S:vet');
  for (let i = 0; i < 40; i += 1) add(s, E((i % 60) + 1), 'D:p1+vet', `D:q${i}+r${i}`);
  for (let i = 0; i < 25; i += 1) add(s, E((i % 60) + 1), `D:x${i}+y${i}`, 'D:p2+vet');
  const mine = new Set(['S:vet', 'D:p1+vet', 'D:p2+vet']);
  const a = await legacyPlayerRows(s, mine);
  const b = await playerRows(s, mine);
  assert.equal(a.length, 1365);
  assert.equal(JSON.stringify(b), JSON.stringify(a), 'identical rows in identical order');
  const gets = s.log.filter((x) => x[0] === 'GET').slice(-6).map((x) => decodeURIComponent(x[2]));
  assert.ok(gets.every((g) => !/offset=/.test(g) || /participant_key=in\./.test(g)), 'the new path never pages by OFFSET');
});

test('history: no-history player and a single-match player', async () => {
  const s = new MemStore();
  seq = 0;
  add(s, E(1), 'S:one', 'S:two');
  assert.deepEqual(await playerRows(s, new Set(['S:nobody'])), await legacyPlayerRows(s, new Set(['S:nobody'])));
  assert.equal(JSON.stringify(await playerRows(s, new Set(['S:one']))), JSON.stringify(await legacyPlayerRows(s, new Set(['S:one']))));
});

test('history: doubles keys with "+" are encoded (never the 2026-09-28 "+" -> space defect)', async () => {
  const s = new MemStore();
  seq = 0;
  add(s, E(1), 'D:a+b', 'D:c+d');
  const rows = await playerRows(s, new Set(['D:a+b']));
  assert.equal(rows.length, 1);
  assert.ok(s.log.at(-1)[2].includes('participant_key=eq.D%3Aa%2Bb'));
});

test('espn mapping: edition-first candidates -> same tally rules (window, source, pair proof), espn editions never fetched as targets', async () => {
  const s = new MemStore();
  seq = 0;
  s.rows('tennis_tournament_editions').push(
    { edition_id: E(1), year: 2025, start_date: '2025-04-21', end_date: '2025-05-04', source_family: 'wta', surface: 'clay', indoor: false, name: 'Madrid' },
    { edition_id: E(2), year: 2025, start_date: '2025-05-12', end_date: '2025-05-18', source_family: 'wta', surface: 'clay', indoor: false, name: 'Rome' },
    { edition_id: E(3), year: 2025, start_date: '2025-04-21', end_date: '2025-05-04', source_family: 'espn', surface: null, indoor: null, name: 'ESPN copy' },
    { edition_id: E(4), year: 2024, start_date: '2024-04-21', end_date: '2024-05-04', source_family: 'wta', surface: 'clay', indoor: false, name: 'Madrid 2024' },
    { edition_id: E(5), year: 2025, start_date: '2025-04-28', end_date: '2025-05-03', source_family: null, surface: 'hard', indoor: false, name: 'unknown-source week' });
  for (const [a, b] of [['1', '2'], ['3', '4'], ['5', '6']]) add(s, E(1), `S:${a}`, `S:${b}`);
  add(s, E(2), 'S:1', 'S:2');
  add(s, E(3), 'S:3', 'S:4');
  add(s, E(4), 'S:1', 'S:2');
  add(s, E(5), 'S:5', 'S:6');
  add(s, E(1), 'D:1+3', 'D:2+4'); // doubles never count (WS only)
  add(s, E(1), 'S:1', 'S:9'); // one incoming player, not an incoming pair
  const pairs = new Set(['S:1~S:2', 'S:3~S:4', 'S:5~S:6', 'S:7~S:8']);
  const keys = [...new Set([...pairs].flatMap((p) => p.split('~')))];
  const lo = Date.parse('2025-04-22') - 3 * 86400e3;
  const hi = Date.parse('2025-05-04') + 3 * 86400e3;
  const got = await officialEditionMatches(s, 2025, lo, hi, keys);
  const t = tallyEditions(got, pairs, lo, hi);
  assert.deepEqual([...t.values()].map((x) => [x.edition_id, x.hit]).sort(), [[E(1), 3], [E(5), 1]], 'Rome (outside window), the ESPN copy and 2024 never count; a null source is kept');
  const edQueries = s.log.filter((x) => x[0] === 'GET' && x[1] === 'tennis_matches').map((x) => decodeURIComponent(x[2]));
  assert.ok(edQueries.every((q) => !q.includes(E(3)) && !q.includes(E(2)) && !q.includes(E(4))));
  assert.equal((await officialEditionMatches(s, 2025, lo, hi, [])).size, 0, 'no keys -> nothing');
});
