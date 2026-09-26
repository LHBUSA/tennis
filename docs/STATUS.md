# Status — 2026-09-26 (evening)

**PRODUCTION READY: NO** for the full owner bar (ATP Tour / Challenger / ITF match data and official ATP
rankings are not legitimately acquirable yet; the newsroom runs in SHADOW; the simulator is RESEARCH).
What is live is real, sourced and labelled.

## Production components

| Component | State |
|---|---|
| Vercel `tennis` | main = production (tennis.propbetedge.ai). SPA + prerendered static heads; data routes proxied to tennis-web |
| `tennis-web` | edge heads (title/description/canonical/robots/OG/X/JSON-LD incl. NewsArticle), 1200x630 cards (player, Player DNA, match, PBEcast, tournament, rankings, news), dynamic sitemap |
| `tennis-api` | public read API incl. `/v1/news` (published only; token preview), `/v1/pbecast/:id` (read-time corrections of append-only events), tour-scoped DNA (`?tour=atp|wta`) |
| `tennis-ingest` | cron */2: calendar, active editions, stats, rankings, DNA (daily + monthly history lane), identity (Wikidata P597/P536), backfill lanes: ranking history ↔ match history (Wimbledon archive → AO qualifying → AO match-centre stats + point-by-point → WTA calendar queue) |
| `tennis-live` | cron every minute; ~18 s observed-live polling |
| `tennis-news` | cron */2; **SHADOW** (`NEWS_PUBLISH_ENABLED=false`): detection + frozen packets + held drafts. **OPENAI SECRET REQUIRED** for model prose (`npx wrangler secret put OPENAI_API_KEY` in `workers/tennis-news`); without it the deterministic fact-safe writer is used or the story holds |
| Supabase (tkmln) | migrations 0100–0600 applied with ledger rows |

Deploy/rollback ids: `docs/RELEASE.md` and the commit messages on main.

## Coverage

- **Women:** WTA Tour + WTA 125 + women's Slam draws via the WTA API: live state, results, stats, rankings
  (history backfilling weekly to 2020), DNA (481 players with snapshots, 192 with medium/high metrics).
- **Men:** Australian Open 2026 (main draw, qualifying, doubles, mixed) with match-centre statistics and
  genuine point-by-point (reason + server-first score; no speed/rally/coordinates in the feed). Wimbledon
  draws archive 1979–2025 (MS, MD, QS) ingesting now; identity only through exact ids (Wikidata
  P4503→P536, same-match 2025 join, archive tourid) — unmapped players are held, never guessed.
- **Blocked / not acquired:** atptour.com + Infosys (Cloudflare challenge), US Open (edge tarpit), official
  ATP rankings (no legitimate source), ESPN (Disney ToU: commercial use + automated extraction banned →
  reference only, tennis-scoped owner decision pending). Adaptable next: Roland-Garros results API
  2018–2026, Davis Cup (ITF Stadion API, 1900+), ProTennisLive PDFs (ATP + Challenger draws, names only).
- **Photos:** 479 approved (policy tiers: live → today → fields → top 100 → top 200 → recent PBEcast →
  rest; tiled small-face detection and square-only approval added without weakening identity/licence/face
  gates). Live 2/2, today 152/264, WTA top-100 93/100. Men: pending the ATP Wikidata crawl.

## Product surfaces

PBEcast V2 (truth-mode badge, serve-indicator ball, tracked ball only from coordinates, engine-derived
break/set/match point, identity anchors, moment rail, intelligence strip, broadcast fullscreen; live entry
from the nav + live switcher) · Tennis DNA (WTA/ATP populations) · newsroom (/news desks + story pages,
shadow) · schedule, tournaments, players, rankings, H2H, venues, credits, coverage.

## Evidence

`docs/evidence/`: production-canary-latest (28 PASS / 1 WARN), photo-contract-latest (PASS, 0 approved photos
dropped), photo-pipeline-latest, news-shadow-latest (14/14 real candidates pass gates), sim-backtest-latest
(RESEARCH: fails vs coin at current depth), mens-coverage-latest.
