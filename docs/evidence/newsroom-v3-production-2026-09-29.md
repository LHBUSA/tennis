# Tennis Newsroom V3 — production acceptance (2026-09-29)

Contract: docs/NEWSROOM_V3.md. Migration 20260929000200 applied. Deployed: tennis-news a5415f3e (rb c28cf9ec),
tennis-api 5c8b26a2 0.8.0 (rb 87bca6d2), Vercel dpl_FavajNnS (b3f2731; rb dpl_5hWQxH5c).

## Engine (scripts/news/health.mjs, docs/evidence/newsroom-v3-health-latest.json)
| window | detected | wire | brief | full | deep | held | duplicate | published |
|---|---|---|---|---|---|---|---|---|
| 24 h | 44 | 29 | 2 | 0 | 0 | 0 | 13 | 2 |
| 7 d | 128 | 82 | 14 | 1 | 0 | 0 | 29 | 17 |
7 d by desk: ATP 38 events / 3 published / 35 wire; WTA 61 / 14 / 47; doubles 31 / 5; rankings 3 / 0; Slams 0.
Before V3: 126 events, 96 below_threshold, 0 wire, 5 published, 0 ATP.

Replay (docs/evidence/newsroom-v3-replay-latest.json, frozen-packet dry run): 83 wire / 14 brief / 1 full / 28 duplicate;
principle violations 0. Every ATP/WTA tour singles title >= brief (Chengdu, Hangzhou ATP 250; Seoul WTA 250; Porto,
Ankara, Tolentino WTA 125; Singapore WTA 500 full). Routine comebacks / deciding tiebreaks = wire. Reclassification
backfill applied: 12 new stories published (0 held); the 5 original articles kept id/slug/first_published_at.

## Latency
- source final observed -> detected: 24 h p50 0.9 min / p95 1.7 min (11 live events); 7 d p50 1.6 / p95 278 min (18 live);
  catch-up (69) and no-source-clock (33) reported separately.
- detected -> wire: immediate (read projection; API cache <= 2 min).
- detected -> published (live pipeline): 7 d p50/p95 0.5 min (2 stories); no event detected AND published since the V3
  cutover yet (12 backfill + 3 launch-batch excluded).

## Correction applied (same day)
A Match DNA v2 snapshot dated 2026-09-01 but BUILT 2026-09-27 13:46Z (after the match) supplied "24% pre-match" style
model cells. Rule now: ratings / expectation only from snapshots built before the event started. 7 articles corrected in
place (glance + PBE Intelligence rebuilt from the corrected packet; prose never stated ratings), revised_at + revision.

## Intelligence (articles, 24 h / 7 d)
Match DNA v2 83% / 59%; technical DNA 58% / 53%; pre-match rating (validated at the time) 25% / 18%; charts 100%;
H2H 8% / 12%; draw path 42% / 41%; glance 100% / 71%; PBE Intelligence 75% / 53%; player + tournament links 100%;
media resolved 100% / 82%.

## UI (scripts/qa/news-v3.mjs, production)
154/154 (22 pages x 7 widths, 80 links resolved): no overflow, broken or stretched images, SVG mock media, giant blank
hero or tile walls; lead dominant at 1440; wire bounded (14 desktop / 8 phone before "Show more") and readable at 320;
article measure and rail width; collapsible Source & Method; share links. Screenshots: docs/evidence/newsroom-v3/.

## Media
Coverage (approved photo): ATP top 100 91.9%, WTA top 100 94%, current-event players 73.4%, news players 69.4%
(9 photos added; 115 refused by the existing rules — 88 have no Wikidata image). docs/evidence/media-coverage-latest.md.

## Known limits
- Backfilled stories show their publication time ("42 min ago") although the events are from 26-28 Sep.
- No deep story yet (no Slam / 1000 late round in the window); rankings desk has no story (only top-50/100 crossings).
