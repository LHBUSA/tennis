#!/usr/bin/env node
// Read-only benchmark of writer.js crossSource() candidate lookup shapes on REAL inputs (EXPLAIN ANALYZE, BUFFERS).
//   node scripts/ops/bench-candidate-query.mjs <editionId[,editionId]> [runs=15] [batch=100]
// Shapes (same candidate set: matches of the target editions that involve an incoming participant key):
//   current  = the exact SQL PostgREST generates for select=match_id,tennis_matches!inner(edition_id)&participant_key=in.(..)
//              &tennis_matches.edition_id=in.(..)&order=match_id.asc,side.asc&limit=1000&offset=0 (inner LATERAL with LIMIT/OFFSET)
//   keyfirst = two-stage A: participants by key (all rows), then matches by those ids AND edition (owner's proposal)
//   edfirst  = two-stage B: matches of the editions, then participants of THOSE matches filtered by the keys
// Keys = every participant key of the editions' stored matches (what the official feed sends back each tick).
import { execFileSync } from 'node:child_process';

const [edArgIn, runsArg = '15', batchArg = '100'] = process.argv.slice(2);
// PLAYER=<pbe id>: a wta_history-like pass = that player's latest 40 matches (their editions; keys = the player + opponents)
let edArg = edArgIn;
let playerKeys = null;
if (process.env.PLAYER) {
  const r0 = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', `with mm as (select m.match_id, m.edition_id from tennis_match_participants p join tennis_matches m using (match_id) where (p.participant_key = 'S:${process.env.PLAYER}' or p.participant_key like 'D:%${process.env.PLAYER}%') order by m.scheduled_at desc nulls last limit ${Number(process.env.N || 40)}) select (select array_agg(distinct edition_id::text) from mm) eds, (select array_agg(distinct p.participant_key) from tennis_match_participants p where p.match_id in (select match_id from mm)) keys`], { encoding: 'utf8' });
  const v = JSON.parse(r0.slice(r0.indexOf('{')));
  edArg = v.eds.join(','); playerKeys = v.keys;
}
const eds = edArg.split(',');
const runs = Number(runsArg);
const batch = Number(batchArg);
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 64 << 20 }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((i) => i >= 0); if (!at.length) throw new Error(out.slice(0, 400)); const v = JSON.parse(out.slice(Math.min(...at))); return Array.isArray(v) ? v : [v]; };
const lit = (a) => `'{${a.map((x) => `"${x}"`).join(',')}}'`;
const edLit = `${lit(eds)}::uuid[]`;
const keys = playerKeys || sql(`select array_agg(distinct p.participant_key order by p.participant_key) k from tennis_matches m join tennis_match_participants p using (match_id) where m.edition_id = any(${edLit})`)[0].k;
const chunks = []; for (let i = 0; i < keys.length; i += batch) chunks.push(keys.slice(i, i + batch));

const ONLY = process.env.SHAPES ? process.env.SHAPES.split(',') : null;
const shapes = {
  current: (k) => [`WITH pgrst_source AS ( SELECT "public"."tennis_match_participants"."match_id", row_to_json("t".*)::jsonb AS "tennis_matches" FROM "public"."tennis_match_participants" INNER JOIN LATERAL ( SELECT "tennis_matches_1"."edition_id" FROM "public"."tennis_matches" AS "tennis_matches_1" WHERE "tennis_matches_1"."edition_id" = ANY (${edLit}) AND "tennis_matches_1"."match_id" = "public"."tennis_match_participants"."match_id" LIMIT NULL OFFSET 0 ) AS "t" ON TRUE WHERE "public"."tennis_match_participants"."participant_key" = ANY (${lit(k)}::text[]) ORDER BY "public"."tennis_match_participants"."match_id" ASC, "public"."tennis_match_participants"."side" ASC LIMIT 1000 OFFSET 0 ) SELECT pg_catalog.count(_postgrest_t) AS page_total, coalesce(json_agg(_postgrest_t), '[]') AS body FROM ( SELECT * FROM pgrst_source ) _postgrest_t`],
  keyfirst: (k) => [`SELECT match_id, side, participant_key FROM tennis_match_participants WHERE participant_key = ANY (${lit(k)}::text[]) ORDER BY match_id, side`,
    // stage B on the ids stage A returns (computed in-database here so both stages are measured on the same data)
    `SELECT m.match_id FROM tennis_matches m WHERE m.match_id = ANY (ARRAY(SELECT match_id FROM tennis_match_participants WHERE participant_key = ANY (${lit(k)}::text[]))) AND m.edition_id = ANY (${edLit})`],
  // single PostgREST request from the matches side: tennis_matches?select=match_id,tennis_match_participants!inner(participant_key)
  //   &edition_id=in.(eds)&tennis_match_participants.participant_key=in.(keys)&order=match_id.asc&limit=1000&offset=0
  edjoin: (k) => [`WITH pgrst_source AS ( SELECT "public"."tennis_matches"."match_id", COALESCE("t"."x", '[]') AS "tennis_match_participants" FROM "public"."tennis_matches" INNER JOIN LATERAL ( SELECT json_agg("p1") AS "x" FROM ( SELECT "p"."participant_key" FROM "public"."tennis_match_participants" AS "p" WHERE "p"."participant_key" = ANY (${lit(k)}::text[]) AND "p"."match_id" = "public"."tennis_matches"."match_id" LIMIT NULL OFFSET 0 ) AS "p1" HAVING count(*) > 0 ) AS "t" ON TRUE WHERE "public"."tennis_matches"."edition_id" = ANY (${edLit}) ORDER BY "public"."tennis_matches"."match_id" ASC LIMIT 1000 OFFSET 0 ) SELECT pg_catalog.count(_postgrest_t) AS page_total, coalesce(json_agg(_postgrest_t), '[]') AS body FROM ( SELECT * FROM pgrst_source ) _postgrest_t`],
  // same, ordered by (edition_id, match_id): the ordering the edition index itself provides (no PK walk can satisfy it)
  edorder: (k) => [shapes.edjoin(k)[0].replace('ORDER BY "public"."tennis_matches"."match_id" ASC', 'ORDER BY "public"."tennis_matches"."edition_id" ASC, "public"."tennis_matches"."match_id" ASC')],
  // one request per edition (edition_id=eq.X)
  // edorder with the editions split into groups of ED_CHUNK (one statement per group): bounds each statement's cost
  edchunk: (k) => { const n = Number(process.env.ED_CHUNK || 8); const out = []; for (let i = 0; i < eds.length; i += n) { const g = `${lit(eds.slice(i, i + n))}::uuid[]`; out.push(shapes.edorder(k)[0].split(edLit).join(g)); } return out; },
  edper: (k) => eds.map((e) => shapes.edjoin(k)[0].replace(`= ANY (${edLit})`, `= '${e}'::uuid`)),
  edfirst: (k) => [`SELECT match_id FROM tennis_matches WHERE edition_id = ANY (${edLit}) ORDER BY match_id`,
    `SELECT DISTINCT p.match_id FROM tennis_match_participants p WHERE p.match_id = ANY (ARRAY(SELECT match_id FROM tennis_matches WHERE edition_id = ANY (${edLit}))) AND p.participant_key = ANY (${lit(k)}::text[])`]
};
const walk = (n, f) => { f(n); for (const c of n.Plans || []) walk(c, f); };
// the plan comes back as ONE text value (run_sql.ps1's JSON depth limit truncates nested plans); pg_temp = session-only
const explain = (q) => {
  const txt = sql(`create or replace function pg_temp.bx(q text) returns text language plpgsql as $f$ declare r text; begin execute 'explain (analyze, buffers, format json) ' || q into r; return r; end $f$; select pg_temp.bx($q$${q}$q$) as p`)[0].p;
  const plan = JSON.parse(txt)[0];
  const nodes = []; walk(plan.Plan, (n) => nodes.push(n));
  return { exec: plan['Execution Time'], planning: plan['Planning Time'], rows: plan.Plan['Actual Rows'], hit: plan.Plan['Shared Hit Blocks'] || 0, read: plan.Plan['Shared Read Blocks'] || 0,
    nodes: [...new Set(nodes.map((n) => `${n['Node Type']}${n['Index Name'] ? `(${n['Index Name']})` : ''}${n['Relation Name'] && !n['Index Name'] ? `(${n['Relation Name']})` : ''}`))], plan };
};
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const out = { editions: eds, keys: keys.length, singles_keys: keys.filter((k) => k.startsWith('S:')).length, doubles_keys: keys.filter((k) => k.startsWith('D:')).length, batch, chunks: chunks.length, runs, shapes: {} };
for (const [name, f] of Object.entries(shapes).filter(([n]) => !ONLY || ONLY.includes(n))) {
  let stmtMax = 0; const times = []; let rows = 0; let hit = 0; let read = 0; let nodes = null; let first = null; let planning = 0;
  for (let r = 0; r < runs; r += 1) {
    let t = 0; let rr = 0; let h = 0; let rd = 0; let pl = 0;
    for (const k of chunks) for (const q of f(k)) { const e = explain(q); t += e.exec; stmtMax = Math.max(stmtMax, e.exec); rr += e.rows; h += e.hit; rd += e.read; pl += e.planning; if (!nodes) nodes = e.nodes; }
    times.push(t); if (r === 0) { first = t; rows = rr; hit = h; read = rd; planning = pl; }
  }
  out.shapes[name] = { first_ms: +first.toFixed(1), p50_ms: +pct(times, 0.5).toFixed(1), p95_ms: +pct(times, 0.95).toFixed(1), max_ms: +Math.max(...times).toFixed(1), planning_ms: +planning.toFixed(2), rows_per_run: rows, shared_hit_per_run: hit, shared_read_first_run: read, db_statements_per_run: chunks.length * f(chunks[0]).length, statement_max_ms: +stmtMax.toFixed(1), nodes };
  console.log(name.padEnd(9), JSON.stringify(out.shapes[name]));
}
if (process.env.PLAN) console.log(JSON.stringify(explain(shapes[process.env.PLAN](chunks[0])[0]).plan, null, 1));
console.log(JSON.stringify({ editions: out.editions, keys: out.keys, singles: out.singles_keys, doubles: out.doubles_keys, batch, chunks: out.chunks }));
