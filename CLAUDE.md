# PropBetEdge Tennis — repo instructions

`tennis.propbetedge.ai`: global professional tennis intelligence — men's and women's, singles, doubles and
mixed, every tour from ITF to the Grand Slams — on a canonical data graph PropBetEdge collects, normalizes
and owns. One product, one identity graph. ATP and WTA are namespaces inside it, never separate sites.

Read before changing anything: `docs/STATUS.md` (what is real today), `docs/ARCHITECTURE.md`,
`docs/TENNIS_SOURCE_MATRIX.md`.

## Doctrine (non-negotiable)

- **GitHub** = source + backup. **Vercel** = static frontend only (no Functions, no crons).
  **Supabase** = canonical system of record (sports project, tkmln). **Cloudflare** = APIs, ingestion,
  normalization, live runtime, queues, cron, intelligence. KV = live state; R2 = raw evidence.
- **Never add GitHub Actions** (owner policy). Schedules are Cloudflare Cron.
- The browser talks only to `tennis-api`, only through `src/data/api.js`. No provider or Supabase calls
  from the browser, no secrets in the bundle.
- **$0 data licensing.** We build the data layer; we do not rent it. Commercial feeds are
  `COMMERCIAL_REFERENCE_ONLY` and are never listed as a blocker. When a field is missing, find where the
  official site gets it, whether it is embedded, derivable, or available from another authoritative
  public source — before recording a gap.
- **Access boundary.** No auth bypass, challenge/CAPTCHA defeat, paywall circumvention, UA spoofing,
  IP rotation or evasion. Blocked = record it and find a legitimate path. Every fetch goes through
  `workers/shared/http.js` (honest UA, per-host rate limit, backoff, conditional requests).
- **Rights are an owner decision.** Official WTA/ATP/Slam terms restrict automated/commercial use; no
  production ingestion or canonical writes from those sources until the owner decides (see matrix).
- **Missing stays missing.** Never invent a score, player, ranking, photo, match, tournament, market,
  odds, pick, injury, source or retirement reason. `null` / `UNAVAILABLE` beats false confidence.
- Main only. Test → commit → push immediately. Ask before: applying Supabase migrations, creating
  Vercel/Cloudflare resources, first production deploys, adding Tennis to other properties' footers.

## Code map

| Path | What |
|---|---|
| `workers/shared/canonical/scoring.js` | Pure scoring engine: point → game → set → match; tiebreaks, match tiebreak, no-ad, advantage sets, retirement, walkover, suspension; score parse/validate/format; monotonic-progress guard |
| `workers/shared/canonical/participant.js` | Teams of one or two. `S:<uuid>` / `D:<uuid>+<uuid>` (sorted) |
| `workers/shared/canonical/identity.js` | Name folding, alias keys, deterministic resolution (external id, or name+DOB unique), UUIDv5 minting from founding tour id |
| `workers/shared/canonical/normalize.js` | SourceMatch → CanonicalMatch; the only door into canonical rows |
| `workers/shared/dna/metric.js` | Tennis DNA v1 definitions + builder (summed ratios, exclusive as-of, null propagation) |
| `workers/shared/{http,archive,adapter,change-ledger,envelope,health}.js` | Polite client, content-addressed R2 archive, adapter contract + isolation, source-change diff, response envelope |
| `workers/providers/*.js` | One adapter per upstream: `wta`, `slams` (Wimbledon, AO), `open` (Wikidata, Commons, ProTennisLive) |
| `workers/tennis-{api,ingest,live,model,news}` | Worker entrypoints (none deployed) |
| `supabase/migrations/` | Staged schema, proven on PGlite by `tests/migration.test.js`; NOT applied |
| `src/` | Vite shell: router (`src/lib/routes.js` is the route authority), pages, SEO, network registry |
| `data/source-registry/sources.json` | Audited source registry (guarded: PASS needs evidence) |
| `docs/evidence/` | Canary run summaries (counts/hashes only). Raw captures live in private R2, never in this public repo |

## Commands

`npm run check` (guard + tests + build; also the Vercel build) · `npm test` · `npm run guard` ·
`npm run canary [prefix]` (live read-only source canaries) · `npm run matrix` (regenerate the source matrix)
· `npm run qa` (1440/1024/430/390/360/320 overflow + console QA; needs a build and local Chrome).

D: is exFAT: wrangler/Vite on D: may need `NODE_OPTIONS="--require D:/Workers/exfat-readlink.cjs"`.

## Adding a source

1. Probe the real system (page source, hydration JSON, XHR) with honest requests; record robots + terms.
2. Write an adapter in `workers/providers/` (`request` / `shape` / `parse`), parse into provider-neutral
   SourceRecords only. Map only codes you have observed; unknown codes become warnings.
3. Add a trimmed real capture to `tests/fixtures/` and parser tests; run it through `normalizeMatch`.
4. Add it to the canary plan + registry; `npm run canary && npm run matrix`.

## Product rules that bind code

- Doubles is first-class: never collapse a pair into a single-player row. Scoring is side-based.
- TennisCast shows observed points only; never reconstruct points from a final score. State never moves
  backward without a documented correction (`assertNoRegression`).
- Every derived number is a DNA metric object (numerator, denominator, sample, confidence, coverage,
  definition_version, source families, exclusive as_of). No metric without a documented formula.
- Market truth ≠ model truth. Never label consensus as PBE probability; never fabricate a price (-110).
- Picks lock before start and are append-only (DB trigger). ROI only on real recorded prices.
- Newsroom: evidence packet → gates → publish; failing stories HOLD. No unsupported number in prose.
- Photos: rights-safe licenses only (CC0/PD/CC BY/CC BY-SA), identity-proven, reviewed focal box; no
  approved photo → initials identity card. Never a wrong athlete, never an AI likeness.
- No claim of any official relationship with a tour, federation or tournament; no tour trade dress.
- Projections are labeled `PBE PROJECTED RANK`, never "ATP/WTA ranking".
