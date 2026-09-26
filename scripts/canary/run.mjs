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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// Access probes: official pages that refused automated requests during the audit. Re-checked every run
// so a BLOCKED verdict never goes stale — but nothing here tries to get past the block.
const probe = (key, family, url, capabilities) => ({
  key, family, capabilities, parser_version: 'probe', request: () => ({ url, headers: { accept: 'text/html,application/json' } }),
  shape: () => [], parse: () => []
});

export const CANARIES = [
  { adapter: wta.rankingsSingles, params: { pageSize: 5 } },
  { adapter: wta.rankingsDoubles, params: { pageSize: 5 } },
  { adapter: wta.calendar, params: { from: day(-7), to: day(21), pageSize: 50 } },
  { adapter: wta.matches, params: { eventId: 1152, year: 2026 } },
  { adapter: wta.matchStats, params: { eventId: 1152, year: 2026, matchId: 'LS002' } },
  { adapter: slams.wimbledonDraw, params: { year: 2025, eventCode: 'MS' } },
  { adapter: slams.ausopenDay, params: { year: 2026, day: 1 } },
  { adapter: open.wikidataCrosswalk, params: { limit: 5 } },
  { adapter: open.commonsLicense, params: { file: 'Andre Agassi (2011).jpg' } },
  { adapter: open.protennisliveDraw, params: { year: 2026, tournamentId: 7581 } },
  { adapter: probe('atp.rankings.page', 'atp', 'https://www.atptour.com/en/rankings/singles', ['rankings_singles']) },
  { adapter: probe('itf.api.calendar', 'itf', 'https://www.itftennis.com/tennis/api/TournamentApi/GetCalendar?circuitCode=MT&searchString=&skip=0&take=10&nationCodes=&zoneCodes=&dateFrom=2026-09-21&dateTo=2026-10-05&indoorOutdoor=&categories=&isOrderAscending=true&orderField=startDate&surfaceCodes=', ['calendar']) }
];

const trim = (rec) => {
  const s = JSON.stringify(rec);
  return s.length <= 700 ? rec : { truncated: true, preview: `${s.slice(0, 700)}…` };
};

async function main() {
  const filter = process.argv[2] || '';
  const client = new SourceClient({ policies: { [wta.WTA_HOST]: wta.WTA_POLICY, 'query.wikidata.org': { min_interval_ms: 2000 }, 'www.atptour.com': { retries: 0 }, 'www.itftennis.com': { retries: 0 } } });
  const runAt = new Date().toISOString();
  const results = [];
  for (const { adapter, params = {} } of CANARIES.filter((c) => c.adapter.key.startsWith(filter))) {
    let captured = null;
    const r = await runAdapter(adapter, {
      client,
      params,
      archive: async ({ result }) => { captured = { sha256: await sha256Hex(result.body || ''), bytes: result.bytes, content_type: result.content_type, attempts: result.attempts }; return null; }
    });
    const out = {
      key: adapter.key, family: adapter.family, state: r.state, url: r.url, http_status: r.http_status ?? null,
      bytes: captured?.bytes ?? null, content_type: captured?.content_type ?? null, sha256: captured?.sha256 ?? null,
      attempts: captured?.attempts ?? null, latency_ms: r.latency_ms ?? null, record_count: r.record_count ?? (r.records ? r.records.length : null),
      error: r.error ?? null, drift: r.drift ?? null, sample: r.records?.length ? trim(r.records[0]) : null
    };
    if (adapter.parser_version === 'probe' && r.state === 'DEGRADED' && r.error === 'zero_records') { out.state = 'REACHABLE'; out.error = null; }
    results.push(out);
    console.log(`${out.state.padEnd(26)} ${adapter.key.padEnd(26)} http=${out.http_status ?? '-'} bytes=${out.bytes ?? '-'} records=${out.record_count ?? '-'}${out.error ? ` err=${out.error}` : ''}`);
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
