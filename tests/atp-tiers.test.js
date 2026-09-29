// Reviewed ATP tier registry (news materiality). ESPN publishes no level, so an ATP 500/1000 title weighed as a 250
// (58 < 60) while a WTA 500 title scores 63. Same bar for both tours; unknown events keep the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATP_TIER_ROWS, validateRegistry, atpTierForEdition, REGISTRY_VERSION } from '../workers/shared/atp-tiers.js';
import { tournamentId, editionId } from '../workers/shared/canonical/ids.js';
import { detectMatchEvents, tourWeight } from '../workers/tennis-news/src/detect.js';

const PUBLISH_BAR = 60;
const ed = async (tid, y) => editionId(await tournamentId(`espn:${tid}`), y);
const final = (edition, et = 'MS') => ({
  id: `m-${et}-${edition.id}`, event_type: et, round: 'F', status: 'completed', winner_side: 'A', retired_side: null, best_of: 3,
  sets: [{ A: 6, B: 4, tb: false }, { A: 6, B: 3, tb: false }], duration_s: 5400, started_at: '2026-10-01T08:00:00Z', edition,
  list_depth: null, sides: { A: { players: [{ id: 'p1', name: 'A' }], rank: 5, list_date: '2026-09-28' }, B: { players: [{ id: 'p2', name: 'B' }], rank: 3, list_date: '2026-09-28' } }
});
const title = async (edition, et) => (await detectMatchEvents(final(edition, et))).find((e) => e.kind === 'title');

test('registry: valid, one tier per tournament-season, the 2025 upgrades split by season', () => {
  assert.deepEqual(validateRegistry(), []);
  assert.deepEqual(validateRegistry([...ATP_TIER_ROWS, { espn_tournament_id: 959, tier: 'ATP 250', from: 2026, to: 2026 }]), ['two tiers for 959:2026']);
  const doha = ATP_TIER_ROWS.filter((r) => r.espn_tournament_id === 119).map((r) => `${r.tier}:${r.from}-${r.to}`).sort();
  assert.deepEqual(doha, ['ATP 250:2024-2024', 'ATP 500:2025-2026']);
});

test('identity: the registry resolves through the canonical ids the espn_atp lane mints (production China Open 2026 edition)', async () => {
  const china = await ed(959, 2026);
  assert.equal(china, '81fb3ab5-a037-5418-8008-efcfd35005e6', 'the edition id production holds for ESPN event 959-2026');
  assert.deepEqual(await atpTierForEdition(china), { tier: 'ATP 500', espn_tournament_id: 959, year: 2026, registry: REGISTRY_VERSION });
  assert.equal((await atpTierForEdition(await ed(315, 2026))).tier, 'ATP Masters 1000');
  assert.equal((await atpTierForEdition(await ed(119, 2024))).tier, 'ATP 250');
  assert.equal(await atpTierForEdition(await ed(959, 2019)), null, 'outside the reviewed seasons: unknown');
  assert.equal(await atpTierForEdition(await ed(771, 2024)), null, 'Olympics: not in the registry, unknown');
  assert.equal(await atpTierForEdition(null), null);
});

test('parity: an ATP 500 title clears the same unchanged bar as a WTA 500 title; a 250 stays below for both tours', async () => {
  const wta500 = await title({ id: 'w500', level: 'WTA 500', source_family: 'wta' }, 'WS');
  const atp500 = await title({ id: 'a500', level: null, source_family: 'espn', atp_tier: 'ATP 500', tier_registry: REGISTRY_VERSION }, 'MS');
  const wta250 = await title({ id: 'w250', level: 'WTA 250', source_family: 'wta' }, 'WS');
  const atpUnknown = await title({ id: 'aunk', level: null, source_family: 'espn' }, 'MS');
  const atp1000 = await title({ id: 'a1000', level: null, source_family: 'espn', atp_tier: 'ATP Masters 1000' }, 'MS');
  assert.equal(atp500.materiality, wta500.materiality);
  assert.ok(atp500.materiality >= PUBLISH_BAR, `ATP 500 title ${atp500.materiality} >= ${PUBLISH_BAR}`);
  assert.equal(atpUnknown.materiality, wta250.materiality, 'unknown ATP event = the 250 floor, never promoted');
  assert.ok(atpUnknown.materiality < PUBLISH_BAR);
  assert.ok(atp1000.materiality > atp500.materiality);
  assert.equal(atp500.facts.edition_tier, 'ATP 500');
  assert.equal(atp500.facts.tier_registry, REGISTRY_VERSION, 'the evidence names the registry');
  assert.equal(tourWeight({ level: 'WTA 1000' }), tourWeight({ atp_tier: 'ATP Masters 1000' }));
});
