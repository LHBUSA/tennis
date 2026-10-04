# Tennis PBE Picker V1 — pre-registered research protocol

Registered 2026-10-04, BEFORE any result was computed. The study script implements exactly this text; any deviation
is a new protocol version, never an edit of this one.

## What is (and is not) being studied

- **Prediction engine:** the production **PBE Rating** (`workers/shared/dna/match-dna.js`, `RATING_METHOD_VERSION`),
  exactly as the production DNA v2 build (`workers/tennis-ingest/src/dna-v2-job.js`) runs it: per tour, the variant
  (`standard` / `margin`) with the lower out-of-sample log loss; the served probability is the overall prediction,
  or the 50/50 surface blend where surface ratings are published and both players have >= 5 surface matches.
  No coefficient, calibration, surface rule or serving rule is changed.
- **Picker V1** is a *selection policy* over that probability (CALL / PASS / HOLD). It is not a model.
- **Matchup Model V2** is out of scope (research / shadow only).
- **Markets are not inputs.** No Kalshi / Polymarket / sportsbook price enters the policy or its selection. Markets are
  benchmarks recorded after the decision.

## Data

Production inputs fetched 2026-10-02 (`research-data/tennis-mm2/inputs/manifest.json`, SHA-256 per file), converted
with the production functions (`scripts/research/mm2/lib/inputs.mjs`). Singles only (ATP = MS, WTA = WS).
Chronological; ATP and WTA evaluated separately.

| Tour | Selection window | Holdout (evaluated ONCE) |
|---|---|---|
| ATP | 2012-01-01 .. 2022-12-31 | 2023-01-01 .. data end |
| WTA | 2023-01-01 .. 2024-12-31 | 2025-01-01 .. data end |

(Start dates = the production backtest's own `from`.) Ratings are walk-forward (each prediction uses only strictly
earlier matches), so no window leaks future results.

## Policy family

For each match with a pre-match PBE probability: `p_fav = max(p, 1 - p)`, selection = the favourite.

- **HOLD** — the match is not eligible for a decision: either player has < 10 prior rated matches (production
  `minPrior`), or the tour's rating is not published, or there is no pre-match probability.
- **CALL** — eligible and `p_fav >= tau`.
- **PASS** — eligible and `p_fav < tau`.

`tau` grid: 0.550, 0.575, ..., 0.800.

## Grading (frozen for V1)

- completed match -> **W** / **L** (selection won / lost);
- walkover -> **VOID**; retirement, default, abandonment, cancellation -> **VOID** (V1 keeps non-tennis completion
  events out of model accuracy);
- VOID calls are excluded from hit rate and calibration, and reported as a count.

## Threshold selection (selection window only)

Choose, per tour, the **smallest** `tau` (the most calls) such that, on graded CALLs in the selection window:

1. at least 300 graded calls;
2. Wilson 95 % lower bound of the hit rate >= 0.65;
3. calibration: hit rate - mean `p_fav` >= -0.02 (the model is not over-confident on its calls).

If no `tau` qualifies, that tour fails selection and has no Picker.

## Holdout gate (evaluated once, frozen tau)

The tour passes only if, on holdout graded CALLs:

1. at least 100 graded calls;
2. Wilson 95 % lower bound of the hit rate >= 0.60;
3. hit rate - mean `p_fav` >= -0.03;
4. log loss of the called probabilities < ln 2 (better than a coin).

Reported regardless of pass / fail: sample sizes, CALL / PASS / HOLD rates, hit rate (+ Wilson interval), mean
`p_fav`, calibration by 5-point probability band, log loss, Brier, VOID count.

A tour that fails the holdout gate does **not** go to the activation gate. Nothing activates without the owner.
