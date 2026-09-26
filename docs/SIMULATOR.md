# Tennis matchup simulator — status: RESEARCH

Not a picks product. Not exposed in navigation, not indexed, no GA events (`tennis_simulation_*` are
deliberately unregistered in `src/analytics.js`). It stays RESEARCH until every gate below passes on a
walk-forward backtest.

## Engine (`workers/shared/sim/engine.js`, version `tennis-sim/0.1.0-research`)

- **Point model:** each side wins a point on its own serve with a fixed probability (iid points). pA =
  mu + (serveA - mu) - (returnB - (1 - mu)), where serve/return points won are point-in-time totals shrunk
  toward the tour mean (k = 400 points). Stated simplification: no momentum, pressure or fatigue effects.
- **Exact solver:** Markov chain point -> game (ad and no-ad closed forms) -> tiebreak (DP with the
  real serve rotation, closed form beyond level) -> set (tracks who serves first in the next set) ->
  match. Supports every canonical format (BO3/BO5, 7- and 10-point final-set tiebreaks, advantage
  final sets, doubles match tiebreak).
- **Monte Carlo:** seeded (mulberry32) and plays every point through the canonical scoring engine's
  `applyPoint`, so simulated matches follow exactly the rules live scoring and replay follow. Outputs
  win probability with its standard error, set-score distribution, total-games distribution, tiebreak
  probability and mean points.
- **Truth tests (`tests/sim.test.js`):** hold-probability closed form, symmetry at equal strength,
  monotonicity, distributions summing to 1, Monte Carlo within 4 SE of the exact solver in four
  formats, seed determinism, shrinkage bounding tiny samples.

## Walk-forward backtest (`scripts/sim/backtest.mjs` -> `docs/evidence/sim-backtest-latest.json`)

Completed women's singles, ordered by edition start date. Features come only from editions that started
strictly before the match's edition. Baselines: a coin flip, and a ranking model p = 1/(1 + (rA/rB)^c)
with c fitted on the earlier half only. Metrics on the later half: Brier, log loss, accuracy,
calibration deciles.

### 2026-09-26 result — FAIL (expected at this data depth)

| | n | Brier | log loss |
|---|---|---|---|
| Simulator | 860 | 0.2565 | 0.708 |
| Coin flip | 860 | 0.2500 | 0.693 |
| Simulator, both players >= 150 prior serve points | 71 | 0.2740 | 0.745 |

The simulator is worse than a coin flip. Only 679 of 1,720 matches carry statistics and only 71 test
matches had enough prior serve points for both players. The ranking baseline could not be evaluated:
ranking history was stuck behind the backfill queue (fixed in tennis-ingest `d4dc5694`: ranking history
now has its own lane) so only one official list was stored.

## Gates to leave RESEARCH

1. Ranking history stored back to 2020 and at least 5,000 test matches with statistics.
2. Simulator beats the fitted ranking baseline on Brier AND log loss on the held-out later half.
3. Calibration: every decile with n >= 50 within 0.05 of observed.
4. Re-run on a second, later window with the same result.

Until then outputs may be stored in `tennis_simulations` with `status = 'research'` only.
