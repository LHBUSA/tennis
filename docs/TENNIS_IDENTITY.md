# Identity graph

One canonical PropBetEdge player UUID per human. Names are never identity.

## Minting

`uuidv5("player:<provider>:<ID>", PBE_TENNIS_NAMESPACE)` from the player's **founding external id**,
precedence: tour id (`atp:` for men, `wta:` for women) → ITF → other. Deterministic, so the graph can be
rebuilt from the raw archive. When two UUIDs are later proven to be one person, the survivor keeps its
UUID and the other becomes `status='merged', merged_into=<survivor>`.

Tour ids reach us embedded in other official feeds — Wimbledon `atps0ag` / `wta324219`, AO `ATPBK92` /
`WTA317790` — so Slam rows land on the same UUID as tour rows with **no name matching**
(`tests/providers.test.js`).

## Crosswalk

`tennis_player_external_ids (provider, external_id) → pbe_player_id` with `method` and `evidence`.
Providers: `atp`, `wta`, `itf`, `wikidata` (QID), `daviscup`, `bjkcup`, `wimbledon`, `ausopen`, `fft`, …
Wikidata supplies ATP (P536, 6,582 humans), WTA (P597, 5,405), ITF (P599, 7,417), Davis Cup (P2641),
BJK Cup (P2642) and image (P18); WTA ids were verified identical to the WTA API.

## Resolution (`workers/shared/canonical/identity.js`)

1. Exact external id on the crosswalk → resolved (`external_id`).
2. Normalized full name **and** exact DOB (and nationality if both sides have one), exactly one
   candidate → resolved (`name_dob`).
3. Anything else → `unresolved` / `ambiguous` → `tennis_identity_queue` for review.

Name only is never identity. No fuzzy match ever writes a production row.

## Aliases

`normalizeName` folds diacritics (NFD + ø/ł/ß/æ/đ/ı…), apostrophes, hyphens and punctuation;
`aliasKeys` produces feed forms ("sinner j", "j sinner", "sinner jannik") that narrow candidates only.
Alias kinds: legal, married, former, transliteration, feed, short.

Reconciliation reports come from the identity queue once ingestion runs.
