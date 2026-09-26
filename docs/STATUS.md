# Status — 2026-09-26 22:30 UTC (production snapshot)

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
| `tennis-news` | cron */2; **SHADOW** (`NEWS_PUBLISH_ENABLED=false`). `OPENAI_API_KEY` set; model canary PASS (3/3 gpt-5.6-sol, 0 gate failures, 84 numbers checked on one story). Publishing switch awaits owner action. Canary PASS 11/11: 0 published, held stories 404 + noindex + not in sitemap |
| Supabase (tkmln) | migrations applied with ledger rows |

## Women (WTA API)

3,987 canonical matches across 52 editions, 3,164 with match statistics; live state via tennis-live;
WTA singles + doubles rankings (weekly history from 2026-07-27, backfilling). Tennis DNA: 568 players,
249 with medium/high service samples — published. Photos: 480 players approved; WTA top-100 singles
94/100, doubles 86/100.

## Men

Product: `/men` landing, Men + News in primary nav, homepage men/women modules, players ALL/MEN/WOMEN, schedule ALL/MEN/WOMEN/MIXED, tournament event tabs (+ qualifying), rankings hub (WTA available / ATP not available), men's PBEcast replays on /men, /pbecast and the homepage.


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
- **ATP Tour / Challenger:** ProTennisLive draw PDFs are reachable but carry names only — draw context,
  never canonical. atptour.com / Infosys: Cloudflare challenge. **Official ATP rankings: BLOCKED.**
- **Davis Cup (ITF Stadion):** reachable, NOT INGESTED — `tennisId` has no crosswalk to tour ids and no DOB.
- **US Open:** BLOCKED from Cloudflare egress.
- **Photos:** 329 men approved; AO 2026 men's main draw 123/128; 2026 men's field (all ingested events)
  272/324.
- **Tennis DNA (ATP):** 7/30 qualified → **held** on every surface (API, player page, leaders, PBEcast,
  newsroom packet).

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
Browser QA 2026-09-26: 26 routes × 8 widths on production — no overflow, no console errors, no broken
images; PBEcast replay acceptance (`scripts/qa/pbecast-replay.mjs`) PASS on 3 matches × 2 widths.
