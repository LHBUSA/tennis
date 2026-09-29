# Tennis Newsroom V3 — close-out (2026-09-29)

## 1. Backfill freshness

- Old: every card showed publication-relative time, so stories published by the V3 reclassification on 2026-09-29 16:56Z about
  events of 21-29 Sep read "42 min ago". Wire rows linked to them, and late catch-up wire items, showed a fresh time of day.
- New (tennis-api 0.8.2 / 0.8.3, frontend `storyClock` / `wireRow`):
  - `freshness.is_backfill` from the lifecycle record: first published AFTER the event's `reclassify_v3` class-history entry
    (12 stories; the 5 published before the reclassification are not backfills).
  - Event time = the match's own `started_at`, else `scheduled_at` (day precision for secondary results), else
    `occurred_at` (which can be a tournament start for untimed results — never used when the match has a time).
  - Cards (front, desks, homepage, player, tournament, related) and article meta: "Match Sep 27 · Added to PropBetEdge Sep 29";
    the byline reads "Published Sep 29, 4:56 PM (added after the event)". The masthead "Updated" ignores backfills.
  - Live wire: an item recorded > 18 h after its event, or linked to a backfill story, shows "Match Sep 24" instead of a time.
- QA: tests/news-freshness.test.js (Birrell Seoul, Medvedev Hangzhou, Harris R2 fixtures); scripts/qa/news-v3.mjs fails if
  any link to a backfill story sits next to a clock that is not "Match …", on every page and width.

## 2. Latency outliers (7 d, first terminal-state observation -> detected_at; match start never used)

| event | tour · tournament | kind | source | terminal observed | detected | delay | classification |
|---|---|---|---|---|---|---|---|
| comeback:d2aa0b9d… | WTA · Singapore | comeback (WS) | wta | (no change row; source_updated 09-26 12:17) | 09-26 16:56:05 | 278.4 min | migration/backfill — newsroom first detection run (launch catch-up) |
| deciding_tiebreak:6485… | WTA · Jingshan 125 | deciding tiebreak (WS) | wta | 09-28 06:56:18 | 09-28 10:16:14 | 199.9 min | news_late — detection query truncation |
| doubles_title:4c60fd61… | WTA · Porto 125 | doubles title (WD) | wta | 09-26 15:47:29 | 09-26 16:56:05 | 68.6 min | migration/backfill — newsroom first detection run |
| doubles_title:c8c05950… | WTA · Singapore | doubles title (WD) | wta | 09-27 07:59:31 | 09-27 08:18:58 | 19.4 min | news_late — detection query truncation |
| title:48ee6282… | WTA · Seoul | title (WS) | wta | 09-27 08:03:32 | 09-27 08:18:58 | 15.4 min | news_late — detection query truncation |

The other 13 live events: 0.0-2.5 min.

- First detection run: the newsroom's earliest `detected_at` is 2026-09-26 16:56:05.785Z; every event it found was already final.
- Detection query truncation (a real current-path defect, fixed): candidates were
  `status=final & updated_at >= now-6h & limit=400` with NO ORDER BY. Bulk historical rewrites (>= 500,834 finished rows with
  updated_at in 09-28 01:00-10:16; >= 4,570 in 09-27 02:00-08:18 — lower bounds, updated_at keeps only the latest write)
  pushed fresh finals out of an arbitrary 400-row page. Fix (tennis-news 3ae54ce2, deployed 2026-09-29 18:22Z):
  `detectionCandidates` bounds timed rows by `started_at`/`scheduled_at` inside the 72 h window and untimed rows by
  edition end date, keyset-paged on match_id, then loads by id. Regression test in tests/newsroom-v3.test.js. First
  production run after the fix: 135 scanned, 10 s, 0 errors (the run at 18:24Z hit a Supabase gateway 521 that also hit
  the ingest Worker's own DB probe — an upstream outage, not the query).
- Health (scripts/news/health.mjs) now reports `current_live_slo` (events detected since the V3 cutover) separately from
  `historical_observed` (audit only), and classifies every > 5 min outlier.

| metric | value |
|---|---|
| current live p50 / p95 | 0.9 / 0.9 min (1 event since 16:50Z; 0 over 5 min) |
| historical audit (7 d) p50 / p95 | 1.6 / 278.4 min (18 live events; 69 catch-up and 33 without a source clock reported separately) |
| current-path violations | 0 unresolved (the truncation defect is fixed) |

## 3. First post-cutover V3 article

`node scripts/qa/news-first-v3-article.mjs` -> HOLD_NO_ELIGIBLE_EVENT (2026-09-29 ~18:45Z). Since the 16:50Z cutover only 2
events were detected (1 wire, 1 duplicate); none classified brief or above. Nothing was manufactured or promoted. The script
traces source terminal observation -> detection -> classification -> packet -> editorial -> gates -> publication for the first
naturally eligible event and checks it in a real browser at 390 / 1440 (front, desk, article, tournament page, freshness,
image, glance, Match DNA cutoff, Source & Method). Mechanics exercised on an existing story (QA_MECHANICS_ANY=1).

## 4. Health semantics

- `event_window` — clock: `tennis_news_events.detected_at`: events_detected, classified_wire / brief / full / deep,
  events_resulting_in_article, queued_for_article, held, duplicates, legacy_below_bar, by desk.
- `article_activity` — clock: `tennis_articles.first_published_at`: newly_published_live, backfill_articles_created,
  articles_revised (revised_at), historical_articles_preserved, total_published.
- 24 h now: event window 44 detected / 29 wire / 2 brief / 2 resulting in an article; article activity 0 live-path /
  12 backfill / 7 revised / 5 preserved.
