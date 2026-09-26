# Status — 2026-09-26

**PRODUCTION READY: NO.** Nothing is deployed. No customer-facing tennis data exists yet.

## Working (in repo, tested)

- Scoring engine (all TennisCast fixtures), participant model (singles/doubles/mixed), identity
  resolution + deterministic UUIDs, DNA v1 builder, envelope, polite source client, content-addressed
  archive, adapter isolation, change ledger, SourceMatch → CanonicalMatch normalizer.
- Adapters: WTA rankings (singles/doubles, historical), calendar, matches (live + results + doubles +
  qualifying + ret/w.o.), match stats; Wimbledon draws; AO day results (player registry); Wikidata
  crosswalk; Commons license; ProTennisLive PDF availability.
- Live canaries (workstation egress): 10 PASS, 2 BLOCKED (ATP, ITF). End-to-end: 357/358 live matches
  canonical; 1 contradictory source row held.
- Staged schema, proven on PGlite. Five Workers bundle (`wrangler deploy --dry-run`).
- Frontend shell: all brief routes, truthful NOT_CONFIGURED states, real /sources and /methodology,
  prerendered heads, sitemap/robots, six-viewport QA green.

## Blocked on the owner

1. **Source rights decision** (WTA / Wimbledon / AO terms restrict automated or commercial use) — gates
   all production ingestion. See `docs/TENNIS_SOURCE_MATRIX.md §Rights`.
2. Approval to apply the Supabase migration, create Cloudflare KV/R2/secrets, deploy Workers, create the
   Vercel project and attach the domain.
3. Repo visibility: `LHBUSA/tennis` is **public**; the evidence files contain small excerpts of
   captured WTA/Wimbledon payloads.

## Not started

TennisCast UI, Match Lab, H2H, Draw Explorer, player pages with data, rankings pages with data, newsroom
event graph, surface ratings, model, picks, Breakout Watch, media pipeline runs.
