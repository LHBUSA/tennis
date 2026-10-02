# TennisCast — live state contract

`tournament → match → set → game → point`, one engine for live and replay
(`workers/shared/canonical/scoring.js`). Status: engine built and tested.

**Live sources in production (2026-09-29, tour-aware router `workers/tennis-live/src/router.js`):**

| Router source | Upstream | Tour / events | Granularity | Discovery |
|---|---|---|---|---|
| `wta` | official WTA live-scoring feed (api.wtatennis.com) | WTA, WTA 125, Slam women: WS, WD | point score + server | ingest `matches` step (WTA calendar editions) |
| `espn` | ESPN core API, ATP league — SECONDARY, not an official ATP feed | ATP events: MS, MD, XD | set/game score only (competition status + per-competitor linescores); ESPN publishes no point score or server — null, never invented | ingest `espn_live` step (current ATP events recorded by the espn_atp lane) |

`tennis-live` polls every edition in `live:editions` inside a once-a-minute cron (designed for 3 rounds 18 s apart; measured 2026-10-02: 1–2 rounds fit the 50 s budget, observations ~60 s apart, never < 27 s) through its router provider; every
observation goes parse -> normalizeMatch -> the ONE canonical writer (tennis_matches, tennis_sets,
`score_snapshot` rows in tennis_match_events, tennis_source_changes). Ownership: `live:heartbeat` + `live:owned`;
while the heartbeat is fresh, neither the ingest `matches`/`espn_live` steps nor the espn_atp/espn_wta lanes write an
owned edition. An edition whose live state has no legitimate source stays scheduled / result-only. US Open live
remains unavailable (upstream challenges Cloudflare egress; not bypassed). ESPN live rows must be re-observed within
20 minutes to count as live in `/v1/live` (WTA rows: 12 h, unchanged).

This is observation granularity, not point-by-point: points (or, for ESPN, games) between two observations are never
filled in. True point-by-point exists only in the AO match centre (not adapted yet).

## Rules

- Transitions are either one observed point (`applyPoint`) or an explicit, source-reported event:
  `retire(side)`, `walkover(side)`, `suspend(reason)`, `resume()`. Nothing unseen is inferred — not a
  point, not a server, not a retirement reason.
- Formats: best of 3/5; tiebreak at 6-6 to 7; deciding-set tiebreak to 10; advantage deciding set;
  no-ad deciding point; 10-point match tiebreak in lieu of a final set.
- Serve: alternates each game; in a tiebreak the first point is served by the next server, then every
  two points; the side that received first in a tiebreak serves the next set. Inside a doubles side the
  individual server is a source fact only.
- `situation(state)`: break point (never inside a tiebreak), set point, match point — derived from state.
- **Monotonic:** `assertNoRegression(prev, next)` throws unless next ≥ prev, or the source issued a
  documented correction `{source, reason}`. Deuce ↔ advantage cycles compare equal.
- Replay = `replay(format, firstServer, winners)` over the persisted point stream — the same contract.
- Point-by-point is never reconstructed from a final score.

## Score strings

`parseScore("6-4 7-6(5) [10-8] RET")`, `validateScore`, `formatScore`. When only the loser's tiebreak
points are published, the winner's are derived by rule and flagged `winner_points_derived`. Validation
rejects impossible sets (6-5, 8-6 with a tiebreak), sets after the match was decided, unfinished
completed matches, wrong tiebreak targets, retirement after a decided match, and walkovers with games.
The winner of a terminated match is a source fact, never derived from games.

## Test suite (`tests/scoring.test.js`)

6-4, 7-5, 7-6 tiebreak + rotation, extended tiebreak, 10-point match tiebreak, five-setter with 10-point
final tiebreak, break of serve, love game, deuce/advantage cycles, no-ad, retirement mid-game and between
sets, walkover, suspension + next-day resumption, doubles, mixed doubles, regression guard, parse/validate
of legal and illegal lines (incl. 70-68).

## Presentation (to build on a live source)

Header `SINNER vs ALCARAZ · SET 3 · 4–3 · 30–15 · SINNER SERVING`. Tabs: Points | Stats | Momentum |
Serve | Return | Matchup | PBE | Draw. Event hierarchy: BREAK POINT, BREAK, SET POINT, SET, MATCH POINT,
TIEBREAK, RETIREMENT, SUSPENDED, RESUMED. Zero live matches renders as exactly that.
