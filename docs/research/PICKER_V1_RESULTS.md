# Tennis PBE Picker V1 — study results (activation-gate evidence)

Protocol: `docs/research/PICKER_V1_PROTOCOL.md`, registered in commit `b27aeec` before any result was computed.
Study: `scripts/research/picker-v1/study.mjs` → `docs/evidence/picker-v1-study.json` (full selection grid, holdout, bands).
Inputs: production DNA v2 ledger + ranking lists fetched 2026-10-02 (SHA-256 manifest), converted with the production
functions. Prediction engine: production PBE Rating (per-tour variant chosen exactly as `dna-v2-job.js` chooses it;
served probability = overall, or the 50/50 surface blend where published and both players have >= 5 surface matches).
No market data was used anywhere.

## ATP — FAILS selection (no Picker)

PBE Rating is consistently **over-confident on its calls in ATP**: at every threshold the called favourites win about
4 points less often than the probability says (selection window 2012–2022).

| tau | graded calls | hit rate | Wilson low | mean PBE p | gap (hit − p) |
|---|---|---|---|---|---|
| 0.55 | 19,293 | 68.9 % | 68.2 % | 72.5 % | −3.6 pts |
| 0.65 | 13,089 | 74.2 % | 73.4 % | 78.4 % | −4.2 pts |
| 0.75 | 7,661 | 80.1 % | 79.2 % | 84.4 % | −4.3 pts |
| 0.80 | 5,294 | 83.0 % | 82.0 % | 87.5 % | −4.5 pts |

The pre-registered calibration rule (gap >= −2 pts) fails everywhere, so no tau is chosen and the ATP holdout was
**not** evaluated (the protocol evaluates a holdout only for a chosen tau). Publishing "PBE 84 %" on calls that win
80 % would misstate our confidence. Fixing it is a probability-recalibration question, i.e. a model change — out of
scope for Picker V1 and an owner decision.

## WTA — PASSES selection and the holdout gate

Chosen tau = **0.55** (the smallest qualifying tau, per the protocol's rule). Selection window 2023–2024:
45,846 graded calls, hit 74.8 % (Wilson low 74.4 %), gap +1.1 pts.

Holdout (2025-01-01 → 2026-10-02), evaluated once at the frozen tau:

| graded calls | hit rate | Wilson 95 % | mean PBE p | gap | log loss | CALL / PASS / HOLD |
|---|---|---|---|---|---|---|
| 45,314 | 75.6 % | 75.2–76.0 % | 74.1 % | +1.5 pts | 0.505 | 72.5 % / 10.7 % / 16.8 % |

Gate: >= 100 calls ✔ · Wilson low >= 60 % ✔ · gap >= −3 pts ✔ · beats a coin (ln 2 = 0.693) ✔.

**Descriptive** breakdown of the same frozen holdout by level (not a gate, not used for selection):

| level | graded calls | hit rate | Wilson 95 % | mean PBE p | gap |
|---|---|---|---|---|---|
| WTA tour-level (Slams, 1000, 500, 250, Finals) | 5,928 | 70.6 % | 69.5–71.8 % | 71.3 % | −0.7 pts |
| WTA 125 | 3,249 | 70.8 % | 69.2–72.3 % | 71.4 % | −0.7 pts |
| ITF women | 36,111 | 76.9 % | 76.5–77.4 % | 74.9 % | +2.1 pts |

The pass holds at tour level (well calibrated), not only on ITF volume.

## Grading policy (frozen for V1)

Completed → W / L. Walkover → VOID. Retirement, default, abandonment, cancellation → VOID (V1 keeps non-tennis
completion events out of model accuracy). VOIDs are counted, never in hit rate or calibration. Corrections are
appended (`tennis_pick_corrections`), never mutations.

## Owner decisions needed before activation (nothing is activated)

1. **WTA tau.** The protocol's rule selects 0.55, which CALLs ~84 % of eligible tour-level matches. That is a valid,
   calibrated result but a very high call rate for an "Official Pick". A stricter tau (e.g. 0.65 or 0.75 from the
   selection grid) can only be adopted as a **new protocol version validated on fresh prospective data** — choosing
   it now from the holdout would be holdout tuning.
2. **Scope.** WTA tour-level only, + WTA 125, + ITF? (Kalshi / Polymarket list tour-level and 125 events.)
3. **Lock time.** Today 0 of 19 scheduled WTA singles matches for tomorrow carry a sourced start time (ATP: 21 of 21).
   A lock keyed only on the sourced start would HOLD all of WTA. Proposed V1 rule: `lock_at = sourced start − 60 min`
   when a start is sourced, otherwise the start of the match's scheduled day in the tournament's local time (before
   any play that day); no day known → HOLD.
4. **ATP.** Stays off in V1 (over-confident). Recalibration study = separate, explicit model work.
5. **Visibility.** Match probabilities are All Access today; whether Official Picks are public or All Access is a
   membership decision (no membership semantics are changed by this work).
