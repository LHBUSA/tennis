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


## PropSports service bridge

The named Cloudflare service entrypoint `PropSportsTennis` is for the PropSports API gateway after PropSports has validated its own API key and Tennis entitlement. It bypasses the consumer All Access membership check only for the 25 explicitly commercialized Tennis routes: the 10 core routes above plus schedule, sources, men, men/players, slams, PBEcast match, matchup board/detail, players-to-watch, DNA leaders, player profile, search, venue, match broadcast, and coverage.

It does **not** expose `/v1/news`, `/v1/odds`, `/v1/pbe-picks`, `/v1/track-record`, `/v1/breakout-watch`, or doubles pair profiles through PropSports. Those remain outside the service bridge until their product/data contracts are separately approved.
