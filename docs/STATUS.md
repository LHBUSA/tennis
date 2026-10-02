# Status — 2026-09-28 13:00 UTC (production snapshot)

**PBE Rating publication (authoritative: `docs/evidence/dna-v2-backtest-latest.json`, build 2026-09-29T03:44:57Z,
rating method_version 1; reconciled 2026-10-02, nothing recomputed).** Both tours PUBLISHED, surface ratings published
for both. Champion figures are the PUBLISHED variant of each tour:

| Tour | Variant served | Eval matches | Log loss | Brier | vs fitted ranking (same matches) | Surface blend vs overall |
|---|---|---|---|---|---|---|
| ATP | standard | 34,429 | 0.6183 | 0.2147 | 0.6326 vs 0.6391 (15,649) | 0.5898 vs 0.5921 (10,388) |
| WTA | margin | 104,632 | 0.5353 | 0.1810 | 0.6059 vs 0.6468 (7,318) | 0.5371 vs 0.5377 (100,120) |

(WTA standard variant, not served: 0.5419 / 0.1832, 0.6080 vs 0.6468.) Sections below are dated snapshots; where they
say WTA PBE Rating is "held", that was superseded by this build.

**2026-09-28 — Phase 5 contextual expansion (evidence: `docs/evidence/context-coverage-latest.json`,
`source-canary-latest.json`, `production-canary-latest.json`, `dna-v2-qa-latest.json`, `dna-v2-wta-qa-latest.json`,
`dna-v2-surface-qa-latest.json`; registries `data/context/*.json`).**
- Official WTA player history: all 3,523 players of the backfill population complete (73 with an empty list; one
  "TBD" placeholder removed from the graph). WS 484,831 / WD 138,373 canonical matches (ITF included).
- Context layer (migration 20260928000100): source mappings with evidence (WTA 8,518 editions / 2,189 tournaments
  official_id; ESPN WTA editions 1,309 mapped / 8 unresolved / 5 ambiguous; ESPN ATP 1,250 / 8; 114 combined-event
  identity links), sourced edition attributes, draw slots, player source records, disagreement log.
- Edition consolidation: 9,942 ESPN rows left in ESPN "shadow" editions merged (956 duplicates) or moved (8,986);
  656 shadow editions removed. 0 duplicate canonical matches in any edition (WS/WD/MS/MD).
- Surface: WS 99.8% sourced (official WTA calendar + Slam feeds); MS 34.8% (Slams + 112 combined events).
  ProTennisLive draw sheets are challenged from Cloudflare egress: ATP draw-sheet surfaces not applied.
- Brackets: 721 WTA main draws proven from official WTA draw sheets (28,128 slots, 94.6% of player slots resolved;
  surfaces 414/414 and seeds 6,565/6,571 agree with the official record). ESPN brackets unavailable.
- WTA /records + /year (top 200) and ESPN season stats + event log (top 150 each tour) stored as reported;
  /records vs derived (singles + doubles, tour level): 216/602 exact, 402 within 2 matches; 386 logged disagreements.
- Tennis DNA v2: memory-safe build (was failing: 1102 exceededMemory), surface Match DNA (hard/clay/grass),
  incremental inputs live (`dna2:mode=auto`, shadow verification to 2026-10-05; production hashes equal).
  WTA PBE Rating (margin variant) 0.6061 vs ranking 0.6470 log loss (7,313 matches; 2026-09-29 build: 0.6059 vs 0.6468 on 7,318); surface ratings published
  for both tours.
- Incident 2026-09-28 00:24 UTC: ~2-3 min of PostgREST 5xx on tkmln (all tennis reads) caused by our own
  backfill load; see RELEASE.md "Incidents".


**2026-09-27 evening — WTA history (evidence: `docs/evidence/wta-coverage-latest.json`, `espn-wta-discovery-latest.json`,
`dna-v2-backtest-latest.json`, `dna-v2-wta-qa-latest.json`).** Women's singles 9,368 -> 101,340 and doubles 2,715 -> 25,345
canonical matches, 2000-2026, from the official WTA player-history lane (`wta_history`, 83,760 rows founded, 8,738
links to existing rows) and ESPN's WTA league (`espn_wta`, 1,438 events, 30,868 rows still ESPN-owned, 30,284 ESPN
ids on official rows; 20,358 ESPN rows taken over by official history). 0 same-edition duplicate groups
(1,052 + 172 cross-source duplicates merged by a logged repair after two mapping defects were fixed). Weekly WTA
singles lists 2007-2026 (818 ESPN + 7 official; 4 ESPN weeks of 2018 = SOURCE_ERROR, retried weekly); ESPN lists
dated to their effective Monday (742 re-dated) — official vs ESPN on 7 overlapping weeks: 100% rank + points
agreement. WTA PBE Rating published (0.6268 vs ranking 0.6462 log loss); WTA Match DNA 1,080 players qualify for
match win % (was 276); WTA top 150: Match DNA percentiles 150/150, technical DNA 138/150 (unchanged).
The history lane continues (3,523-player queue; current top 150 done).

**2026-09-27 — ESPN ATP secondary lane + Tennis DNA v2 (details below and in `docs/evidence/espn-atp-coverage-latest.json`,
`docs/evidence/dna-v2-qa-latest.json`).** Men's graph: 3,725 → 60,899 MS/MD matches (53,384 MS), 56 → 1,285 men's
editions, 648 → 1,593 men; ATP Tour results 2007–2026 from ESPN (secondary; official sources outrank it — 3,153
ESPN ids attached to official rows, 0 duplicate canonical matches). Weekly ATP singles lists (ESPN, top 100–150,
2018-07 → 2026-09 so far, backfilling to 2007). Tennis DNA v2 (Match DNA + PBE Rating) LIVE for ATP: 568 ATP
players qualify for match win %, 145 of the current top 150 have a published percentile; technical DNA (v1)
unchanged at 17/30 (held).

**FULL OWNER BAR: NOT YET MET.** Live and real: the Tennis frontend, the WTA core product, Australian Open
2026 men's coverage with genuine point-by-point, Wimbledon archive (degraded source) and Roland-Garros
(ingesting). Not legitimately acquirable yet: ATP Tour / Challenger match data, official ATP rankings, ITF.
Newsroom runs in SHADOW (OpenAI secret not set). Men's Tennis DNA is held by its population gate.

## Production components

Current versions and rollback targets: `docs/RELEASE.md` → *Current production*.

| Component | State |
|---|---|
| Vercel `tennis` | main = production (tennis.propbetedge.ai). SPA + prerendered static heads; data routes proxied to tennis-web |
| `tennis-web` | edge heads, 1200x630 cards, dynamic sitemap |
| `tennis-api` | public read API; tour-scoped DNA with the ATP publication gate; `/v1/news` published-only |
| `tennis-ingest` | cron */2; lane scheduler: `ao_current` every tick + one rotating lane (rank_history, wimbledon_archive, rolandgarros, wta_calendar) with per-lane backoff. Backfill cursors advance only on a proven-absent edition, never on a block |
| `tennis-live` | cron every minute; ~18 s observed-live polling |
| `tennis-news` | cron */2; **PUBLISH** (owner-approved 2026-09-26). gpt-5.6-sol prose behind the deterministic fact gates; 3 public stories; /news indexable. Canary PASS |
| Supabase (tkmln) | migrations applied with ledger rows |

## Women (WTA API)

3,987 canonical matches across 52 editions, 3,164 with match statistics; live state via tennis-live;
WTA singles + doubles rankings (weekly history from 2026-07-27, backfilling). Tennis DNA: 568 players,
249 with medium/high service samples — published. Photos: 480 players approved; WTA top-100 singles
94/100, doubles 86/100.

## Men

Product: ONE Tennis product — men’s and women’s singles, doubles and mixed appear together on Today, PBEcast, Players, Tournaments, Schedule, Search and News, with the event as context. Primary nav: Today · Live · PBEcast · News · Players · Tournaments · Tennis DNA · More. `/men` stays an indexable editorial landing (not in nav).


- **Australian Open 2026 — COMPLETE.** 333 canonical matches: MS main 127/127, qualifying 112/112,
  MD 63/63, XD 31/31; 1 walkover, 10 retirements, 0 unknown rounds. 332 with statistics (the walkover has
  none), 327 with genuine point-by-point (56,231 point events; reason + server-first score only — 0 events
  with coordinates, serve speed or rally length). 5 point feeds held: the official feed contradicts its own
  score/server sequence (MD121, MQ203, MS159, XD102, XD114). 0 unresolved identities.
- **Wimbledon archive (da.wimbledon.com) — DEGRADED.** 778 canonical matches (2015, 2017–2019, 2021–2025);
  cursor re-set to 2016 after a fix (2016 and 2014 had been skipped on a 403; now retried). 398 held for
  unresolved identity, 9 held for impossible deciding-set tiebreak scores reported by the source (e.g. 2022
  QF Nadal d. Fritz 10-4 appears as 7-4). The ingest Worker's Cloudflare egress receives intermittent 403
  (2 of 30 draw requests in 12 h); the lane backs off, never works around it.
- **Roland-Garros (rolandgarros.com) — INGESTING.** Source/parser PASS for every edition 2018–2026 (127
  matches each). Men's singles 2021–2026 written (391+ canonical), cursor at 2020 SM; DM and QM follow.
  Identity: 271 players inspected, 149 resolved to ATP ids by exact name + DOB + nationality, 0 ambiguous,
  the rest held (never name-only).
- **ATP Tour (ESPN core API, secondary source, owner decision 2026-09-27) — INGESTED 2007–2026.** Lane
  `espn_atp`: 58,747 canonical rows written (50,144 MS, 6,877 MD, 1,726 XD; 5,134 qualifying; 1,537 retirements;
  427 walkovers), 1,242 editions / 158 tournaments added; 3,153 ESPN ids attached to official Slam rows. Identity:
  1,886 ESPN athletes resolved (1,317 by exact ids via the crosswalk / Wikidata P11585→P536/P597, 569 by exact
  name + DOB); 400 unresolved + 3 ambiguous/conflict held. Holds: 5,025 identity, 2,411 round missing from the
  source (doubles without a round), 2,138 result-line/id contradictions (ESPN remaps historical athlete ids),
  384 invalid scores, 77 unprovable formats, 11 duplicate candidates, 11 cross-source disagreements. No
  surface, level or match statistics in ESPN (non-Slam editions carry surface = null).
- **ATP Challenger:** ProTennisLive draw PDFs carry names only — never canonical. atptour.com / Infosys:
  Cloudflare challenge. **Official ATP ranking feed: BLOCKED**; weekly ATP singles lists are held from ESPN as
  a secondary source (never labelled official).
- **Davis Cup (ITF Stadion):** reachable, NOT INGESTED — `tennisId` has no crosswalk to tour ids and no DOB.
- **US Open:** BLOCKED from Cloudflare egress.
- **Photos:** 329 men approved; AO 2026 men's main draw 123/128; 2026 men's field (all ingested events)
  272/324.
- **Tennis DNA:** v2 **Match DNA — live** (definition_version 2; results-based families, per-metric same-tour
  gates; PBE Rating published for ATP and WTA after each beat a fitted ranking model out of sample — see the table at the top). v1 **technical
  DNA** unchanged: ATP 17/30 → held; only 238 men's singles matches carry statistics (all Australian Open).

## Open ingest holds (844)

| Count | Source | Class | Action |
|---|---|---|---|
| 426 | rolandgarros | identity ambiguity (FFT id without a unique name+DOB+nat ATP match) | legitimate hold |
| 398 | wimbledon | identity ambiguity (archive UUID without an exact ATP id path) | legitimate hold |
| 8 (+1 also identity) | wimbledon | source inconsistency (impossible deciding tiebreak) | legitimate hold |
| 5 | wta | malformed record (completed without a score) | legitimate hold |
| 5 | ausopen | source inconsistency (point feed contradicts itself) | legitimate hold |
| 1 | wta | source inconsistency (stale set fields) | legitimate hold |
| 1 | wta | malformed record (same participant on both sides) | legitimate hold |

Engineering fixes this pass: WTA winner code 7 (walkover), AO mixed match tiebreak, AO qualifying final
round, AO walkover gap fill, AO opening server when game 1's serve row is missing (MQ206 resolved),
point-feed hold retry per parser revision, backfill cursor never skipping a blocked year.

## Evidence

`docs/evidence/`: source-canary-latest (20 PASS, 2 BLOCKED), wimbledon-archive-latest, daviscup-stadion-latest,
news-canary-latest (PASS 11/11), photo-pipeline-latest, espn-gap-latest (internal reference only),
production-canary-latest, sim-backtest-latest (RESEARCH, hidden).
Live UX 2026-09-30 (`scripts/qa/live-ux.mjs`, `docs/evidence/live-ux/`): production PASS on a real live WD match — 7 widths, no page overflow, no rail scrollbars, live scores inside cards with aligned set columns, ticker arrows / wheel / touch swipe, auto-advance pauses on hover / focus / touch and is off under reduced motion; route matrix 23 routes × 8 widths OK.
Browser QA 2026-09-26: 26 routes × 8 widths on production — no overflow, no console errors, no broken
images; PBEcast replay acceptance (`scripts/qa/pbecast-replay.mjs`) PASS on 3 matches × 2 widths.
