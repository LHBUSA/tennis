# ATP PBE Rating recalibration — pre-registered research protocol (separate study)

Opened 2026-10-04 by owner decision, BEFORE any recalibration result was computed. This is a separate study from
Picker V1 (`PICKER_V1_PROTOCOL.md` @ b27aeec). Any deviation is a new protocol version, never an edit of this one.
Nothing here changes production: the served PBE Rating probability, its coefficients and Picker V1 (ATP = PASS ·
MODEL_NOT_VALIDATED) stay exactly as they are until the owner approves a result.

## Why

Picker V1 found ATP calls over-confident at every threshold (hit rate about 4 pts below mean p, selection window
2012–2022; `PICKER_V1_RESULTS.md`). The question here: does a frozen, monotone recalibration of the production ATP
probability fix calibration out of sample, without touching the rating itself?

## The untouched holdout

**ATP 2023-01-01 .. data end is the holdout. It has never been evaluated** (Picker V1 evaluated a holdout only for a
chosen tau, and ATP chose none). It stays untouched until the method, its coefficients and the picker threshold are
frozen in a commit and the owner approves running it. Enforcement: `scripts/research/atp-recal/holdout-guard.mjs`
— study code reads ATP entries only through `developmentEntries()`, which throws on any entry dated >= 2023-01-01;
the holdout reader requires a committed `frozen.json` whose sha256 matches and an explicit `--holdout` flag, and
writes a one-time marker so a second holdout run is refused.

## Data

Same production inputs as Picker V1 (`research-data/tennis-mm2/inputs`, fetched 2026-10-02, SHA-256 manifest),
production rating run (ATP variant chosen exactly as `dna-v2-job.js` chooses it; served probability = overall or the
50/50 surface blend under the production rule). Singles only. Development window 2012-01-01 .. 2022-12-31.

## Candidate methods (closed list)

All are monotone maps of the served favourite probability's logit; none uses a market, ranking feed or any new input.

1. **Temperature**: `p' = sigmoid(logit(p) / T)`, one parameter.
2. **Platt**: `p' = sigmoid(a · logit(p) + b)` on the A-side probability (symmetry kept by fitting on both orientations).
3. **Binned isotonic**: isotonic regression on 20 equal-count bins of `p_fav`, linear interpolation, symmetric.

## Fitting and selection (development window only, forward-chaining)

- For each validation year Y in 2019, 2020, 2021, 2022: fit each method on ATP matches strictly before Y-01-01
  (from 2012), predict year Y. This gives out-of-sample recalibrated probabilities for 2019–2022.
- **Method selection:** lowest pooled log loss over 2019–2022 out-of-sample predictions; ties (< 0.001) go to the
  simpler method (Temperature < Platt < Isotonic). The uncalibrated production probability is the baseline; a method
  must beat it by >= 0.002 log loss, else the study concludes "no recalibration".
- **Threshold:** Picker V1's rule, unchanged, applied to the selected method's out-of-sample 2019–2022 probabilities:
  smallest tau in 0.550 .. 0.800 (step 0.025) with >= 300 graded calls, Wilson 95 % low >= 0.65, and
  hit − mean p >= −0.02. If none qualifies, the study fails.
- **Freeze:** the selected method is refit once on 2012-01-01 .. 2022-12-31; coefficients, tau, input hashes and the
  code commit are written to `docs/evidence/atp-recal/frozen.json` and committed BEFORE the holdout is opened.

## Holdout gate (evaluated once, owner-approved)

On ATP 2023-01-01 .. data end with the frozen coefficients and tau:
>= 100 graded calls; Wilson 95 % low >= 0.60; calibration gap (hit − mean p') >= −0.03; log loss of p' below the
uncalibrated production probability's log loss on the same matches; also report reliability (10 bins), Brier, CALL /
PASS / HOLD rates, and the tour-level vs Challenger/ITF breakdown (descriptive, not a gate).

## Grading

Identical to Picker V1: completed → W / L; walkover, retirement, default, abandonment, cancellation → VOID (counted,
excluded from hit rate and calibration).

## What a pass would and would not mean

A pass lets the owner decide whether ATP joins a future Picker version that serves the recalibrated probability for
CALL decisions (a model-serving change, its own release). It does not change the published ATP PBE Rating
probability, and it never makes any earlier ATP decision official.
