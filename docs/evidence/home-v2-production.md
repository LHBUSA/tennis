# Tennis homepage visual V2 — production evidence (2026-09-29)

- Baseline: main `d16be91` (Vercel dpl_3CBX866rrehQHvC69tfYtEPx2uQ6 — rollback target). Baseline shots: `home-v2/baseline/` (1440: 6,807px, 390: 14,095px).
- Shipped: `1964cca` (V2), `5fb2a45` (no rail scrollbars), `cff8d39` (owner refinements + /news masthead CLS fix).
- Production: Vercel **dpl_6mKZexEDSiPf3wvk2sGhuvKbT7cy** (cff8d39) READY on https://tennis.propbetedge.ai.
- Target: the owner's mockup (section rows = intro column + horizontal rail; dark emerald hero; slim live bar). Built with real data only.

## Data map (every section → real source)
| Section | Source | Truthful fallback |
|---|---|---|
| Hero media | `/v1/slams` featured[0..1] with an APPROVED photo (Commons, license + credit shown); alternates the men's/women's champion by UTC day | court-art hero (no player) |
| Status rail | `/v1/today` live grouped per tournament | "No match live right now · N tournaments in progress · Next match <real clock time>" |
| Up next / Live | `/v1/today` live → upcoming → latest results | section hidden |
| Tournaments | `/v1/today` tournaments (live first) + latest 3 Slam editions | branded court art per SOURCED surface; ATP (ESPN publishes no surface/level) = neutral |
| Players to watch | Slam featured + ATP/WTA leaders interleaved (ATP labelled secondary-source) | monogram tile |
| Latest intelligence | `/v1/news` lead + 3 (newsroom's own cards + storyClock backfill freshness) | "no story published" note |
| Tennis DNA | `/v1/dna/leaders` 3 metrics × ATP/WTA, never pooled | held board: "Awaiting data threshold" progress bar of served qualified/threshold (ATP serve/return: 17 of 30) |
| PBEcast | `/v1/today` live (feature card) + `/v1/slams` replays as box scores | "no replay stored" note |
| Coverage & sources | `/v1/today` coverage object | — |
| Header pulse | `/v1/live` (polled 60s while visible) | hidden when nothing is live |

Mockup items NOT reproduced because we do not hold the data/media: rendered player art, city/venue photography, "Betting intelligence", "Analysis"/"Tennis DNA" story labels (only real story classes/types are shown).

## Browser QA (production, `node scripts/qa/home-visual.mjs`)
PASS 7/7 widths, 87 internal links 200. Per width: hero, one h1, primary CTA, status hydrated, all sections hydrated, no skeleton, no broken image, no SVG editorial image, no console error, no horizontal overflow, no runaway section, no visible rail scrollbar, every visible rail arrow scrolls both ways, CLS < 0.1.

| width | height | CLS | arrows |
|---|---|---|---|
| 320 | 7,492 | 0.014 | swipe |
| 360 | 7,206 | 0.016 | swipe |
| 390 | 7,052 | 0.032 | swipe |
| 430 | 6,857 | 0.017 | swipe |
| 768 | 6,077 | 0.001 | 5 ✓ |
| 1024 | 5,459 | 0.032 | 5 ✓ |
| 1440 | 4,076 | 0.001 | 4 ✓ |

Regression (production): V4 site 56/56, Newsroom V3 UI 154/154 (966 backfill clocks), DNA page parity 316/316, `npm run check` 398/398.

## Screenshots
`docs/evidence/home-v2/`: home-1440, home-1024, home-768, home-390, home-320, hero-1440, tournaments-1440, dna-1440 (full-page shots pin the sticky header for capture only).

## Known limitations
- ATP tournaments show no surface or level (the secondary source does not publish them) → neutral card art.
- No approved event/venue imagery exists → tournament cards use branded court art.
- The hero portrait is a 600px Commons portrait; hero media is hidden below 760px (text-first).
- Live pulse and live states verified hidden-when-nothing-live; no live match occurred during QA.
- Header live pulse polls the API (the browser never connects to Supabase directly).
