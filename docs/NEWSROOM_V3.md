# Tennis Newsroom V3 — contract

Owner brief 2026-09-29. Baseline (production, verified): 126 detected events, 96 below_threshold, 25 duplicate,
5 published articles (3 doubles, 2 WTA, 0 ATP), tennis_news_wire 0 rows. Cause: one global bar
(PUBLISH_MIN_MATERIALITY = 60) and only one editorial layer (a full article).

Truth architecture is unchanged: event -> canonical graph -> frozen evidence packet -> deterministic plan/charts ->
model-assisted prose -> fact gates -> publish or HOLD. No gate is relaxed.

## Editorial classes

| Class | What | Article? |
|---|---|---|
| `wire` | deterministic fact card (final score, upset, retirement/walkover as sourced, deciding tiebreak, comeback, ranking move, title) | no — live wire only |
| `brief` | material event with >= 2-3 evidence dimensions (~250-600 words) | yes |
| `full` | high materiality + >= 5-6 evidence dimensions | yes |
| `deep` | major event (Slam / 1000 late round or title, No. 1, major upset) + >= 7 dimensions | yes |

`classifyStory(event, packet)` (workers/tennis-news/src/classify.js) is deterministic, from event facts + the frozen
packet only, never from prose: `{ surface, reasons[], importance, evidence_dimensions[], publish_article }`.
A preliminary class is computed at detection from facts (no packet); the final class at enrichment from the packet.
Principles (owner): every legitimate ATP/WTA tour singles title >= brief (Slam deep; 1000 deep/full; 500 full;
250 brief; 125 brief/wire); top-10 upset >= brief, late-round top-10 upset at a significant event full; routine
comeback / deciding tiebreak = wire unless significance upgrades it; ranking: new No. 1 deep/full, top 10 full,
top 20 brief/full, top 50 wire (brief only with strong context), top 100 wire; retirement/walkover: only what the
source proves; top player / late round brief+, routine wire. Tour tier: official level or the reviewed ATP tier
registry (workers/shared/atp-tiers.js); unknown stays unknown. No artificial volume target.

Evidence dimensions (packet-derived): result/score, set detail, match statistics, point-level evidence, ranking
context, Match DNA v2, Technical DNA v1, pre-match rating expectation, recent form, H2H, draw path, tournament
context, next opponent, surface context, prior stories, ranking history.

## Storage (migration 20260929000200, APPLIED 2026-09-29)

- `tennis_news_events.editorial_class` (wire|brief|full|deep), `class_reasons` jsonb, `class_history` jsonb
  (`[{ class, at, reasons, classifier_version }]`), `classifier_version`; state `wire` added (new wire-only events;
  historical `below_threshold` rows keep their state until re-classified by the V3 backfill).
- `tennis_articles.story_class` (brief|full|deep), `revised_at`, `revisions` jsonb
  (`[{ at, from_class, to_class, reason, packet_hash }]`). Upgrades keep article_id, slug, first_published_at.
- `tennis_news_wire` is the EXTERNAL publisher wire (attributed headlines) — untouched. The internal live wire is a
  read projection of `tennis_news_events` (no duplicate storage).

## API (tennis-api)

`GET /v1/news/live?desk=&tournament=&year=&player=&limit=` — internal live wire, newest first:
```
{ items: [{ id, kind, tour, desk, occurred_at, detected_at, headline, summary, tournament: { slug, year, name },
  players: [{ id, slug, name }], match_id, article_slug | null, story_class | null,
  links: [{ rel: 'article'|'match'|'tournament'|'player', href, label }], state }] }
```
Deterministic copy from facts (e.g. "Carlos Alcaraz defeats X 6-4 7-6 in Tokyo"); no interpretation. Materiality is
never exposed as a consumer score. Link order: article, match, tournament, player.

`GET /v1/news` cards add `story_class`, `first_published_at`, `revised_at`. `GET /v1/news/:slug` adds
`story_class`, `revisions`, `glance` (3-5 at-a-glance cells, never empty: `[{ label, value, note? }]`),
`intelligence` (`{ takeaway, evidence: [...], counterpoint | null }` or null), `sections` adapt to evidence.

## Packet v3 (frozen)

Singles: Match DNA v2 snapshot with `as_of` STRICTLY BEFORE the match day for both players (rating + status,
rated matches, families, form windows, strength/hand splits, sourced-surface Match DNA, surface rating only if that
tour's surface model was published at that snapshot, recent rating trajectory) + Technical DNA v1 where stored.
Pre-match expectation only when a validated rating existed before the match and the exact number is frozen in the
packet (model vs descriptive facts separated). Never a snapshot newer than the event.

## Targets

source_updated_at -> detected_at p95 < 5 min (wire visible); detected (eligible) -> published p95 < 2 min.
Health: `node scripts/news/health.mjs` (24h/7d distribution by class and tour, latencies, attachment rates).
Replay: `docs/evidence/newsroom-v3-replay-latest.json` (last 7 days through the new classifier).
