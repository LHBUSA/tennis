// tennis-live — TennisCast live runtime. docs/TENNISCAST.md.
//
// Cron every minute. For editions that tennis-ingest last saw with a match in progress (KV
// `live:editions`), poll the source that owns the edition's live state (router.js: official WTA feed for WTA
// editions, the secondary ESPN ATP feed for ATP events) ~every 20 s inside the invocation and write through the
// SAME tested writer as ingest. Every observed score/state change lands in tennis_source_changes, which is the
// replayable observed-state stream. Nothing is interpolated between observations: if the source jumps
// from 30-15 to a new game, that jump is what we record.
//
// Ownership: while this Worker's heartbeat is fresh, tennis-ingest skips the editions listed in
// `live:owned`, so the two never write the same edition concurrently.

import { json } from '../../shared/envelope.js';
import { health } from '../../shared/health.js';
import { SourceClient } from '../../shared/http.js';
import { storeFromEnv } from '../../shared/store/postgrest.js';
import { providerFor, livePolicies, LIVE_PROVIDERS } from './router.js';

export const VERSION = '0.3.0';
const ROUNDS = 3;          // polls per minute per live edition
const GAP_MS = 18000;      // spacing between rounds
const MAX_EDITIONS = 8;
const BUDGET_MS = 50000;  // no round starts that could not finish inside the minute (the next cron owns it)

export async function liveCycle(env, { rounds = ROUNDS, gapMs = GAP_MS, budgetMs = BUDGET_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const t0 = Date.now();
  const store = storeFromEnv(env);
  const kv = env.TENNIS_STATE;
  if (!store || !kv) return { ok: false, error: 'not_configured' };
  const editions = ((await kv.get('live:editions', 'json')) || []).slice(0, MAX_EDITIONS);
  const started = new Date().toISOString();
  await kv.put('live:heartbeat', started, { expirationTtl: 300 });
  await kv.put('live:owned', JSON.stringify(editions.map((e) => e.edition_id)), { expirationTtl: 300 });
  if (!editions.length) {
    const s = { worker: 'tennis-live', started_at: started, editions: 0, note: 'no edition with a match in progress' };
    await kv.put('tennis-live:last_run', JSON.stringify(s));
    return s;
  }
  const ctx = { env, store, kv, client: new SourceClient({ policies: livePolicies() }), log: [], upstream: 0 };
  const out = [];
  let stillLive = editions;
  for (let i = 0; i < rounds && stillLive.length; i += 1) {
    if (i) {
      if (Date.now() - t0 + gapMs > budgetMs) break;
      await sleep(gapMs);
    }
    const next = [];
    for (const ed of stillLive) {
      let provider;
      let r;
      try { provider = providerFor(ed); r = await provider.observe(ctx, ed); } catch (e) { r = { state: 'ERROR', error: String(e?.message || e).slice(0, 200) }; }
      out.push({ round: i, source: provider?.key || null, event: ed.source === 'espn' ? ed.event_id : `${ed.event_id}-${ed.year}`, state: r.state, written: r.written, changes: r.changes, live: r.live, error: r.error });
      if (r.state === 'PASS' && r.live) next.push(ed);
    }
    stillLive = next;
  }
  const s = { worker: 'tennis-live', version: VERSION, started_at: started, finished_at: new Date().toISOString(), editions: editions.length, sources: [...new Set(editions.map((e) => e.source || 'wta'))], upstream_requests: ctx.upstream, store_requests: store.requests, rounds: out };
  await kv.put('tennis-live:last_run', JSON.stringify(s));
  return s;
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/health' || path === '/') return json(await health({ worker: 'tennis-live', version: VERSION, env, deps: ['TENNIS_STATE', 'TENNIS_SOURCE', 'TENNIS_MODEL_SUPABASE_URL', 'TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY'], extra: { cron: '* * * * *', cadence_s: GAP_MS / 1000, providers: Object.values(LIVE_PROVIDERS).map((p) => ({ source: p.key, tour: p.tour, events: p.events, granularity: p.granularity, official: p.official })) } }), { headers: { 'cache-control': 'no-store' } });
    if (path === '/v1/live/runs' && request.method === 'POST') {
      const auth = request.headers.get('authorization') || '';
      if (!env.INGEST_ADMIN_TOKEN || auth !== `Bearer ${env.INGEST_ADMIN_TOKEN}`) return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      try { return json({ ok: true, data: await liveCycle(env, { rounds: 1 }) }, { headers: { 'cache-control': 'no-store' } }); } catch (e) { return json({ ok: false, error: String(e?.stack || e).slice(0, 800) }, { status: 500 }); }
    }
    if (path === '/v1/live/runs') {
      const last = env.TENNIS_STATE ? await env.TENNIS_STATE.get('tennis-live:last_run', 'json') : null;
      return json({ ok: !!last, data: last, meta: { semantics: 'most recent live cycle' } }, { headers: { 'cache-control': 'no-store' } });
    }
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  },
  async scheduled(_e, env, ctx) {
    ctx.waitUntil(liveCycle(env).catch(async (e) => {
      if (env.TENNIS_STATE) await env.TENNIS_STATE.put('tennis-live:last_error', JSON.stringify({ at: new Date().toISOString(), error: String(e?.stack || e).slice(0, 800) }));
    }));
  }
};
