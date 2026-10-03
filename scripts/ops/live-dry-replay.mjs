// Forensic dry replay of an archived ESPN (game-level) live observation INSIDE tennis-live (production bindings,
// real store reads, all writes intercepted). Read-only; admin token from D:\Workers\secrets (never printed).
//   node scripts/ops/live-dry-replay.mjs <routes.json> <event_id> <nowIso> [previouslyCsv] [baseUrl]
// routes.json: [{ url, k }] = archived capture url -> R2 payload key (from tennis_source_captures).
import fs from 'node:fs';

const [file, eventId, now, prevCsv, base = 'https://tennis-live.sales-fd3.workers.dev'] = process.argv.slice(2);
const caps = JSON.parse(fs.readFileSync(file, 'utf8'));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const routes = caps.map((c) => [`${esc(new URL(c.url).pathname)}(\\?|$)`, c.k]);
const tok = fs.readFileSync('D:/Workers/secrets/tennis-ingest-admin-token', 'utf8').trim();
const previously = prevCsv && prevCsv !== '-' ? prevCsv.split(',') : null;
const r = await fetch(`${base}/v1/live/diag/replay`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ event_id: eventId, now, routes, previously }) });
const j = await r.json();
if (!j.ok) { console.log('ERR', r.status, JSON.stringify(j).slice(0, 1200)); process.exit(1); }
const d = j.data;
const { trace, ...rest } = d.result;
console.log('RESULT', JSON.stringify(rest).slice(0, 900));
console.log('TRACE', JSON.stringify(trace, null, 1));
console.log('calls', d.calls.length);
for (const w of d.writes) console.log('WRITE(intercepted)', w.op, w.table || w.key || w.path, w.rows ?? '', w.op === 'upsert' && /tennis_matches|tennis_match_events/.test(w.table) ? JSON.stringify(w.sample).slice(0, 400) : '');
