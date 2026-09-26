# Tennis DNA v1

Deterministic, descriptive player intelligence. Separate from the predictive PBE model.

## Shipped definitions (v1)

| Metric | Formula | min denominator |
|---|---|---|
| ace_rate | aces / service points | 150 |
| double_fault_rate | double faults / service points | 150 |
| first_serve_in | first serves in / service points | 150 |
| first_serve_won | first-serve points won / first serves in | 100 |
| second_serve_won | second-serve points won / (service points − first serves in) | 60 |
| service_points_won | (1st + 2nd serve points won) / service points | 150 |
| hold_rate | (service games − times broken) / service games | 30 |
| break_points_saved | saved / faced | 20 |
| return_points_won | opponent service points not won by opponent / opponent service points | 150 |
| first_return_won | (opp. first serves in − opp. first-serve points won) / opp. first serves in | 100 |
| second_return_won | opp. second-serve points lost / opp. second-serve points | 60 |
| return_games_won | breaks / opponent service games | 30 |
| break_points_converted | breaks / break points created | 20 |

All computable from the WTA match-stats payload today (verified on a real capture). Surface filter:
`buildDna(rows, { asOf, surface })`.

## Designed, not shipped (needs data + a frozen formula first)

- **Pressure:** tiebreak win rate, deciding-set win rate, set/match points (need point data).
- **Match shape:** straight-set rate, comeback rate (won after losing set 1), deciding-set frequency,
  duration, workload (minutes/sets/matches in trailing 7/14/28 days).
- **Opposition splits:** vs Top 10/25/50/100 using the ranking snapshot valid at match date.
- **Trajectory:** opponent-adjusted form, ranking velocity, variance.
- **Surface ratings:** opponent-adjusted, recency-weighted, per surface with a shrinkage prior toward
  overall; best-of-5 and retirements handled explicitly; versioned; snapshotted by date.

No "clutch" or "momentum" label ships without a published formula.
