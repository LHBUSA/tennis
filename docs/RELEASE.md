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

## Current production (2026-09-28 13:00 UTC)

| Component | Current | Rollback target |
|---|---|---|
| Vercel `tennis` (tennis.propbetedge.ai) | main HEAD — this docs commit on top of ac58f10 (ac58f10 = `dpl_9Nu5cZfbDNMiXN9DV6DP5183sU6W`) | `dpl_9Nu5cZfbDNMiXN9DV6DP5183sU6W` (ac58f10), then `dpl_F3CxdfsLu57sAHAMtAontuesuk4V` (e21d468) |
| tennis-web | 8d6db251-db10-44ff-b664-492d046a4741 | 6334502d-2f1d-4286-8124-c45a35d4bd52 |
| tennis-api | bdf4fa97-dd15-421a-983f-3b9b109ff9ac (0.5.0: match_dna.by_surface, edition draws + surface_provenance, inList encoding) | b62a1197-7797-4b6e-b504-8154746fa1f2 (0.4.2) |
| tennis-ingest | 8ec09873-52dc-43f1-baef-0f22b97a3ffe (Phase 5: context lanes, batched writer, memory-safe + incremental DNA) | 3424ea51-284a-4105-b780-03baf5de8a97 (pre-Phase-5; ignores dna2:mode, OOMs on the current ledger — prefer a forward fix) |
| tennis-live | 26ac259c-3592-4f56-843e-5551796ee719 (INGEST_ADMIN_TOKEN rotated 2026-09-28) | do not roll back past 26ac259c (restores the rotated token) |
| tennis-news | 786c7d6e-45ee-4ad2-a08d-9c03ad4c6585 (**PUBLISH**; packet pinned to DNA v1) | 9d9976ae-e487-4dda-8833-f4161feb1b51 |

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
| 2026-09-27 | tennis-ingest | 38e2cf31 → 11fa7b16 → 9065e06e → 03f3c782 → 55db60c4 → de5af15c → dd547b88 | 29c78a5b | ESPN ATP lane (espn_atp priority, espn_rankings rotating), identity step 4, RG doubles round fix, source-duplicate aliasing, athlete 400, Slam RR refusal, Slam edition date fill |
| 2026-09-27 | tennis-api | c97e6efc → 4ae09219 → f30fa17c → 32778351 | 43ab9ef8 | ESPN ranking semantics; /v1/men + /v1/men/players bounded rewrite (postgrest 400 fix) |
| 2026-09-27 | tennis-ingest | 87cf8aa4 → 52a92ce2 → 99c6076a → d29d228c → 2a3dbb91 | 29c78a5b | Tennis DNA v2 build (lane dna_v2 + daily step, cpu_ms 300000); ranking 5xx source-error rule |
| 2026-09-27 | tennis-api | 693a4f95 → 1cc59769 → 8b5a0bec → faa97c86 | 43ab9ef8 | v1 readers pinned to definition_version 1; match_dna + v2 leaders; player rankings/matches ordering |
| 2026-09-27 | tennis-news | 786c7d6e | 9d9976ae | DNA packet pinned to definition_version 1 |
| 2026-09-27 | Vercel | main e9e8867 → 8cc1ab2 | previous main deployment | men's directory (ATP secondary list + Slam performance), error-vs-empty states, rankings hub, Match DNA player pages + DNA hub |

| 2026-09-27 | tennis-ingest | 2c847ddb → 6b50aaaf → cd0b48cb → 80626532 → b7bb32b6 → 378789fb → 28091310 → 7a11da5d → efe93023 → 3424ea51 | 2a3dbb91 | espn_wta + espn_wta_rankings, wta_history (sharded), dedupe fixes + self-heal, ESPN lists dated to effective Monday |
| 2026-09-27 | tennis-api | b62a1197 (0.4.2) | faa97c86 | ESPN list semantics (effective Monday) |

| 2026-09-28 | Supabase tkmln | migration 20260928000100_tennis_context_layer applied (owner-approved) | — | additive tables |
| 2026-09-28 | tennis-ingest | 3fe712aa … 8ec09873 (16 deploys) | 3424ea51 | completion ledger, context jobs, WTA records, ESPN extras, edition merge, draw-sheet route, batched writer, DNA memory + incremental |
| 2026-09-28 | tennis-api | 1814d765 (0.5.0) → 248cc6e5 → bdf4fa97 | b62a1197 | surface DNA, draws, inList encoding |

## Incidents

**2026-09-28 00:24-00:26 UTC — tkmln PostgREST 503/520/521/525 (PGRST002), all tennis reads failed ~2-3 min.**
Cause: our own load — 8 concurrent wta_history admin shards (~4k store requests per run each), the espn_extras lane,
the edition-merge lane and a 64-chunk SQL dump through the Management API at once. Recovered ~20 s after the load
was stopped. NFL / UFC share tkmln and may have seen the same window. Changes: shard drivers with a circuit breaker
(3 store failures stop all shards), a production read watchdog during backfills, max 5 heavy writers, no SQL dumps
while backfills run; the history writer later went from ~450 to ~40 store requests per page (writeGroups).

**2026-09-28 02:15-04:30 UTC — 4,392 WD + 7 WS duplicate canonical matches.** The batched writer's candidate query
filtered by participant key; `inList` did not URL-encode, so doubles keys "D:a+b" arrived as "D:a b" and matched
nothing. Fixed (inList encodes + & # % and spaces; 4897b04), repaired by a logged merge (4,399 rows,
tennis_source_changes duplicate_merged / repair), 2,967 stale holds resolved. 0 duplicate groups after.

**Credential hygiene 2026-09-28:** a prefix of INGEST_ADMIN_TOKEN appeared in a local process listing; the token was
rotated on tennis-ingest and tennis-live.
