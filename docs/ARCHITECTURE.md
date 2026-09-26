# Architecture

```
public / first-party source ──► adapter (workers/providers) ──► raw evidence (R2, content-addressed)
        │                              │ parse → provider-neutral SourceRecords
        │                              ▼
        │                    normalize (workers/shared/canonical) ── identity graph (UUIDv5 from founding tour id)
        │                              ▼
        │                 Supabase canonical tables ── source-change ledger ── coverage ledger
        │                              ▼
        │          Tennis DNA / surface ratings / pair snapshots (versioned, exclusive as_of)
        │                              ▼
        │              PBE model ─► locked picks ─► grades ─► Track Record
        │                              ▼
        └──────────────► tennis-api (Worker) ─► Vercel static frontend (browser)
                                       ▲
               tennis-live (KV live state, same event contract as replay) · tennis-news (evidence → gates → publish)
```

## Platform

| Layer | Owns | Never |
|---|---|---|
| GitHub | source, backup, docs, evidence | schedules (no Actions) |
| Vercel | static `dist/` (prerendered heads, SPA shell) | Functions, crons, provider calls |
| Cloudflare Workers | `tennis-api` reads; `tennis-ingest` acquisition; `tennis-live` live state; `tennis-model`; `tennis-news` | secrets in responses |
| Cloudflare KV / R2 | live state + run ledgers / raw payloads + capture records | canonical truth |
| Supabase (sports project) | canonical relational records | browser access (RLS on, no client policies) |

Production must be reconstructible from Git + the documented Supabase / Cloudflare / Vercel config.

## Adapters

Contract: `workers/shared/adapter.js`. Every adapter is `{ key, family, capabilities, parser_version,
cadence, request(params), shape(body), parse(body, meta) }`. `shape()` is the parser-shape monitor:
drift → `DEGRADED` and nothing is parsed. `runIsolated()` wraps each adapter in `allSettled` + a timeout,
so an ITF failure never stops Wimbledon. Provider-specific codes stop at the adapter; unobserved codes are
warnings, never guesses.

## Source hygiene

`workers/shared/http.js`: honest User-Agent, per-host minimum interval + concurrency, jitter from
`crypto.getRandomValues`, exponential backoff honouring `Retry-After`, `If-None-Match` /
`If-Modified-Since` reuse, timeouts. A 403 or a challenge page (Cloudflare, Incapsula, PerimeterX, Akamai
markers — including challenge pages served with HTTP 200) raises `SourceBlockedError` and is never
retried around. Cadence classes: `dynamic` (active match 15 s → today 5 min → idle 1 h), `event_window`,
`daily`, `weekly`, `on_final`. Completed matches get one final reconciliation, then archive.

## Raw evidence

`workers/shared/archive.js`: payload at `tennis-source/<family>/sha256/<aa>/<sha256>` (put once);
a capture record per request at `tennis-source/<family>/captures/<date>/<capture_id>.json` with request
identity (method + sorted-query URL), HTTP metadata, hash, bytes, parser + normalization versions.
Canonical rows point at `capture_id`, so any number can be traced to bytes and reparsed.

## Identity

`docs/TENNIS_IDENTITY.md`. UUIDv5 from the founding tour id (`atp:S0AG`, `wta:324166`) → the graph is
rebuildable from the archive, and a Slam feed row carrying `atps0ag` lands on the same UUID as a tour row
without any name matching.

## Cloudflare resources (to create at first deploy, with approval)

KV `TENNIS_STATE` (live state, run ledgers) · R2 `tennis-source` (raw evidence) · Secrets:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (api/model/news), `INGEST_ADMIN_TOKEN` (ingest).
Queues for live fan-out when `tennis-live` gets a real source.
