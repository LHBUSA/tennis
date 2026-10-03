# Tennis PBEcast — live capability audit (2026-10-03)

Internal. Phase 1 of the "level up the live court" brief: what the live payloads we ALREADY receive actually contain,
read from archived raw captures (R2 `tennis-source/<family>/sha256/…`, lineage in `tennis_source_captures`) and from
what we stored (`tennis_match_events`). Field semantics are taken only from observed values, never from names.
Upstream names appear here because this is an internal source audit; none of it is for the public product.

## Sources that feed live state

| Lane | Tours / events | Endpoint we poll (live) | Cadence we get |
|---|---|---|---|
| Official WTA feed (`wta.matches`) | WTA WS, WD | `/tennis/tournaments/{id}/{year}/matches` (all matches of the edition, one payload) | ~1 observation/min (TENNISCAST measured median 60.2 s) |
| ESPN core, ATP league (secondary) | ATP MS, MD, XD | `…/events/{e}` + `…/competitions/{c}/status` + `…/competitors/{k}/linescores` | same cron; game level only |
| WTA match stats (`wta.match_stats`) | WTA | `…/matches/{m}/stats` | **after the match only** (`on_final`; 0 in-play captures today, e.g. LS040–LS045 one capture each, post-match) |
| AO match centre (`ausopen.match_centre`) | Australian Open only, current edition | `/match-centre/{matchId}` | historical replay (Jan 2026 edition), not a live lane today |

## Capability table

OBSERVED = present with real values in live payloads · PARTIAL = present but incomplete/limited · NOT PRESENT = no such field anywhere in the payloads.

| Capability | WTA singles (live) | WTA doubles (live) | ATP singles/doubles (ESPN, live) | AO match centre (Slam, replay) |
|---|---|---|---|---|
| server | OBSERVED `Serve` A/B (13,370/13,556 WS snapshots) | OBSERVED side only, not which partner (2,224/2,258) | NOT PRESENT | OBSERVED ("X is serving game N", type `serve`) |
| receiver | derived = other side | derived = other side (team) | NOT PRESENT | derived |
| point score | OBSERVED `PointA/PointB` (0/15/30/40/Av; tiebreak counts) | OBSERVED | NOT PRESENT | OBSERVED per point (`score`) |
| point winner | PARTIAL — only when two observations differ by exactly one point (see below) | PARTIAL, same | NOT PRESENT | OBSERVED (`winner` 1/2 per point) |
| game winner | OBSERVED via exactly-one-game step + prior server (hold/break), else unattributed | same | PARTIAL — games per set (linescores), winner only when one game step between reads | OBSERVED |
| set winner | OBSERVED (`ScoreSetNA/B`, tiebreak `ScoreTbSetN`) | OBSERVED | OBSERVED (linescores per period, tiebreak) | OBSERVED |
| ace / double fault | match totals only, post-match (`acesa`, `dblflta`) — not live | same | NOT PRESENT | OBSERVED per point (reason text "Ace", "Double Fault") + totals |
| winner / unforced / forced error | NOT PRESENT | NOT PRESENT | NOT PRESENT | OBSERVED per point (Forehand/Backhand Winner, Forced Error, Unforced Error, Service Winner) |
| first/second serve, serve number | totals only, post-match (`ptsplayed1stserva`…) | same | NOT PRESENT | totals only (per-point serve number NOT PRESENT) |
| serve speed | NOT PRESENT | NOT PRESENT | NOT PRESENT | PARTIAL — aggregates only (Fastest serve, 1st/2nd serve average, km/h + mph); no per-point speed |
| serve direction / placement | NOT PRESENT | NOT PRESENT | NOT PRESENT | NOT PRESENT |
| rally length | NOT PRESENT | NOT PRESENT | NOT PRESENT | NOT PRESENT (rally_stats = shot-type counts: groundstroke, volley, approach, passing, lob, overhead, drop) |
| shot sequence / shot type per point | NOT PRESENT | NOT PRESENT | NOT PRESENT | PARTIAL — only the point-ending shot (FH/BH + outcome) |
| ball x/y, bounce x/y, player x/y, court/shot coordinates | **NOT PRESENT** | **NOT PRESENT** | **NOT PRESENT** | **NOT PRESENT** |
| point timestamp | NOT PRESENT (observation time only = our `observed_at`) | same | NOT PRESENT | OBSERVED (`timestamp` epoch s, elapsed `duration`) |
| event timestamp | `LastUpdated` = source record update time (per match), `MatchTimeStamp` = start, `MatchTimeTotal` = elapsed | same | status `period`/`detail` only | OBSERVED |
| sequence / order | NOT PRESENT (ordering = our observation order) | same | NOT PRESENT | OBSERVED (`id` `XD114-003-001-022` = set-game-point) |

Our own store confirms it: `tennis_match_events` has `serve_speed_kmh`, `serve_number`, `rally_length`, `coordinates`
columns — **0 of 72,045 rows** have any of them populated, because no source supplies them.

Other fields looked at and ruled out:
- WTA `BinPacketBase64`: null on every match in every capture inspected (100/100 Beijing rows, all states). Not a hidden data channel.
- WTA `tournament.liveScoringId`: an identifier on the tournament object; we receive nothing from any live-scoring system it might refer to and did not probe one.
- ESPN competition flags: `commentaryAvailable:false`, `liveAvailable:false`, `gameSource/linescoreSource/statsSource: none` on live ATP competitions; no `situation`, `plays` or `details` refs exist in the payload.

## How complete is the observed point stream (WTA)?

WS Volynets–Mertens (Beijing R2, 2026-10-03, `8f83eee4`): 114 points played (post-match stats), 71 stored events.
- 28 within-game steps were exactly one point → point winner provable.
- 24 within-game steps jumped 2+ points (`0–0 → 15–15`, `0–0 → 30–0`, `30–0 → 40–15`) → winners of those points unknown.
- 19 game changes (11 `game_won` with hold/break attribution, 5 `break`, 1 `set_won`).

So at our ~1/min cadence only **~25% of points have a provable winner**; every game and set result is known. A
"last N point winners" strip must show gaps for most points, or be a **last N games** strip (complete).

## Sanitized real payloads

WTA singles, live (`wta.matches`, Beijing, 2026-10-03T04:17Z; names/ids redacted):
```json
{"BinPacketBase64":null,"CourtID":4,"DateSeq":6,"DrawLevelType":"M","DrawMatchType":"S","EventID":"1020","EventYear":2026,
 "LastUpdated":"2026-10-03T04:17:46.55+00:00","MatchID":"LS043","MatchState":"P","MatchTimeStamp":"2026-10-03T02:45:56.57+00:00",
 "MatchTimeTotal":"01:09:48","NumSets":2,"PlayerIDA":"<id>","PlayerNameLastA":"<last>","PlayerIDB":"<id>","PlayerNameLastB":"<last>",
 "PointA":"40","PointB":"40","RoundID":"2","ScoreSet1A":"0","ScoreSet1B":"6","ScoreSet2A":"0","ScoreSet2B":"3","ScoreString":"6-0,3-0",
 "ScoreSys":"1","ScoreTbSet1":"","SeedB":"13","Serve":"A","Winner":"0"}
```
(62 keys per match; the rest are partner/country/entry/seed/court/not-before text.)

WTA doubles, live (stored observation from `wta.matches` 1143-2026, 2026-10-03T12:23Z, match tiebreak):
`point {"A":"6","B":"9"}, server "B"` — same fields as singles, `PlayerIDA2/B2` filled; server is a side, never a player.

ATP, live (ESPN, Beijing competition 183451, 2026-10-03T13:27Z; names redacted):
```json
status:     {"period":2,"type":{"name":"STATUS_IN_PROGRESS","state":"in","completed":false,"detail":"2nd Set"}}
linescores: {"count":2,"items":[{"value":3,"displayValue":"3","period":1},{"value":3,"displayValue":"3","period":2}]}
competition:{"type":{"text":"Men's Singles"},"commentaryAvailable":false,"liveAvailable":false,
             "gameSource":{"description":"none"},"linescoreSource":{"description":"none"},"statsSource":{"description":"none"},
             "competitors":[{"order":1,"winner":true,"linescores":{"$ref":"…"}},{"order":2,"winner":false,"tournamentSeed":8}],
             "round":{"description":"Round 2"},"court":{"description":"<court>"}}
```

AO match centre point (replay only):
`{"id":"XD114-003-001-021","timestamp":1769159664,"commentary":"<team> lose the point with a Forehand Forced Error","set":3,"winner":2,"score":"11 - 10","type":"point"}`

## Verdict

**No spatial data exists in any live payload we receive, for either tour, singles or doubles.** True ball movement,
bounce maps, serve placement and rally trails are not possible from current sources; they would need a new
tracking source or rights-cleared video, which is a separate project.

Truthful granularity per live match today:
- WTA singles + doubles: POINT LEVEL (score + server per observation; point winners only on single-point steps; games/sets complete).
- ATP singles + doubles: GAME LEVEL (games per set + status; no point, no server).
- SCORE ONLY: any match whose live state is missing (e.g. feed unavailable) — fall back to sets/games.
