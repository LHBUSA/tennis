// tennis-ingest — source acquisition runtime. docs/ARCHITECTURE.md §Ingest.
//
// Cron (every 2 min) runs one bounded, polite tick:
//   1. calendar window refresh (every 3 h)            -> editions
//   2. matches for every active WTA/WTA 125/Slam edition -> matches, sets, participants, live state
//   3. pending match stats (bounded)                   -> tennis_match_stats
//   4. current weekly rankings (singles + doubles)     -> snapshots
//   5. one backfill unit (calendar discovery -> past editions -> ranking history -> Slam feeds)
//   6. Wikidata crosswalk pages (weekly)
// Every request goes through the polite client, is archived to R2, and is recorded in tennis_source_runs.
// A failure in one job never stops the others.

import { json } from '../../shared/envelope.js';
import { health } from '../../shared/health.js';
import { SourceClient } from '../../shared/http.js';
import { storeFromEnv } from '../../shared/store/postgrest.js';
import * as wta from '../../providers/wta.js';
import * as slams from '../../providers/slams.js';
import * as open from '../../providers/open.js';
import { calendarWindow, editionContext, editionMatches, pendingStats, rankingStep, wimbledonMen, ausopenPlayers, ausopenDayMatches, wikidataPage, TOUR_LEVELS, iso, addDays } from './jobs.js';

export const VERSION = '0.2.0';
const BACKFILL_FROM = '2025-01-01';       // match backfill start (current + previous season)
const RANK_HISTORY_FLOOR = '2023-01-02';  // weekly ranking history floor
const WIMBLEDON_YEARS = [2022, 2023, 2024, 2025];
const UPSTREAM_BUDGET = 30;

/** Kept for the canary endpoint + tests: one bounded request per adapter. */
export function canaryPlan() {
  const day = (o) => iso(new Date(Date.now() + o * 86400000));
  return [
    [wta.rankingsSingles, { pageSize: 5 }],
    [wta.rankingsDoubles, { pageSize: 5 }],
    [wta.calendar, { from: day(-7), to: day(21) }],
    [slams.wimbledonDraw, { year: 2025, eventCode: 'MS' }],
    [slams.ausopenDay, { year: 2026, day: 1 }],
    [open.wikidataCrosswalk, { limit: 5 }]
  ].map(([a, params]) => ({ ...a, request: () => a.request(params) }));
}

function isActive(e, today) {
  return e.live_scoring_id && TOUR_LEVELS.test(e.level || '') && addDays(e.start_date, -1) <= today && today <= addDays(e.end_date, 1);
}

async function step(ctx, name, fn) {
  try {
    const out = await fn();
    ctx.steps.push({ step: name, ok: true, out });
  } catch (e) {
    ctx.steps.push({ step: name, ok: false, error: String(e?.message || e).slice(0, 300) });
  }
}

export async function tick(env, { force = {} } = {}) {
  const store = storeFromEnv(env);
  const kv = env.TENNIS_STATE;
  if (!store || !kv) return { ok: false, error: 'not_configured', store: !!store, kv: !!kv };
  // one tick at a time: a slow tick must not overlap the next cron firing
  const lock = await kv.get('tick:lock');
  if (lock && Date.now() - Date.parse(lock) < 170 * 1000) return { ok: false, error: 'tick_in_progress', since: lock };
  await kv.put('tick:lock', new Date().toISOString(), { expirationTtl: 180 });
  try {
    return await tickInner(env, store, kv, force);
  } finally {
    await kv.delete('tick:lock');
  }
}

async function tickInner(env, store, kv, force) {
  const ctx = { env, store, kv, client: new SourceClient({ policies: { [wta.WTA_HOST]: wta.WTA_POLICY, 'query.wikidata.org': { min_interval_ms: 2000, timeout_ms: 60000 } } }), log: [], steps: [], upstream: 0 };
  const started = new Date();
  const today = iso(started);
  const hour = 3600 * 1000;

  // 1. calendar
  await step(ctx, 'calendar', async () => {
    const last = await kv.get('cal:last');
    if (!force.calendar && last && Date.now() - Date.parse(last) < 3 * hour) return 'fresh';
    const { ok, editions: eds } = await calendarWindow(ctx, addDays(today, -4), addDays(today, 45));
    if (!ok || !eds.length) return 'calendar_fetch_failed (keeping previous active list)';
    const active = await Promise.all(eds.filter((e) => isActive(e, today)).map(editionContext));
    await kv.put('cal:active', JSON.stringify(active));
    await kv.put('cal:last', started.toISOString());
    return { editions: eds.length, active: active.length };
  });

  // 2. active editions
  const active = (await kv.get('cal:active', 'json')) || [];
  const live = [];
  await step(ctx, 'matches', async () => {
    const out = [];
    // editions tennis-live is actively polling are its to write while its heartbeat is fresh
    const hb = await kv.get('live:heartbeat');
    const owned = hb && Date.now() - Date.parse(hb) < 150 * 1000 ? new Set((await kv.get('live:owned', 'json')) || []) : new Set();
    const prevLive = new Map(((await kv.get('live:editions', 'json')) || []).map((e) => [e.edition_id, e]));
    for (const ed of active.slice(0, 12)) {
      if (owned.has(ed.edition_id)) { out.push({ event: `${ed.event_id}-${ed.year}`, state: 'OWNED_BY_LIVE' }); if (prevLive.has(ed.edition_id)) live.push(prevLive.get(ed.edition_id)); continue; }
      const r = await editionMatches(ctx, ed);
      out.push({ event: `${ed.event_id}-${ed.year}`, ...r });
      if (r.live) live.push({ ...ed, live: r.live });
    }
    await kv.put('live:editions', JSON.stringify(live), { expirationTtl: 900 });
    return out;
  });

  // 3. stats
  await step(ctx, 'stats', () => pendingStats(ctx, 10));

  // 4. current rankings
  await step(ctx, 'rankings', async () => {
    const monday = wta.rankingMonday(started);
    const out = {};
    for (const kind of ['singles', 'doubles']) {
      const hold = await kv.get(`rank:wait:${kind}:${monday}`);
      if (hold) { out[kind] = 'waiting_for_publication'; continue; }
      const st = await rankingStep(ctx, kind, monday, 5);
      if (st.list_date && st.list_date < monday && st.page <= 5) {
        // this week's list is not published yet; the API answered with the previous one. Retry in 3 h.
        await kv.delete(`rank:${kind}:${monday}`);
        await kv.put(`rank:wait:${kind}:${monday}`, '1', { expirationTtl: 3 * 3600 });
        out[kind] = `not_published (latest ${st.list_date})`;
      } else out[kind] = st;
    }
    return out;
  });

  // 5. backfill — one unit per tick, only with budget left
  await step(ctx, 'backfill', async () => {
    if (ctx.upstream >= UPSTREAM_BUDGET) return 'budget_spent';
    const cal = (await kv.get('bf:cal', 'json')) || { from: BACKFILL_FROM, done: false };
    if (!cal.done) {
      const to = addDays(cal.from, 13);
      const { ok, editions: eds } = await calendarWindow(ctx, cal.from, to < today ? to : today);
      if (!ok) return { calendar_window: cal.from, state: 'fetch_failed_will_retry' };
      const past = await Promise.all(eds.filter((e) => e.live_scoring_id && TOUR_LEVELS.test(e.level || '') && e.end_date < addDays(today, -1)).map(editionContext));
      const queue = (await kv.get('bf:events', 'json')) || [];
      const seen = new Set(queue.map((q) => q.edition_id));
      for (const p of past) if (!seen.has(p.edition_id)) queue.push(p);
      await kv.put('bf:events', JSON.stringify(queue));
      const next = addDays(cal.from, 14);
      await kv.put('bf:cal', JSON.stringify(next > today ? { from: next, done: true } : { from: next, done: false }));
      return { calendar_window: cal.from, queued: queue.length };
    }
    const queue = (await kv.get('bf:events', 'json')) || [];
    if (queue.length) {
      const ed = queue.shift();
      const r = await editionMatches(ctx, ed);
      if (r.state === 'PASS') await kv.put('bf:events', JSON.stringify(queue));
      else { ed.attempts = (ed.attempts || 0) + 1; if (ed.attempts < 4) queue.push(ed); await kv.put('bf:events', JSON.stringify(queue)); }
      return { edition: `${ed.name} ${ed.year}`, ...r, remaining: queue.length };
    }
    for (const y of WIMBLEDON_YEARS) {
      if (await kv.get(`bf:wim:${y}`)) continue;
      const r = await wimbledonMen(ctx, y);
      if (r.state === 'PASS') await kv.put(`bf:wim:${y}`, iso(new Date()));
      return { wimbledon_ms: y, ...r };
    }
    const ao = (await kv.get('bf:ao', 'json')) || { year: 2026, day: 1 };
    if (ao.day <= 15) {
      const r = await ausopenDayMatches(ctx, ao.year, ao.day);
      if (r.state === 'PASS') await kv.put('bf:ao', JSON.stringify({ year: ao.year, day: ao.day + 1 }));
      return { ausopen: `${ao.year} day ${ao.day}`, ...r };
    }
    const rk = (await kv.get('bf:rank', 'json')) || { date: addDays(wta.rankingMonday(started), -7) };
    if (rk.date < RANK_HISTORY_FLOOR) return 'rank_history_complete';
    const s = await rankingStep(ctx, 'singles', rk.date, 6);
    const d = s.done ? await rankingStep(ctx, 'doubles', rk.date, 6) : { done: false };
    if (s.done && d.done) await kv.put('bf:rank', JSON.stringify({ date: addDays(rk.date, -7) }));
    return { ranking_history: rk.date, singles: s.page, doubles: d.page ?? 0 };
  });

  // 6. weekly identity jobs
  await step(ctx, 'identity', async () => {
    if (ctx.upstream >= UPSTREAM_BUDGET) return 'budget_spent';
    const st = (await kv.get('wd:state', 'json')) || { props: ['P597', 'P536'], i: 0, offset: 0, next_at: null };
    if (st.next_at && Date.now() < Date.parse(st.next_at)) return 'fresh';
    const prop = st.props[st.i];
    const r = await wikidataPage(ctx, prop, st.offset);
    if (r.state !== 'PASS') return r;
    if (r.rows < 1500) { st.i += 1; st.offset = 0; } else st.offset += 1500;
    if (st.i >= st.props.length) {
      Object.assign(st, { i: 0, offset: 0, next_at: new Date(Date.now() + 7 * 86400000).toISOString() });
      const ao = await ausopenPlayers(ctx, started.getUTCFullYear() + (started.getUTCMonth() >= 10 ? 1 : 0)).catch((e) => ({ state: 'ERROR', error: String(e) }));
      r.ausopen = ao;
    }
    await kv.put('wd:state', JSON.stringify(st));
    return { prop, ...r };
  });

  const summary = { worker: 'tennis-ingest', version: VERSION, started_at: started.toISOString(), finished_at: new Date().toISOString(), upstream_requests: ctx.upstream, store_requests: store.requests, client: ctx.client.stats, steps: ctx.steps, runs: ctx.log.slice(-60) };
  await kv.put('tennis-ingest:last_run', JSON.stringify(summary));
  return summary;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/health' || path === '/') {
      return json(await health({ worker: 'tennis-ingest', version: VERSION, env, deps: ['TENNIS_STATE', 'TENNIS_SOURCE', 'TENNIS_MODEL_SUPABASE_URL', 'TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY', 'INGEST_ADMIN_TOKEN'], extra: { mode: 'ingest', cron: '*/2 * * * *' } }), { headers: { 'cache-control': 'no-store' } });
    }
    if (path === '/v1/runs' && request.method === 'GET') {
      if (!env.TENNIS_STATE) return json({ ok: false, error: 'not_configured' }, { status: 503 });
      const [last, bfCal, bfEvents, bfRank, active] = await Promise.all(['tennis-ingest:last_run', 'bf:cal', 'bf:events', 'bf:rank', 'cal:active'].map((k) => env.TENNIS_STATE.get(k, 'json')));
      return json({ ok: true, data: { last_run: last, backfill: { calendar: bfCal, events_remaining: bfEvents?.length ?? null, ranking_history: bfRank }, active_editions: active }, meta: { semantics: 'most recent ingest tick + backfill cursors' } }, { headers: { 'cache-control': 'no-store' } });
    }
    if (path === '/v1/runs' && request.method === 'POST') {
      const auth = request.headers.get('authorization') || '';
      if (!env.INGEST_ADMIN_TOKEN || auth !== `Bearer ${env.INGEST_ADMIN_TOKEN}`) return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      return json({ ok: true, data: await tick(env, { force: { calendar: url.searchParams.get('calendar') === '1' } }) }, { headers: { 'cache-control': 'no-store' } });
    }
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env));
  }
};
