# TENNIS ATP/WTA PARITY — PRODUCTION ACCEPTANCE

STATUS: CONDITIONAL HOLD — LIVE ATP OBSERVATION ONLY

Recorded 2026-09-29 ~15:00 UTC against production (tennis.propbetedge.ai, tennis-api.propbetedge.ai). Versions and
rollbacks: docs/RELEASE.md. Main 6c9eece + this evidence commit.

## Only open gate

LIVE ATP FIRST-PRODUCTION OBSERVATION
- Status: WAITING FOR A LEGITIMATE MATCH TO BEGIN
- Reason: no ATP match currently live (`node scripts/qa/atp-live-production.mjs` -> `HOLD_NO_LIVE_ATP`, 15:0x UTC;
  live rows: WTA WS/WD at Adana only). Next scheduled ATP start: 2026-09-30 03:00Z (China Open, Khachanov v
  Auger-Aliassime).
- Code/router tests: PASS
- Production provider health: PASS
- Real-match observation: PENDING — run `node scripts/qa/atp-live-production.mjs` while an ATP match is live, then
  once more after it ends (proves it left live state).

## Results

| Gate | Result | Evidence |
|---|---|---|
| Live router | PASS | tests below; tennis-live /health |
| PBEcast DNA v2 | PASS | API + real browser |
| ATP player DNA | PASS | Alcaraz, Sinner |
| WTA player DNA | PASS | Swiatek, Sabalenka |
| News detection | PASS | MS/WS/MD/WD/XD detected; ATP ranking context |
| News parity | PASS | same weights, same bar 60; ATP published 0 legitimately |
| News fair scheduler | PASS | w1(70), a1(61), w2(66) |
| Ranking provenance | PASS | tests D |
| Desk routing | PASS | tests E |
| Schedule / tournament coverage | PASS | /v1/schedule filters + coverage layers |
| One product | PASS | one-product QA; no Men/Women nav silo |
| Duplicates | PASS | 0 active duplicate groups; 2 valid tombstones |
| Browser QA | PASS | 147/147 (21 routes x 7 widths) |
| ATP live real-match observation | PENDING | see above |

## Live router (PASS)

Deterministic tests (`node --test tests/live-router.test.js tests/workers.test.js ...`, 42/42 with the parity suites):
- router: WTA editions -> official WTA provider; ATP (ESPN) editions -> ESPN provider; unknown sources refused (fail closed)
- WS/WD edition and MS/MD edition both write canonical live match state + canonical events through the same writer, no source mixing
- ownership: the ingest discovery scan never observes or writes an edition tennis-live owns (live:heartbeat / live:owned)
- ESPN live parsing proves what it writes: contiguous sets, known formats, match tiebreak, no guessed state
- tennis-live polls only live editions and hands ownership back to ingest

Production `https://tennis-live.sales-fd3.workers.dev/health`: version 0.3.0, cron every minute, providers
- `wta`: tour WTA, events WS/WD, granularity point, official true
- `espn`: tour ATP, events MS/MD/XD, granularity game, official false (secondary)

Discovery: every ingest tick (2 min) observes the current ATP events (Chengdu, Hangzhou, Tokyo, Beijing):
`espn_live {"events":4,"live":0}`.

## Player DNA (ATP PASS, WTA PASS) — `/v1/players/:slug/dna`, as_of 2026-09-29

| Player | Tour | Match DNA v2 | Families published (Result strength / Pressure / Opponent quality) | PBE Rating | Technical DNA v1 | Technical gate | Sources |
|---|---|---|---|---|---|---|---|
| Carlos Alcaraz | ATP | yes (v2) | 6/6, 5/6, 7/7 | published 2277 (p99) | present, comparative HELD | 17 of 30 | ausopen, espn, rolandgarros, wimbledon |
| Jannik Sinner | ATP | yes (v2) | 6/6, 5/6, 7/7 | published 2409 (p100) | present, comparative HELD | 17 of 30 | ausopen, espn, rolandgarros, wimbledon |
| Iga Swiatek | WTA | yes (v2) | 6/6, 5/6, 7/7 | published 2798 (p100) | present, comparative published | 506 of 30 | espn, wta, wta_history |
| Aryna Sabalenka | WTA | yes (v2) | 6/6, 5/6, 7/7 | published 2870 (p100) | present, comparative published | 506 of 30 | espn, wta, wta_history |

ATP result as intended: MATCH DNA V2 useful and surfaced; TECHNICAL DNA V1 independently gated (17/30, gate not lowered).

## PBEcast DNA (PASS)

`/v1/pbecast/0bedef37-c0d9-52f9-9df9-68768969a907` (Hanfmann v Machac, China Open 2026 qualifying R1, MS, result_only):
- `dna.contract` = `pbecast-dna/2`
- `match_dna.{A,B}.definition_version` = 2, tour ATP both sides, 12/12 metrics with published percentiles, PBE Rating published
- `technical_dna.{A,B}.definition_version` = 1, status `building`
- `match_dna.same_tour` = true; basis "ATP singles players with a stored v2 snapshot on 2026-09-29; ATP and WTA are never pooled"

Real browser (Chrome, 1440px, https://tennis.propbetedge.ai/pbecast/0bedef37-…): header "China Open · Qualifying R1 ·
Men's singles"; ATP ranks shown (No. 54, No. 74); Tennis DNA module shows Match DNA + PBE Rating and "Technical
serve/return DNA is still building"; the text "No Tennis DNA" does not appear; 0 console errors; 0 broken images.

## News (detection PASS, parity PASS, scheduler PASS)

Production 7-day audit (tennis_news_events, detected since 2026-09-22):

| | ATP | WTA |
|---|---|---|
| Candidates detected | 49 | 77 |
| Qualifying (materiality >= 60) | 0 | 2 |
| Published | 0 | 5 |
| Below threshold | 41 (max 58) | 54 (max 58) |
| Held (by reason) | 0 | 0 |
| Failed (by reason) | 0 | 0 |
| Duplicate — "merged into … (one story per match)" | 8 | 18 |

WTA published: the 2 qualifying stories (Singapore WTA 500: upset 69, title 63) plus 3 stories of 36-37 from the
owner-approved 2026-09-26 launch batch (published 21:49-21:50 UTC that day).

Parity of the bar (publish threshold 60, unchanged):
- Chengdu ATP 250 title = 58; Hangzhou ATP 250 title = 58 (registry tier ATP 250, dry-run audit 2026-09-29)
- WTA 250 title equivalent = 58
- ATP 500 title = 63 under the registry (tests/atp-tiers.test.js), equal to the WTA 500 title that published (63)

Why ATP published = 0 is legitimate: in this window no ATP event reached 60. The ATP events that finished were two
ATP 250 finals (58, the same score a WTA 250 final gets, which also does not publish) and early rounds at the ATP 500s
(Tokyo, Beijing). No article was created to make the count nonzero.

Fair scheduler (tests/news-parity.test.js F): 3 eligible WTA (70, 66, 62) + 1 eligible ATP (61), limit 3 -> selected
order `w1(70), a1(61), w2(66)`; compare-and-set claim keeps a constant WTA stream from starving ATP.

## Ranking provenance (PASS)

tests/news-parity.test.js D: an ATP secondary list is "the ATP singles list in the PropBetEdge archive", never
"official"; a WTA official list keeps "official WTA singles list"; ranking stories take tour label + provenance from
the list; gate `unsupported_official_claim` holds any "official ATP" phrasing. Copy guard (tests/one-product.test.js):
"official ATP" appears in src/ only as a negation. Player heads: men "ATP singles No. X (… secondary source)", women
the official WTA list.

## Desk routing (PASS)

tests/news-parity.test.js E: ATP non-Slam MS -> atp; WTA non-Slam WS -> wta; Grand Slam MS -> grand-slams; Grand Slam
WS -> grand-slams; non-Slam MD/WD/XD -> doubles.

## Schedule / tournament coverage (PASS)

`/v1/schedule` filters.tours = `atp, wta, wta-125, grand-slam`; coverage layers:

| | ATP Tour | WTA Tour / WTA 125 | Grand Slams |
|---|---|---|---|
| Provenance | secondary (ESPN; not an official ATP feed) | official (WTA) | official Slam feeds where accessible, else WTA (women) and ESPN (men, secondary) |
| Historical / results | ATP Tour events and results 2007–present (singles, doubles, mixed); no level/surface from the source | WTA 250–1000, Finals / WTA 125 editions | every event of each edition held (MS, WS, MD, WD, XD, qualifying) |
| Schedule | fixtures once the source lists them (draw, next day's order of play) | official order of play | as each source publishes it |
| Live | set and game score while observed live; no point-by-point | official live score with point score and server | as each source publishes it |
| Rankings | weekly ATP singles top 100–150, not an official ATP ranking; no ATP doubles list | official WTA singles and doubles | n/a |

/v1/today, /v1/schedule and /v1/tournaments list ATP editions (Hangzhou, Chengdu, China Open, Japan Open) next to WTA.

## One product (PASS)

scripts/qa/one-product.mjs: PASS on /, /players, /tournaments, /news, /news/atp, /news/wta, /dna, /schedule, /live,
/pbecast (+ search), never visiting /men. Primary nav: Today, Live, PBEcast, News, Players, Tournaments, Tennis DNA,
More — no Men/Women silo.

## Duplicates (PASS)

scripts/qa/dna-v2.mjs 138/138: 0 active duplicate canonical singles groups; 2 superseded rows, both pointing at a live
survivor with no natural key.
- China Open 2026 WS: 15 pairs absorbed (writer fixture identity, c71aa64): 15 survivors all official WTA rows with a
  natural key, 15 ESPN ids moved onto them, 0 rows or ids left behind.
- Adana 2026 WS: 2 orphans cannot be deleted (tennis_match_events is append-only and references tennis_matches
  without ON DELETE); tombstoned with migration 20260929000100 (status superseded + superseded_by, applied, ledger
  recorded): c69ab2e1 -> cc53d141, 4d49ce38 -> db28134a.

## Browser QA (PASS)

scripts/qa/browser-gate.mjs: 147/147 (21 routes x 320/360/390/430/768/1024/1440): no overflow, broken images, console
errors, missing identity, empty DNA shells, duplicate live matches or WTA labels on ATP content.

## One-shot live acceptance command

`node scripts/qa/atp-live-production.mjs [--wait 240] [--shots]` -> PASS | HOLD_NO_LIVE_ATP | FAIL. Checks identity,
no duplicates/superseded, PBEcast observed_live with no point score / server / point events / speeds / coordinates,
re-observation across polling cycles, score progression when the source changed, the real browser (players,
tournament, LIVE, no server/point UI, no console errors, no broken images); a later run proves each observed match
left /v1/live as final. Mechanics exercised 2026-09-29 against a live WTA row (QA_LIVE_SOURCE=wta): every step ran;
the game-level assertions failed there as they must (WTA carries point + server), which also shows the browser check
detects server/point UI.
