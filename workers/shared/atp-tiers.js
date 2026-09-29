// Reviewed ATP tournament-tier registry (news materiality only). REGISTRY_VERSION below; review: 2026-09-29.
//
// Why: ESPN (our secondary ATP source) publishes no tournament level, so every ATP Tour edition weighed as a 250 in the
// newsroom and an ATP 500/1000 story could never clear the same bar a WTA 500/1000 story clears.
//
// Identity: keyed by the ESPN tournament id (stable across seasons, verified 2024-2026 against
// /leagues/atp/events/{tid}-{YYYY}), resolved to OUR canonical ids exactly as the espn_atp lane mints them —
// editionId(tournamentId('espn:<tid>'), year). No display-name matching. Slams (competition_key grand_slam) and the ATP
// Finals (competition_key atp_finals) are already classified at ingest and are not listed.
//
// Source of the categories: the ATP Tour's published tournament categories for each season (Masters 1000 / 500 / 250),
// reviewed by hand for 2024-2026 including the 2025 upgrades to 500 (Doha, Dallas, Munich). Every entry has an explicit
// season range; a season outside it, or a tournament not listed (e.g. Olympics, exhibitions, anything new), is UNKNOWN
// and falls back to the unchanged default (no level -> the 250 floor). Never guessed, never inferred from names or prize
// money. Nothing here is published as a level on the site; it only weights newsroom materiality.

import { tournamentId, editionId } from './canonical/ids.js';

export const REGISTRY_VERSION = 'atp-tiers/2026-09-29.1';
export const TIERS = Object.freeze({ M1000: 'ATP Masters 1000', A500: 'ATP 500', A250: 'ATP 250' });

// [espn tournament id, tier, first season, last season, label]
const ROWS = [
  // Masters 1000
  [411, 'M1000', 2024, 2026, 'Indian Wells'], [713, 'M1000', 2024, 2026, 'Miami'], [42, 'M1000', 2024, 2026, 'Monte-Carlo'],
  [413, 'M1000', 2024, 2026, 'Madrid'], [414, 'M1000', 2024, 2026, 'Rome'], [421, 'M1000', 2024, 2026, 'Canada (Toronto/Montreal)'],
  [718, 'M1000', 2024, 2026, 'Cincinnati'], [315, 'M1000', 2024, 2026, 'Shanghai'], [13, 'M1000', 2024, 2026, 'Paris'],
  // ATP 500
  [4, 'A500', 2024, 2026, 'Rotterdam'], [375, 'A500', 2024, 2026, 'Rio de Janeiro'], [711, 'A500', 2024, 2026, 'Acapulco'],
  [25, 'A500', 2024, 2026, 'Dubai'], [338, 'A500', 2024, 2026, 'Barcelona'], [942, 'A500', 2024, 2026, 'Hamburg'],
  [27, 'A500', 2024, 2026, 'Halle'], [129, 'A500', 2024, 2026, "Queen's Club (London)"], [888, 'A500', 2024, 2026, 'Washington'],
  [5, 'A500', 2024, 2026, 'Tokyo'], [959, 'A500', 2024, 2026, 'Beijing'], [10, 'A500', 2024, 2026, 'Vienna'], [23, 'A500', 2024, 2026, 'Basel'],
  [119, 'A500', 2025, 2026, 'Doha'], [836, 'A500', 2025, 2026, 'Dallas'], [12, 'A500', 2025, 2026, 'Munich'],
  // ATP 250
  [119, 'A250', 2024, 2024, 'Doha'], [836, 'A250', 2024, 2024, 'Dallas'], [12, 'A250', 2024, 2024, 'Munich'],
  [970, 'A250', 2024, 2026, 'Brisbane'], [925, 'A250', 2024, 2026, 'Auckland'], [971, 'A250', 2024, 2026, 'Hong Kong'],
  [611, 'A250', 2024, 2026, 'Adelaide'], [29, 'A250', 2024, 2026, 'Montpellier'], [518, 'A250', 2024, 2024, 'Cordoba'],
  [299, 'A250', 2024, 2026, 'Buenos Aires'], [110, 'A250', 2024, 2025, 'Marseille'], [296, 'A250', 2024, 2026, 'Delray Beach'],
  [620, 'A250', 2024, 2026, 'Santiago'], [145, 'A250', 2024, 2026, 'Houston'], [28, 'A250', 2024, 2026, 'Marrakech'],
  [974, 'A250', 2024, 2026, 'Bucharest'], [396, 'A250', 2024, 2026, 'Geneva'], [49, 'A250', 2024, 2026, 'Stuttgart'],
  [415, 'A250', 2024, 2026, "'s-Hertogenbosch"], [444, 'A250', 2024, 2026, 'Eastbourne'], [637, 'A250', 2024, 2026, 'Mallorca'],
  [306, 'A250', 2024, 2026, 'Bastad'], [7, 'A250', 2024, 2026, 'Gstaad'], [22, 'A250', 2024, 2026, 'Umag'], [18, 'A250', 2024, 2024, 'Newport'],
  [304, 'A250', 2024, 2026, 'Kitzbuhel'], [400, 'A250', 2024, 2026, 'Estoril'], [121, 'A250', 2024, 2024, 'Atlanta'],
  [424, 'A250', 2024, 2026, 'Los Cabos'], [363, 'A250', 2024, 2026, 'Winston-Salem'], [441, 'A250', 2024, 2026, 'Chengdu'],
  [1001, 'A250', 2024, 2026, 'Hangzhou'], [440, 'A250', 2024, 2026, 'Brussels'], [708, 'A250', 2024, 2026, 'Almaty'],
  [114, 'A250', 2024, 2025, 'Metz'], [1039, 'A250', 2025, 2025, 'Athens'], [1010, 'A250', 2024, 2024, 'Belgrade'],
  [148, 'A250', 2024, 2026, 'Stockholm'], [882, 'A250', 2024, 2024, 'Pune']
];

export const ATP_TIER_ROWS = Object.freeze(ROWS.map(([espn, tier, from, to, label]) => Object.freeze({ espn_tournament_id: espn, tier: TIERS[tier], from, to, label })));

/** Registry integrity: one tier per tournament-season, known tiers, sane ranges. Returns problems (empty = valid). */
export function validateRegistry(rows = ATP_TIER_ROWS) {
  const problems = [];
  const seen = new Map();
  for (const r of rows) {
    if (!Object.values(TIERS).includes(r.tier)) problems.push(`unknown tier ${r.tier} (${r.espn_tournament_id})`);
    if (!(Number.isInteger(r.from) && Number.isInteger(r.to) && r.from <= r.to)) problems.push(`bad range ${r.espn_tournament_id}`);
    for (let y = r.from; y <= r.to; y += 1) {
      const k = `${r.espn_tournament_id}:${y}`;
      if (seen.has(k)) problems.push(`two tiers for ${k}`);
      seen.set(k, r.tier);
    }
  }
  return problems;
}

let byEdition = null;
/** canonical edition_id -> { tier, espn_tournament_id, year, registry } (built once; pure hashing, no I/O). */
export async function atpTierIndex() {
  if (byEdition) return byEdition;
  const m = new Map();
  for (const r of ATP_TIER_ROWS) {
    const tid = await tournamentId(`espn:${r.espn_tournament_id}`);
    for (let y = r.from; y <= r.to; y += 1) m.set(await editionId(tid, y), { tier: r.tier, espn_tournament_id: r.espn_tournament_id, year: y, registry: REGISTRY_VERSION });
  }
  byEdition = m;
  return m;
}

/** The reviewed tier of one canonical edition, or null (unknown -> caller keeps its default). */
export async function atpTierForEdition(editionIdValue) {
  if (!editionIdValue) return null;
  return (await atpTierIndex()).get(editionIdValue) || null;
}
