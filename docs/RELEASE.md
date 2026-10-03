# Release


## Worker deploys: always through scripts/ops/deploy-worker.mjs (2026-10-03)

`node scripts/ops/deploy-worker.mjs <worker> --yes`. It refuses to deploy unless the tree is committed, local main equals
origin/main, and the commit currently in production is an ancestor of HEAD; it then uploads, checks the preview
`/health`, deploys, and records the rollback version. Added after one session's tennis-api deploy silently replaced
another session's for four minutes (17029cfb -> b2c4c8e1 -> e45b1109).

## 2026-10-03 Schedule freshness (Beijing ATP stall; docs/evidence/atp-live-incident-2026-10-03.md, addendum)

| Component | Current | Rollback target |
|---|---|---|
| tennis-ingest | `2b1ad8bb-6a30-41ca-b981-2d48c22f8511` 0.4.1 @ 0fb386b (ESPN current window re-read every 15 min; `freshness` step -> KV `freshness:schedule`, /health, /v1/runs, `tennis_schedule_stale` error log) | `c32e2997-cbb4-4b57-8d79-16f9b989806b` @ 77fde35 |
| tennis-api | `773cc5f2-7caf-4ef5-8296-3f9c90742a3b` 0.10.4 @ 0fb386b (/v1/schedule `tournaments[].freshness`, `data.freshness`, per-tournament `meta.degraded`) | `225b60f3-8ef8-4d34-bdba-ac3e055c6609` @ 0a36080 |

## 2026-10-03 Newsroom V5 editorial overhaul (docs/NEWSROOM_EDITORIAL_V5.md)

| Component | Current | Rollback target |
|---|---|---|
| tennis-news | `dd7f74f3-4742-4f70-b596-fec91b276f4a` 4.1.0 @ 77fde35 (editorial gate, angle, narrative writer, previews, overhaul queue) | `ee4d36a2` 4.0.5 -> `99c01dcc` 4.0.4 -> `b9ef3139` 4.0.3 -> `3308bdc9` 4.0.2 -> `ed260a82` 4.0.1 -> `6eb908c3` 4.0.0 -> `1769fe2c` 3.1.0 (pre-overhaul) |
| Vercel `tennis` | main (narrative article layout from d711275; backward compatible with legacy stories) | previous production deployment |

Deployed manually (upload -> preview /health -> versions deploy) because the production 3.1.0 deployment message named no
commit (deploy-worker.mjs refuses); base reconciled by hand: 3.1.0 = b18cb97, an ancestor of every 4.x commit, and no other
commit touched workers/tennis-news in between. Rewritten stories keep their prior headline/dek/body in `revisions`.

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

## 2026-10-01 DNA + Players UX release (verified live ~02:30 UTC)

| Component | Current | Rollback target |
|---|---|---|
| Vercel `tennis` | main 9caaa8e (UX release 624db55 = `dpl_H3w9Zrpq2oGUiUNCX2V31yvy1MRn`; 2fe144a Worker-only; 9caaa8e /players rAF fix) | `dpl_FjaEb1atoQd6y2LEPmPnza1S2Msb` (1395825) |
| tennis-api | `c0d3b5e6-c440-4b6f-8b77-9ffddeacc0f6` 0.9.3 @ main 2fe144a (cached-CORS fix) | `021d5cc2-f3d1-41c2-b2ce-0d56a0be1f04` 0.9.2 @ 624db55, then `35b7c968-d048-446f-a6cb-0c609d6da077` 0.9.1 (PropSports bridge 6f72289, deployed from its branch before the merge) |

- main now contains the PropSports service bridge (fix/propsports-service-bridge-20261001 @ 6f72289, fast-forwarded):
  tennis-api `main = src/worker.js` (PropSportsTennis entrypoint). Deploy tennis-api only from main.
- Public DNA preview (no membership): `/v1/dna/leaders?preview=1` for pbe_rating, match_win_rate, game_win_rate, max 5 rows
  (raw limit; the old capped comparison let limit=50 through). Everything else under /v1/dna and /v1/players/:slug/dna = 401.
- Edge cache: hits re-issue CORS for the current request (an Origin-less fill used to poison credentialed browser reads
  for the TTL). PBE Rating leaders use a DB fast path (WTA cold 42.2 s -> 1.4 s, identical board).
- Timings (scripts/qa/perf-players-dna.mjs, 6 s injected delay on /v1/slams, /v1/men/players and one DNA board):
  /players first rows 7,222 -> 485 ms; /players?gender=men 6,851 -> 638 ms; homepage DNA content 6,781 ms blank -> 349 ms
  (first leader rows 543 ms). Evidence docs/evidence/perf-players-dna-{before,after}-*.json.
- QA: scripts/qa/dna-fingerprint-ux.mjs (WIDTHS=390|768|1440; MOCK_DNA=1 = owner membership + /dna from the public PBEcast
  Match DNA). scripts/qa/dna-page-parity.mjs needs an entitled `pbe_session` (QA_PBE_SESSION or
  D:/Workers/secrets/tennis-qa-pbe-session); without one it exits 2 HOLD, never PASS.
- Closeout 2026-10-01 (no behavior change after Vercel 9caaa8e / tennis-api 0.9.3 c0d3b5e6):
  - 768 QA on the exact build (`WIDTHS=768 MOCK_DNA=1`, production API 0.9.3): 52/52 PASS
    (docs/evidence/dna-fingerprint-ux-final-768.json). 390 and 1440: 52/52 each (local-390 / local-1440).
  - Production smoke (real browser, no fixtures): homepage 6/6 DNA slots populated; /players ranking rows first,
    enhancements after (rankings 204-207 ms, men/players + slams from 236 ms); ?gender=men 150 ATP + 164 Grand Slam rows;
    ?gender=women 200 rows. Preview limit=5 200, limit=6 401, non-preview DNA leaders 401, /v1/players/:slug/dna 401.
  - Owner signed-in DNA proof (Carlos Alcaraz, Iga Swiatek, Aryna Sabalenka): **HOLD — no entitled browser session**
    (the only connected Chrome reports membership `free`). Not run, not claimed.
  - Authenticated parity gate `scripts/qa/dna-page-parity.mjs`: **HOLD_NO_SESSION** (no credential file). Not a PASS.
  - To close: sign in as owner in Chrome (or save the entitled pbe_session to D:/Workers/secrets/tennis-qa-pbe-session),
    then run the owner proof + `node scripts/qa/dna-page-parity.mjs`.

## Current production (verified live 2026-09-29 ~13:45 UTC after the ATP/WTA parity release; wrangler versions deploy per Worker, Vercel production list)

| Component | Current | Rollback target |
|---|---|---|
| Vercel `tennis` (tennis.propbetedge.ai) | main (parity release 6207869 = `dpl_6msrsN5zCzWoGew26robuC2GBr24`; later commits are Worker/QA/docs only and rebuild the same app) | `dpl_HD2KwkKBSQd2AMfmvAns6F8Mypqt` (0af2041, pre-parity) |
| tennis-web | 4dc6a144-b0a1-48a8-ad27-61bc3c54a009 (men's rank in heads/OG with secondary-source label; ATP players in sitemap) | bcb45c39-33f4-42f6-8004-3acf7a03ccff |
| tennis-api | 16a60626-dd8a-4b51-8041-f650a4ec1c39 (0.7.0: PBEcast match_dna + technical_dna, ATP tour in today/schedule/tournaments, profile 400 fix, v2 leaders in-database, /v1/live ESPN freshness + unlinked-row exclusion) | 70af8316 -> d87124a5 -> ceba8a94-329f-4261-b381-4867a112031a (0.6.0, pre-parity) |
| tennis-ingest | f8feb7a8-f5e2-4b17-a1c6-98c90f68dbea (0.4.0: espn_live discovery step + admin lane, ESPN lanes skip live-owned editions, writer never merges evented rows) | 18cc4f6a-f194-401a-9405-090851473a09 (pre-parity), then 4a84fdb1 |
| tennis-live | 608f1321-8344-4cea-ad0a-59c3798e0ea4 (0.3.0: tour-aware router wta / espn, round budget) | fdb6b9db, f1bbc38f; pre-parity 26ac259c-3592-4f56-843e-5551796ee719 (forward fix preferred: its bundled writer predates the self-heal) |
| tennis-news | f3684a0a-97b0-41b1-ad02-2c5491fc9494 (tour-aware desks, ATP ranking context + provenance, unsupported_official_claim gate, tour-fair claim) | 786c7d6e-45ee-4ad2-a08d-9c03ad4c6585 |
| Supabase tkmln | unchanged by the parity release (no migration) | — |

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

| 2026-09-28 | tennis-ingest | 4a84fdb1 (uploaded, version dry run: policy count-based, 0 eligible) -> 100% | 13dafdd3 | retention correction (owner-approved, retention-only); 289 tests; production dry run + proof plan 7/7 |

| 2026-09-28 | tennis-ingest | 18cc4f6a (dark probe: 7 active editions + 2 veteran histories, candidate sets identical to the old query) -> 100% | 4a84fdb1 | Seoul timeout fix; 4 ticks 0 errors; holds / external ids / natural keys unchanged |
| 2026-09-29 | tennis-api | d87124a5 (preview canary: ATP editions in today/schedule/tournaments, Djokovic/Zverev/Sabalenka profiles 200, PBEcast match_dna 12/12 on an ATP match) -> 70af8316 (leaders in-database, identical output, 44 s -> 3.7 s cold) -> 16a60626 (live: unlinked orphans excluded) | ceba8a94 | ATP/WTA parity |
| 2026-09-29 | tennis-ingest | dec6494c (candidate: espn_live dry run from CF egress resolved China Open + Japan Open editions) -> f8feb7a8 | 18cc4f6a | ATP live discovery; ticks complete 15-60 s, all steps ok |
| 2026-09-29 | tennis-live | f1bbc38f -> fdb6b9db -> 608f1321 | 26ac259c | tour-aware router; f1bbc38f failed one WTA edition per round (self-heal DELETE on append-only events) for ~5 min -> fixed in 4c821d3 |
| 2026-09-29 | tennis-news | f3684a0a (dry run: ATP candidates detected with atp_singles context) | 786c7d6e | tour-aware newsroom |
| 2026-09-29 | tennis-web | 4dc6a144 (preview heads: men's rank with secondary-source label) | bcb45c39 | one product |
| 2026-09-29 | Vercel | dpl_6msrsN5z (6207869) | dpl_HD2KwkKB (0af2041) | one product; one-product QA PASS, browser gate 147/147 |

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

**2026-09-28 — matches step 57014 (Seoul and others), ROOT CAUSE: query shape.** writer.js crossSource() found candidate rows
participant-first: PostgREST's `tennis_match_participants?...&tennis_matches!inner(edition_id)&...&order=match_id,side&limit=1000`
becomes an inner LATERAL with LIMIT/OFFSET (no join flattening) under ORDER BY match_id + LIMIT, so the planner either read
every historical participant row of the incoming players (Seoul: 60 keys -> 19,201 rows for 58 candidates) or walked the
whole participants primary key (114,649 buffers, ~1.1 s warm; 22.7 s cold for 3 editions) — over the 8 s authenticator
statement_timeout whenever the cache was cold or the database busy (pg_stat_statements: 13,375 calls, mean 296 ms,
max 7.9 s, ~62.6k buffers/call; timed-out calls are not recorded). Fix (18cc4f6a): edition-first — tennis_matches by
edition (index tennis_matches_edition) with `tennis_match_participants!inner(participant_key)` filtered to the incoming
keys, ordered by (edition_id, match_id), editions in groups of 8, keyset paging (no OFFSET). Generated query in production:
mean 28 ms, max 1.0 s, ~960 buffers/call. No index, no db-guard change. Evidence: scripts/ops/bench-candidate-query.mjs,
tests/candidate-lookup.test.js (0 differences vs the old query), `candidate_probe` lane.
