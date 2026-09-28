# ATP surface coverage plan (Phase 6, 2026-09-28) — PLAN ONLY, nothing ingested

Gap: 1,064 ESPN ATP editions (2007-2026) have no sourced surface = **34,869 men's singles matches**
(MS coverage 34.8%: Slams + 112 combined events). Rules that bind every option: no evasion of access controls
(ProTennisLive / atptour.com challenge us and stay excluded), no inference from name / city / month / convention,
edition identity proven by CONTENT (not by a name), provenance per value, official values always outrank.

Measured feasibility inputs (read-only, 2026-09-28): 779 of the 1,064 editions have a final whose champion carries
a Wikidata id; Wikidata holds 577 ATP edition items 2007+ (550 with a singles champion, 340 with an English
Wikipedia article, far fewer with an edition-level surface).

| # | Source | Access / rights | Edition identity proof | Surface fact | Est. coverage of the gap | Decision |
|---|---|---|---|---|---|---|
| 1 | Combined events (official WTA edition of the same ESPN event) | in use | same ESPN event id + same city + same week | WTA calendar (official) | 112 editions, done | LIVE (Phase 5) |
| 2 | Wikidata edition items (P765 surface) | open API, CC0 | champion QID (singles event P1346) = our final winner's Wikidata id, start date within 5 days, unique | P765 per edition | 164 editions proven with a surface (subset of 317 proven) | PROPOSED, secondary |
| 3 | English Wikipedia edition article infobox (`surface=`), reached by the Wikidata sitelink of a proven item | MediaWiki API, CC BY-SA (attribution) | same proof as #2 (the article belongs to the proven item) | infobox `surface` + indoor/outdoor | up to 317 editions / 11,007 matches (32% of the gap) | PROPOSED, secondary |
| 4 | Wikipedia edition articles found by search (no Wikidata item) | MediaWiki API, CC BY-SA | the article's champion link -> Wikidata QID = our champion AND its dates contain our final day; unique | infobox | remaining editions with a champion QID (up to ~460 more); not measured | PROPOSED after #3 validates |
| 5 | ProTennisLive draw sheets | challenged from Cloudflare egress (429); workstation fetch would be evasion | draw-content proof (built) | printed header | ~all 2014+ tour editions | EXCLUDED unless the owner obtains permission / allowlisting |
| 6 | atptour.com / ATP media notes | Cloudflare challenge; terms restrict systematic retrieval | — | — | — | EXCLUDED |
| 7 | Jeff Sackmann tennis_atp | CC BY-NC-SA (non-commercial) | — | per match | high | EXCLUDED (rights) |
| 8 | tennis-data.co.uk | registry: blocked / not used | — | per match | high | EXCLUDED |
| 9 | Official tournament websites (Wikidata P856) | per-site terms, ~160 sites | per site | varies | unbounded | NOT SCALABLE; owner decision per site |
| 10 | Tournament-level surface "it is always clay" | — | — | convention | — | FORBIDDEN (inference) |

Validation gate before any secondary value is applied (sources 2-4):
1. Build the candidate set read-only; store every proof (QIDs, dates, article revision id) in the registry file.
2. Measure agreement against editions whose surface is already OFFICIAL (Slams, combined events): the source is
   adopted only at >= 99% agreement on >= 50 overlapping editions; each disagreement is listed.
3. Apply as `tennis_edition_attributes (source wikidata|wikipedia, method mapped_edition)` with the article revision
   id as capture; fill-only (never over an official value); a later official value replaces it.
4. Re-run the surface backtest; surface models keep the unchanged publication rule.

Expected outcome if the gate passes: MS surface coverage from 34.8% to roughly 55-60% (sources 2+3), higher if #4
validates. Remaining gap after that: tour editions without a champion Wikidata id or article — closable only with an
official source (#5 with permission).
