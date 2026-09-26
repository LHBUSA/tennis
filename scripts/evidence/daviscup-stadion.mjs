#!/usr/bin/env node
// Source evidence for `daviscup.stadion` (ITF Stadion tie-centre API) and for why it is NOT ingested.
//   node scripts/evidence/daviscup-stadion.mjs   -> docs/evidence/daviscup-stadion-latest.json
// Proves: the endpoint answers, ties carry nominations + rubbers, persons carry an ITF-internal `tennisId`
// and no date of birth, and those tennisIds match no Wikidata ATP (P536), ITF (P599) or Davis Cup (P2641)
// identifier — so no deterministic crosswalk to canonical players exists and no rubber is canonicalized.
// One honest request at a time; only counts, hashes and id shapes are written (this repo is public).
import fs from 'node:fs';
import { USER_AGENT } from '../../workers/shared/http.js';
import { sha256Hex } from '../../workers/shared/archive.js';

const TIES = ['2f278593-fd02-4495-a08d-4726852edab1', 'c1a86d15-2d9e-49fa-a768-22d8b03a483e'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DOB_KEY = /birth|dob/i;
function keysDeep(o, out = new Set()) { if (Array.isArray(o)) o.forEach((x) => keysDeep(x, out)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.add(k); keysDeep(v, out); } return out; }

const ties = [];
const ids = new Map();
for (const id of TIES) {
  await sleep(1100);
  const url = `https://api.itf-production.sports-data.stadion.io/custom/tieCentre/${id}`;
  const r = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  const body = await r.text();
  let j = null; try { j = JSON.parse(body); } catch { /* not json */ }
  const persons = (j?.data?.nominations || []).flatMap((n) => (n.players || []).map((p) => p.person).filter(Boolean));
  for (const p of persons) if (p.tennisId) ids.set(p.tennisId, `${p.firstName || ''} ${p.lastName || ''}`.trim());
  const personKeys = keysDeep(persons);
  ties.push({
    url, tie_id: id, tie_name: j?.data?.tie?._name || null, http_status: r.status, bytes: body.length, sha256: await sha256Hex(body),
    rubbers: (j?.data?.tie?.matches || []).length, nominated_persons: persons.length,
    persons_with_tennisId: persons.filter((p) => p.tennisId).length,
    person_fields_matching_birth_or_dob: [...personKeys].filter((k) => DOB_KEY.test(k)),
    tennisId_examples: persons.map((p) => p.tennisId).filter(Boolean).slice(0, 3)
  });
  console.log(`tie ${id} http=${r.status} rubbers=${ties.at(-1).rubbers} persons=${persons.length}`);
}

// Crosswalk test: does any Wikidata item carry one of these tennisIds as its ATP, ITF or Davis Cup id?
await sleep(2000);
const values = [...ids.keys()].map((v) => JSON.stringify(v)).join(' ');
const q = `SELECT ?id ?item ?prop WHERE { VALUES ?id { ${values} } VALUES ?prop { wdt:P536 wdt:P599 wdt:P2641 } ?item ?prop ?id }`;
const w = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { 'user-agent': USER_AGENT, accept: 'application/sparql-results+json' } });
const wj = w.ok ? await w.json() : null;
const matches = wj ? wj.results.bindings.length : null;

const allOk = ties.every((t) => t.http_status === 200 && t.rubbers > 0 && t.nominated_persons > 0);
const out = {
  source_key: 'daviscup.stadion',
  endpoint_family: 'https://api.itf-production.sports-data.stadion.io/custom/tieCentre/{tieId}',
  checked_at: new Date().toISOString(),
  runner: 'scripts/evidence/daviscup-stadion.mjs (local workstation egress)',
  user_agent: USER_AGENT,
  parser_version: 'evidence-1 (no production parser: not ingested)',
  result: allOk ? 'REACHABLE_DATA_PRESENT' : 'FAIL',
  ties,
  identity: {
    tennisId_shape: 'three letters of surname + 7 digits (e.g. GOM1041959) — ITF-internal',
    distinct_tennisIds_checked: ids.size,
    date_of_birth_in_person_records: ties.some((t) => t.person_fields_matching_birth_or_dob.length) ? 'PRESENT' : 'ABSENT',
    wikidata_crosswalk_query: { http_status: w.status, properties: ['P536 ATP', 'P599 ITF', 'P2641 Davis Cup'], matching_items: matches },
    conclusion: matches === 0 ? 'no deterministic crosswalk to tour ids; name-only matching is not identity -> NOT INGESTED' : 'crosswalk candidates found — review before any ingest'
  },
  verdict: 'DEGRADED',
  production_status: 'NOT INGESTED'
};
fs.writeFileSync('docs/evidence/daviscup-stadion-latest.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ result: out.result, ids: ids.size, dob: out.identity.date_of_birth_in_person_records, wikidata_matches: matches }));
if (!allOk || matches === null) process.exitCode = 1;
