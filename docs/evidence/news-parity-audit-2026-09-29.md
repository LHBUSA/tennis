# Newsroom ATP/WTA parity audit — 2026-09-29

Read-only production audit (2026-09-29 ~12:50Z) of tennis-news 1.1.0 (detector `tennis-detect/1.0.0`,
compose `tennis-compose/1.0.0`). Sources: public `GET /v1/news` + `/v1/news/:slug` (tennis-api), the same list
with the preview token (published + held drafts), and a DRY detector run (`POST /v1/news/runs?dry=1`, which
inserts nothing and writes no KV). The `tennis_news_events` table itself was not read: the Supabase service key is
never fetched locally (owner rule), so the detected-event view below is the detector's current 72 h window.

## Published stories, last 7 days (2026-09-22 .. 2026-09-29)

| published_at (UTC) | headline | event_type | tour | desk | tournament | primary player | source family | materiality |
|---|---|---|---|---|---|---|---|---|
| 2026-09-28 07:08 | Fernandez wins the Singapore title | WS | WTA | wta | Singapore (WTA 500) | Leylah Fernandez | wta | 63 |
| 2026-09-27 05:49 | Fernandez beats No. 5 Andreeva in the Singapore quarterfinal | WS | WTA | wta | Singapore (WTA 500) | Leylah Fernandez | wta | 69 |
| 2026-09-26 21:50 | Tang and Xu edge Kato and Perez in Singapore deciding tiebreak | WD | WTA | doubles | Singapore (WTA 500) | Qianhui Tang / Yifan Xu | wta | 37 |
| 2026-09-26 21:50 | Falkowska/Smith win the Ankara 125 doubles title | WD | WTA | doubles | Ankara 125 (WTA 125) | Weronika Falkowska / Alana Smith | wta | 36 |
| 2026-09-26 21:49 | Francisca Jorge and Matilde Jorge win Porto 125 doubles title | WD | WTA | doubles | Porto 125 (WTA 125) | Francisca Jorge / Matilde Jorge | wta | 36 |

Counts: **ATP 0 · WTA 5** (WS 2, WD 3) · Grand Slam 0 · doubles 3 · ranking stories 0. No held drafts were
visible with the preview token (5 rows total). All five were written by the model and passed the gates.

## Detected events (dry run, current 72 h window: 177 rows scanned, 162 fresh matches)

37 match candidates (plus 3 merged duplicates) and 3 ranking candidates; **every one is `below_threshold`**
(publish bar `PUBLISH_MIN_MATERIALITY = 60`).

| group | candidates | kinds (materiality) |
|---|---|---|
| MS AITO Hangzhou Open (espn, level null) | 7 | comeback 13/13/13/21, deciding_tiebreak 15, seed_upset 18/21 |
| MS Chengdu Open (espn, level null) | 8 | seed_upset 21/18/27, comeback 21/25/13/25/13 |
| MS China Open (espn, level null) | 4 | comeback 13, deciding_tiebreak 15/15/15 |
| MS Japan Open Tokyo (espn, level null) | 3 | comeback 13/13/13 |
| WS China Open Beijing (wta, WTA 1000) | 6 | comeback 30 x5, deciding_tiebreak 32 |
| WS Jingshan (wta, WTA 125) | 5 | seed_upset 19, deciding_tiebreak 16 x3, comeback 14 |
| WS Adana (wta, WTA 125) | 4 | comeback 14 x4 |
| wta_singles list 2026-09-28 | 3 | enters_top50 40/40, enters_top100 30 |

ATP detected: **22** (all MS) · ATP published: **0** · WTA detected: 15 match + 3 ranking · WTA published (7 d): 5.

## Why ATP is at zero — classification of every detected ATP event

All 22 ATP candidates: **below materiality threshold**, and the threshold was unreachable because of code, not
because the matches were immaterial:

1. **Missing ranking context (by construction).** `workers/tennis-news/src/index.js:68` (at HEAD 0af2041):
   `const ranks = ms[0].event_type === 'MS' ? new Map() : await rankAt(...)`. An MS match never received a rank,
   so the rank-driven kinds (`upset`, `walkover`, `dominant`, `retirement`) and the top-10/top-20 bonuses could
   never fire for men. Only rank-free kinds (comeback, deciding tiebreak, seed upset) were emitted. The list it
   would have used was also wrong for men: `index.js:66` chose `wta_singles` for every non-WD event.
2. **Level-less editions weighted as the lowest bucket.** `detect.js:22` `tourWeight(level)` returns 5 for a
   null level; ESPN (the secondary ATP source) publishes no tournament level, so every non-Slam ATP edition
   scored like an unknown event. Outside the Slams no MS event could reach 60 (an ATP final title scored 53).
3. **Ranking stories WTA-only.** `index.js:80` looped `['wta_singles']` only: ATP ranking milestones were never
   detected. Separately, every deterministic ranking article failed its own gates (`compose.js:147` printed
   "career-best", banned by `unsupported_first_or_record`, and "Top 10" whose 10 was not a packet number), so a
   ranking story could only publish through model prose — for either tour.
4. **Men's doubles never detected.** `index.js:60` loaded `event_type=in.(WS,WD,MS)`: MD and XD were excluded
   while WD produced 3 of the 5 published stories.
5. **Wrong desk (latent).** `compose.js:21` mapped `MS: 'grand-slams'`; any men's story that had passed would
   have been filed under Grand Slams.

Not the cause in this window: scheduler starvation (no ATP event ever reached `detected`, so none waited in the
claim queue), packet unavailability, gate failures, source unavailability (22 fresh MS results were in the graph).

## Fix (tennis-news 1.2.0, detector 1.1.0, compose 1.1.0)

- Tour-aware lists: WS -> wta_singles, MS -> atp_singles, WD -> wta_doubles, MD/XD -> none held (never a singles
  list for doubles). Provenance (`source_family`, official vs secondary, list depth) travels in facts + packet.
- A winner missing from a top-N extract (ESPN ATP lists hold the top 100-150) is "outside the top N", never
  "unranked"; the gap assumes rank N + 1.
- ESPN ATP league editions (ATP Tour only, no Challengers) weigh as the tour floor (10 = a WTA 250), not 5.
  Remaining asymmetry: without a level source an ATP 500/1000 still weighs as a 250 (a reviewed ATP tier
  registry would lift it); nothing is published as a level.
- Ranking milestones for `wta_singles` and `atp_singles`; lists dated in the future wait for their date.
- Desks: any Grand Slam event -> grand-slams; MS -> atp; WS -> wta; MD/WD/XD -> doubles.
- ATP (ESPN) lists and results are never called official (compose wording + new `unsupported_official_claim` gate).
- Tour-fair claim: slot 1 highest materiality, slot 2 best of the other tour, slot 3 next overall; RPC fallback.
