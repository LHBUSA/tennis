# Tennis Picks V2 — ATP recalibration development results (atp-recal/2)

Protocol: `docs/research/PICKS_V2_PROTOCOL.md` (registered ff35487 before any result). Study:
`scripts/research/atp-recal/study.mjs` → `docs/evidence/atp-recal/dev-study.json`; frozen challenger
`docs/evidence/atp-recal/frozen.json`. Inputs: production DNA v2 ledger + ranking lists fetched 2026-10-02 (manifest
sha256 a6349836…). Production probability = PBE Rating (ATP `standard`, surface blend under the production rule).
No ATP match dated 2023-01-01 or later was read (development entries are filtered before the rating run).
No market data exists for the development window, so there is no market benchmark here; markets are compared only
prospectively (frozen at each lock).

## ATP — forward-chained out-of-sample 2019–2022 (fit on 2012 .. Y−1, predict Y)

| Probability | n | Log loss | Brier | ECE | Accuracy |
|---|---|---|---|---|---|
| Coin | 8,110 | 0.6931 | 0.2500 | — | — |
| Production PBE Rating (uncalibrated) | 8,110 | 0.6301 | 0.2202 | 0.0404 | 63.8 % |
| **Temperature (selected)** | 8,110 | **0.6257** | **0.2187** | **0.0130** | 63.8 % |
| Platt (both orientations → b = 0, a = 1/T) | 8,110 | 0.6257 | — | 0.0130 | 63.8 % |
| Binned isotonic | 8,110 | 0.6257 | — | 0.0165 | 63.8 % |
| Ranking model `1/(1+(ra/rb)^c)`, c fit on earlier years | 6,911 ranked | 0.6384 | 0.2244 | 0.0262 | 62.3 % |
| Production uncalibrated, same 6,911 ranked matches | 6,911 | 0.6316 | | | |

Temperature wins the tie rule (simplest); gain vs uncalibrated 0.0044 ≥ 0.002 required. Fold temperatures
1.227 / 1.241 / 1.242 / 1.248 (stable). Frozen refit on 2012–2022 (22,428 matches): **T = 1.2487**, i.e. the
production ATP favourite probability is shrunk toward 50 % (an 80 % call becomes ~75.2 %). Accuracy is unchanged by
construction (monotone map); only the stated confidence changes.

**Picker rule (V1's, unchanged) on the temperature OOS probabilities:** tau = **0.55** qualifies — 6,455 graded calls,
hit 67.1 % (Wilson 65.9–68.2 %), mean p 68.3 %, gap −1.2 pts (≥ −2 required), 133 VOID. Under V1 the uncalibrated
probability failed this calibration rule at every tau.

**Outside the chalk (descriptive, calls at tau 0.55):**

| Segment | graded | hit | Wilson 95 % | mean p (recal) | gap |
|---|---|---|---|---|---|
| PBE favourite = ranking favourite | 4,600 | 68.8 % | 67.4–70.1 % | 69.2 % | −0.4 |
| **PBE favourite = ranking underdog** | 867 | **56.5 %** | 53.2–59.8 % | 62.4 % | **−5.8** |

When PBE disagrees with the ranking, it is right more often than not but still over-confident even after
recalibration. These are therefore shown as UNDERDOG WATCH context only, never as value or a stronger pick.

## WTA — V1 frozen (no change), descriptive check on the V1 selection window 2023–2024

Same split at tau 0.55: PBE favourite = ranking underdog 708 calls, 57.9 % vs mean p 63.7 % (−5.8); PBE favourite =
ranking favourite 3,209 calls, 69.0 % vs 70.3 %. Most WTA calls (41,929) involve an unranked player (ITF depth).
Same lesson: disagreement with the ranking is not an edge signal.

## Verdict

- **ATP `atp-recal/2:temperature` = FROZEN PROSPECTIVE SHADOW. Not validated.** It passed development selection only.
  Its only holdout is the prospective shadow ledger (protocol §2, §4). ATP 2023+ is never used (observed by the mm2
  research).
- **WTA Picker V1 unchanged** (frozen baseline, prospective, not official).
- The production PBE Rating and every published probability are unchanged.
