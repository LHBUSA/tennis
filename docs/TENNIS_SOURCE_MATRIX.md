# Tennis source matrix

Phase 0 source audit for PropBetEdge Tennis. The registry is `data/source-registry/sources.json`, the
latest canary run is `docs/evidence/source-canary-latest.json` (counts and hashes only), and the raw audit
(every probe, robots line and terms quote, 2026-09-26) is kept out of this public repo in private R2 at
`tennis-source/audit/phase0-source-audit-2026-09-26.json`. The tables
below are generated: edit the registry and run `npm run canary && npm run matrix`.

## Owner directive (2026-09-26): we build the data layer, we do not rent it

- **$0 data licensing / API cost.** No Sportradar, Stats Perform, Genius, Infront/TDI, SportsDataIO,
  RapidAPI, paid scores/rankings/odds. Commercial vendors are `COMMERCIAL_REFERENCE_ONLY`, never a blocker.
- Source order: official tour / federation / tournament public data and the endpoints their own sites
  render from → official rankings, draws, profiles → Wikidata/Wikimedia → secondary public sources only to
  reconcile gaps.
- **Access boundary.** No auth bypass, CAPTCHA/challenge defeat, paywall circumvention, identity spoofing
  or anti-bot evasion. A blocked source is recorded `BLOCKED_BY_ACCESS_CONTROL` and left alone; we look for
  another legitimate path (e.g. ATP ids arrive through Slam feeds and Wikidata, not atptour.com).
- Verdicts: `PASS` (proven by a real request this run), `DEGRADED`, `NOT_AVAILABLE`,
  `BLOCKED_BY_ACCESS_CONTROL`, `UNVERIFIED`, `COMMERCIAL_REFERENCE_ONLY`. The build guard refuses a
  PASS/DEGRADED verdict without canary or evidence-file backing.

## Headline

| Family | What PropBetEdge can acquire today | How |
|---|---|---|
| **WTA** (tour, WTA 125, qualifying, doubles) | rankings singles+doubles incl. historical weeks · calendar · every match with live point/server · per-set serve/return stats · player identity/DOB/history | `api.wtatennis.com` — the JSON API wtatennis.com renders from. No key, no challenge; flaky connections (retry). |
| **ESPN core API** (secondary, owner decision 2026-09-27) | ATP Tour + Slam results 2007→ (singles, doubles, mixed, Slam qualifying; round, seeds, score line with tiebreaks, ret/w-o), athlete bio/DOB, weekly ATP singles rankings (top 100-150, points, previous rank) 2007→ | `sports.core.api.espn.com` — one event request = a whole tournament. No surface, no ATP level, no match statistics, no Challengers. `site.api.espn.com` 403 (Akamai; not bypassed). Lanes `espn_atp` / `espn_rankings`; official sources outrank it. Discovery: `docs/evidence/espn-atp-discovery-latest.json`. |
| **ATP** (tour + Challenger) | draw PDFs only (names, no ids) | atptour.com / app.atptour.com / Infosys all challenge (Cloudflare/CloudFront 403). ProTennisLive `/posting/` PDFs are open. |
| **ITF** (World Tennis Tour) | nothing directly | Incapsula JS challenge on every path (served as HTTP 200). ITF ids exist on Wikidata (P599). |
| **Grand Slams** | Wimbledon draws/scores/players (all years probed) · AO day results, player registry, match centre with point-by-point (current edition) | Static feeds each site loads. US Open hung (recheck), Roland-Garros only in SSR payload. |
| **Team events** | pages reachable, results endpoint not yet found | Davis Cup / BJK Cup / United Cup |
| **Identity + media** | ATP/WTA/ITF/Davis/BJK id crosswalk; CC-licensed images with per-file license | Wikidata SPARQL (CC0) + Commons API |
| **Odds** | none free | `MARKET: UNAVAILABLE` by default; the product works without it |

**End-to-end parser status (live data, 2026-09-26):** 357 of 358 matches normalized to canonical rows
(WTA Singapore 51/51, WTA 125 Ankara 52/53, Wimbledon 2025 MS 127/127, LS 127/127). The one rejection was a
self-contradictory WTA row (`1178-2026-LD013`: 11 minutes, score "0-3", coded as a normal win) — held by
score validation, exactly as designed.

## Rights — owner decision (2026-09-26): APPROVED

The owner reviewed the terms quoted below and approved using the technically accessible official tennis
sources (WTA, Wimbledon, Australian Open, ATP/Challenger, ITF, Davis Cup, BJK Cup and other legitimate
sources) for PropBetEdge's own normalized data layer, analytics, Tennis DNA, models, predictions and
product. Conditions that remain binding:

- no bypass of authentication, CAPTCHAs, Cloudflare/Incapsula challenges or other access controls —
  a blocked source stays blocked and we find another legitimate path;
- full provenance on every record; raw responses archived privately (R2), never in this public repo;
- everything customer-facing passes through our own normalized contracts; every derived number is ours;
- re-raise only for a materially different issue: auth bypass, credential misuse, a takedown request, or a
  source that needs a paid/licensed credential we do not have.

## Technical blockers (not purchases)

1. ATP tour + Challenger live/results/stats: no open official path found. Next: map how ATP's own mobile
   app and tournament microsites load scores; test ProTennisLive Challenger ids; PDF text extraction.
2. ITF World Tennis Tour: Incapsula on itftennis.com. Next: tournament-run live-score sites and national
   federation feeds that publish ITF events.
3. Point-by-point beyond the AO match centre: find the Wimbledon/USO slamtracker paths the sites request.
4. WTA Race parameters; WTA API connection resets (patient retries work).
5. Davis Cup / BJK Cup results endpoint (client-side request not yet identified).

## Next ingest (highest value)

**WTA API → canonical graph** (now rolling out): weekly singles+doubles ranking snapshots
(with historical weeks backfilled), the calendar, and every match for every WTA/WTA 125 event, archived raw
to R2 and normalized through the tested pipeline. Wikidata crosswalk in parallel (rights-clear now), then
Wimbledon + AO archives for men's Slam results keyed by embedded ATP ids.

## Generated tables

<!-- generated:start (npm run matrix) -->
Registry 2026-09-27 · canary run 2026-09-27T23:57:12.361Z (scripts/canary/run.mjs (local workstation egress)) · UA `PropBetEdge-Tennis/0.1 (+https://tennis.propbetedge.ai/sources)`

| Source | Verdict | Capabilities | Canary (latest) | Terms | Production status |
|---|---|---|---|---|---|
| **WTA** | | | | | |
| `wta.rankings.singles` WTA API — singles rankings (dated lists, historical) | PASS | rankings_singles, player_identity, player_bio, history | PASS · HTTP 200 · 5 rec · 1265 B | RESTRICTS_AUTOMATED_ACCESS | INGEST — owner-approved 2026-09-26 (tennis-ingest cron) |
| `wta.rankings.doubles` WTA API — doubles rankings | PASS | rankings_doubles, player_identity | PASS · HTTP 200 · 5 rec · 1294 B | RESTRICTS_AUTOMATED_ACCESS | INGEST — owner-approved 2026-09-26 (tennis-ingest cron) |
| `wta.race` WTA API — Race rankings | UNVERIFIED | race | audit request (private archive) | RESTRICTS_AUTOMATED_ACCESS | NOT_ADAPTED |
| `wta.calendar` WTA API — tournament calendar (WTA 1000/500/250/125) | PASS | calendar | PASS · HTTP 200 · 30 rec · 20702 B | RESTRICTS_AUTOMATED_ACCESS | INGEST — owner-approved 2026-09-26 (tennis-ingest cron) |
| `wta.matches` WTA API — tournament matches (results + live state) | PASS | schedule, live_state, set_game_scoring, doubles, qualifying, withdrawals_ret_wo | PASS · HTTP 200 · 53 rec · 61710 B | RESTRICTS_AUTOMATED_ACCESS | INGEST — owner-approved 2026-09-26 (tennis-ingest cron) |
| `wta.match_stats` WTA API — match statistics (per set + totals) | PASS | match_stats, serve_stats, return_stats | PASS · HTTP 200 · 1 rec · 2191 B | RESTRICTS_AUTOMATED_ACCESS | INGEST — owner-approved 2026-09-26 (tennis-ingest cron) |
| `wta.player` WTA API — player identity, match history, season stats, records | PASS | player_identity, player_bio, match_history, h2h | PASS · HTTP 200 · 1 rec · 8336 B | RESTRICTS_AUTOMATED_ACCESS | INGESTING: /players/{id}/matches (lane wta_history, official player history; backfill of the 3,523-player population); /players/{id}/records + /players/{id}/year/{y} (lane wta_records, top 200 of the official list; stored as reported in tennis_player_source_records, compared, never merged) |
| **ATP** | | | | | |
| `atp.site` atptour.com — rankings, calendar, scores, stats, players (incl. Challenger) | BLOCKED_BY_ACCESS_CONTROL | rankings_singles, rankings_doubles, race, calendar, draws, live_state, match_stats, player_bio, history | BLOCKED_BY_ACCESS_CONTROL · HTTP 403 | RESTRICTS_AUTOMATED_ACCESS | NOT_USED — Cloudflare challenge on every request; not evaded |
| `atp.infosys` ATP stats platform (Infosys) | BLOCKED_BY_ACCESS_CONTROL | point_by_point, match_stats | audit request (private archive) | RESTRICTS_AUTOMATED_ACCESS | NOT_USED |
| `protennislive.draw_pdf` ProTennisLive — ATP Tour + Challenger official draw / order-of-play PDFs | DEGRADED | draws | PASS · HTTP 200 · 1 rec · 144232 B | NOT_RETRIEVED | REGISTRY ONLY, NOT INGESTED — blocked from Cloudflare egress (HTTP 429 + challenge page on the 3rd request from tennis-ingest, 2026-09-28; not bypassed, not re-routed through another network). Workstation canary PASS. |
| **ITF** | | | | | |
| `itf.site` itftennis.com — World Tennis Tour calendar, results, rankings, players | BLOCKED_BY_ACCESS_CONTROL | calendar, draws, schedule, rankings_singles, player_bio, match_history, history | BLOCKED_BY_ACCESS_CONTROL · HTTP 200 | NOT_RETRIEVED | NOT_USED — Incapsula JS challenge (served with HTTP 200); not evaded |
| **Grand Slams** | | | | | |
| `wimbledon.draws` Wimbledon — draw/score JSON feeds | PASS | draws, set_game_scoring, withdrawals_ret_wo, history, player_identity | PASS · HTTP 200 · 127 rec · 357838 B | RESTRICTS_COMMERCIAL_USE | INGEST — gentlemen's singles 2022-2025 (women's Slam matches come from the WTA API to avoid duplicates) |
| `wimbledon.players` Wimbledon — players feed | PASS | player_bio, player_identity | audit request (private archive) | RESTRICTS_COMMERCIAL_USE | NOT_ADAPTED |
| `wimbledon.pbp` Wimbledon — point-by-point / match detail | UNVERIFIED | point_by_point, match_stats | — | RESTRICTS_COMMERCIAL_USE | NOT_ADAPTED |
| `ausopen.results` Australian Open — scores API (day results/schedule, players) | PASS | schedule, set_game_scoring, player_identity, player_bio | PASS · HTTP 200 · 64 rec · 209058 B | NOT_RETRIEVED | INGEST (player registry → identity) — owner-approved 2026-09-26; match rows not parsed yet |
| `ausopen.matchcentre` Australian Open — match centre (key stats + point-by-point) | PASS | point_by_point, match_stats | audit request (private archive) | NOT_RETRIEVED | NOT_ADAPTED |
| `rolandgarros.results` Roland-Garros results API (rolandgarros.com) | PASS | draws, set_game_scoring, withdrawals_ret_wo, history, qualifying, doubles | PASS · HTTP 200 · 127 rec · 403738 B | NOT_RETRIEVED | INGESTING (lane rolandgarros) — source/parser PASS; canonical rows only after the identity phase resolves players |
| `wimbledon.archive` Wimbledon draws archive (da.wimbledon.com) | DEGRADED | draws, set_game_scoring, withdrawals_ret_wo, history, player_identity, qualifying, doubles | PASS · HTTP 200 · 127 rec · 108677 B | RESTRICTS_COMMERCIAL_USE | INGESTING (lane wimbledon_archive, 1979+) — bad rows held, never corrected by guess |
| **Team events** | | | | | |
| `daviscup.draws` Davis Cup — draws & results pages | DEGRADED | draws | audit request (private archive) | NOT_RETRIEVED | NOT_ADAPTED |
| `bjkcup.draws` Billie Jean King Cup — draws & results pages | DEGRADED | draws | audit request (private archive) | NOT_RETRIEVED | NOT_ADAPTED |
| `unitedcup.site` United Cup | DEGRADED | schedule | audit request (private archive) | NOT_RETRIEVED | NOT_ADAPTED |
| `olympics.tennis` Olympics — tennis results | UNVERIFIED | draws | audit request (private archive) | NOT_RETRIEVED | NOT_ADAPTED |
| `daviscup.stadion` Davis Cup (ITF Stadion API) | DEGRADED | draws, set_game_scoring, history, doubles | audit request (private archive) | — | NOT INGESTED — every rubber would be an unresolved identity; no name-only merges |
| **Wikidata** | | | | | |
| `wikidata.crosswalk` Wikidata — identity crosswalk (ATP P536, WTA P597, ITF P599, Davis Cup P2641, BJK Cup P2642, image P18) | PASS | player_identity, player_media | PASS · HTTP 200 · 5 rec · 2915 B | OPEN_LICENSE | INGEST — weekly crosswalk (P597 + P536) |
| `commons.license` Wikimedia Commons — per-file license & author metadata | PASS | player_media | PASS · HTTP 200 · 1 rec · 1163 B | PER_FILE_LICENSE | READY — rights-ledger input |
| **Open data** | | | | | |
| `sackmann.tour_datasets` Jeff Sackmann tennis_atp / tennis_wta / tennis_slam_pointbypoint | NOT_AVAILABLE | history, point_by_point, match_stats | audit request (private archive) | NOT_RETRIEVED | NOT_USED |
| `sackmann.match_charting` Match Charting Project | DEGRADED | point_by_point, history | audit request (private archive) | NON_COMMERCIAL_LICENSE | NOT_USED — CC BY-NC-SA conflicts with a commercial product |
| `tennisabstract.site` Tennis Abstract | DEGRADED | history, match_stats | audit request (private archive) | NOT_RETRIEVED | NOT_USED — data paths are robots-disallowed |
| **Odds** | | | | | |
| `odds.tennis_data_co_uk` tennis-data.co.uk | BLOCKED_BY_ACCESS_CONTROL | odds, history | audit request (private archive) | NOT_RETRIEVED | NOT_USED |
| `odds.the_odds_api` The Odds API (existing PropBetEdge network subscription) | COMMERCIAL_REFERENCE_ONLY | odds | audit request (private archive) | NOT_REVIEWED | REFERENCE_ONLY — not a Tennis dependency |
| **Commercial (reference only)** | | | | | |
| `commercial.sportradar` Sportradar | COMMERCIAL_REFERENCE_ONLY | live_state, match_stats | — | NOT_REVIEWED | REFERENCE_ONLY — owner directive: $0 data licensing |
| `commercial.stats` Stats Perform (Opta) | COMMERCIAL_REFERENCE_ONLY | live_state, match_stats | — | NOT_REVIEWED | REFERENCE_ONLY — owner directive: $0 data licensing |
| `commercial.genius` Genius Sports | COMMERCIAL_REFERENCE_ONLY | live_state, match_stats | — | NOT_REVIEWED | REFERENCE_ONLY — owner directive: $0 data licensing |
| `commercial.infront` Infront / Tennis Data Innovations | COMMERCIAL_REFERENCE_ONLY | live_state, match_stats | — | NOT_REVIEWED | REFERENCE_ONLY — owner directive: $0 data licensing |
| `commercial.sportsdataio` SportsDataIO | COMMERCIAL_REFERENCE_ONLY | live_state, match_stats | — | NOT_REVIEWED | REFERENCE_ONLY — owner directive: $0 data licensing |
| `commercial.api-tennis.com` api-tennis.com | COMMERCIAL_REFERENCE_ONLY | live_state, match_stats | — | NOT_REVIEWED | REFERENCE_ONLY — owner directive: $0 data licensing |
| `commercial.rapidapi` RapidAPI tennis APIs | COMMERCIAL_REFERENCE_ONLY | live_state, match_stats | — | NOT_REVIEWED | REFERENCE_ONLY — owner directive: $0 data licensing |
| **ESPN core API (secondary source, owner decision 2026-09-27)** | | | | | |
| `espn.tennis.core` ESPN tennis core API (sports.core.api.espn.com, undocumented) | PASS | calendar, draws, set_game_scoring, withdrawals_ret_wo, qualifying, doubles, mixed, history, rankings_singles, player_bio, player_identity | PASS · HTTP 200 · 333 rec · 1238272 B | RESTRICTED | SECONDARY INGESTION (lanes espn_atp, espn_rankings, espn_wta, espn_wta_rankings) — owner decision 2026-09-27 supersedes the 2026-09-26 reference-only approval. Official sources keep precedence (an ESPN row attaches to, never overwrites, an official match; an official row takes over an ESPN row). Structured facts only; no editorial text stored. Terms remain RESTRICTED (quoted) — accepted by the owner. \| 2026-09-28: season statistics (/seasons/{Y}/types/2/athletes/{id}/statistics: singles W-L, titles, prize) and event log (/seasons/{Y}/athletes/{id}/eventlog) for the top 150 of each tour (lane espn_extras; stored as reported; the event log is a coverage check only). Brackets: only on www.espn.com (connection reset before any HTTP response to our honest UA) — unavailable; competitors carry tournamentSeed only (no draw position). |

### Endpoint templates and notes

- **`wta.rankings.singles`** — `https://api.wtatennis.com/tennis/players/ranked?page={p}&pageSize={n}&type=rankSingles&sort=asc&metric=SINGLES&at={YYYY-MM-DD}` · ids: player = integer (e.g. 324166)  
  Historical lists by date (at=2015-01-05 returned that week). ~40-50% of connections reset and succeed on retry; the adapter retries patiently at 1 request per 1.5 s.  
  robots: www.wtatennis.com: 'User-agent: * / Disallow:' (empty = allow all). api.wtatennis.com/robots.txt -> 404 (none)
- **`wta.rankings.doubles`** — `https://api.wtatennis.com/tennis/players/ranked?page={p}&pageSize={n}&type=rankDoubles&sort=asc&metric=DOUBLES&at={YYYY-MM-DD}` · ids: player = integer  
  robots: www.wtatennis.com: 'User-agent: * / Disallow:' (empty = allow all). api.wtatennis.com/robots.txt -> 404 (none)
- **`wta.race`** — _no working endpoint yet_  
  Guessed parameters returned a list that is not the Race. Needs the parameters the site itself uses.  
  robots: www.wtatennis.com: 'User-agent: * / Disallow:' (empty = allow all). api.wtatennis.com/robots.txt -> 404 (none)
- **`wta.calendar`** — `https://api.wtatennis.com/tennis/tournaments/?page=0&pageSize={n}&from={date}&to={date}` · ids: tournament = tournamentGroup.id + year  
  Surface, indoor/outdoor, draw sizes and level. WTA 125 events included.  
  robots: www.wtatennis.com: 'User-agent: * / Disallow:' (empty = allow all). api.wtatennis.com/robots.txt -> 404 (none)
- **`wta.matches`** — `https://api.wtatennis.com/tennis/tournaments/{id}/{year}/matches` · ids: match = {EventID}-{year}-{MatchID}, e.g. LS002 / RS014 / LD003  
  Live rows carry point score and server. 2026-09-26 end-to-end run: 103 of 104 rows (Singapore + Ankara WTA 125) normalized canonical; 1 self-contradictory source row (1178-2026-LD013) was held by score validation. Winner codes 5/7 unobserved and unmapped.  
  robots: www.wtatennis.com: 'User-agent: * / Disallow:' (empty = allow all). api.wtatennis.com/robots.txt -> 404 (none)
- **`wta.match_stats`** — `https://api.wtatennis.com/tennis/tournaments/{id}/{year}/matches/{matchId}/stats`  
  Field semantics verified against set scores; a consistency check (service points = points won; per-set sums = totals) runs on every parse.  
  robots: www.wtatennis.com: 'User-agent: * / Disallow:' (empty = allow all). api.wtatennis.com/robots.txt -> 404 (none)
- **`wta.player`** — `https://api.wtatennis.com/tennis/players/{id} ; /players/{id}/matches/ ; /players/{id}/year/{y} ; /players/{id}/records` · ids: player = integer  
  Rows carry no match id or time: identity = edition + event + stage + participants; day = edition end date. Codes observed: W played, R retired, B bye (skipped); qualifying rows label rounds against the qualifying draw. pageSize capped at 100. /records counts SINGLES AND DOUBLES together (320760: "Grand Slam" 6 titles = 4 singles + 2 doubles). /year returns one season's serve/return COUNTS for seasons in the WTA stats coverage (2017+ observed; earlier seasons return the player object only -> recorded absent, never zero); its MatchCount covers only the matches in the WTA stats system, so season totals are not like-for-like with our per-match statistics.  
  robots: www.wtatennis.com: 'User-agent: * / Disallow:' (empty = allow all). api.wtatennis.com/robots.txt -> 404 (none)
- **`atp.site`** — `https://www.atptour.com/ and app.atptour.com (all paths probed)` · ids: player = 4-char alphanumeric (e.g. S0AG)  
  ATP player ids reach us legitimately through Slam feeds and Wikidata instead.  
  robots: User-Agent: * / Disallow: /sitecore/, */ajax/*, /*/scores/archive/*, /*/scores/match-stats, /*/stats/player-tendencies, /*/scores/second-screen, /*/search-results, /*/photos/photo-filter-results, /*/video/video-filter-re
- **`atp.infosys`** — `https://itp-atp-sls.infosys-platforms.com/prod/api/...`  
  CloudFront 403.
- **`protennislive.draw_pdf`** — `https://www.protennislive.com/posting/{year}/{atpTournamentId}/{mds|mdd|qs|op}.pdf` · ids: tournament = ATP tournament id (e.g. 7581 Chengdu)  
  Covers ATP Tour and ATP Challenger events (mds/mdd = main-draw singles/doubles, qs = qualifying, op = order of play). Names + countries only: no player ids, no DOB, so nothing from these PDFs can mint or merge a canonical player. Unpublished draws return HTTP 200 with a ~2.6 KB placeholder PDF; the canary checks size and text, not status. 2026-09-28 (Phase 5): the reviewed registry build (scripts/context/drawsheets.mjs) would use a sheet only when its first round PROVES the ESPN edition (>= 4 first-round pairs resolved within the edition's own stored players, >= 90% of them stored matches, >= 75% of the draw resolved, no player twice): header surface per edition + draw slots that point at players already in that edition. A PDF still never mints or merges a player. Candidate ATP ids come from Wikipedia links (candidates only). Blocked from Worker egress, so the ATP registry holds 1 attempted tournament; ATP surfaces come from combined events instead.  
  robots: robots.txt -> 404 (none published)
- **`itf.site`** — `https://www.itftennis.com/tennis/api/TournamentApi/... ; /PlayerRankApi/...` · ids: player = 9-digit integer (e.g. 100241350)  
  ITF ids are available through Wikidata P599 (7,417 humans) for identity only.  
  robots: User-agent: * / Disallow: /umbraco/ / Allow: /
- **`daviscup.draws`** — `https://www.daviscup.com/en/draws-results/{season}/{stage}`  
  No challenge; the server-rendered payload holds team and nomination metadata only. Tie results load client-side from an endpoint not yet found.  
  robots: User-Agent: * / Allow: /
- **`bjkcup.draws`** — `https://www.billiejeankingcup.com/en/draws-results/{season}/{stage}`  
  Same platform and limitation as daviscup.com.  
  robots: User-Agent: * / Allow: /
- **`unitedcup.site`** — `https://www.unitedcup.com/en/scores`  
  Reachable, off-season (January event); no data endpoint identified yet.  
  robots: Identical to atptour.com robots (same Sitecore platform)
- **`olympics.tennis`** — `https://www.olympics.com/en/olympic-games/{games}/results/tennis`  
  Requests hung with 0 bytes; not bypassed.
- **`wimbledon.draws`** — `https://www.wimbledon.com/en_GB/scores/feeds/{year}/draws/{MS|LS|...}.json` · ids: player = atps0ag / wta324219 (embeds tour ids); match = 4-digit match_id  
  2025 Gentlemen's + Ladies' singles: 254 of 254 matches normalized canonical. Embedded ATP/WTA ids give a crosswalk with zero name matching.  
  robots: Disallow: /api/, /s/, /webview/, /matchvideo/, /mobile, /zh_CN, /author/, /en_GB/scores/2025/schedule/pdf/, /en_GB/mywimbledon/ ... (/en_GB/scores/feeds/ NOT disallowed)
- **`wimbledon.players`** — `https://www.wimbledon.com/en_GB/scores/feeds/{year}/players/players.json`  
  robots: Disallow: /api/, /s/, /webview/, /matchvideo/, /mobile, /zh_CN, /author/, /en_GB/scores/2025/schedule/pdf/, /en_GB/mywimbledon/ ... (/en_GB/scores/feeds/ NOT disallowed)
- **`wimbledon.pbp`** — _no working endpoint yet_  
  Guessed paths returned S3 AccessDenied (also what a missing key returns). Needs the path the site itself requests.  
  robots: Disallow: /api/, /s/, /webview/, /matchvideo/, /mobile, /zh_CN, /author/, /en_GB/scores/2025/schedule/pdf/, /en_GB/mywimbledon/ ... (/en_GB/scores/feeds/ NOT disallowed)
- **`ausopen.results`** — `https://prod-scores-api.ausopen.com/year/{year}/period/MD/day/{day}/{results|schedule}` · ids: player = ATPBK92 / WTA317790 (embeds tour ids); match = WS116  
  Player registry parsed (tour ids, gender, DOB, nationality). Current edition only; archive depth unknown.  
  robots: ausopen.com: Drupal default; Disallow /core/, /profiles/, /admin/, /search, /user/*, /media/oembed. prod-scores-api.ausopen.com robots not checked
- **`ausopen.matchcentre`** — `https://prod-scores-api.ausopen.com/match-centre/{matchId}`  
  109 point rows with running score observed for WS116. Current edition only.  
  robots: ausopen.com: Drupal default; Disallow /core/, /profiles/, /admin/, /search, /user/*, /media/oembed. prod-scores-api.ausopen.com robots not checked
- **`usopen.feeds`** — `https://www.usopen.org/en_US/scores/feeds/{year}/draws/MS.json`  
  Every request (including robots.txt) hung with 0 bytes: edge drop or outage. Recheck once; do not work around it.  
  robots: robots.txt timed out
- **`rolandgarros.results`** — `https://www.rolandgarros.com/api/en-us/results/{year}/{SM|DM|QM}` · ids: player = FFT-internal integer (e.g. 39723)  
  Data only inside the SSR payload; FFT ids need their own crosswalk.  
  robots: Disallow: /admin, /maintenance
- **`wikidata.crosswalk`** — `https://query.wikidata.org/sparql` · ids: entity = QID  
  Humans with ids: ATP 6,582 · WTA 5,405 · ITF 7,417 · Davis Cup 2,926 · BJK Cup 2,167. WTA ids match api.wtatennis.com exactly.
- **`commons.license`** — `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|size|extmetadata`
- **`sackmann.tour_datasets`** — `https://github.com/JeffSackmann/`  
  Repositories no longer public (404 via web and API) as of 2026-09-26.
- **`sackmann.match_charting`** — `https://github.com/JeffSackmann/tennis_MatchChartingProject`
- **`tennisabstract.site`** — `https://www.tennisabstract.com/`  
  robots: Disallow: /jsfrags/, /jsmatches/, /jsplayers/ (the player/match data paths)
- **`odds.tennis_data_co_uk`** — `http://www.tennis-data.co.uk/{year}/{year}.xlsx`  
  Cloudflare 403. No free, keyless tennis odds source found: MARKET UNAVAILABLE is the default state.
- **`espn.tennis.core`** — `https://sports.core.api.espn.com/v2/sports/tennis/leagues/{atp|wta}/events/{tid}-{YYYY}` · ids: player = ESPN athlete integer (e.g. 3623); event = {tournamentId}-{year} (e.g. 154-2026); match = {event}:{competitionId}  
  Identity: ESPN athlete ids -> tour ids via the PBE crosswalk, Wikidata P11585 (ESPN tennis id) with P536/P597, or exact name + DOB unique; never name-only. No surface or tournament level in the payload (only Slams known). Rankings: weekly ATP singles top 100-150 with points and previous rank, dated by the source lastUpdated. WTA league (2026-09-27): same payloads, competitions 2007+, weekly WTA singles lists (ranking id 2) 2007+; events share one id namespace with the ATP league; mixed doubles ingested once (ATP league); ESPN WTA events map onto the official WTA edition when shared singles pairs prove it; official WTA lists within 6 days win (ESPN list reconciled, not stored).  
  robots: espn.com robots.txt not readable for our UA (connection reset); core API /robots.txt 403
- **`wimbledon.archive`** — `https://da.wimbledon.com/v1/draws_archive/draw/{MS|MD|QS}/{year}` · ids: player = archive UUID (tourid on the player record for some players)  
  DEGRADED for source quality: the archive reports some deciding-set tiebreak scores that are impossible under the edition rule (e.g. 2022 QF Nadal d. Fritz 10-4 appears as 7-4); every such match is held. Identity: archive UUID -> ATP only via Wikidata P4503->P536, same-match 2025 join, archive tourid; else held. The ingest Worker (Cloudflare egress) has also received intermittent HTTP 403 from this host; the lane backs off and never retries around it.  
  robots: not retrieved for da.wimbledon.com
- **`daviscup.stadion`** — `https://api.itf-production.sports-data.stadion.io/custom/tieCentre/{tieId}` · ids: player = ITF tennisId (e.g. GOM1041959) — matches no Wikidata P536/P599/P2641  
  Reachable with ties, nominations and rubbers 1900+. person.tennisId has no deterministic crosswalk to tour ids and person records carry no date of birth, so rubbers are not canonicalized.
- **`wta.draw_pdf`** — `https://wtafiles.wtatennis.com/pdf/draws/{year}/{wtaTournamentId}/{MDS|QS}.pdf` · ids: tournament = WTA tournament group id (e.g. 1038 Madrid)  
  Fetched only through tennis-ingest /v1/drawsheet (polite client, byte-exact R2 archive + capture row). A sheet never mints or merges a player: a slot points at a player already stored in that edition, or stays unresolved.  
  robots: wtafiles.wtatennis.com/robots.txt -> ResourceNotFound (none published)

### Terms of use — verbatim

- **WTA** (https://www.wtatennis.com/terms-and-conditions): “You must not: "harvest" (or collect) information from the WTA Sites using an automated software tool or manually on a mass basis (unless we have given you separate written permission to do so). ... use automated means to access the WTA Sites or gain unauthorized access to the WTA Sites or to any account or computer system connected to the WTA Sites. This prohibition does not apply to search engines accessing the WTA Sites solely for web indexing purposes.”
- **ATP** (https://www.atptour.com/en/terms-and-conditions): “Systematic retrieval of data or other Content from the Website, including but not limited to scores, statistics, and/or rankings, whether to create or compile, directly or indirectly, a collection, compilation, database, or directory, is prohibited absent prior express written permission from ATP. ... You may use the Website and/or Content solely for your own individual non-commercial, entertainment and informational purposes. Any other use, including for any commercial, gambling or wagering purposes, is strictly prohibited without ATP's express prior written permission.”
- **Grand Slams** (https://www.wimbledon.com/en_GB/terms_of_use): “6.2 You must not use any part of or any content obtained from an AELTC Digital Platform for commercial purposes without first obtaining a licence from AELTC or from AELTC's official licensors (as may be applicable).”
- **Wikidata** (https://www.wikidata.org/wiki/Wikidata:Licensing): “Structured data is CC0.”
- **Wikidata** (https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia): “Each file carries its own license; only CC0 / PD / CC BY / CC BY-SA are accepted (docs/MEDIA.md).”
- **Open data** (https://raw.githubusercontent.com/JeffSackmann/tennis_MatchChartingProject/master/README.md): “... is licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License. ... In other words: Attribution is required. Non-commercial use only.”
- **ESPN core API (secondary source, owner decision 2026-09-27)** (https://disneytermsofuse.com/english/): “§2.B(viii) no commercial or business-related use without express written permission; §2.B(x) no robot/spider/script access, data mining or web scraping; §3.H no commercial use except as expressly licensed. Public developer API closed 2014-12-08; no licence path.”
<!-- generated:end -->
