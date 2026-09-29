# ATP/WTA parity — production acceptance (2026-09-29)

Release: main 3a734be, 8aa2197, 6207869, 4c821d3, then Worker/QA follow-ups. Versions and rollbacks: docs/RELEASE.md.

## Live (router)
- tennis-live 0.3.0 `/health` lists providers `wta` (official, WS/WD, point) and `espn` (secondary, MS/MD/XD, game).
- Candidate dry run from Cloudflare egress (`espn_live`, write=0): China Open 959-2026 -> edition 81fb3ab5…, Japan Open
  5-2026 -> edition d1fd1ff0…; 1 upstream request each; 0 candidates (no started, unfinished competition).
- Canaries espn.atp.status + espn.atp.linescores PASS (workstation).
- After the 13:48Z espn_atp relisting, every ingest tick observes 4 current ATP events (441, 1001, 5, 959 -2026):
  `espn_live {"events":4,"live":0}`. No ATP match was live during QA (Asian sessions finished; next ATP start
  2026-09-30 03:00Z, Khachanov v Auger-Aliassime, China Open). Nothing was fabricated to show a live card.
- /v1/live: 2 WTA rows (Adana). Two stale 0-0 rows from 09:10 (orphans of a duplicate pair, no external id) are
  now excluded.

## PBEcast DNA
- ATP match 0bedef37 (Hanfmann v Machac): dna.contract pbecast-dna/2; match_dna ATP as_of 2026-09-29, 12/12 metrics
  with same-tour percentiles, PBE Rating published (1778 / 1846); technical_dna `building` for both (ATP v1 17/30).

## Players
- Alcaraz, Sinner: /v1/players/:slug/dna match_dna.rating published (2277 p99 / 2409 p100).
- Djokovic, Zverev, Sabalenka /profile: 400 before (900-id in.()), 200 after.

## News
- Published 2026-09-22..29: 5, all WTA (audit docs/evidence/news-parity-audit-2026-09-29.md).
- New worker dry run: ATP candidates detected with atp_singles context (best: upset 48; bar 60). ATP published 0:
  below materiality — ESPN publishes no tournament level, so an ATP 500/1000 weighs like a 250.

## QA
- scripts/qa/one-product.mjs: PASS (/, /players, /tournaments, /news, /news/atp, /news/wta, /dna, /schedule, /live,
  /pbecast, search; no /men visit; men's live card not required: no MS/MD live).
- scripts/qa/browser-gate.mjs: PASS 147 checks (21 routes x 320/360/390/430/768/1024/1440).
- scripts/qa/dna-v2.mjs: UI checks pass; data check FAIL — 17 duplicate canonical singles groups (below).

## Open data defects (pre-existing, not created by this release)
- China Open 2026 WS: 15 pairs of scheduled rows — ESPN WTA-league fixture (round '1', written 09:54) and the official
  WTA row (round 'M-7'). crossSource does not map WTA's opaque round ids to ESPN round numbers for fixtures, so neither
  takes over the other. Schedule can list both until the match is played.
- Adana 2026 WS: 2 pairs created 09:10-09:11 (in_progress orphan + final row). The first tennis-live 0.3.0 rounds
  moved the orphans' external ids to the final rows (merge PATCH) before the merge's DELETE was refused by the
  append-only events trigger; since 4c821d3 evented rows are never merged.
