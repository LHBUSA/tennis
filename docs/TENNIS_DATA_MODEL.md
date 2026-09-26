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
`DOUBLES_TOUR` (no-ad + 10-point match tiebreak), `BO3_MATCH_TB10`.

## Completeness

`tennis_coverage` records, per tour × season × event type (× tournament), whether matches / match stats /
points are `complete | partial | unavailable | unaudited`. Nothing is called complete until audited.
