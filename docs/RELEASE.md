# Release

## Gate (all required)

`npm run check` PASS · canaries PASS or explicitly degraded · `npm run qa` PASS at 1440/1024/430/390/360/320
(no horizontal overflow, no console errors) · no approved photo broken or wrong · no provider secret in
the bundle · no placeholder pretending to be data · canonicals, sitemap, robots, metadata valid ·
zero-live-matches state correct · a source outage does not crash the site · failing news stories HOLD.

## First deploys (each needs owner approval)

1. **Supabase:** apply `supabase/migrations/20260926000100_tennis_core.sql` to the sports project after
   verifying the target ledger (replay the target's applied chain, not repo HEAD).
2. **Cloudflare:** create KV `TENNIS_STATE`, R2 `tennis-source`; set secrets; per Worker
   `wrangler versions upload` → hit the preview URL `/health` → `wrangler versions deploy`. Capture the
   version id + rollback id in `docs/STATUS.md`. Run `POST /v1/runs` on tennis-ingest to get canaries
   from Cloudflare egress (it can differ from the workstation run).
3. **Vercel:** new project from `LHBUSA/tennis` main, build `npm run vercel-build`, output `dist`;
   attach `tennis.propbetedge.ai` only when the site has real public content.
4. Only then: add Tennis to other properties' network footers.

## Rollback

Workers: `wrangler versions deploy <previous>`. Vercel: promote the previous deployment. Migrations:
forward-only fixes.

## Deploy log

| Date (UTC) | Component | Version | Rollback | Note |
|---|---|---|---|---|
| 2026-09-26 | Supabase tkmln | migrations 0100, 0200, 0300 | forward fix only | rollback-only proof first (42 tables, 42 RLS, 17 competitions, zero residue) |
| 2026-09-26 | tennis-api | f3046fad | 87efecc9 | detached-fetch fix; custom domain tennis-api.propbetedge.ai |
| 2026-09-26 | tennis-ingest | 9da8c78a | 84f7009e / b5ca794e / d993c1c0 | cursor-on-failure fix; yields live-owned editions |
| 2026-09-26 | tennis-live | c634e0ed | 4bc0aeeb (skeleton) | 18 s live polling |
| 2026-09-26 | tennis-model / tennis-news | 8598487b / bca67020 | — | skeletons |
| 2026-09-26 | tennis-ingest | e44a5264 | 2a9e0b60 | exact ranking counts, hold resolution, AO men, row-level fallback |
| 2026-09-26 | tennis-live | 59e89b03 | 3eb569df | shared writer changes |
