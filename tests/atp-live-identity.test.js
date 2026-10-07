// ATP (ESPN) live identities (2026-10-07, owner-approved fix). The live lane resolves ESPN athletes from the STORED
// crosswalk only (espn-live.js storedIdMap). It used to label them method 'crosswalk', which tennis_player_external_ids'
// CHECK refuses (23514): Postgres checks the proposed row before on-conflict, so even the no-op insert of an existing
// crosswalk row failed the whole pass and no ATP match was ever written live. MemStore now enforces that CHECK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIVE_PROVIDERS } from '../workers/tennis-live/src/router.js';
import { espnEditionId, storedIdMap } from '../workers/tennis-ingest/src/espn-live.js';
import { parseEspnEvent } from '../workers/providers/espn.js';
import { mintPlayerId } from '../workers/shared/canonical/identity.js';
import { MemStore, MemKV, fakeClient } from './helpers/memstore.js';

const ESPN_EVENT = JSON.parse(readFileSync(new URL('./fixtures/espn/event-959-2026-live.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-09-30T06:00:00Z');
const CROSSWALK = { 2367: ['K09Z', 'Karen Khachanov'], 3209: ['AG37', 'Felix Auger-Aliassime'], 2865: ['BK92', 'Alexander Bublik'], 10073: ['S0H2', 'Shang Juncheng'], 3700: ['C0AU', 'Francisco Cerundolo'], 3511: ['RC91', 'Arthur Rinderknech'] };
const ALLOWED = ['founding', 'external_id', 'name_dob', 'manual_review'];
const status = (name) => ({ period: 2, type: { id: name === 'STATUS_IN_PROGRESS' ? '2' : '1', name, state: name === 'STATUS_IN_PROGRESS' ? 'in' : 'pre', completed: false } });
const ls = (...sets) => ({ count: sets.length, items: sets.map(([v], i) => ({ period: i + 1, value: v, displayValue: String(v) })) });

/** Players + ESPN crosswalk rows only (no stored match, no ATP founding external-id rows). */
async function seed({ skip = [] } = {}) {
  const store = new MemStore();
  const espnEd = await espnEditionId(parseEspnEvent(ESPN_EVENT, { league: 'atp' }).edition);
  await store.upsert('tennis_tournament_editions', [{ edition_id: espnEd, surface: 'hard', indoor: false, source_family: 'espn' }], { onConflict: 'edition_id' });
  for (const [espnId, [atp, name]] of Object.entries(CROSSWALK)) {
    const pid = await mintPlayerId('atp', atp);
    await store.upsert('tennis_players', [{ pbe_player_id: pid, founding_external_key: `atp:${atp}`, full_name: name, first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' '), gender: 'M' }], { onConflict: 'pbe_player_id' });
    if (!skip.includes(espnId)) await store.upsert('tennis_player_external_ids', [{ provider: 'espn', external_id: espnId, pbe_player_id: pid, method: 'external_id', evidence: ['espn_atp lane'] }], { onConflict: 'provider,external_id' });
  }
  return { store, espnEd };
}
const client = (state) => fakeClient([
  [/leagues\/atp\/events\/959-2026$/, () => state.event],
  [/competitions\/(\d+)\/status$/, (u) => status(state.status[/competitions\/(\d+)\/status/.exec(u)[1]] || 'STATUS_SCHEDULED')],
  [/competitors\/([\d-]+)\/linescores$/, (u) => state.ls[/competitors\/([\d-]+)\/linescores/.exec(u)[1]] || ls()]
]);
const observe = (ctx) => LIVE_PROVIDERS.espn.observe(ctx, { source: 'espn', league: 'atp', event_id: '959-2026' });

test('stored-crosswalk identities carry a method the database accepts (same label as the espn_atp lane)', async () => {
  const { store } = await seed();
  const map = await storedIdMap(store, Object.keys(CROSSWALK));
  assert.equal(Object.keys(map).length, 6);
  for (const x of Object.values(map)) { assert.equal(x.method, 'external_id'); assert.ok(ALLOWED.includes(x.method)); assert.match(x.evidence, /^stored crosswalk espn:\d+ -> atp:/); }
});

test('first seen live: a brand-new ATP match is written in progress with the canonical ATP players; nothing minted, nothing mis-mapped', async () => {
  const { store, espnEd } = await seed();
  const players0 = store.rows('tennis_players').map((p) => p.pbe_player_id).sort();
  const state = { event: ESPN_EVENT, status: { 183447: 'STATUS_IN_PROGRESS', 183472: 'STATUS_IN_PROGRESS' }, ls: { 2367: ls([6], [3]), 3209: ls([4], [2]), '2865-10073': ls([7, 7], [2]), '3700-3511': ls([6, 5], [3]) } };
  const ctx = { env: {}, store, kv: new MemKV(), client: client(state), log: [], upstream: 0, now: NOW, observed: new Map() };
  const r = await observe(ctx);
  assert.equal(r.state, 'PASS', r.error || '');
  const rows = store.rows('tennis_matches').filter((m) => m.edition_id === espnEd);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((m) => m.status === 'in_progress' && m.source_family === 'espn'));
  // identities: every external-id row passes the CHECK; ESPN rows still point at the player the crosswalk named; the ATP
  // founding rows written now point at the UUIDv5 of that ATP id; no player minted from an ESPN id
  const ext = store.rows('tennis_player_external_ids');
  assert.ok(ext.every((e) => ALLOWED.includes(e.method)));
  for (const [espnId, [atp]] of Object.entries(CROSSWALK)) {
    const pid = await mintPlayerId('atp', atp);
    assert.deepEqual(ext.filter((e) => e.provider === 'espn' && e.external_id === espnId).map((e) => e.pbe_player_id), [pid]);
    assert.deepEqual(ext.filter((e) => e.provider === 'atp' && e.external_id === atp).map((e) => [e.pbe_player_id, e.method]), [[pid, 'founding']]);
  }
  assert.deepEqual(store.rows('tennis_players').map((p) => p.pbe_player_id).sort(), players0, 'no duplicate / ESPN-minted player');
  const ms = rows.find((m) => m.event_type === 'MS');
  const parts = store.rows('tennis_match_participants').filter((p) => p.match_id === ms.match_id).map((p) => p.participant_key).sort();
  assert.deepEqual(parts, [`S:${await mintPlayerId('atp', 'AG37')}`, `S:${await mintPlayerId('atp', 'K09Z')}`].sort());
  assert.ok(ctx.observed.has(espnEd), 'the edition is reported as confirmed (freshness heartbeat)');

  // stored-match path: the next observation changes the score; the match row is rewritten, no identity rows are re-sent
  const extBefore = store.rows('tennis_player_external_ids').length;
  state.ls[2367] = ls([6], [4]);
  const log0 = store.log.length;
  const r2 = await observe(ctx);
  assert.equal(r2.state, 'PASS');
  assert.equal(store.rows('tennis_matches').find((m) => m.match_id === ms.match_id).score_text, '6-4 4-2');
  assert.equal(store.rows('tennis_player_external_ids').length, extBefore);
  assert.ok(!store.log.slice(log0).some(([op, t, n]) => op === 'UPSERT' && t === 'tennis_player_external_ids' && n > 0), 'change-only: no identity insert for a stored match');
  assert.deepEqual(store.rows('tennis_players').map((p) => p.pbe_player_id).sort(), players0);
});

test('first seen live with an athlete the crosswalk does not hold: that match is held, never guessed or minted; the other is written', async () => {
  const { store, espnEd } = await seed({ skip: ['3511'] });
  const players0 = store.rows('tennis_players').length;
  const state = { event: ESPN_EVENT, status: { 183447: 'STATUS_IN_PROGRESS', 183472: 'STATUS_IN_PROGRESS' }, ls: { 2367: ls([6], [3]), 3209: ls([4], [2]), '2865-10073': ls([7, 7], [2]), '3700-3511': ls([6, 5], [3]) } };
  const r = await observe({ env: {}, store, kv: new MemKV(), client: client(state), log: [], upstream: 0, now: NOW });
  assert.equal(r.state, 'PASS', r.error || '');
  const rows = store.rows('tennis_matches').filter((m) => m.edition_id === espnEd);
  assert.deepEqual(rows.map((m) => m.event_type), ['MS'], 'only the fully resolved match is written');
  assert.equal(store.rows('tennis_players').length, players0);
  assert.ok(!store.rows('tennis_player_external_ids').some((e) => e.provider === 'espn' && e.external_id === '3511'));
});
