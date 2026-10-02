# Matchup Model V2 — research challenger (2026-10-02)

**RESEARCH ONLY.** The production PBE Rating probability, `/v1/matchups/:id` and PBEcast's frozen pre-match probability
are unchanged. No challenger output is served. Evidence: `docs/evidence/matchup-model-v2-latest.json`.

## Verdict

| Challenger | ATP | WTA |
|---|---|---|
| A — calibration of the PBE Rating probability | KEEP RESEARCHING (dominated by B; credibly worse at Grand Slams on the development window) | REJECT (no gain: WTA is already calibrated) |
| **B — broad-coverage context** | **SHADOW-READY** | **SHADOW-READY** |
| C — technical subset | REJECT (not evaluable: 34 qualified rows) | KEEP RESEARCHING (no credible gain; no untouched window yet) |

**B beats the production PBE Rating on identical matches on both tours, in both the development window and the
untouched later window, with better calibration and no material segment failure.** The gain is real but modest:
about 1% of log loss (ATP −0.0069, WTA −0.0050 on the later window). It is **not promoted**: promotion is a separate owner
decision after prospective shadow evidence (below).

## Champion

PBE Rating, `method_version 1`, the served variant of each tour (ATP `standard`, WTA `margin`), with the production
serving rule of `tennis-api` `modelBlock`:
- ratings are rounded as served;
- both players need at least 10 rated matches;
- the surface blend applies when the tour publishes it and both players hold at least 5 surface-rated matches.

**Reproduction first.** The DNA v2 build's own cached inputs (R2 ledger chunks and kept ranking lists; editions and
player genders by SELECT) were replayed locally with the production functions. The replay reproduces
`dna:v2:summary` (built 2026-10-02T06:50:39Z) **exactly**: ATP 34,456 and WTA 104,715 evaluation matches, every log
loss, Brier, ranking-comparison and surface-blend figure. Every challenger is scored against those same production
probabilities.

## Dataset (`mm2-dataset/1`, hash `08926a71…5aa05`)

One row per completed singles match where production publishes a probability. Each row records:
`match_id, tour, scheduled_day, round, edition, surface, level, winner, champion_probability (+ overall, basis), rated
matches, feature_as_of, feature_version, features`.

| Tour | Rows | Technical rows | Excluded: retired (not graded) | Excluded: production publishes no probability |
|---|---|---|---|---|
| ATP | 43,622 | 34 | 1,557 | 7,951 |
| WTA | 371,686 | 9,849 | 15,070 | 96,539 |

- **Reproducibility:** row hashes and the dataset hash are recorded. Two builds on the same inputs gave the same hash.
- **Location:** the rows live outside the repo (≈275 MB). `fetch-inputs.mjs` + `build-dataset.mjs` rebuild them.

**As-of rule.** Challenger features read only the player's ledger matches dated **strictly before** the match day:
- A same-day earlier round is excluded, because the ledger's time-of-day order is not proven for every source.
- No ranking, DNA snapshot, current profile or later match is read.
- Retirements count as activity but never update a profile.
- Missing technical statistics stay missing: such a row is outside C and nothing is imputed.
- A withheld surface stays withheld (surface edge 0; no inference from tournament names).

**Excluded inputs:** raw H2H, nationality, player name, tournament name, seeds, editorial story types, the PBE Edge Map,
and sportsbook prices. Ranking is used only as a baseline.

## Challengers (frozen before the later window was evaluated)

Every model has no intercept and uses only A-minus-B differences, so swapping the listed sides gives exactly 1 − p.
Side order is the source's listing order and is never a signal.

- **A (`mm2-A-calibration/1`):** `sigmoid(a · logit(p_champion))`.
- **B (`mm2-B-context/1`):** L2 logistic regression on standardised features. λ = 1 was chosen on the development
  window only (grid 1 / 100 / 10,000). Features:
  - `logit(p_champion)`;
  - sourced surface-rating edge;
  - form: wins above expectation, last 10 matches;
  - opponent strength: mean pre-match opponent rating, last 20;
  - activity (30 days) and rest;
  - deciding-set, tiebreak, straight-set, first-set-conversion and comeback profiles over the last 60 matches, shrunk.
- **C (`mm2-C-technical/1`):** B plus serve-points-won, return-points-won, break-points-saved and
  break-points-converted edges. Only where both players hold at least 5 stat matches and 200 points. λ = 100 was fixed
  in advance.

Simple interpretable models only. No ensemble or neural network was tried. Coefficients for every walk-forward block
are in the evidence.

## Walk-forward

- **No random split.** Each block trains on every row dated before the block and predicts the block.
- **Development:** ATP yearly 2012–2024 plus 2025H1; WTA 2023, 2024 and 2025H1. These are production's own backtest
  windows.
- **Untouched later window:** 2025-07-01 onwards (blocks 2025H2 and 2026). The evaluator refuses to run it without the
  frozen configuration from the development stage, and it was run once.

## Results — identical rows, log loss / Brier / ECE

| Tour | Window | Matches | Coin | **PBE Rating (champion)** | Rating, overall only | A | **B** |
|---|---|---|---|---|---|---|---|
| ATP | development | 30,461 | 0.6931 / 0.25 / – | 0.6157 / 0.2136 / 0.0328 | 0.6158 / 0.2136 / 0.0351 | 0.6120 / 0.2124 / 0.0081 | **0.6079 / 0.2107 / 0.0099** |
| ATP | later | 3,995 | 0.6931 / 0.25 / – | 0.6329 / 0.2215 / 0.0374 | 0.6381 / 0.2236 / 0.0447 | 0.6293 / 0.2202 / 0.0164 | **0.6260 / 0.2189 / 0.0169** |
| WTA | development | 67,294 | 0.6931 / 0.25 / – | 0.5398 / 0.1828 / 0.0112 | 0.5406 / 0.1833 / 0.0058 | 0.5398 / 0.1828 / 0.0110 | **0.5354 / 0.1809 / 0.0068** |
| WTA | later | 37,421 | 0.6931 / 0.25 / – | 0.5255 / 0.1768 / 0.0157 | 0.5258 / 0.1771 / 0.0089 | 0.5252 / 0.1767 / 0.0132 | **0.5205 / 0.1749 / 0.0098** |

**Paired differences, B − champion.** Bootstrap clustered by tournament edition, 1,000 resamples.

| Tour | Window | Δ log loss (95% CI) | Δ Brier | Clusters |
|---|---|---|---|---|
| ATP | development | −0.0079 (−0.0093 to −0.0064) | −0.0029 | 855 |
| ATP | later | −0.0069 (−0.0100 to −0.0032) | −0.0027 | 75 |
| WTA | development | −0.0044 (−0.0053 to −0.0037) | −0.0019 | 1,689 |
| WTA | later | −0.0050 (−0.0061 to −0.0041) | −0.0019 | 936 |

**Fitted ranking baseline** (exponent fitted on training folds only), on the matches where both players are ranked:

| Tour | Window | Rank | Champion | B |
|---|---|---|---|---|
| ATP | development | 0.6252 | 0.6140 | 0.6072 |
| ATP | later | 0.6333 | 0.6302 | 0.6250 |
| WTA | development | 0.6457 | 0.6218 | 0.6186 |
| WTA | later | 0.6470 | 0.5938 | 0.5908 |

Accuracy is descriptive only: ATP later window 63.7% → 64.5%; WTA later window 73.0% → 73.4%.

**Calibration.** ATP's PBE Rating is **overconfident**: on the later window, favourites priced at 80–85% won 73%, and
at 85–90% won 80%. Challenger A fixes most of this on its own, but one shrink factor over-corrects best-of-five Grand
Slams. B is better calibrated than the champion on both tours and both windows. WTA's champion is slightly
under-confident at the top; B corrects it. Full reliability tables are in the evidence.

**Segment audit.** Segments: surface, level, favourite band (50–55 … 90+), history depth, and technical-DNA
availability. A segment is a material failure when its paired 95% CI is entirely on the worse side.
- **B:** no material failure in either window. Flat or slightly worse but not credible: WTA Slams in development
  (+0.0003) and WTA 250 in the later window (+0.0005). Tiny segments (15–36 matches: finals and Olympics, unknown
  surface/level) are reported but are noise.
- **A:** ATP Grand Slams, development +0.0043, a material failure.

**Challenger C (WTA technical subset, 8,289 matches in 2025H2–2026).**

| Model | Log loss (same rows) |
|---|---|
| Champion | 0.6024 |
| A | 0.6023 |
| B | 0.5993 |
| C | 0.6018 |

- **C vs champion:** −0.0006 (95% CI −0.0034 to +0.0020), not credible.
- **C vs B:** worse on the same rows.
- **No replication window:** technical history only starts in 2025, so every C row sits in the later window and there
  is no separate untouched window. Revisit C as statistics accrue.
- **ATP:** C is not evaluable. Men's statistics exist only for one Australian Open (238 matches).

**Market benchmark:** none. `tennis_odds_snapshots` holds 0 rows. Nothing was purchased or created.

**Prior research:** `tennis-sim/0.1.0-research` (2026-09-26) is preserved unchanged. It scored log loss 0.7077 against
the coin's 0.6931 on 860 WTA matches. It is an early failed baseline and is not reused.

## Caveats

- The improvement is about 1% of log loss. It is a probability-quality result only: **no +EV, profitability, ROI or
  betting-edge claim** is made.
- ATP's later window covers 3,995 matches but only 75 edition clusters, so its interval is wide (still entirely below
  zero).
- 61% of ATP evaluation matches have no sourced surface. B's ATP surface term works only where a surface is stored.
- Features use matches strictly before the match day; the champion's own rating also includes same-day earlier rounds,
  exactly as production serves it.

## Prospective shadow (next)

The cleanest promotion evidence comes from predictions written before play. For each `matchup-freeze/1` snapshot, an
append-only research record will hold: champion probability as frozen, challenger probability, `frozen_at`,
`feature_hash` and `model_version`. Each record is graded after the result. The published probability is never
replaced.

## Reproduce

```
node scripts/research/mm2/fetch-inputs.mjs            # read-only: R2 build cache + SELECTs
node scripts/research/mm2/reproduce-champion.mjs      # must equal dna:v2:summary
node --max-old-space-size=12000 scripts/research/mm2/build-dataset.mjs
node --max-old-space-size=14000 scripts/research/mm2/evaluate.mjs dev     # selection; freezes the configuration
node --max-old-space-size=14000 scripts/research/mm2/evaluate.mjs final   # later window, once
node scripts/research/mm2/write-evidence.mjs
node --test tests/mm2-research.test.js
```
