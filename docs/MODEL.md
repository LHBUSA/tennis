# PBE Tennis model

Status: **not built.** No model is trained, validated or registered; PBE Picks do not exist and will not
launch before out-of-sample validation and grading infrastructure exist. (The brief's
`docs/model/{METHODOLOGY,LEAKAGE,VALIDATION,VERSIONS}.md` are kept as sections here until there is a
model to describe; they split into files at Milestone 6.)

## Methodology (design)

Pre-match win probability per participant from: opponent-adjusted overall + surface strength, serve and
return strength (DNA), recent form, opposition quality, workload/fatigue, travel (only if derivable
safely), tournament level, format (Bo3/Bo5), indoor/outdoor, H2H only if it adds out-of-sample value;
doubles from pair + partner-adjusted individual strength. Output: `p_a, p_b`, fair line where
appropriate, confidence, top factors, coverage warnings, `model_version`, `generated_at`, `locked_at`.

## Leakage

- Every feature is computed from snapshots with `as_of <= match scheduled date` (exclusive as-of).
- `tennis_model_evaluations.feature_cutoff <= generated_at` is a DB check.
- Rankings are joined from the snapshot valid on the match date, never the current list.
- No post-match stats, durations or odds captured after `locked_at`.
- Training splits are chronological; no random k-fold over time.

## Feature readiness (stored data, 2026-09-27)

Point-in-time selectors: `workers/shared/features/asof.js` (`rankingAsOf` = latest list with
`ranking_date <= match day`; `priorMatches` = strictly earlier matches), tested for no future leakage.

| Feature family | Stored inputs | Gap |
|---|---|---|
| Overall Elo / opponent-adjusted rating | every canonical match: participants, winner, status, round, edition, day | none for results; Challenger/ITF not ingested |
| Surface Elo / surface form | `tennis_tournament_editions.surface` | **ESPN non-Slam editions have surface = null** (ESPN has no surface) |
| Rolling ranking / ranking velocity | WTA weekly lists; ATP weekly lists (ESPN, top 100-150, 2007→) with points + previous rank | ATP ranks below 150 unavailable; ATP doubles rankings unavailable |
| Form (last 5/10/20, quality-adjusted) | results + day + opponent | none |
| Workload (prior match date, 24h/72h/7d/14d, sets, games, progression) | `scheduled_at` (day precision for older ESPN rows), `tennis_sets`, round | exact start times only where the source prints them |
| Tiebreak / deciding-set record | `tennis_sets` (tiebreak points, match tiebreaks) | none |
| Break-point metrics | `tennis_match_stats` (WTA, AO) | none from ESPN (no statistics) |
| Retirement / walkover history | `status`, `end_reason` | none |

## Validation

Walk-forward by season; log loss, Brier, calibration curves by tour/gender/surface/level/format;
baseline = ranking-points Elo and market no-vig where a real market exists. Ship only if it beats the
ranking baseline out of sample.

## Versions

Registry of `model_version` → training window, features, definition versions, metrics, git sha.
Frozen once used for a pick.

## Market separation

Sportsbook quote · best available · no-vig consensus · PBE probability are four different things, stored
and labeled separately. No market → `MARKET: UNAVAILABLE`; PBE probability can still exist.
