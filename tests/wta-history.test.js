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
