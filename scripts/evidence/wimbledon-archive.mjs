#!/usr/bin/env node
// Source evidence for `wimbledon.archive` (da.wimbledon.com draws archive).
//   node scripts/evidence/wimbledon-archive.mjs   -> docs/evidence/wimbledon-archive-latest.json
// Two halves: (1) a live probe of the archive endpoint family for representative years (HTTP state, payload
// hash, raw row count, shape check, parsed count); (2) what the ingest actually did with it (matches written,
// holds, unresolved identities, deciding-set tiebreak discrepancies the source reports). One honest request
// at a time; no payload samples are written (this repo is public).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { USER_AGENT } from '../../workers/shared/http.js';
import { sha256Hex } from '../../workers/shared/archive.js';
import { wimbledonArchive } from '../../workers/providers/slams.js';

const YEARS = [1979, 2019, 2022, 2025];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8' }); const i = Math.min(...['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0)); const v = JSON.parse(out.slice(i)); return Array.isArray(v) ? v : [v]; };

const probes = [];
for (const year of YEARS) {
  await sleep(1100);
  const { url } = wimbledonArchive.request({ event: 'MS', year });
  const t0 = Date.now();
  const r = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  const body = await r.text();
  const drift = r.ok ? wimbledonArchive.shape(body) : ['http_error'];
  let parsed = null;
  try { parsed = r.ok && !drift.length ? wimbledonArchive.parse(body, { params: { event: 'MS', year, idMap: {} } }).length : null; } catch { parsed = null; }
  let raw = null; try { raw = JSON.parse(body).length; } catch { /* not json */ }
  probes.push({ url, year, event: 'MS', http_status: r.status, state: r.ok && !drift.length ? 'PASS' : 'FAIL', latency_ms: Date.now() - t0, bytes: body.length, sha256: await sha256Hex(body), raw_rows: raw, parsed_matches: parsed, drift });
  console.log(`${probes.at(-1).state} ${year} MS http=${r.status} rows=${raw} parsed=${parsed}`);
}

const ingest = sql(`select json_build_object(
  'written_by_year', (select json_object_agg(y, n) from (select substr(external_id, 6, 4) y, count(*) n from tennis_match_external_ids where provider='wimbledon' and external_id like 'arch-%' group by 1 order by 1) z),
  'held_open', (select count(*) from tennis_ingest_holds where provider='wimbledon' and external_id like 'arch-%' and resolved_at is null),
  'held_unresolved_identity', (select count(*) from tennis_ingest_holds where provider='wimbledon' and external_id like 'arch-%' and resolved_at is null and problems::text like '%unresolved_identity%'),
  'held_deciding_tiebreak_discrepancy', (select count(*) from tennis_ingest_holds where provider='wimbledon' and external_id like 'arch-%' and resolved_at is null and problems::text like '%tiebreak%not finished%'),
  'tiebreak_discrepancy_ids', (select json_agg(json_build_object('source_id', external_id, 'problem', problems->>0, 'reported_tiebreak', payload->'sets'->4->'tiebreak')) from tennis_ingest_holds where provider='wimbledon' and external_id like 'arch-%' and resolved_at is null and problems::text like '%tiebreak%not finished%'),
  'unresolved_identity_examples', (select json_agg(external_id) from (select external_id from tennis_ingest_holds where provider='wimbledon' and external_id like 'arch-%' and resolved_at is null and problems::text like '%unresolved_identity%' order by last_seen_at desc limit 5) z)
) x`)[0].x;

// what the production ingest Worker (Cloudflare egress) last saw from the same endpoint family
let worker_lane = null;
try { const o = execFileSync('npx', ['wrangler', 'kv', 'key', 'get', 'lane:wimbledon_archive', '--namespace-id', 'a117d7b3846c4a39a27ee74c49574c99', '--remote'], { encoding: 'utf8', shell: true }); worker_lane = JSON.parse(o.slice(o.indexOf('{'))); } catch { worker_lane = null; }

const out = {
  source_key: 'wimbledon.archive',
  endpoint_family: 'https://da.wimbledon.com/v1/draws_archive/draw/{MS|MD|QS}/{year}',
  checked_at: new Date().toISOString(),
  runner: 'scripts/evidence/wimbledon-archive.mjs (local workstation egress)',
  user_agent: USER_AGENT,
  parser_version: wimbledonArchive.parser_version,
  years_probed: YEARS,
  result: probes.every((p) => p.state === 'PASS') ? 'REACHABLE_AND_PARSING' : 'FAIL',
  probes,
  ingest,
  worker_lane,
  source_quality: {
    verdict: 'DEGRADED',
    issue: 'The archive reports some deciding-set tiebreak scores that are impossible under the edition rule (10-point tiebreak at 6-6 from 2022). Verified example: 2022 QF Nadal d. Fritz, fifth-set tiebreak 10-4; the archive reports 7-4.',
    containment: 'Every such match fails canonical score validation and is held (never written); no correction is guessed.'
  }
};
fs.writeFileSync('docs/evidence/wimbledon-archive-latest.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ result: out.result, held: ingest.held_open, unresolved: ingest.held_unresolved_identity, tb: ingest.held_deciding_tiebreak_discrepancy }));
if (out.result !== 'REACHABLE_AND_PARSING') process.exitCode = 1;
