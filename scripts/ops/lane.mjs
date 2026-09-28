#!/usr/bin/env node
// Drive an admin lane of tennis-ingest (backfills, repairs) safely.
//   node scripts/ops/lane.mjs <lane> [--budget N] [--shards K] [--max-runs N] [--write 0]
// - the admin token is read from D:/Workers/secrets/tennis-ingest-admin-token INTO MEMORY: it never appears in argv,
//   the environment, a process listing or a log line (the 2026-09-28 shell drivers passed it to curl -H)
// - shards are capped at 5 (the server also enforces MAX_HEAVY slots and a db pause; db-guard.js)
// - server refusals back off: db_paused waits until the pause ends, concurrency_ceiling / tick_in_progress wait 30 s;
//   3 consecutive store errors in one shard stop that shard; a data error on one item stops that shard only
import fs from 'node:fs';

const [lane, ...rest] = process.argv.slice(2);
if (!lane) { console.error('usage: lane.mjs <lane> [--budget N] [--shards K] [--max-runs N] [--write 0]'); process.exit(2); }
const opt = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : dflt; };
const budget = Number(opt('budget', 8));
const shards = Math.min(5, Math.max(1, Number(opt('shards', 1))));
const maxRuns = Number(opt('max-runs', 1000));
const write = opt('write', null);
// --base targets an uploaded version's preview URL (version canaries); default = the deployed Worker
const BASE = (opt('base', 'https://tennis-ingest.sales-fd3.workers.dev') || '').replace(/\/+$/, '');
if (!/^https:\/\/([a-z0-9]+-)?tennis-ingest\.sales-fd3\.workers\.dev$/.test(BASE)) { console.error('refusing: --base must be a tennis-ingest workers.dev URL'); process.exit(2); }
const TOKEN = fs.readFileSync('D:/Workers/secrets/tennis-ingest-admin-token', 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STORE = /postgrest 5\d\d|PGRST00\d|error code: 5\d\d|Network connection lost|timed out|fetch failed/i;
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function shard(k) {
  let resume = '';
  let storeFails = 0;
  let dataFails = 0;
  for (let run = 0; run < maxRuns; run += 1) {
    const q = new URLSearchParams({ lane, budget: String(budget) });
    if (shards > 1) { q.set('shard', String(k)); q.set('shards', String(shards)); }
    if (write != null) q.set('write', write);
    let body = null;
    try {
      const res = await fetch(`${BASE}/v1/runs?${q}${resume}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(295e3) });
      body = await res.json();
    } catch (e) { body = { data: { ok: false, error: String(e?.message || e) } }; }
    const d = body?.data || {};
    const err = d.error || d.result?.error || null;
    if (err === 'db_paused') { log(`shard ${k} db paused until ${d.paused_until} (${d.reason})`); await sleep(Math.max(30e3, Date.parse(d.paused_until) - Date.now())); continue; }
    if (err === 'concurrency_ceiling' || err === 'tick_in_progress') { await sleep(30e3); continue; }
    const r = d.result || {};
    if (process.env.LANE_JSON) fs.writeFileSync(process.env.LANE_JSON, JSON.stringify(body));
    log(`shard ${k}`, d.ok ? 'ok' : 'FAIL', r.position != null ? `pos ${r.position}/${r.queue ?? r.list}` : '', err ? String(err).slice(0, 140) : '', `store ${d.store_requests ?? '-'}`);
    if (err) {
      if (STORE.test(err)) { storeFails += 1; if (storeFails >= 3) { log(`shard ${k} stopped: 3 consecutive store errors`); return; } await sleep(120e3); continue; }
      dataFails += 1; if (dataFails >= 3) { log(`shard ${k} stopped: repeated data error`); return; } await sleep(30e3); continue;
    }
    storeFails = 0; dataFails = 0;
    resume = Number.isInteger(r.position) && Number.isInteger(r.page) ? `&resume=${r.position}:${r.page}` : '';
    if (r.done) { log(`shard ${k} done`); return; }
    await sleep(8e3);
  }
}

await Promise.all(Array.from({ length: shards }, (_, k) => shard(k)));
