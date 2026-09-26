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

## Current production (2026-09-26 23:30 UTC)

| Component | Current | Rollback target |
|---|---|---|
| Vercel `tennis` (tennis.propbetedge.ai) | main HEAD — this docs commit on top of ac58f10 (ac58f10 = `dpl_9Nu5cZfbDNMiXN9DV6DP5183sU6W`) | `dpl_9Nu5cZfbDNMiXN9DV6DP5183sU6W` (ac58f10), then `dpl_F3CxdfsLu57sAHAMtAontuesuk4V` (e21d468) |
| tennis-web | 8d6db251-db10-44ff-b664-492d046a4741 | 6334502d-2f1d-4286-8124-c45a35d4bd52 |
| tennis-api | 37331ed5-76e2-48fd-9975-b74787e8b668 | 9d1429c8-24c8-4b31-bf94-925e2bd574f4 |
| tennis-ingest | 76604c7d-1bfb-4db3-b5cc-9addb7784e0d | abdf960a-ff9b-4e89-beaf-aa1010589cdb |
| tennis-live | 3cfd7fd6-e635-4d55-aeab-4849200e0096 | c38a77b3-1d6a-49ff-ad46-6eeddec98068 |
| tennis-news | c5b5e942-43a7-4d9d-afde-a833b03658ea (**PUBLISH**, owner-approved) | 847e4338-dd3b-43b7-bd37-a09c6377457c (shadow) |

Rows below are the historical deploy log; the table above is authoritative for what is running.

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
| 2026-09-26 | tennis-api | 747792c0 | 67120e95 | registry truth (evidence for every claim; Wimbledon archive DEGRADED; ProTennisLive duplicate removed) |
| 2026-09-26 | tennis-ingest | abdf960a | ae972ba5 | AO opening-server fix (MQ206), point-feed hold retry, PBP batch 20 |
| 2026-09-26 | tennis-ingest | 76604c7d | abdf960a | backfill cursor never skips a blocked edition; bf:wima reset to 2016 |
| 2026-09-26 | Vercel | dpl_EcNXmY5uZuK5UK17BVBLR786Kdz7 (f365f75) | dpl_5Dw2PDZ5NQDzQmvQbiXkCJdKcGXk | builds green again after c403ca4 (registry evidence) |
| 2026-09-26 | tennis-api | 9d1429c8 | 747792c0 | /v1/men + /v1/men/players; schedule gender filter |
| 2026-09-26 | tennis-web | 588b151b → d79cf4bb | 825f1fd9 | sitemap from the route table + men's profiles/editions; men's heads never mention a ranking |
| 2026-09-26 | Vercel | dpl_EJPAgTUg9iFWvPX3cjwMKNhYNPit (efdde5f) | dpl_6fuAg99Tam8ASYSB1JhVM1osxgzk | /men, Men + News in nav, homepage men/women balance, players/schedule filters, rankings hub |
| 2026-09-26 | tennis-news | c5b5e942 | 847e4338 | NEWS_PUBLISH_ENABLED=true (owner-approved); 3 stories republished through the same gates |
| 2026-09-26 | tennis-api | 37331ed5 | 9d1429c8 | /v1/slams (tournament-first, all five events) |
| 2026-09-26 | tennis-web | 6334502d → 8d6db251 | d79cf4bb | /news indexable in sitemap; app shell cached 30 s (deploy-skew fix) |
| 2026-09-26 | Vercel | dpl_9Nu5cZfbDNMiXN9DV6DP5183sU6W (ac58f10) | dpl_EJPAgTUg9iFWvPX3cjwMKNhYNPit | one Tennis product (Men out of nav; activity-first homepage); ssr heads kept on first load |
