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
import { dryReplay } from './diag.js';

export const VERSION = '0.3.2';
export const DIAG_KEY = 'live:diag:espn';
const DIAG_MAX = 400;
const ROUNDS = 3;          // CONFIGURED polls per run per live edition (intention; see CADENCE for what is measured)
const GAP_MS = 18000;      // spacing between rounds
const MAX_EDITIONS = 8;
const BUDGET_MS = 50000;  // no round starts that could not finish inside the minute (the next cron owns it)

// Two DIFFERENT concepts, never collapsed into one number: the configured intra-run polling intention above, and the
// cadence users actually get. MEASURED is evidence from production (docs/TENNISCAST.md), updated only from a new audit.
export const CADENCE = Object.freeze({
  scheduler_interval_s: 60, // Cloudflare cron '* * * * *'
  configured_rounds_per_run: ROUNDS,
  configured_round_gap_ms: GAP_MS,
  run_budget_ms: BUDGET_MS,
  measured_effective_observation_cadence: Object.freeze({
    summary: '~60 s, occasionally ~30 s',
    median_gap_s: 60.2, min_gap_s: 27.5, observations: 128,
    why: 'round 0 finishes ~8-12 s after a ~:18 cron start; round 1 fits the 50 s budget only sometimes; round 2 never',
    source: 'WTA 125 Adana WS Ruzic–Kostovic, 2026-10-02 18:06–20:34Z (scripts/qa/live-cadence.mjs)'
  })
});

// Idle minute (no live edition): KV writes only when something changes (2026-10-07; was 3 puts every minute, ~4.3k/day).
//  - live:owned / live:heartbeat: an empty ownership is identical to an absent or expired one for every reader
//    (espn-live.js liveOwnedSet), so they are written only to RELEASE editions a previous cycle owned;
//  - tennis-live:last_run: the cron-alive signal (scripts/canary/production.mjs: cycled within 3 min) is refreshed every
//    IDLE_RUN_EVERY_MS instead of every minute; any change of its content (leaving live) is written at once.
export const IDLE_RUN_EVERY_MS = 100e3;
export async function idleCycle(kv, started) {
  const owned = await kv.get('live:owned', 'json');
  if (owned?.length) {
    await kv.put('live:heartbeat', started, { expirationTtl: 300 });
    await kv.put('live:owned', '[]', { expirationTtl: 300 });
  }
  const s = { worker: 'tennis-live', started_at: started, editions: 0, note: 'no edition with a match in progress' };
  const last = await kv.get('tennis-live:last_run', 'json');
  const fresh = last && last.editions === 0 && last.note === s.note && Date.parse(started) - Date.parse(last.started_at) < IDLE_RUN_EVERY_MS;
  if (!fresh) await kv.put('tennis-live:last_run', JSON.stringify(s));
  return { ...s, kv_writes: (owned?.length ? 2 : 0) + (fresh ? 0 : 1) };
}

export async function liveCycle(env, { rounds = ROUNDS, gapMs = GAP_MS, budgetMs = BUDGET_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const t0 = Date.now();
  const store = storeFromEnv(env);
  const kv = env.TENNIS_STATE;
  if (!store || !kv) return { ok: false, error: 'not_configured' };
  const editions = ((await kv.get('live:editions', 'json')) || []).slice(0, MAX_EDITIONS);
  const started = new Date().toISOString();
  if (!editions.length) return idleCycle(kv, started);
  await kv.put('live:heartbeat', started, { expirationTtl: 300 });
  await kv.put('live:owned', JSON.stringify(editions.map((e) => e.edition_id)), { expirationTtl: 300 });
  const ctx = { env, store, kv, client: new SourceClient({ policies: livePolicies() }), log: [], upstream: 0 };
  const out = [];
  const diag = []; // ESPN (game-level) live pipeline stage trace, kept in a bounded internal KV ring (no payloads)
  let stillLive = editions;
  let lastRoundMs = 0;
  for (let i = 0; i < rounds && stillLive.length; i += 1) {
    if (i) {
      // the next round must FINISH inside the budget: elapsed + gap + the last round's own duration
      if (Date.now() - t0 + gapMs + lastRoundMs > budgetMs) break;
      await sleep(gapMs);
    }
    const r0 = Date.now();
    const next = [];
    for (const ed of stillLive) {
      let provider;
      let r;
      try { provider = providerFor(ed); r = await provider.observe(ctx, ed); } catch (e) { r = { state: 'ERROR', error: String(e?.message || e).slice(0, 200) }; }
      out.push({ round: i, source: provider?.key || null, event: ed.source === 'espn' ? ed.event_id : `${ed.event_id}-${ed.year}`, state: r.state, written: r.written, changes: r.changes, live: r.live, error: r.error,
        ...(provider?.key === 'espn' ? { held: r.held ?? null, skipped: r.skipped ?? null, attached: r.attached ?? null, trace: r.trace || null } : {}) });
      if (provider?.key === 'espn' && r.trace && Object.keys(r.trace).length) diag.push({ at: new Date().toISOString(), round: i, event: ed.event_id, state: r.state, live: r.live ?? 0, written: r.written ?? 0, held: r.held ?? 0, skipped: r.skipped ?? 0, error: r.error || null, trace: r.trace });
      if (r.state === 'PASS' && r.live) next.push(ed);
    }
    stillLive = next;
    lastRoundMs = Date.now() - r0;
  }
  const s = { worker: 'tennis-live', version: VERSION, started_at: started, finished_at: new Date().toISOString(), editions: editions.length, sources: [...new Set(editions.map((e) => e.source || 'wta'))], upstream_requests: ctx.upstream, store_requests: store.requests, rounds: out };
  await kv.put('tennis-live:last_run', JSON.stringify(s));
  if (diag.length) {
    const ring = ((await kv.get(DIAG_KEY, 'json')) || []).concat(diag).slice(-DIAG_MAX);
    await kv.put(DIAG_KEY, JSON.stringify(ring), { expirationTtl: 4 * 86400 });
    for (const d of diag) console.log(JSON.stringify({ espn_live_diag: d }));
  }
  return s;
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/health' || path === '/') return json(await health({ worker: 'tennis-live', version: VERSION, env, deps: ['TENNIS_STATE', 'TENNIS_SOURCE', 'TENNIS_MODEL_SUPABASE_URL', 'TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY'], extra: { cron: '* * * * *', cadence: CADENCE, providers: Object.values(LIVE_PROVIDERS).map((p) => ({ source: p.key, tour: p.tour, events: p.events, granularity: p.granularity, official: p.official })) } }), { headers: { 'cache-control': 'no-store' } });
    if (path === '/v1/live/runs' && request.method === 'POST') {
      const auth = request.headers.get('authorization') || '';
      if (!env.INGEST_ADMIN_TOKEN || auth !== `Bearer ${env.INGEST_ADMIN_TOKEN}`) return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      try { return json({ ok: true, data: await liveCycle(env, { rounds: 1 }) }, { headers: { 'cache-control': 'no-store' } }); } catch (e) { return json({ ok: false, error: String(e?.stack || e).slice(0, 800) }, { status: 500 }); }
    }
    // internal forensic surfaces (admin token): the ESPN stage-trace ring and the dry replay of archived payloads
    if (path === '/v1/live/diag' || path === '/v1/live/diag/replay') {
      const auth = request.headers.get('authorization') || '';
      if (!env.INGEST_ADMIN_TOKEN || auth !== `Bearer ${env.INGEST_ADMIN_TOKEN}`) return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      if (path === '/v1/live/diag') return json({ ok: true, data: (await env.TENNIS_STATE.get(DIAG_KEY, 'json')) || [] }, { headers: { 'cache-control': 'no-store' } });
      if (request.method !== 'POST') return json({ ok: false, error: 'POST a replay spec' }, { status: 405 });
      try { return json({ ok: true, data: await dryReplay(env, storeFromEnv(env), await request.json()) }, { headers: { 'cache-control': 'no-store' } }); } catch (e) { return json({ ok: false, error: String(e?.stack || e).slice(0, 800) }, { status: 500 }); }
    }
    if (path === '/v1/live/runs') {
      const last = env.TENNIS_STATE ? await env.TENNIS_STATE.get('tennis-live:last_run', 'json') : null;
      return json({ ok: !!last, data: last, meta: { semantics: 'most recent live cycle' } }, { headers: { 'cache-control': 'no-store' } });
    }
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  },
  // The cycle is AWAITED: work handed to ctx.waitUntil after the handler returns is cut off ~30 s later, and a live cycle
  // runs up to its 50 s budget (23 s measured with nothing ATP-live). The ESPN edition runs last, so a cut there loses
  // its writes silently after its reads were archived (2026-10-03 Beijing forensics).
  async scheduled(_e, env) {
    await liveCycle(env).catch(async (e) => {
      if (env.TENNIS_STATE) await env.TENNIS_STATE.put('tennis-live:last_error', JSON.stringify({ at: new Date().toISOString(), error: String(e?.stack || e).slice(0, 800) }));
    });
  }
};
