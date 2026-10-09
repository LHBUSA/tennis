# Tennis Picks V2 — pre-registered protocol (LHBUSA/tennis#11)

Registered 2026-10-09, BEFORE any V2 result was computed. Any deviation is a new protocol version, never an edit.
Nothing here activates anything: `PICKS_LIVE = false`, `PICKER_POLICY.activated_at = null` stay untouched; the WTA
Picker V1 (`tennis-picker-v1@b27aeec`, tau 0.55) is the frozen baseline and is not modified, refit or re-thresholded.
The production PBE Rating is unchanged. The Match Simulator stays RESEARCH. The mm2 challenger shadow
(`mm2-B-context/1`, R2 `research/mm2/shadow/`) is frozen and is neither read, refit nor reused here.

## 1. ATP recalibration — amendment of `ATP_RECALIBRATION_PROTOCOL.md` (= `atp-recal/2`)

**Why an amendment.** `ATP_RECALIBRATION_PROTOCOL.md` (da306fe) reserved ATP 2023-01-01 .. data end as an untouched
retrospective holdout. That window is no longer untouched: the Matchup Model V2 research evaluated the production ATP
probability on ATP 2023–2025H1 (development) and on 2025-07-01 .. (its "untouched later window",
`docs/MATCHUP_MODEL_V2_RESEARCH.md`), and reported ATP over-confidence there. Using it as our holdout would be tuning
on a previously observed window. Therefore:

- **Development (fit + selection), unchanged from v1:** ATP singles 2012-01-01 .. 2022-12-31, forward-chaining:
  for Y in 2019, 2020, 2021, 2022 fit on 2012-01-01 .. (Y-1)-12-31, predict year Y. Candidate list, tie rule,
  "must beat uncalibrated by >= 0.002 pooled log loss", Picker V1 tau rule (smallest tau in 0.550 .. 0.800 step 0.025
  with >= 300 graded calls, Wilson 95 % low >= 0.65, hit − mean p >= −0.02) — all exactly as in v1.
- **ATP 2023-01-01 .. 2026-10-02 is never read by the study** (neither fit, selection, nor evaluation). The v1
  holdout guard stays closed; `holdout-opened.json` is never written by V2.
- **Freeze:** the selected method is refit once on 2012-01-01 .. 2022-12-31; method, coefficients, tau, input
  manifest hash and code commit go to `docs/evidence/atp-recal/frozen.json`, committed before the shadow records.
- **Holdout = strictly prospective:** ATP singles decisions recorded by the shadow ledger (section 2) with
  `decided_at` >= the first deploy of the frozen challenger. They are evaluated only by the gate in section 4.
- **Reported on the development OOS predictions (2019–2022):** n, log loss, Brier, ECE (10 equal-width bins of the
  favourite probability), reliability bins, for: uncalibrated production probability, each candidate, a coin, and a
  ranking baseline `p = 1 / (1 + (rank_a / rank_b)^c)` with `c` fitted on the same earlier years (ranked pairs only).
  Plus "outside the chalk": calls whose PBE favourite is the ranking underdog at match time (descriptive).
- No market enters fitting or selection (none exists historically in our data: `odds-count.json`).

Version name of the challenger: `atp-recal/2:<method>` served as `tennis-picker-v2-atp-shadow`.

## 2. ATP shadow prospective ledger (`tennis-picker-v2-atp-shadow`)

- Scope: ATP main-tour singles as Picker V1 scopes them (`scope = atp`). Doubles and ITF never.
- Input: the production probability frozen in the pre-match snapshot (`matchup-freeze/1`) at or before the lock —
  the same input Picker V1 uses — mapped through the frozen recalibration. No market key may enter (allowlisted).
- Lock rule = Picker V1's: sourced exact start → lock = start − 60 min (T_MINUS_60); else source-proven day + UTC
  offset → 00:00 tournament local (DAY_START_LOCK); else HOLD (MISSING_DAY_OR_TIMEZONE). A match never observed while
  scheduled gets no record. Past the window (the sourced start; or day start + 6 h) a match counts as started →
  HOLD (LOCK_MISSED). No start time is ever invented.
- Decision: HOLD (no snapshot / < 10 rated matches / no published probability), CALL if recalibrated p_fav >= frozen
  tau, else PASS. Label: **SHADOW · ATP RESEARCH — not an official pick**. Never official, under any activation.
- Storage: R2 `tennis-source` `ledger/picker-v2-atp-shadow/{decisions,calls,grades,seen,corrections}/`,
  create-only (`If-None-Match: *` conditional put + head check), never overwritten; corrections append.
- Benchmarks: the shared `benchmarks-at` (propsports-markets, via the existing MARKETS binding) frozen at the lock,
  recorded separately from the PBE probability; compared only where the venue rules match (comparable).
- Grading (frozen now, `tennis-picker-grading/1`, identical to V1): completed → W / L; walkover, retirement, default,
  abandonment, cancellation → VOID (counted, never in hit rate or calibration). PENDING until final.

## 3. Opportunity labels (`tennis-opportunity/1`, read-time, from frozen records only)

Labels are derived deterministically from what a record froze at its lock; they never alter a record.

- **MATCH_WINNER** — a CALL (side + probability).
- **SURFACE_MATCHUP** — the frozen probability used the surface blend and it differs from the overall-rating
  probability for the same side by >= 5 points (or flips the favourite).
- **UNDERDOG_WATCH** — a venue's market favourite at the lock is NOT the PBE favourite (any comparable or related
  venue with an observation). A watch item, never a pick, never "value".
- **PBE_ABOVE_MARKET / PBE_BELOW_MARKET** — only on a same-contract (comparable) venue observed at the lock:
  PBE selection probability − market selection probability >= +5 / <= −5 points. A probability difference, never a
  profit, ROI or edge claim (no execution price is recorded).

Every label carries its own W/L/VOID/PENDING tally in the record; dominant favourites are never presented as
profitable, and calls are also tallied by PBE favourite probability band so chalk is visible as chalk.

## 4. Proposed owner activation gates (proposal only — nothing activates)

**WTA Picker V1 (official candidate, scope `wta_main`), prospective ledger only:**
1. >= 250 graded CALLs from >= 25 distinct editions, all with lock integrity (decided_at < started_at, or for
   DAY_START_LOCK decided before the local day began) — 100 % required, any violation excluded by correction and
   reported;
2. Wilson 95 % lower bound of hit rate >= 0.60; 3. hit − mean p_fav >= −0.03; 4. log loss < ln 2;
5. disclosed (not gated): PBE vs same-contract market Brier on the same calls, VOID count, PASS/HOLD rates.
Selection-policy implication: tau 0.55 calls ~84 % of eligible tour-level matches. A stricter tau (fewer, stronger
calls) is a new policy version and needs its own fresh prospective sample; it may not be chosen from this ledger.

**ATP (`atp-recal/2` challenger), prospective shadow only:** the same five items with >= 300 graded CALLs from >= 30
editions, plus: paired log loss of the recalibrated probability below the uncalibrated production probability on the
same calls, with the edition-cluster bootstrap 95 % CI of the difference entirely below 0. A pass makes ATP eligible
for an owner decision; it never makes an earlier shadow decision official.
