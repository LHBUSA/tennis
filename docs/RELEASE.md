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

## Current production (verified live 2026-09-28 17:10 UTC: wrangler deployments status per Worker, Vercel production list)

| Component | Current | Rollback target |
|---|---|---|
| Vercel `tennis` (tennis.propbetedge.ai) | app code a30a570 (`dpl_4UZiabQJvbCoV5vEZuvsSohyDiEm`); later docs/evidence-only commits on main rebuild the same app | `dpl_ATqPbq3cci5PHH2oLUpjzDGjZgt9` (18e5537, Phase 6), then `dpl_HSTZnpH2UevGsqjusmxUTGzfgT7Z` (f70b1c4, pre-Phase-6) |
| tennis-web | bcb45c39-33f4-42f6-8004-3acf7a03ccff (since 2026-09-27 01:10; this table said 8d6db251 until 2026-09-28 — corrected from the live deployment) | 2b611570-99c2-4a91-8a37-4e315e0290f3 |
| tennis-api | ceba8a94-329f-4261-b381-4867a112031a (0.6.0: /v1/matchups, /v1/matchups/:id, /v1/players-to-watch, match_dna.profile, stable paging) | bdf4fa97-dd15-421a-983f-3b9b109ff9ac (0.5.0) |
| tennis-ingest | 13dafdd3-8d6d-44ae-9231-2b6529e529f9 (Phase 6: fixtures + 2-day lookahead, profile/watch/calibration, retention, natural_key writer, per-edition isolation) | 37ea192e-ea4c-4f4f-9a86-cc3f64c546f7 (Phase 6 without the isolation fix), then 8ec09873-52dc-43f1-baef-0f22b97a3ffe (Phase 5; writes no natural_key -> run scripts/ops/natural-key.sql after a rollback) |
| tennis-live | 26ac259c-3592-4f56-843e-5551796ee719 | forward fix only (earlier versions predate the 2026-09-28 admin-token rotation) |
| tennis-news | 786c7d6e-45ee-4ad2-a08d-9c03ad4c6585 (PUBLISH; packet pinned to DNA v1) | 9d9976ae-e487-4dda-8833-f4161feb1b51 |
| Supabase tkmln | migration 20260928000200 applied + unique index tennis_matches_natural_key (valid) | forward fix only (drop index concurrently would restore pre-6 behaviour) |

All rollback targets above were confirmed to exist (`wrangler versions view`, Vercel `isRollbackCandidate`) on 2026-09-28.

## Operations notes

- **Long admin runs:** an admin lane run (e.g. `dna_v2`) can complete even when the HTTP request times out or its
  response never arrives (observed for runs over ~5-8 min). The KV result is authoritative: `lane:<name>.last_ok`,
  and for DNA `dna:v2:summary.built_at` / `dna:v2:watch:current`. Do not re-run a long lane because the request failed;
  read KV first. Request limits are unchanged by design.
- **Storage watch (observe only, no new cleanup policy):** `node scripts/ops/storage-report.mjs` weekly ->
  `docs/evidence/storage/<date>.json` (size, index size, estimated rows, dead rows, 7-day growth). Baseline 2026-09-28:
  database 8,648 MB; tennis_dna_snapshots 457 MB, tennis_matches 356 MB.
- **DNA snapshot retention (authoritative: the POLICY, not a date list).** Retention preserves the latest 14
  successful daily DNA snapshots independently for each DNA version, plus the designated monthly archive snapshots and
  the latest snapshot. Missing build days do not reduce the number of daily snapshots retained. Implementation:
  tennis-ingest cron step `dna_retention` (after the day's DNA build) and the admin lane `dna_retention` (`--write 1`)
  both call `runRetention` (workers/tennis-ingest/src/dna-retention.js), which computes `retentionPlan` for each
  definition version from that version's own stored dates BEFORE its first DELETE and deletes only planned dates:
  newest (`'newest'`), the latest 14 stored dates (`'daily'`, a count), the earliest stored date of every month
  (`'monthly'` archive, additional to the 14), per-version delete filter `definition_version=eq.<v>`, at most
  `MAX_DATES_PER_RUN = 3` dates per run shared across versions. Corrected 2026-09-28 from a 14-calendar-day window
  (no production delete ever ran under the old rule). Projection from the real date list on 2026-09-28, assuming one
  successful build per day (NOT a requirement; missed builds move it later): first deletion 2026-10-10 (v1 2026-09-26),
  2026-10-11 (v1 + v2 2026-09-27), 2026-10-12 (v1 + v2 2026-09-28). Proof: `scripts/ops/retention-proof.mjs` plan /
  verify; the job's own result is KV `dna:retention:last`.
- **Phase 6 status:** live; COMPLETE only after the real fixture lifecycle check (2026-09-29 matches) passes and the first
  real production retention deletion (projected 2026-10-10) has happened with post-delete invariants passing. Frozen: no Tennis feature work until then.

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

| 2026-09-28 | Supabase tkmln | 20260928000200_tennis_match_natural_key (owner-approved) + ledger rows for 0928000100 (was applied unrecorded) and 0928000200; 685,994 keys backfilled in 35 batches; 0 duplicate groups; unique index built CONCURRENTLY (102 MB, valid) | forward only | |
| 2026-09-28 | tennis-api | c79af9be / 4ebfb7f1 (uploaded, 0%) -> ceba8a94 100% | bdf4fa97 | version canary 34/34 (existing routes byte-equal to production; leaders deterministic = DB count 2190) |
| 2026-09-28 | tennis-ingest | 803b7e29 (uploaded) -> 37ea192e 0% (override-only measurement: full no-write build 55.6 s CPU / 288 s wall) -> 37ea192e 100% -> 13dafdd3 100% | 8ec09873 | first Phase 6 DNA build 15:42 UTC: 37,386 snapshots with profile, 54,149 surface ratings, calibration, watch (weekly edition 2026-09-28 frozen) |
| 2026-09-28 | Vercel | dpl_ATqPbq3cci5PHH2oLUpjzDGjZgt9 (18e5537) -> a30a570 | dpl_HSTZnpH2UevGsqjusmxUTGzfgT7Z | Matchups, Players to Watch, Player DNA profile + charts |

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

**2026-09-28 (found in Phase 6 canaries) — nondeterministic DNA leaderboards.** Paged leader reads had no ORDER BY, so offset
pages skipped / repeated rows: the WTA PBE Rating leaders' qualified count read 2068-2467 on consecutive requests (true
2190). Fixed in tennis-api 0.6.0 (allRows requires an order; leaders ordered by pbe_player_id).

**2026-09-28 16:02-16:15 UTC — matches step statement timeouts (57014).** One active edition's candidate query timed out
while heavy build writes were finishing; because the step looped editions without isolation, every edition after it
(including two that started that day) was skipped. Transient (did not recur, the same query measures 4-38 ms), but
the step now isolates editions (tennis-ingest 13dafdd3) and keeps the failing query for diagnosis.

**Flaky test (build dpl_GkmnJpEgkiYmrsii3NXkwjyp9x2A).** The concurrent-writer race test assumed the race would happen;
one Vercel build ran the writers serially. Now deterministic (barrier store, 34e8a00).
