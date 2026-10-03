# Tennis newsroom V5 — editorial overhaul ("Prose leads. Data supports.")

Owner brief 2026-10-03. Standard: *if all the charts disappeared, would this still be an excellent tennis article?*

## Writer architecture

`FACTS (packet.js, frozen) -> STORY ANGLE (angle.js) -> NARRATIVE (editorial.js 5.x) -> VISUAL SUPPORT -> EVIDENCE`

- **Story angle** (`workers/tennis-news/src/angle.js`, pure): thesis + secondary threads (comeback, deciding tiebreak,
  title run, qualifier run, return pressure, serve control, break-point edge, pressure absorbed, upset, control,
  form turn; previews: rematch, qualifier vs, ranking gap, matchup), ordered beats, the turning points the evidence
  proves (stored sets/tiebreaks, observed games only — never reconstructed), the story tier and word target, and the
  visuals that prove the angle (chosen AFTER the angle).
- **Narrative** (`editorial.js` 5.x): the editor writes to the angle. Lead section has no heading; set-by-set
  chronology; "why" translates evidence into tennis; "what it means" looks forward. No shot/position claims (no such
  data exists). Each section may attach ONE visual + a 25-70 word interpretation (`visual`, `visual_note`). The
  templated deterministic baseline is no longer shown to the model. A corrective attempt edits the previous draft.
- **Visual support** (frontend `src/pages/news.js` narrative layout): the scoreboard (or a preview's matchup card)
  follows the lead; each attached visual sits inside its section with "Reading the data"; unattached modules go to a
  collapsed "All the data behind this story" appendix (nothing removed). Legacy stories render unchanged.

## Word targets (narrative paragraphs only)

| Tier | When | Min | Max |
|---|---|---|---|
| feature | full/deep class, singles titles, top-10 or top-two-seed upsets, previews | 650 | 1150 |
| news | other singles stories | 350 | 750 |
| doubles | doubles stories | 300 | 650 |
| ranking | ranking moves | 250 | 650 |

## Editorial acceptance gate (`editorial-gate.js`, tennis-editorial-gate/1.0.0)

Publication = factual gates (`gates.js`) AND this gate. FAIL on: `thin_prose`, `bloated_prose`, `mostly_structured`
(>= 3 visual blocks with < 110 prose words per block), `chart_without_interpretation`, `rhythm` (< 80 prose words
before a visual), `too_many_visuals` (> 4), `thin_lead`, `database_writing` (> 7 numbers per 100 words, >= 7 in a
paragraph — a scoreline or W-L record counts once — or a chain of short numeric sentences), `restates_numbers`,
`template_intro` (winner-beat-loser-score first sentence, metric lead), `no_story_angle`, `recap_no_development`,
`preview_no_argument`, `preview_prediction`, `conclusion_repeats_opening`, `duplicate_heading`, `template_headings`,
`unsupported_tactical`, `repeated_phrasing` (>= 3 six-word frames, names/numbers normalised, shared with >= 2 other
published stories; required provenance wording exempt).

Factual-gate precision changes made with V5 (each from a real false positive in the first production rewrites):
"historical" is not "historic"; "record" is banned only as a record claim (W-L / "the match record shows" allowed);
a scoreline is not chart narration and chart narration needs >= 5 figures; "not a prediction" is a disclaimer.

## Operations

- Rewrite one published story in place: `POST /v1/news/rewrite?slug=&write=1&attempts=1|2` (admin; trigger
  `admin_reedit`; writes only when every gate passes; same id/slug/published_at; revision keeps prior headline/dek/body).
  `dry=1` = one call, nothing written.
- Audit stored stories (no model call): `GET /v1/news/editorial-audit?limit=`.
- Previews: cron detects late-round singles matches (classify `preview`; max 3/run, 8/UTC day; `NEWS_PREVIEWS_ENABLED`),
  `POST /v1/news/previews?dry=1` lists candidates. Preview packets carry no model probability.
- Browser QA: `SLUGS=a,b LABEL=x node scripts/qa/editorial-narrative.mjs` (prose vs structured words, rhythm,
  interpretations, overflow, screenshots 1440/390).
- Cost: automatic new stories keep 1 attempt; the Tennis premium soft cap (300k tokens/UTC day) still applies — rewrite
  batches stop at the cap and continue the next UTC day.
