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

## ESPN athlete ids (`workers/shared/canonical/espn-identity.js`, lane `espn_atp`)

ESPN ids never found a player. Each ESPN athlete reaches a tour id (then the tour-id UUID) through, in order:

1. the crosswalk we already hold (`provider=espn`) → `external_id`;
2. Wikidata **P11585** (ESPN.com tennis player ID) on the same item as **P536** (ATP) / **P597** (WTA) →
   `external_id`, corroborated when we already hold that player: the surname must agree and the DOB must not
   conflict; a tour id Wikidata gives to two ESPN ids is refused;
3. exact normalized full name + exact DOB (+ nationality when both have one), unique among canonical tour-id
   players → `name_dob` (the Roland-Garros contract);
4. only when step 3 has **no candidate at all**: exact normalized English label + exact **day-precision**
   DOB (Wikidata `timePrecision 11`), unique among every Wikidata item with an ATP or WTA id → `name_dob`.

Anything else is `unresolved` / `ambiguous` in `tennis_identity_queue` and the athlete's matches are held.

ESPN remaps historical athlete ids (AO 2008 lists id 543 "Lesley Pattinama Kerkhove" and 440 "Lizette
Cabrera" where the printed result says Nenad Zimonjic / Victor Hanescu). Every ESPN match is therefore also
checked against the printed result line: the flagged winner's and loser's surnames, and the surname of the
canonical player each id resolved to, must appear on the correct side of "bt" — otherwise the row is held
(`result_line_names_disagree_with_winner_flag`, `resolved_player_not_in_result_line`).
