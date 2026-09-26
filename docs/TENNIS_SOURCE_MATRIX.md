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
Registry 2026-09-26 · canary run 2026-09-26T13:21:00.135Z (scripts/canary/run.mjs (local workstation egress)) · UA `PropBetEdge-Tennis/0.1 (+https://tennis.propbetedge.ai/sources)`

| Source | Verdict | Capabilities | Canary (latest) | Terms | Production status |
|---|---|---|---|---|---|
| **WTA** | | | | | |
| `wta.rankings.singles` WTA API — singles rankings (dated lists, historical) | PASS | rankings_singles, player_identity, player_bio, history | PASS · HTTP 200 · 5 rec · 1265 B | RESTRICTS_AUTOMATED_ACCESS | INGEST — owner-approved 2026-09-26 (tennis-ingest cron) |
| `wta.rankings.doubles` WTA API — doubles rankings | PASS | rankings_doubles, player_identity | PASS · HTTP 200 · 5 rec · 1294 B | RESTRICTS_AUTOMATED_ACCESS | INGEST — owner-approved 2026-09-26 (tennis-ingest cron) |
| `wta.race` WTA API — Race rankings | UNVERIFIED | race | audit request (private archive) | RESTRICTS_AUTOMATED_ACCESS | NOT_ADAPTED |
| `wta.calendar` WTA API — tournament calendar (WTA 1000/500/250/125) | PASS | calendar | PASS · HTTP 200 · 19 rec · 14069 B | RESTRICTS_AUTOMATED_ACCESS | INGEST — owner-approved 2026-09-26 (tennis-ingest cron) |
| `wta.matches` WTA API — tournament matches (results + live state) | PASS | schedule, live_state, set_game_scoring, doubles, qualifying, withdrawals_ret_wo | PASS · HTTP 200 · 51 rec · 59294 B | RESTRICTS_AUTOMATED_ACCESS | INGEST — owner-approved 2026-09-26 (tennis-ingest cron) |
| `wta.match_stats` WTA API — match statistics (per set + totals) | PASS | match_stats, serve_stats, return_stats | PASS · HTTP 200 · 1 rec · 2191 B | RESTRICTS_AUTOMATED_ACCESS | INGEST — owner-approved 2026-09-26 (tennis-ingest cron) |
| `wta.player` WTA API — player identity, match history, season stats, records | PASS | player_identity, player_bio, match_history, h2h | audit request (private archive) | RESTRICTS_AUTOMATED_ACCESS | NOT_ADAPTED |
| **ATP** | | | | | |
| `atp.site` atptour.com — rankings, calendar, scores, stats, players (incl. Challenger) | BLOCKED_BY_ACCESS_CONTROL | rankings_singles, rankings_doubles, race, calendar, draws, live_state, match_stats, player_bio, history | BLOCKED_BY_ACCESS_CONTROL · HTTP 403 | RESTRICTS_AUTOMATED_ACCESS | NOT_USED — Cloudflare challenge on every request; not evaded |
| `atp.infosys` ATP stats platform (Infosys) | BLOCKED_BY_ACCESS_CONTROL | point_by_point, match_stats | audit request (private archive) | RESTRICTS_AUTOMATED_ACCESS | NOT_USED |
| `protennislive.draw_pdf` ProTennisLive — ATP official draw / order-of-play PDFs | DEGRADED | draws | PASS · HTTP 200 · 1 rec · 139642 B | NOT_RETRIEVED | NOT_ADAPTED — availability proven, PDF text extraction not built |
| **ITF** | | | | | |
| `itf.site` itftennis.com — World Tennis Tour calendar, results, rankings, players | BLOCKED_BY_ACCESS_CONTROL | calendar, draws, schedule, rankings_singles, player_bio, match_history, history | BLOCKED_BY_ACCESS_CONTROL · HTTP 200 | NOT_RETRIEVED | NOT_USED — Incapsula JS challenge (served with HTTP 200); not evaded |
| **Grand Slams** | | | | | |
| `wimbledon.draws` Wimbledon — draw/score JSON feeds | PASS | draws, set_game_scoring, withdrawals_ret_wo, history, player_identity | PASS · HTTP 200 · 127 rec · 357838 B | RESTRICTS_COMMERCIAL_USE | INGEST — gentlemen's singles 2022-2025 (women's Slam matches come from the WTA API to avoid duplicates) |
| `wimbledon.players` Wimbledon — players feed | PASS | player_bio, player_identity | audit request (private archive) | RESTRICTS_COMMERCIAL_USE | NOT_ADAPTED |
| `wimbledon.pbp` Wimbledon — point-by-point / match detail | UNVERIFIED | point_by_point, match_stats | — | RESTRICTS_COMMERCIAL_USE | NOT_ADAPTED |
| `ausopen.results` Australian Open — scores API (day results/schedule, players) | PASS | schedule, set_game_scoring, player_identity, player_bio | PASS · HTTP 200 · 64 rec · 209058 B | NOT_RETRIEVED | INGEST (player registry → identity) — owner-approved 2026-09-26; match rows not parsed yet |
| `ausopen.matchcentre` Australian Open — match centre (key stats + point-by-point) | PASS | point_by_point, match_stats | audit request (private archive) | NOT_RETRIEVED | NOT_ADAPTED |
| `usopen.feeds` US Open — score feeds | UNVERIFIED | draws, set_game_scoring | audit request (private archive) | NOT_RETRIEVED | NOT_ADAPTED |
| `rolandgarros.results` Roland-Garros — results pages (Nuxt payload) | DEGRADED | set_game_scoring, history | audit request (private archive) | NOT_RETRIEVED | NOT_ADAPTED |
| **Team events** | | | | | |
| `daviscup.draws` Davis Cup — draws & results pages | DEGRADED | draws | audit request (private archive) | NOT_RETRIEVED | NOT_ADAPTED |
| `bjkcup.draws` Billie Jean King Cup — draws & results pages | DEGRADED | draws | audit request (private archive) | NOT_RETRIEVED | NOT_ADAPTED |
| `unitedcup.site` United Cup | DEGRADED | schedule | audit request (private archive) | NOT_RETRIEVED | NOT_ADAPTED |
| `olympics.tennis` Olympics — tennis results | UNVERIFIED | draws | audit request (private archive) | NOT_RETRIEVED | NOT_ADAPTED |
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
  Proven by Phase 0 audit requests; adapter not built yet. No dedicated H2H endpoint (404); H2H derives from match history.  
  robots: www.wtatennis.com: 'User-agent: * / Disallow:' (empty = allow all). api.wtatennis.com/robots.txt -> 404 (none)
- **`atp.site`** — `https://www.atptour.com/ and app.atptour.com (all paths probed)` · ids: player = 4-char alphanumeric (e.g. S0AG)  
  ATP player ids reach us legitimately through Slam feeds and Wikidata instead.  
  robots: User-Agent: * / Disallow: /sitecore/, */ajax/*, /*/scores/archive/*, /*/scores/match-stats, /*/stats/player-tendencies, /*/scores/second-screen, /*/search-results, /*/photos/photo-filter-results, /*/video/video-filter-re
- **`atp.infosys`** — `https://itp-atp-sls.infosys-platforms.com/prod/api/...`  
  CloudFront 403.
- **`protennislive.draw_pdf`** — `https://www.protennislive.com/posting/{year}/{atpTournamentId}/mds.pdf (op.pdf = order of play)` · ids: tournament = ATP tournament id (e.g. 7581 Chengdu)  
  Names only, no player ids. Unpublished draws return HTTP 200 with a ~2.6 KB placeholder PDF; the canary checks size and text, not status.  
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
- **`rolandgarros.results`** — `https://www.rolandgarros.com/en-us/results/{SM|SD|...}?round={n}&year={y}` · ids: player = FFT-internal integer (e.g. 39723)  
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

### Terms of use — verbatim

- **WTA** (https://www.wtatennis.com/terms-and-conditions): “You must not: "harvest" (or collect) information from the WTA Sites using an automated software tool or manually on a mass basis (unless we have given you separate written permission to do so). ... use automated means to access the WTA Sites or gain unauthorized access to the WTA Sites or to any account or computer system connected to the WTA Sites. This prohibition does not apply to search engines accessing the WTA Sites solely for web indexing purposes.”
- **ATP** (https://www.atptour.com/en/terms-and-conditions): “Systematic retrieval of data or other Content from the Website, including but not limited to scores, statistics, and/or rankings, whether to create or compile, directly or indirectly, a collection, compilation, database, or directory, is prohibited absent prior express written permission from ATP. ... You may use the Website and/or Content solely for your own individual non-commercial, entertainment and informational purposes. Any other use, including for any commercial, gambling or wagering purposes, is strictly prohibited without ATP's express prior written permission.”
- **Grand Slams** (https://www.wimbledon.com/en_GB/terms_of_use): “6.2 You must not use any part of or any content obtained from an AELTC Digital Platform for commercial purposes without first obtaining a licence from AELTC or from AELTC's official licensors (as may be applicable).”
- **Wikidata** (https://www.wikidata.org/wiki/Wikidata:Licensing): “Structured data is CC0.”
- **Wikidata** (https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia): “Each file carries its own license; only CC0 / PD / CC BY / CC BY-SA are accepted (docs/MEDIA.md).”
- **Open data** (https://raw.githubusercontent.com/JeffSackmann/tennis_MatchChartingProject/master/README.md): “... is licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License. ... In other words: Attribution is required. Non-commercial use only.”
<!-- generated:end -->
