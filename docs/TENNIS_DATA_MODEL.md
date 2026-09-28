# Canonical data model

Schema: `supabase/migrations/20260926000100_tennis_core.sql` (STAGED, not applied; proven by
`tests/migration.test.js` on PGlite). Target: the sports Supabase project (tkmln), per the network rule
that identity/billing live on rlfy and models/markets/history on tkmln.

## Participants

A match is **participant A vs participant B**. A participant is a team of one or two players:

| Kind | Key | Example |
|---|---|---|
| singles | `S:<player uuid>` | `S:3f…` |
| pair (doubles, mixed) | `D:<uuid>+<uuid>`, members sorted | A+B and B+A are the same key |

`tennis_participants` + `tennis_participant_members` (slot 1/2). Event types `MS WS MD WD XD`; a mixed
team must be one woman and one man, and an unknown gender fails validation rather than being guessed
(`participant.js`). The scoring engine is side-based and never cares about team size; which doubles player
served is stored only when the source names them (`tennis_points.server_player_id`).

## Entities

| Area | Tables |
|---|---|
| Reference | `tennis_tours`, `tennis_competitions` |
| Identity | `tennis_players`, `tennis_player_external_ids`, `tennis_player_aliases`, `tennis_identity_queue`, `tennis_player_media` |
| Participants | `tennis_participants`, `tennis_participant_members` |
| Tournaments | `tennis_tournaments`, `tennis_tournament_editions` (surface, indoor), `tennis_draws` (event × stage), `tennis_draw_entries` (seed, entry type WC/Q/LL/PR…, bye, withdrawn) |
| Matches | `tennis_matches`, `tennis_match_external_ids`, `tennis_match_participants`, `tennis_sets`, `tennis_games`, `tennis_points` (observed only), `tennis_match_stats`, `tennis_player_match_stats` |
| Rankings | `tennis_ranking_snapshots` (list × date, unique) + `tennis_rankings` rows (provider id kept; `pbe_player_id` null until resolved) |
| Derived | `tennis_surface_ratings`, `tennis_dna_snapshots`, `tennis_pair_snapshots` — versioned, exclusive `as_of` |
| Markets | `tennis_odds_runs`, `tennis_odds_snapshots` (append-only) |
| Model / picks | `tennis_model_evaluations` (`feature_cutoff <= generated_at`), `tennis_picks` (locked before start, append-only trigger), `tennis_pick_corrections` (reason required), `tennis_pick_grades` |
| Newsroom | `tennis_news_events` (deterministic id), `tennis_articles` (held/published), `tennis_article_evidence` (frozen packet) |
| Lineage | `tennis_source_captures`, `tennis_source_runs`, `tennis_source_changes`, `tennis_coverage` |

## Match status + scores

Statuses: `scheduled in_progress suspended completed retired walkover defaulted cancelled abandoned`. A
final status requires `winner_side`. Sets store games A-B, tiebreak points, `tb_winner_points_derived`
(true when the source printed only the loser's points, e.g. `7-6(5)`), `is_match_tiebreak`. Format keys
(`scoring.js FORMATS`): `BO3_TB7`, `BO5_FINAL_TB10`, `BO3_FINAL_TB10`, `BO5_FINAL_ADV`, `BO3_FINAL_ADV`,
`DOUBLES_TOUR` (no-ad + 10-point match tiebreak), `BO3_MATCH_TB10`, `BO5_TB7` (tiebreak at 6-6 in every set of a
best-of-five: US Open to 2021).

## Completeness

`tennis_coverage` records, per tour × season × event type (× tournament), whether matches / match stats /
points are `complete | partial | unavailable | unaudited`. Nothing is called complete until audited.

## One real match = one row (cross-source)

Canonical match ids are minted per source (`uuidv5(match:<provider>:<id>)`), so the writer
(`writer.js crossSource`, opt-in per lane: every Slam lane and `espn_atp`; the WTA lane is unchanged)
first looks for the same match inside the edition: **event type + stage (main / qualifying / round robin) +
the two participant keys** (orientation-free). Then:

| Found | Incoming source | Action |
|---|---|---|
| this external id already linked | any | update that row (idempotent re-ingest) |
| one row, higher-precedence owner (precedence: `espn` 1 < `wta_history` 2 < every per-match official feed 3) | lower | **attach** the ESPN external id only; a result disagreement becomes a `cross_source` hold for review; the official row stands |
| one row owned by `espn` | official feed | **take over**: same `match_id`, official fields, participants replaced |
| one row, round codes differ | any | held `duplicate_candidate:round_conflict` |
| same source, other external id / several rows | any | held `duplicate_candidate` |

Provenance for an ESPN row or link: `source_family` + `tennis_match_external_ids (espn, '<tid>-<year>:<competition>')`
→ the event capture in `tennis_source_captures` (request identity carries the event id) → the immutable
payload in R2 (`tennis-source/espn/sha256/…`).

## Dates

ESPN competition timestamps are stored in `scheduled_at` as the source prints them; `T05:00Z` / `T04:00Z` values
are day precision (US-Eastern midnight), not a start time. `started_at` is only a source-observed start.

## Rankings from a secondary source

ESPN ATP singles lists are stored as `tennis_ranking_snapshots (list_key atp_singles, source_family espn)`
with `ranking_date` = the date ESPN last updated that list (its `lastUpdated`), never an assumed official ATP
Monday; `tennis_rankings.provider_player_id = 'espn:<athlete id>'`, `previous_rank` as printed,
`pbe_player_id` linked once the athlete resolves (daily relink). The public API describes such a list as
carried by a secondary source, never as an official feed.

### WTA specifics (2026-09-27)

- `espn_wta`: an ESPN WTA event is written into the OFFICIAL WTA edition when shared singles pairs prove it
  (candidates found through the event's players; >= max(2, 30%) of resolved pairs, unique best), recorded as
  `tennis_edition_external_ids (espn_wta, '<tid>-<year>')`; otherwise into ESPN's edition. ESPN event ids are one
  namespace across both leagues (a combined event shares its id); mixed doubles is ingested once, from the ATP
  league.
- `wta_history`: official career rows, no match id/time. Side A = the team with the lower WTA id (both players'
  histories write one identical row). A history row takes over an ESPN row filed in ESPN's edition only when it
  is ESPN-owned, in an ESPN edition and in the same week (start dates within 3 days).
- WTA API round ids are opaque (at a 128 draw its `M-2` is round 1; qualifying may be a bare `Q-`): against a WTA
  API row only the stage and Q/S/F are compared.
- Writer self-heal: a row found by its own external id that duplicates an equal-or-higher-precedence row of the same
  match in the edition is merged into it (ids moved, row removed, `tennis_source_changes kind duplicate_merged`).
- Known source labelling issue (not duplicates): 377 draw-slot conflicts (one player twice in the same round of an
  edition) from ESPN round mislabels and the WTA API's opaque qualifying ids; reported by `scripts/qa`, not rewritten.

## Context layer (Phase 5, 2026-09-28; migration 20260928000100)

Identity of tournaments and editions, and the facts attached to them, each with provenance. Nothing here is
decided by a name.

| Table | What |
|---|---|
| `tennis_tournaments` / `tennis_tournament_editions` | canonical tournament and edition (a tour-neutral event; a combined event's men's rows live in ESPN's edition, its women's rows in the official WTA edition) |
| `tennis_tournament_external_ids` / `tennis_edition_external_ids` | resolution index (provider id -> canonical id) |
| `tennis_source_mappings` | every provider tournament / edition id we looked at: `status` mapped / unresolved / ambiguous / rejected, `method`, `confidence` (mapped only), `evidence` (counts, ids, dates), `rule_version` |
| `tennis_edition_attributes` | sourced edition facts (surface, indoor, level) per source: `method` direct (the source states it for this edition), combined_event, draw_sheet, mapped_edition; `capture_id`, `evidence` |
| `tennis_draw_slots` | draw position / seed / entry per source; `participant_key` null = unresolved (never guessed) |
| `tennis_player_source_records` | source-published player aggregates kept as reported (WTA /records, /year; ESPN season statistics + event-log coverage) |
| `tennis_source_disagreements` | a source value that disagrees with a stored / derived value — logged, never written over it |

Mapping methods (rule `context-v1`, `scripts/context/reconcile.sql`, `workers/tennis-ingest/src/context-jobs.js`):

- `official_id` (high): the WTA calendar's own tournament group id / edition — the canonical key is minted from it.
- `shared_matches`: an ESPN event -> the canonical edition holding its rows (the ESPN match ids point at rows in
  exactly one official edition). High at >= 3 rows, medium at 2; one row, or two official editions -> unresolved /
  ambiguous. Official start date within 7 days of ESPN's.
- `espn_founded` (high): the ESPN event has no official counterpart; ESPN's own edition is canonical.
- `mapped_editions`: an ESPN tournament id -> the ONE canonical tournament all its mapped editions belong to;
  two or more -> ambiguous (a tournament that changed identity across years is never collapsed).

Surface (never inferred from a name, city, country, month or convention; unknown stays null):

1. `direct` — the official WTA calendar (per edition, 2000 ->; `wta_edition_facts` lane) and the official Slam
   feeds. The Slam editions ESPN created carry the WTA calendar's value for the same edition as their attribute.
2. `combined_event` — an ESPN ATP edition whose ESPN event id is also the WTA league's event, mapped (high) to an
   official WTA edition in the SAME city (edition city, else the official calendar's) within 7 days: the official
   edition's surface / indoor. Toronto / Montreal splits and "Washington" vs "Washington DC" are refused.
3. `draw_sheet` — ProTennisLive header surface of a PROVEN ATP draw sheet (registry built; blocked from Cloudflare
   egress 2026-09-28, so not applied).
An edition's effective `surface` is filled from its attributes only where empty; matches inherit it (`matches.surface`
set where null, `updated_at` bumped). A sourced value that differs from a stored one goes to the disagreement log.

Edition consolidation (`edition_merge` lane): ESPN WTA rows written before their official edition could be proven
sat in ESPN "shadow" editions. For every high `shared_matches` mapping, each ESPN-owned WS / WD row is merged into
the official row of the same match (event, stage, participant pair; exactly one) or moved into the official edition
(draw, surface), logged as `duplicate_merged` / `edition_moved`; an emptied shadow edition is removed
(`edition_merged`) and its ESPN id repointed. Men's rows of a combined event's ESPN edition are never touched.

Draw slots: official draw-sheet PDFs (WTA `wtafiles`, ATP ProTennisLive) are fetched only through tennis-ingest
`/v1/drawsheet` (allow-listed, polite client, byte-exact R2 archive + capture row) and parsed in a reviewed build
(`scripts/context/drawsheet-parse.mjs`). A sheet is used only when it PROVES the edition: >= 4 first-round pairs
resolved within that edition's own stored players, >= 90% of them stored matches, >= 75% of the draw resolved, no
player twice. A slot points at a player already stored in the edition or stays unresolved; a PDF never mints or
merges a player.
