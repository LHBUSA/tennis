# Status — 2026-09-26

**PRODUCTION READY: NO.** Data is flowing into production and the public API serves it, but the owner's
bar is not met yet: ATP/Challenger/ITF are not acquirable, historical backfill is in progress and not yet
validated, live scoring is observed at ~20 s granularity (not point-by-point), and no photos, model,
picks or newsroom exist.

## Decisions

- 2026-09-26 owner approved commercial use of technically accessible tennis sources (no access-control
  bypass). Recorded in `data/source-registry/sources.json` (`rights_decision`) and the source matrix.
- Owner approved applying the migrations, provisioning Cloudflare, deploying Workers and creating the
  Vercel project.

## Production

| Component | State |
|---|---|
| Supabase (tkmln, sports) | migrations `20260926000100` core, `…0200` schedule note, `…0300` player slugs — applied after a rollback-only proof, recorded in `supabase_migrations.schema_migrations` |
| KV `TENNIS_STATE` | `a117d7b3846c4a39a27ee74c49574c99` |
| R2 `tennis-source` | raw payloads + capture records; private Phase 0 audit at `audit/phase0-source-audit-2026-09-26.json` |
| `tennis-ingest` | cron `*/2`; calendar, active editions, stats, weekly rankings, backfill (2025-01-01 →), Wimbledon MS 2022-25, Wikidata crosswalk, AO registry |
| `tennis-live` | cron every minute; ~18 s polling of editions with a live match |
| `tennis-api` | `https://tennis-api.propbetedge.ai` — today, live, tournaments, tournament, match, players, player, DNA, rankings, H2H, sources |
| `tennis-model`, `tennis-news` | deployed skeletons (`/health`), no work |
| Vercel `tennis` | Git-connected to `LHBUSA/tennis` main; production builds behind Vercel deployment protection; **`tennis.propbetedge.ai` not attached yet** |

Rollbacks: see the deploy log in `docs/RELEASE.md`.

## Coverage today

- WTA Tour + WTA 125 + women's Slam events (singles, doubles, qualifying): matches, live state, results,
  retirements/walkovers, per-set serve/return statistics, weekly singles + doubles rankings.
- Men: Wimbledon singles 2022-2025 only (feed). No ATP tour/Challenger/ITF data path yet.
- Identity: WTA ids founding; Wimbledon/AO embedded tour ids; Wikidata QIDs + ITF/BJK/Davis ids attached.

## Not built

Photos pipeline runs, surface ratings, DNA snapshots table writes, PBE model, picks, grading, newsroom,
Breakout Watch, Doubles Lab pair metrics, Draw Explorer brackets, men's rankings.
