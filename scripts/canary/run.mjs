#!/usr/bin/env node
// Read-only source canaries. Every adapter runs through the polite SourceClient (honest UA, per-host
// spacing, backoff; no evasion). Results -> docs/evidence/source-canary-latest.json.
//
//   npm run canary            run all
//   npm run canary -- wta     only keys starting with "wta"
//
// A canary proves what a source returned at run time from THIS network. Cloudflare egress may differ
// (a source open to a home connection can refuse datacenter IPs) — re-run from the ingest Worker
// before any production dependence.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceClient, USER_AGENT } from '../../workers/shared/http.js';
import { runAdapter } from '../../workers/shared/adapter.js';
import { sha256Hex } from '../../workers/shared/archive.js';
import * as wta from '../../workers/providers/wta.js';
import * as slams from '../../workers/providers/slams.js';
import * as open from '../../workers/providers/open.js';
import * as rg from '../../workers/providers/rolandgarros.js';
import * as espn from '../../workers/providers/espn.js';
import * as wtaHistory from '../../workers/providers/wta-history.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// Access probes: official pages that refused automated requests during the audit. Re-checked every run
// so a BLOCKED verdict never goes stale — but nothing here tries to get past the block.
const probe = (key, family, url, capabilities) => ({
  key, family, capabilities, parser_version: 'probe', request: () => ({ url, headers: { accept: 'text/html,application/json' } }),
  shape: () => [], parse: () => []
});

// Roland-Garros: the canary counts parsed matches (not payloads), for every edition the lane claims. The
// current edition keeps the bare registry key; earlier years are suffixed @year.
const rgMatches = { ...rg.rgResults, parse: (body) => rg.rgResults.parse(body).flatMap((j) => (j.tournamentEvent?.roundResults || []).flatMap((r) => r.matches || [])) };
const espnResults = { ...espn.espnEvent, parse: (body) => espn.parseEspnEvent(JSON.parse(body), {}).matches.filter((m) => m.warnings.every((w) => !/names_disagree|unparseable|winner_flag/.test(w))) };
const RG_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

export const CANARIES = [
  { adapter: wta.rankingsSingles, params: { pageSize: 5 } },
  { adapter: wta.rankingsDoubles, params: { pageSize: 5 } },
  { adapter: wta.calendar, params: { from: day(-7), to: day(21), pageSize: 50 } },
  { adapter: wta.matches, params: { eventId: 1152, year: 2026 } },
  { adapter: wta.matchStats, params: { eventId: 1152, year: 2026, matchId: 'LS002' } },
  { adapter: slams.wimbledonDraw, params: { year: 2025, eventCode: 'MS' } },
  { adapter: slams.ausopenDay, params: { year: 2026, day: 1 } },
  { adapter: slams.wimbledonArchiveRaw, params: { year: 2022, event: 'MS' } },
  { adapter: open.wikidataCrosswalk, params: { limit: 5 } },
  { adapter: open.commonsLicense, params: { file: 'Andre Agassi (2011).jpg' } },
  { adapter: open.protennisliveDraw, params: { year: 2026, tournamentId: 7581 } },
  ...RG_YEARS.map((year) => ({ adapter: rgMatches, key: year === 2026 ? 'rolandgarros.results' : `rolandgarros.results@${year}`, params: { year, event: 'SM' } })),
  // ESPN ATP (secondary, lane espn_atp): the event canary counts RESULT rows the parser accepts, not payloads.
  { adapter: espnResults, key: 'espn.atp.event', params: { id: '154-2026' } },
  { adapter: espnResults, key: 'espn.atp.event@2008', params: { id: '154-2008' } },
  { adapter: espn.espnSeasonEvents, params: { year: 2026 } },
  { adapter: espn.espnAthlete, params: { id: '3623' } },
  { adapter: espn.espnRankingWeek, params: { season: 2026, week: 38 } },
  { adapter: espn.espnRankingWeek, key: 'espn.atp.rankings@2010', params: { season: 2010, week: 10 } },
  { adapter: { ...espn.WTA.event, parse: (body) => espn.parseEspnEvent(JSON.parse(body), { league: 'wta' }).matches.filter((m) => m.warnings.every((w) => !/names_disagree|unparseable|winner_flag/.test(w))) }, key: 'espn.wta.event', params: { id: '154-2026' } },
  { adapter: espn.WTA.rankingWeek, params: { season: 2012, week: 10 } },
  { adapter: wtaHistory.playerMatches, params: { id: 320760, page: 0, pageSize: 5 } },
  { adapter: probe('espn.site.scoreboard', 'espn', 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard', ['schedule']) },
  { adapter: probe('atp.rankings.page', 'atp', 'https://www.atptour.com/en/rankings/singles', ['rankings_singles']) },
  { adapter: probe('itf.api.calendar', 'itf', 'https://www.itftennis.com/tennis/api/TournamentApi/GetCalendar?circuitCode=MT&searchString=&skip=0&take=10&nationCodes=&zoneCodes=&dateFrom=2026-09-21&dateTo=2026-10-05&indoorOutdoor=&categories=&isOrderAscending=true&orderField=startDate&surfaceCodes=', ['calendar']) }
];

async function main() {
  const filter = process.argv[2] || '';
  const client = new SourceClient({ policies: { [wta.WTA_HOST]: wta.WTA_POLICY, 'query.wikidata.org': { min_interval_ms: 2000 }, 'www.atptour.com': { retries: 0 }, 'www.itftennis.com': { retries: 0 }, [espn.ESPN_HOST]: espn.ESPN_POLICY, 'site.api.espn.com': { retries: 0 } } });
  const runAt = new Date().toISOString();
  const results = [];
  for (const { adapter, params = {}, key = adapter.key } of CANARIES.filter((c) => (c.key || c.adapter.key).startsWith(filter))) {
    let captured = null;
    const r = await runAdapter(adapter, {
      client,
      params,
      archive: async ({ result }) => { captured = { sha256: await sha256Hex(result.body || ''), bytes: result.bytes, content_type: result.content_type, attempts: result.attempts }; return null; }
    });
    const out = {
      key, family: adapter.family, state: r.state, url: r.url, http_status: r.http_status ?? null,
      bytes: captured?.bytes ?? null, content_type: captured?.content_type ?? null, sha256: captured?.sha256 ?? null,
      attempts: captured?.attempts ?? null, latency_ms: r.latency_ms ?? null, record_count: r.record_count ?? (r.records ? r.records.length : null),
      error: r.error ?? null, drift: r.drift ?? null // no payload samples: this repo is public
    };
    if (adapter.parser_version === 'probe' && r.state === 'DEGRADED' && r.error === 'zero_records') { out.state = 'REACHABLE'; out.error = null; }
    results.push(out);
    console.log(`${out.state.padEnd(26)} ${key.padEnd(26)} http=${out.http_status ?? '-'} bytes=${out.bytes ?? '-'} records=${out.record_count ?? '-'}${out.error ? ` err=${out.error}` : ''}`);
  }
  const file = path.join(ROOT, 'docs', 'evidence', 'source-canary-latest.json');
  let merged = results;
  if (filter && fs.existsSync(file)) {
    const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    const keep = (prev.results || []).filter((p) => !results.some((r) => r.key === p.key));
    merged = [...keep, ...results];
  }
  const doc = { run_at: runAt, runner: 'scripts/canary/run.mjs (local workstation egress)', user_agent: USER_AGENT, client_stats: client.stats, results: merged };
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  const counts = merged.reduce((m, r) => ({ ...m, [r.state]: (m[r.state] || 0) + 1 }), {});
  console.log(`\ncanary: ${JSON.stringify(counts)} -> ${path.relative(ROOT, file)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
