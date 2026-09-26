# Tennis DNA — data contract

Implementation: `workers/shared/dna/metric.js` (shared by builder, API and the /methodology page).
`definition_version = 1`.

## Metric object (every derived number, everywhere)

```json
{
  "metric_key": "hold_rate",
  "value": 0.872,
  "unit": "ratio",
  "numerator": 211,
  "denominator": 242,
  "sample_matches": 18,
  "sample_sets": 43,
  "sample_games": 398,
  "confidence": "high",
  "coverage_status": "complete",
  "definition_version": 1,
  "origin": "pbe_derived",
  "source_families": ["wta"],
  "as_of": "2026-09-26"
}
```

- Ratios **sum** numerators and denominators across the sample (not averages of per-match ratios).
- A match missing any input of a metric is excluded from that metric; `coverage_status` becomes
  `partial` (or `none`). Missing is never zero.
- Zero denominator → `value: null`, `confidence: insufficient`.
- Confidence: `insufficient` below the metric's `min_den`; `low` under 5 matches or under 2× `min_den`;
  `medium` under 15 matches or under 5× `min_den`; `high` above.
- **as_of is exclusive**: a snapshot at D includes only matches with `match_date < D`.

## Canonical per-side match stats (input)

`service_points, aces, double_faults, first_serves_in, first_serve_points_won, second_serve_points_won,
service_games, break_points_faced, break_points_saved, total_points_won`. Adapters map provider fields
to these (e.g. WTA: `breakptsplayedX` = break points X had as returner, so X's opponent faced them).

## Snapshots

`tennis_dna_snapshots (pbe_player_id, as_of, surface, definition_version)` with `metrics` and
`provenance` (match ids, capture watermark, builder version / git sha). Pair snapshots:
`(participant_key D:…, as_of, definition_version)`.
