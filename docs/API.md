# tennis-api contract

Every response:

```json
{ "ok": true, "data": {}, "meta": { "source": [], "fetched_at": "", "source_updated_at": "", "age_s": 0,
  "freshness": "CURRENT", "semantics": "", "degraded": [] } }
```

Freshness: `CURRENT | CACHED | STALE | UNAVAILABLE | ERROR | NOT_CONFIGURED`
(`workers/shared/envelope.js`).

| Route | Today |
|---|---|
| `GET /health` | live: version, build, dependency configured/not (never values), last run |
| `GET /v1/sources` | real: registry + latest committed canary run (`CACHED`) |
| `/v1/today` `/v1/live` `/v1/tournaments[/:id[/draws]]` `/v1/matches[/:id[/live\|points\|stats]]` `/v1/players[/:id[/matches\|dna\|rankings]]` `/v1/h2h/:a/:b` `/v1/rankings` `/v1/doubles/pairs/:id` `/v1/breakout-watch` `/v1/odds` `/v1/pbe-picks` `/v1/track-record` `/v1/news` | `NOT_CONFIGURED`, `data: null` |

Run ledgers: `tennis-ingest GET/POST /v1/runs` (POST needs `Bearer INGEST_ADMIN_TOKEN`),
`tennis-live /v1/live/runs`, `tennis-model /v1/model/runs`, `tennis-news /v1/news/runs`.
