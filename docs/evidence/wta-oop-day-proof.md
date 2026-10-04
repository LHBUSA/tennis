# WTA order-of-play day proof — 2026-10-04T13:54:22.296Z

Verdict: **placeholder day NOT PROVEN** — proven only if: >= 2 tournaments have entries carrying both a placeholder and a full-ISO NotBeforeISOTime, every such pair agrees on the local day, no placeholder falls outside its tournament window, and no earlier capture contradicts the day the match was played.

Totals: {"tournaments":7,"scheduled_rows":26,"placeholders":14,"placeholders_unscheduled":14,"E_both":12,"E_agree":12,"E_mismatch":0,"A_both":0,"A_agree":0,"A_mismatch":0,"B_both":0,"B_agree":0,"B_mismatch":0,"C_out_of_window":0,"tournaments_with_cross_evidence":0}

Placeholders on Unscheduled:true rows: 14 of 14 (an unscheduled row is not on an order of play: its 23:59 date is never a day of play).

E. MatchTimeStamp vs time-only NotBeforeISOTime agreement: 12 of 12 rows agree on local time + offset across 3 tournaments (0 mismatches).

Consequence in code (workers/providers/wta.js wtaScheduleDay): the placeholder path stays OFF (PLACEHOLDER_DAY_PROVEN = false; never on an Unscheduled row even if enabled). Precedence 1 = full-ISO NotBeforeISOTime (source wta_not_before_iso). Precedence 2 = a non-placeholder MatchTimeStamp whose local time and offset equal the time-only NotBeforeISOTime (source wta_order_of_play; check E above). +00:00 / Z offsets are stored as null (unproven -> HOLD). Re-run with --capture on later days; check D then compares earlier placeholders with the day each match was actually played.

Played-day check (earlier captures): {"captures":2,"compared":0,"agree":0,"mismatches":0}

| Tournament | window | scheduled U rows | placeholders | A: both / agree / mismatch | B: both / agree / mismatch | out of window | placeholder days |
|---|---|---|---|---|---|---|---|
| JINGSHAN 125 (WTA 125) | 2026-09-28..2026-10-04 | 0 | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 | {} |
| ADANA 125 (WTA 125) | 2026-09-28..2026-10-04 | 1 | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 | {} |
| TEMPLETON (ITF) | 2026-09-28..2026-10-04 | 0 | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 | {} |
| QUINTA DO LAGO (ITF) | 2026-09-28..2026-10-05 | 0 | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 | {} |
| BEIJING (WTA 1000) | 2026-09-30..2026-10-11 | 13 | 5 | 0 / 0 / 0 | 0 / 0 / 0 | 0 | {"2026-10-05":5} |
| SUZHOU 125 (WTA 125) | 2026-10-05..2026-10-11 | 12 | 9 | 0 / 0 / 0 | 0 / 0 / 0 | 0 | {"2026-10-05":9} |
| SAMSUN 125 (WTA 125) | 2026-10-05..2026-10-11 | 0 | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 | {} |
