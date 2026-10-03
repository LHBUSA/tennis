# ATP live incident 2026-10-03 — LIVE_MATCH_AVAILABLE_BUT_NOT_INGESTED

Internal. Append-only. This document corrects earlier status reports; the earlier evidence is left as it was.

## Correction of earlier status

Session reports on 2026-10-03 at 02:13Z and 04:17Z recorded `HOLD_NO_LIVE_ATP`, and the 2026-09-29 parity evidence
used the same label. That label could not distinguish:

- `NO_LIVE_MATCH_AVAILABLE` — nothing ATP was in play upstream, and
- `LIVE_MATCH_AVAILABLE_BUT_NOT_INGESTED` — ATP matches were in play and polled, but nothing was stored.

On 2026-10-03 ATP matches were live and were missed, so at least the Beijing window (12:01–13:30Z) was
`LIVE_MATCH_AVAILABLE_BUT_NOT_INGESTED`. In particular:

- Japan Open matches (e.g. d54c6504) completed that day with no in-progress state ever stored.
- Production has never stored an in-progress ESPN-lane match: 0 status changes to `in_progress`, 0 ESPN score_snapshot
  events (query 2026-10-03 ~14:00Z).

`scripts/qa/atp-live-production.mjs` now reports `NO_LIVE_MATCH_AVAILABLE` or `LIVE_MATCH_AVAILABLE_BUT_NOT_INGESTED`.
It uses the live lane's own stage trace, with no extra upstream request.

## What production saw (from archived captures + run rows)

- **Beijing ATP (ESPN event 959-2026), edition 81fb3ab5.** Competition 183446 (status + both linescores) was read
  every minute from 12:01Z; 183451 from ~12:05Z. Both were `STATUS_IN_PROGRESS`, linescores HTTP 200.
- **12:33Z.** Two observations in the same minute: round 0 at :04–:20, round 1 at :33–:48. Cron invocations overlap.
- **Nothing persisted.** No `tennis_matches` row and no external id for 959-2026:183446/183451. No source change, no
  event. The hold rows were last seen 2026-09-30 04:59.
- **The whole Beijing ATP edition was frozen.** Its last write of any kind was 2026-09-30 04:59:28; 0 writes since
  Oct 1. Japan Open (5-2026) and the Beijing WTA-league rows kept being written.

## Proven

1. **Self-perpetuating ownership.**
   - `espnLiveScan` re-added an owned edition's previous `live:editions` entry unconditionally.
   - tennis-live derives `live:owned` from `live:editions`. Beijing ATP therefore stayed owned from 2026-09-30 with
     nothing live: `live:editions` carried `{espn 959-2026, live:1}` at 15:13Z with 0 live competitions.
   - Every ingest lane skips owned editions (`OWNED_BY_LIVE`), and tennis-live writes only competitions it sees live.
   - Result: no lane wrote Beijing ATP results or fixtures for 3+ days.
   - **Fix (a758154):** ownership lasts only while tennis-live tracks a competition of the event. Tested.
2. **The code and data path is sound.**
   - The production dry replay (`POST /v1/live/diag/replay` on tennis-live, version d5b38e2f) ran the deployed code
     with real bindings and real store reads, and intercepted every write.
   - It replayed the archived 12:33Z observation (event, 2 statuses, 4 linescores).
   - Both competitions went `CANDIDATE → LIVE → NORMALIZED:in_progress → WRITE_ATTEMPTED → WRITTEN`: 2 in-progress
     `tennis_matches` rows and 2 `score_snapshot` events. This held with `previously` empty and with both competitions
     previously live.
   - A faithful in-memory replay seeded with the production rows of the edition gave the same result.
   - **The cron run therefore died or diverged after the reads.**

## Strong candidate, fixed, awaiting the natural proof

`scheduled()` handed the cycle to `ctx.waitUntil()` and returned. Work after the handler returns is cut off about 30 s
later.

- The cycle is designed to run up to 50 s (`BUDGET_MS`). It measured 23 s wall with nothing ATP-live (tail 15:21Z).
- The ESPN edition runs last.
- A cut there loses the writes after the reads were already archived, and loses `last_run` too. That matches every
  symptom.

**Fix (a758154):** the cycle is awaited. Exact confirmation needs a natural ATP live window with the new per-stage
trace.

## Instrumentation (internal only)

Every ESPN candidate now ends in a reason code:

- `CANDIDATE_*`, `STATUS_BUDGET_EXCEEDED`, `STATUS_FETCH_FAILED:*`, `NOT_LIVE:<status>`, `LINESCORES_UNAVAILABLE`,
  `LIVE`
- `NOT_PARSED:*`, `NOT_KEPT:*`, `NORMALIZED:*`
- `EDITION_PENDING`, `WRITE_ATTEMPTED`
- `WRITTEN`, `ATTACHED`, `HELD:<problem>`, `SKIPPED_UNRESOLVED_PLAYER:*`, `SKIPPED_SIDE_UNDECIDED`
- `WRITE_FAILED:<msg>`, `DROPPED_UNCLASSIFIED`

They are kept in:

- the tennis-live round record;
- a bounded KV ring `live:diag:espn` (400 entries, 4 days; admin `GET /v1/live/diag`);
- one structured log line per traced observation.

No payloads are stored, and nothing is exposed publicly.

## Timeline (UTC)

| Time | Event |
|---|---|
| 2026-09-30 04:59 | last write of any Beijing ATP row; ownership loop begins |
| 2026-10-02 20:54 | tennis-live 0.3.1 (730dca48) deployed — the version running during the incident |
| 2026-10-02 23:18 | tennis-ingest 7f3249ff deployed |
| 2026-10-03 02:00–04:30 | Japan Open ATP matches played; none stored as in-progress |
| 2026-10-03 12:01–13:30 | Beijing ATP 183446 / 183451 live and polled every minute; nothing stored |
| 2026-10-03 14:16 | tennis-api 17029cfb (other session, source-brand) |
| 2026-10-03 14:38 | tennis-api b2c4c8e1 (this session) — overwrote 17029cfb; tennis-api is not on the ingest path |
| 2026-10-03 14:42 | tennis-api e45b1109 merged redeploy |
| 2026-10-03 15:25 | tennis-live 0.3.2 878adc71 + tennis-ingest cd16ae91 (a758154): ownership release, awaited cycle, trace |

**Classification:**

- **Pre-existing:** the failure predates the 14:38 deployment collision by 10+ hours (and 3+ days for the ownership
  loop).
- **Not deployment-related:** tennis-api is not on the write path.
- **Configuration and platform related:** waitUntil lifetime, ownership handoff.

## Addendum 2026-10-03 18:05Z — schedule/draw stall (results + next-round fixtures)

- **Scope.** Only Beijing ATP (ESPN 959-2026, edition 81fb3ab5) was stale: 21 MS/MD rows still `scheduled` 6+ h after
  their start (oldest 09-30 04:30Z), last write 2026-09-30 04:59:28Z. Every other edition with matches in the last 30 days
  had 0 such rows (SQL 17:30Z). Upstream had everything: ESPN listed Borges v Djokovic as final since 09-30 and the QF
  Zverev v Djokovic (comp 183465, 10-04 11:00Z) by 17:25Z.
- **Second cause (besides the ownership loop fixed in a758154).** The espn_atp current queue was rebuilt only on the 3 h
  season re-list, and an `OWNED_BY_LIVE` skip was consumed like a read. The 14:53Z re-list (before the 15:25Z release
  deploy) skipped 959-2026 as owned, so even after the release the edition would have stayed stale until ~17:53Z; in
  normal operation results and next-round fixtures could lag up to 3 h.
- **Fix 0fb386b** (ingest 2b1ad8bb, api 773cc5f2): current-window events re-read every 15 min, owned skips retried after
  4 min; first tick after deploy (17:39Z) wrote 54 Beijing ATP rows (all R1/R2 finals + 4 QF fixtures). Freshness guard
  per tournament on /v1/schedule and in tennis-ingest (KV `freshness:schedule`; STALE 17:39Z -> CURRENT 17:52Z).
- **Market layer.** HURKHA/DERUB attached on the next lane read; ZVEDJO (ticker date 10-04, first seen 12:20Z while our
  schedule lacked it) kept its carried `unmatched` decision until the propsports-markets far-date refresh (every 30 min)
  and attached at 18:00:56Z to canonical 8b76f7f0. Unmatched queue tennis-atp: 8 eligible / 8 matched.
