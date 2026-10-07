# tennis-api contract

Every response:

```json
{ "ok": true, "data": {}, "meta": { "data_source": "PropSports", "source": [], "fetched_at": "", "source_updated_at": "", "age_s": 0,
  "freshness": "CURRENT", "semantics": "", "degraded": [], "deprecated": {} } }
```

Data brand (2026-10-03): `meta.data_source` is always `"PropSports"`. **Deprecated, compatibility only** (kept working;
removed in a future versioned contract): `meta.source` (upstream source families) and `data.external_ids` on player
documents (upstream crosswalk ids; use the PropSports canonical `data.id` / `data.slug`). `meta.deprecated` lists them.
`coverage` / `tour_coverage` carry customer-safe source labels; the upstream detail stays on the Sources page.

Freshness: `CURRENT | CACHED | STALE | UNAVAILABLE | ERROR | NOT_CONFIGURED`
(`workers/shared/envelope.js`).

Base: `https://tennis-api.propbetedge.ai`. Edge-cached per route (live 15 s … rankings 15 min).

| Route | Data |
|---|---|
| `GET /health` | version, dependency configured/not (never values) |
| `GET /v1/today` | editions in progress today + live, upcoming, latest results |
| `GET /v1/live` | matches in progress with source point score + server |
| `GET /v1/tournaments[?from&to&all=1]` | editions overlapping the window (tour levels unless `all=1`) |
| `GET /v1/tournaments/:slug/:year` | edition + every observed match |
| `GET /v1/matches/:id` | match + sets + statistics + observed changes |
| `GET /v1/players[?q=]` | search, or the current WTA singles list |
| `GET /v1/players/:slug` | identity crosswalk, ranking history, recent matches |
| `GET /v1/players/:slug/dna[?as_of&surface]` | Tennis DNA v1 singles, computed from stored statistics |
| `GET /v1/rankings?tour=wta&type=singles\|doubles[&date&limit&offset]` | official list as published + movement vs our previous archived list; ATP → `UNAVAILABLE` |
| `GET /v1/h2h/:a/:b` | singles meetings in the store |
| `GET /v1/sources` | registry + latest canary summary |
| `/v1/pbe-picks` `/v1/track-record` `/v1/odds` `/v1/news` `/v1/breakout-watch` `/v1/doubles/pairs/:id` | `NOT_CONFIGURED`, `data: null` |

Run ledgers: `tennis-ingest GET/POST /v1/runs` (POST needs `Bearer INGEST_ADMIN_TOKEN`),
`tennis-live /v1/live/runs` (last live cycle), `tennis-model /v1/model/runs`, `tennis-news /v1/news/runs`.

Change-only writes (2026-10-07): the match writer (tennis-ingest `writer.js`) writes a match / set / participant /
external-id row only when its content changed; `tennis_matches.updated_at` = the match (row, sets or participants) last
changed, and in-progress rows are rewritten on every pass (live heartbeat). Forced full reconciliation (every row written
exactly as before): automatically on the first tick from 04:00 UTC each day (KV `reconcile:day`), or on demand with
`POST /v1/runs?reconcile=1` (admin token). The time each edition was last confirmed with its source is KV
`obs:editions:ingest` + `tennis-live:last_run.observed`; tennis-api merges it into `tennis_matches.updated_at` at read time
(`store-heartbeat.js`), so response freshness (`meta.source_updated_at`, tournament `as_of`) is unchanged.
