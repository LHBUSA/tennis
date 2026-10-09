# Official PBE Picks V1 — Tennis (LHBUSA/tennis#14)

**Owner decision 2026-10-09:** PBE Tennis Picks is an official, customer-facing algorithm picker. The launch is real
backend semantics, not a relabel.

## Cutover
- `PICKS_ACTIVATED_AT` (`workers/tennis-api/src/picker.js`) is one precise UTC instant, set to a moment **after** the
  release carrying it was live. It is never backdated.
- A decision is official only when it was **recorded at or after** the cutover, and only if it is a CALL.
- Nothing recorded earlier is reclassified, rewritten or promoted. That covers Picker V1 WTA research, the WTA 125 shadow
  and the ATP shadow.

## Official decision streams

| Stream | Ledger (private R2 `tennis-source`) | Rule | Official when |
|---|---|---|---|
| `official_wta` | `ledger/picker-v1/` (existing, create-only) | Picker V1 `tennis-picker-v1@b27aeec`: PBE Rating, tau 0.55, frozen | WTA tour-level singles CALL, `decided_at >= cutover` (`isOfficial`) |
| `official_atp` | `ledger/picks-official-v1/atp/` (**new**, create-only) | `tennis-picks-official-v1-atp`: the frozen `atp-recal/2:temperature` probability, tau 0.55, history floor 10, unchanged from the shadow | Every CALL in this ledger. The stream decides nothing before the cutover and never a match whose lock fell before it |

- **WTA tour-level** means Grand Slam, WTA 1000, 500 and 250, and the WTA Finals.
- **ATP** means tour singles as present in the canonical store.
- **WTA 125** is not part of Official Picks. It remains prelaunch research.

The ATP official stream is a separate ledger with its own record ids (`…:atp-official`), grades, verification scope
(`atp_official`) and denominators. The ATP shadow (`ledger/picker-v2-atp-shadow/`) keeps running unchanged as prelaunch
research, so the same match can carry a shadow record and an official record. Only the official one is counted.

## Unchanged guarantees
- **Decisions:**
  - one designated pre-match decision per match;
  - lock at T-60 from a sourced start, or at the start of the tournament day when only the day and offset are proven,
    otherwise HOLD;
  - create-only writes;
  - no post-start decisions, no backfill.
- **What counts:** PASS and HOLD are recorded but never counted as picks.
- **Grading:** W/L from the canonical result. Walkover, retirement, default, abandonment and cancellation are VOID. VOIDs
  are counted but never enter the hit rate.
- **Markets:** prices never enter the decision.
- **Access:**
  - `/v1/picks*` is All Access, fail-closed, `private, no-store`.
  - `/v1/picks/track-record` is public and carries resolved picks only.
- **Verification:** the read-only lock verification ledger (`picks-verify.js`) covers `atp_official` as well.

## API
- **`official`** is on both `/v1/picks` and `/v1/picks/track-record`. It is `{ activated_at, live, all, ATP, WTA }`, each
  `{ picks, W, L, VOID, pending, graded, hit_rate }`, counting official picks only.
- **`record`** gives per-stream research aggregates: `official_wta`, `official_atp`, `prelaunch_wta`, `prelaunch_wta125`,
  `prelaunch_atp`. Streams are never pooled.
- **Each pick** carries `official`, `stream` and `tour`.
- **`/v1/picks`** returns official picks only, pending and settled.

## UI
- **`/pbe-picks`** shows current official picks first. Each card has the selected player vs the opponent, PBE win
  probability, lock time, a one-line reason and a named PBEcast link. Below it are the latest settled results, a link to the
  Track Record, and "How Picks Work" behind a single disclosure.
- **`/track-record`** shows the official record tiles (All / ATP / WTA), every settled official pick, and the prelaunch
  research record, kept separate and labelled historical. Versions, lock integrity and evidence hashes sit in a closed
  "Technical audit" section.
- **Layout:** no horizontal scrolling or nested scrollers at 320–1920 px (`scripts/qa/picks-official.mjs`).

## Kill switches
- `PICKS_OFFICIAL_ATP=0` stops the ATP official stream.
- `PICKER_V1=0` stops Picker V1. That stops WTA, both prelaunch and official.

Nothing is deleted by either.
