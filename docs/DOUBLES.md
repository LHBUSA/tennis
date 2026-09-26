# Doubles

First-class, not an afterthought.

- Participants are pairs (`D:<uuid>+<uuid>`, order-independent). Doubles matches, rankings, draws and
  stats never collapse into single-player rows.
- WTA doubles are fully available from the WTA API (both players' ids per side, no-ad + match-tiebreak
  format `ScoreSys 9`, retirements). Wimbledon doubles feeds are expected under the same path pattern
  (not yet probed per event code). ATP doubles: blocked like the rest of atptour.com.
- Pair profile (planned): current players, combined rankings from the snapshot at date, pair record,
  shared-match history, surface splits, tiebreak + match-tiebreak record, serve/return (team-level),
  partner continuity, partner history.
- **Partner Lift** (research, not shipped): pair performance vs the pair's expected baseline from each
  player's partner-adjusted doubles strength with other partners. Ships only with a published method,
  a minimum shared-match sample, and a backtest showing it is not noise.
- Pair snapshots: `(participant_key, as_of, definition_version)`.
- Doubles Lab is not "combined singles rankings".
