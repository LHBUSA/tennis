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
