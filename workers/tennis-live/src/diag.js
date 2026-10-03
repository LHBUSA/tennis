// tennis-live forensic DRY REPLAY (internal, admin token only). Runs the PRODUCTION espnLiveObserve, with this
// Worker's real bindings and the real canonical store for READS, against ARCHIVED source payloads (R2 tennis-source,
// content-addressed), with every store / KV WRITE intercepted and recorded instead of executed. Nothing is fetched
// from the source, nothing is written, no capture is archived (env carries no TENNIS_SOURCE for fetchRun).
// Purpose: reproduce a past live observation inside production to find where it dies — never to create state.

import { espnLiveObserve } from '../../tennis-ingest/src/espn-live.js';

const WRITES = new Set(['upsert', 'insert', 'del']);

/** Store proxy: selects / GET requests pass through; every write is recorded and answered as if it succeeded. */
export function dryStore(store, log) {
  return new Proxy(store, {
    get(t, k) {
      if (WRITES.has(k)) return async (table, rowsOrQuery) => { log.push({ op: k, table, rows: Array.isArray(rowsOrQuery) ? rowsOrQuery.length : null, sample: Array.isArray(rowsOrQuery) ? rowsOrQuery.slice(0, 2) : String(rowsOrQuery).slice(0, 200) }); return []; };
      if (k === 'req') return async (method, path, opts) => { if (method === 'GET') return t.req(method, path, opts); log.push({ op: `req:${method}`, path: String(path).slice(0, 200) }); return null; };
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
}

/** KV proxy: reads pass through, writes recorded. */
export function dryKv(kv, log) {
  return { get: (k, type) => kv.get(k, type), put: async (k, v) => { log.push({ op: 'kv.put', key: k, value: String(v).slice(0, 200) }); }, delete: async (k) => { log.push({ op: 'kv.delete', key: k }); } };
}

/** Source client that serves archived payloads: routes = [[regexSource, r2Key]]. Unrouted URLs answer 404. */
export function archiveClient(bucket, routes) {
  const calls = [];
  return {
    calls,
    stats: {},
    async get(url) {
      calls.push(url);
      const hit = routes.find(([re]) => new RegExp(re).test(url));
      const obj = hit ? await bucket.get(hit[1]) : null;
      if (!obj) return { url, ok: false, status: 404, body: '{"error":"not in archive"}', bytes: 0, latency_ms: 0, fetched_at: new Date().toISOString(), content_type: 'application/json' };
      const body = await obj.text();
      return { url, ok: true, status: 200, body, bytes: body.length, latency_ms: 0, fetched_at: new Date().toISOString(), content_type: 'application/json' };
    }
  };
}

/** { event_id, now, routes, previously? } -> { result, writes, calls } */
export async function dryReplay(env, store, { event_id, now, routes, previously = null }) {
  if (!env.TENNIS_SOURCE) throw new Error('TENNIS_SOURCE binding missing');
  const writes = [];
  const kv = dryKv(env.TENNIS_STATE, writes);
  if (previously) kv.get = async (k, type) => (k === `espn:live:${event_id}` ? previously : env.TENNIS_STATE.get(k, type));
  const client = archiveClient(env.TENNIS_SOURCE, routes);
  const ctx = { env: {}, store: dryStore(store, writes), kv, client, log: [], upstream: 0, now: Date.parse(now) };
  let result;
  try { result = await espnLiveObserve(ctx, event_id, { league: 'atp', maxStatus: 4, now: Date.parse(now) }); } catch (e) { result = { state: 'THREW', error: String(e?.stack || e).slice(0, 1200) }; }
  return { result, writes, calls: client.calls, log: ctx.log };
}
