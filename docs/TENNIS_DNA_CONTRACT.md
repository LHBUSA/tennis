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

---

# Tennis DNA v2 — Match DNA + PBE Rating (definition_version = 2, 2026-09-27)

Implementation: `workers/shared/dna/match-dna.js` (pure), build `workers/tennis-ingest/src/dna-v2-job.js`,
serving `workers/tennis-api/src/dna2.js`. **v1 (technical DNA) is unchanged**: same definitions, same
confidence rules, same Level-3 gate (DNA_MIN_QUALIFIED = 30 medium/high `service_points_won` samples per
tour). v1 readers are pinned to `definition_version = 1`; v1 snapshots are never rewritten. v2 rows live in
the same table with `definition_version = 2`, `surface = 'all'`.

## Families

| Family | Source | Status |
|---|---|---|
| Result strength, Pressure, Opponent quality, Form, PBE Rating | canonical singles results (sets, games, tiebreaks, dates, rounds) + ranking lists in force at the time | **Match DNA — live** |
| Serve, Return, (technical) Pressure | `tennis_match_stats` only (v1) | **Technical DNA — coverage building** |
| Surface | only where the edition's surface is stored; never inferred from names | partial (ESPN non-Slam events carry no surface) |

No technical metric is ever derived from results. A player without match statistics still has Match DNA.

## Ledger (input)

Singles (`MS`, `WS`), status `completed` or `retired` (walkovers are not played matches), both players
resolved, both of the **same tour** (a cross-tour pair is dropped, never pooled). One canonical match = one
ledger row (cross-source dedupe, official > secondary).

- `day` = the match's own timestamp date; timestamps outside the edition year ±1 are source placeholders and
  are ignored; undated official archive rows use the edition `end_date`; no date at all → excluded.
- `rank_day` = edition `start_date` (the list in force when the tournament began), else `day`.
- **as_of is exclusive**: a snapshot at D reads only rows with `day < D`.

## Ranking at match time

The latest list with `ranking_date <= rank_day` of the player's own tour, used only if it is at most 28 days
old. An ESPN list is dated to the **Monday from which it is in force** (ESPN's `lastUpdated` is the start of its
calendar week, anchored on 1 January: 2026 weeks start on Thursdays); reconciled against 7 official WTA weeks:
1,033 of 1,033 linked players identical in rank and points on the same Monday. An official list within 6 days
replaces a secondary one. A player absent from a list of N is "outside the top N". No list in force → the match does not enter any
ranking-based metric. A current ranking is never applied to a historical match. ATP lists are the ESPN
secondary-source weekly lists (dated by the source's own update date); WTA lists are official.

## Metrics (metric object as v1, plus `family`, `comparable`, `lower_is_better`, `percentile`,
`population_qualified`, `comparative_published`)

| key | definition | min_den |
|---|---|---|
| match_win_rate | matches won / matches played (completed + retired) | 10 |
| set_win_rate | completed sets won / completed sets | 25 |
| game_win_rate | games won / games played (incl. unfinished sets) | 200 |
| straight_sets_win_rate | completed wins without losing a set / completed wins | 10 |
| avg_game_diff | mean games won − lost per completed match | 10 |
| avg_set_diff | mean sets won − lost per completed match | 10 |
| deciding_set_win_rate | deciding sets won / played (3rd of Bo3, 5th of Bo5; completed, format known) | 8 |
| tiebreak_win_rate | tiebreak sets won / played (7-6, or 13-12 under a 12-all rule) | 10 |
| close_match_win_rate | wins / close matches; **close** = completed and (reached the deciding set OR total game margin ≤ 2) | 8 |
| comeback_win_rate | wins after losing set 1 / completed matches with set 1 lost | 8 |
| first_set_conversion | wins after winning set 1 / completed matches with set 1 won | 10 |
| deciding_set_dependence | wins needing a deciding set / completed wins (descriptive, never compared) | 10 |
| top{10,25,50,100}_win_rate | wins / matches vs opponents ranked ≤ N at match time (with W–L record) | 5, 5, 8, 10 |
| outside100_loss_rate | losses / matches vs opponents outside the top 100 (list of ≥ 100 in force) — lower is better | 10 |
| avg_opponent_rank | mean numeric opponent rank at match time — lower is better | 10 |
| wins_above_expectation | mean (result − PBE Rating pre-match win probability), both players ≥ 10 rated matches | 10 |

Confidence uses the v1 rule on each metric's own denominator and sample: `insufficient` < min_den; `low`
< 5 matches or < 2×min_den; `medium` < 15 matches or < 5×min_den; `high` otherwise.

Form (dated, descriptive, never compared): last 5/10/20 W–L with date range, rolling-20 set/game win %,
current streak, longest win streak in the 365 days before as_of, bagels/breadsticks won/lost.

## Comparative gates (per metric, per tour)

- Population = same tour, same `as_of`, v2 snapshots whose metric is `medium`/`high` and `comparable`.
- **Level 2** percentile: the player's metric medium/high AND ≥ 10 such peers.
- **Level 3** comparison published for THAT metric when ≥ 30 players qualify (same 30 as v1 — not lowered).
  Each metric matures on its own: e.g. ATP match win % can publish while ATP service points won (v1) stays at
  17/30.
- Percentiles and gates are computed in the build and stored with the snapshot; the API never pools tours.

## PBE Rating (method_version = 1)

Chronological Elo per tour over the ledger (ordered by day, then round). Start 1500; K = 250 / (n + 5)^0.4
(n = the player's prior rated matches). Retirements do not update ratings. Every prediction is recorded
before the update, so a rating never sees its own or any later result.

Research (walk-forward, evaluation from 2012-01-01 for ATP, both players ≥ 10 prior rated matches):
- standard vs margin-sensitive (K × (1 + 2·|game share − 0.5|), capped 2): the margin variant was worse
  (ATP log loss 0.6236 vs 0.6207) → **standard**.
- vs a ranking model p = rB^c / (rA^c + rB^c) with c fitted on the earliest 40% of ranked matches and both
  compared on the remaining 60%: ATP rating log loss 0.6347 vs ranking 0.6399; Brier 0.2222 vs 0.2249;
  accuracy 63.4% vs 62.2% (15,270 matches; c = 0.7 fitted on 10,383) → **ATP rating published**.
  Evidence: `docs/evidence/dna-v2-backtest-latest.json`.
- Surface ratings (updated only on matches with a stored surface; prediction = 50/50 blend with overall):
  ATP blend worse than overall (0.5363 vs 0.5321 on 3,871 matches) → **not published for ATP**.
- **WTA rating (2026-09-27, after the ESPN WTA + official WTA history backfill, 100,380 singles matches 2000-2026,
  824 weekly lists)**: rating log loss 0.6268 vs ranking model 0.6462; Brier 0.2193 vs 0.2280; accuracy 63.5% vs
  60.5% (5,742 out-of-sample matches, c = 0.55 fitted on 3,829) -> **published**. Margin variant worse (0.6108 vs
  0.6100). WTA surface blend better than overall (0.6083 vs 0.6112 on 24,061 matches) -> **WTA surface ratings
  published**. ATP after the ESPN list re-dating: 0.6327 vs 0.6391 (15,640 matches) -> published; ATP surface
  still held (0.5381 vs 0.5345).

Stored in `tennis_surface_ratings (surface overall|hard|clay|grass, method_version 1)` with `published` in
provenance; the rating percentile is shown only for published ratings among players with ≥ 20 rated
matches and a match in the last 365 days (≥ 30 such players).

## Missingness

Missing is never zero: a metric without its sample is `insufficient` with `value: null`. A match without a
valid ranking list simply does not enter ranking metrics. Unknown surface is shown as unknown.

## Build + backfill

Daily in tennis-ingest (step `dna_v2`, today + one historical month-start per day back to 2008); admin
`POST /v1/runs?lane=dna_v2[&as_of=YYYY-MM-DD,...][&write=0]`. Idempotent upserts on
`(pbe_player_id, as_of, surface, definition_version)`; raw evidence untouched.

## Surface Match DNA (2026-09-28; definition_version 2, surface hard / clay / grass)

The same Match DNA definitions over a player's matches on ONE surface, for the build's first as_of (today):

- A match's surface is its edition's sourced surface (`docs/TENNIS_DATA_MODEL.md` "Context layer"); never inferred.
  A match without a sourced surface is in no surface snapshot. A player needs >= 5 matches on the surface.
- Population = same tour x same surface x same as_of; per-metric gates exactly as overall (percentile at >= 10
  medium/high peers, published at >= 30).
- `_rating` = the surface PBE Rating (the surface run of the chosen variant) with the SURFACE model's publication
  status: `published` only when the surface blend beats the overall rating out of sample (backtest
  `surface_blend`, >= 500 matches) for that tour; percentile among established players on that surface.
- `wins_above_expectation` uses the surface-blend pre-match probability where the surface model is published for the
  tour, else the overall rating (`provenance.wae_basis`).
- `_recent` = the last 20 matches on the surface; `_form.career` / `_form.years` = records on the surface.
- API: `GET /v1/players/:slug/dna` -> `match_dna.by_surface[]` (additive, tennis-api 0.5.0). Overall snapshots and
  every existing reader (`surface=eq.all`, v1 readers pinned to definition 1) are unchanged.

## Build performance (2026-09-28)

**Before:** one full-universe build held both tours' ledgers (~360 B per row, uninterned ids, a sort-key string per
row, set objects), both rating variants' per-match prediction objects and every snapshot until the end. At 186k
ledger rows the build died in production with `Worker exceeded memory limit` (1102; cpu 17.0 s, wall 90.6 s);
the last good build (153k rows, 6,991 snapshots) took ~88 s.

**Now (byte-identical output):**

- one tour in memory at a time (MS ledger -> ATP, WS -> WTA; a row whose two players are both of the other tour is
  counted `mismatched_rows` and left out — 0 on 2026-09-28 — instead of being pooled);
- interned strings, fixed-shape entries, sets packed one integer per set (tiebreak points are never read by a metric);
- pre-match predictions column-stored (typed arrays); the losing rating variant released after the backtest;
- two-pass population: pass 1 keeps one slim record per player, pass 2 rebuilds each snapshot, applies the
  population and writes in batches of 200 (percentile by binary search: the same count as the linear scan);
- rank lists paged correctly: batches whose row counts sum to <= 1,000, a larger list paged alone. **Defect fixed:**
  six lists had shared one 1,000-row page, so the ~1,570-row official WTA lists (2026) were truncated to an arbitrary
  subset (8,400+ of 9,426 ranks missing) — WTA rank-at-match and rank peaks in their weeks were incomplete.

**Incremental inputs** (`workers/tennis-ingest/src/dna-cache.js`): each tour's raw ledger rows are cached in R2 (16
chunks by match-id prefix); a build reads only rows with `updated_at` after the watermark (minus 5 min), drops rows
the writer logged as merged away (`tennis_source_changes duplicate_merged`), merges chunk by chunk, and is trusted
only if the eligible-row count equals the database's exact count — otherwise, or when the cache is missing / older
than 7 days / another version, the tour is scanned in full (which rewrites the cache). Rank lists are cached with
their snapshot descriptors and invalidated by any write to `tennis_rankings` (KV `rank:changed_at`). Every
repair that edits `tennis_matches`, `tennis_sets` or `tennis_match_participants` outside the writer must bump
`tennis_matches.updated_at` (the reconciliation SQL does). Production switch: KV `dna2:mode` = `auto`
(default `full`); optional shadow verification (KV `dna2:shadow`) streams a full scan and compares hashes.

**Regression proof** (`scripts/dna/dump.mjs` + `scripts/dna/regress.mjs`): frozen production inputs, the previous
builder vs the new one through a read-only fake store; every written row compared as canonical JSON (keys
sorted). 2026-09-28: 191,952 matches / 198,730 ranking rows / 11,648 players — 4 as_ofs, 24,903 snapshots and
22,902 ratings byte-identical; live set (sampled after a full GC at every store call) 187 MB -> 78 MB
(2 as_ofs: 139 MB -> 61-63 MB); incremental inputs on unchanged data: store requests 534 -> 124, identical output.
