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
import * as espn from '../../providers/espn.js';
import { espnAtpStep, espnWtaStep, espnRankingStep } from './espn-jobs.js';
import { buildDnaSnapshots } from './dna-job.js';
import { buildDnaV2 } from './dna-v2-job.js';
import { wtaHistoryStep } from './wta-history-job.js';
import { wtaEditionFactsStep, drawSheet } from './context-jobs.js';
import { wtaRecordsStep } from './wta-records-job.js';
import { planTick, afterRun, LANE_STATE_KEY } from './lanes.js';
import { calendarWindow, editionContext, editionMatches, pendingStats, rankingStep, wimbledonMen, wimbledonArchiveStep, rolandGarrosStep, ausopenPlayers, ausopenDayMatches, ausopenPointStep, ausopenGapStep, wikidataPage, TOUR_LEVELS, iso, addDays } from './jobs.js';

export const VERSION = '0.3.0';
const BACKFILL_FROM = '2025-01-01';       // match backfill start (current + previous season)
const RANK_HISTORY_FLOOR = '2020-01-06';  // weekly ranking history floor (phase A: 2020 ->)
const HISTORY_PHASE_A = { from: '2020-01-01', to: '2024-12-31' }; // after the current-season pass
// Wimbledon matches come ONLY from the draws archive (wimbledonArchiveStep) so one real match is one row; the
// current-edition feed is used for identity (2025 join) and, later, 2025 stats/point-by-point enrichment.
const WIMBLEDON_YEARS = [];
const UPSTREAM_BUDGET = 40;

/** Kept for the canary endpoint + tests: one bounded request per adapter. */
export function canaryPlan() {
  const day = (o) => iso(new Date(Date.now() + o * 86400000));
  return [
    [wta.rankingsSingles, { pageSize: 5 }],
    [wta.rankingsDoubles, { pageSize: 5 }],
    [wta.calendar, { from: day(-7), to: day(21) }],
    [slams.wimbledonDraw, { year: 2025, eventCode: 'MS' }],
    [slams.ausopenDay, { year: 2026, day: 1 }],
    [open.wikidataCrosswalk, { limit: 5 }],
    [espn.espnEvent, { id: '154-2026' }],
    [espn.espnRankingWeek, { season: 2026, week: 38 }]
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

export async function tick(env, { force = {}, only = null, budget = null, params = {} } = {}) {
  const store = storeFromEnv(env);
  const kv = env.TENNIS_STATE;
  if (!store || !kv) return { ok: false, error: 'not_configured', store: !!store, kv: !!kv };
  // sharded history runs take their own per-shard lock (they never touch another lane's state); everything
  // else is one tick at a time: a slow tick must not overlap the next cron firing
  if (only === 'wta_history' && Number(params.shards) > 1) {
    const lk = `tick:lock:wta_history:${params.shard}/${params.shards}`;
    const held = await kv.get(lk);
    if (held && Date.now() - Date.parse(held) < 290 * 1000) return { ok: false, error: 'tick_in_progress', since: held };
    await kv.put(lk, new Date().toISOString(), { expirationTtl: 300 });
    try { return await tickInner(env, store, kv, force, { only, budget, params }); } finally { await kv.delete(lk); }
  }
  const lock = await kv.get('tick:lock');
  if (lock && Date.now() - Date.parse(lock) < 170 * 1000) return { ok: false, error: 'tick_in_progress', since: lock };
  await kv.put('tick:lock', new Date().toISOString(), { expirationTtl: 180 });
  try {
    return await tickInner(env, store, kv, force, { only, budget, params });
  } finally {
    await kv.delete('tick:lock');
  }
}

async function tickInner(env, store, kv, force, { only = null, budget = null, params = {} } = {}) {
  const ctx = { env, store, kv, client: new SourceClient({ policies: { [wta.WTA_HOST]: wta.WTA_POLICY, [espn.ESPN_HOST]: espn.ESPN_POLICY, 'query.wikidata.org': { min_interval_ms: 2000, timeout_ms: 60000 }, 'www.protennislive.com': { min_interval_ms: 1500, timeout_ms: 30000, retries: 1 }, 'wtafiles.wtatennis.com': { min_interval_ms: 1500, timeout_ms: 30000, retries: 1 } } }), log: [], steps: [], upstream: 0 };
  // admin drive of one lane (backfill acceleration): nothing else runs in this invocation
  if (only) return laneOnly(ctx, only, budget, params);
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
  await step(ctx, 'stats', () => pendingStats(ctx, 20));

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

  async function rankingHistoryStep() {
    const rk = (await kv.get('bf:rank', 'json')) || { date: addDays(wta.rankingMonday(started), -7) };
    if (rk.date < RANK_HISTORY_FLOOR) return 'rank_history_complete';
    const s = await rankingStep(ctx, 'singles', rk.date, 6);
    const d = s.done ? await rankingStep(ctx, 'doubles', rk.date, 6) : { done: false };
    if (s.done && d.done) await kv.put('bf:rank', JSON.stringify({ date: addDays(rk.date, -7) }));
    return { ranking_history: rk.date, singles: s.page, doubles: d.page ?? 0, list_date: s.list_date || null };
  }

  // 5. backfill — one unit per tick, only with budget left
  await step(ctx, 'backfill', async () => {
    if (ctx.upstream >= UPSTREAM_BUDGET) return 'budget_spent';
    // Lane scheduler (lanes.js): current AO work first every tick, then ONE rotating history lane round-robin.
    // Each lane owns its state + backoff in KV `lane:<name>`; no lane can hold another lane's slot.
    const LANES = {
      async ao_current() {
        const ao = (await kv.get('bf:ao', 'json')) || { year: 2026, day: 1 };
        if (ao.day <= 15) {
          const r = await ausopenDayMatches(ctx, ao.year, ao.day);
          if (r.state === 'PASS') await kv.put('bf:ao', JSON.stringify({ year: ao.year, day: ao.day + 1 }));
          return { ok: r.state === 'PASS', out: { ausopen: `${ao.year} day ${ao.day}`, ...r } };
        }
        const aoq = (await kv.get('bf:aoq', 'json')) || { year: 2026, day: 1 };
        if (aoq.day <= 4) {
          const r = await ausopenDayMatches(ctx, aoq.year, aoq.day, 'Q');
          if (r.state === 'PASS') await kv.put('bf:aoq', JSON.stringify({ year: aoq.year, day: aoq.day + 1 }));
          return { ok: r.state === 'PASS', out: { ausopen_qualifying: `${aoq.year} day ${aoq.day}`, ...r } };
        }
        // every expected main-draw slot exists (walkovers are absent from the day results)
        const gap = await ausopenGapStep(ctx, 2026);
        if (!gap.done || (gap.results || []).length) return { ok: true, out: { ausopen_gap_fill: gap } };
        const pbp = await ausopenPointStep(ctx, 20);
        const failed = (pbp.results || []).filter((x) => !['PASS', 'EMPTY', 'HELD'].includes(x.state)).length;
        return { ok: failed < (pbp.results || []).length || !(pbp.results || []).length, done: !!pbp.done, out: { ausopen_match_centre: pbp } };
      },
      async rank_history() {
        const r = await rankingHistoryStep();
        return { ok: true, done: r === 'rank_history_complete', out: r };
      },
      async wimbledon_archive() {
        const r = await wimbledonArchiveStep(ctx);
        return { ok: !r.error || r.state === 'NOT_AVAILABLE', done: !!r.done, out: r };
      },
      async rolandgarros() {
        const r = await rolandGarrosStep(ctx);
        return { ok: !r.error, done: !!r.done, out: r };
      },
      async espn_atp() {
        // a block / transient failure throws -> this lane backs off alone; the cursor never skips an event
        const r = await espnAtpStep(ctx, { budget: 20 });
        return { ok: true, out: r };
      },
      async espn_wta() {
        const r = await espnWtaStep(ctx, { budget: 20 });
        return { ok: true, out: r };
      },
      async wta_history() {
        const r = await wtaHistoryStep(ctx, { pages: 2 });
        return { ok: true, done: false, out: r };
      },
      async wta_records() {
        const r = await wtaRecordsStep(ctx, { budget: 6 });
        return { ok: true, done: false, out: r };
      },
      async espn_wta_rankings() {
        const r = await espnRankingStep(ctx, { weeks: 8, league: 'wta' });
        return { ok: true, done: false, out: r };
      },
      async espn_rankings() {
        const r = await espnRankingStep(ctx, { weeks: 8 });
        return { ok: true, done: false, out: r };
      },
      async wta_calendar() {
        let calKey = 'bf:cal';
        let cal = (await kv.get('bf:cal', 'json')) || { from: BACKFILL_FROM, done: false };
        let ceiling = today;
        if (cal.done) {
          calKey = 'bf:cal:a';
          cal = (await kv.get(calKey, 'json')) || { from: HISTORY_PHASE_A.from, done: false };
          ceiling = HISTORY_PHASE_A.to;
        }
        const queue = (await kv.get('bf:events', 'json')) || [];
        if (!cal.done && queue.length < 40) {
          const to = addDays(cal.from, 13);
          const { ok, editions: eds } = await calendarWindow(ctx, cal.from, to < ceiling ? to : ceiling);
          if (!ok) return { ok: false, out: { calendar_window: cal.from, state: 'fetch_failed_will_retry' } };
          const past = await Promise.all(eds.filter((e) => e.live_scoring_id && TOUR_LEVELS.test(e.level || '') && e.end_date < addDays(today, -1)).map(editionContext));
          const seen = new Set(queue.map((q) => q.edition_id));
          for (const p of past) if (!seen.has(p.edition_id)) queue.push(p);
          await kv.put('bf:events', JSON.stringify(queue));
          const next = addDays(cal.from, 14);
          await kv.put(calKey, JSON.stringify(next > ceiling ? { from: next, done: true } : { from: next, done: false }));
          return { ok: true, out: { calendar_window: cal.from, phase: calKey, queued: queue.length } };
        }
        if (!queue.length) return { ok: true, done: cal.done, out: 'calendar_backfill_complete' };
        const done = [];
        let passed = 0;
        for (let k = 0; k < 2 && queue.length; k += 1) {
          const ed = queue.shift();
          const r = await editionMatches(ctx, ed);
          if (r.state === 'PASS') passed += 1; else { ed.attempts = (ed.attempts || 0) + 1; if (ed.attempts < 4) queue.push(ed); }
          done.push({ edition: `${ed.name} ${ed.year}`, state: r.state, written: r.written, held: r.held });
        }
        await kv.put('bf:events', JSON.stringify(queue));
        return { ok: passed > 0 || !done.length, out: { editions: done, remaining: queue.length } };
      }
    };
    const DECL = [['ao_current', true], ['espn_atp', true], ['espn_wta', true], ['rank_history', false], ['wimbledon_archive', false], ['rolandgarros', false], ['wta_calendar', false], ['espn_rankings', false], ['espn_wta_rankings', false], ['wta_history', false], ['wta_records', false]];
    const states = Object.fromEntries(await Promise.all(DECL.map(async ([n]) => [n, (await kv.get(LANE_STATE_KEY(n), 'json')) || {}])));
    const rr = Number(await kv.get('lanes:rr')) || 0;
    const plan = planTick({ now: Date.now(), lanes: DECL.map(([name, priority]) => ({ name, priority, ...states[name] })), rr });
    await kv.put('lanes:rr', String(plan.rr));
    const out = {};
    for (const name of plan.run) {
      if (!['ao_current', 'espn_atp', 'espn_wta'].includes(name) && ctx.upstream >= UPSTREAM_BUDGET) { out[name] = 'budget_spent'; continue; }
      let r;
      try { r = await LANES[name](); } catch (e) { r = { ok: false, out: { error: String(e?.message || e).slice(0, 200) } }; }
      await kv.put(LANE_STATE_KEY(name), JSON.stringify(afterRun(states[name], { ok: r.ok, done: r.done, now: Date.now() })));
      out[name] = r.out;
    }
    return { lanes: plan.run, ...out };
  });

  // 5b. daily Tennis DNA snapshots (stored values the API / PBEcast read)
  await step(ctx, 'dna', async () => {
    const day = iso(started);
    // historical lane: one first-of-month snapshot per daily run, walking back to 2025-02-01 (stats begin 2024-12-29)
    const hist = (await kv.get('dna:hist')) || `${day.slice(0, 7)}-01`;
    const dates = [];
    if (force.dna || (await kv.get('dna:last')) !== day) dates.push(day);
    if (hist >= '2025-02-01') dates.push(hist);
    if (!dates.length) return 'fresh';
    const r = await buildDnaSnapshots(ctx, { asOfs: dates });
    if (dates.includes(day)) await kv.put('dna:last', day);
    if (dates.includes(hist)) { const d = new Date(`${hist}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); await kv.put('dna:hist', d.toISOString().slice(0, 10)); }
    return r;
  });

  // 5c. daily Tennis DNA v2 (Match DNA + PBE Rating): today + one historical month-start per day, back to 2008
  await step(ctx, 'dna_v2', async () => {
    const day = iso(started);
    if (!force.dna && (await kv.get('dna2:last')) === day) return 'fresh';
    const hist = (await kv.get('dna2:hist')) || `${day.slice(0, 7)}-01`;
    const asOfs = [day, ...(hist >= '2008-01-01' && hist !== day ? [hist] : [])];
    const r = await buildDnaV2(ctx, { asOfs });
    await kv.put('dna2:last', day);
    if (asOfs.length > 1) { const d = new Date(`${hist}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); await kv.put('dna2:hist', d.toISOString().slice(0, 10)); }
    return { as_of: r.as_of, snapshots: r.snapshots, ratings: r.ratings, ms: r.ms, published: Object.fromEntries(Object.entries(r.tours).map(([t, x]) => [t, x.published])) };
  });

  // 6. weekly identity jobs
  await step(ctx, 'identity', async () => {
    // one Wikidata page per tick: a small reserved allowance so history backfill can never starve identity
    if (ctx.upstream >= UPSTREAM_BUDGET + 5) return 'budget_spent';
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

/** Run ONE ESPN lane with an explicit request budget (POST /v1/runs?lane=espn_atp&budget=N). Same code,
 *  same lane state + backoff as the cron; used to accelerate a backfill without widening every tick. */
async function laneOnly(ctx, lane, budget, params = {}) {
  const b = Math.max(1, Math.min(Number(budget) || 20, 120));
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const asOfs = String(params.as_of || '').split(',').filter((d) => day.test(d));
  const fns = { espn_atp: () => espnAtpStep(ctx, { budget: b }), espn_rankings: () => espnRankingStep(ctx, { weeks: Math.min(b, 40) }), espn_wta: () => espnWtaStep(ctx, { budget: b }), wta_history: () => wtaHistoryStep(ctx, { admin: true, resume: /^\d+:\d+$/.test(params.resume || '') ? { i: Number(params.resume.split(':')[0]), page: Number(params.resume.split(':')[1]) } : null, pages: Math.min(b, 8), shard: Math.max(0, Number(params.shard) || 0), shards: Math.min(8, Math.max(1, Number(params.shards) || 1)) }), espn_wta_rankings: () => espnRankingStep(ctx, { weeks: Math.min(b, 40), league: 'wta' }), wta_edition_facts: () => wtaEditionFactsStep(ctx, { pages: Math.min(b, 10) }), wta_records: () => wtaRecordsStep(ctx, { budget: Math.min(b, 60) }), dna_v2: () => buildDnaV2(ctx, { ...(asOfs.length ? { asOfs } : {}), write: params.write !== '0' }) };
  if (!fns[lane]) return { ok: false, error: 'unknown lane', lanes: Object.keys(fns) };
  const state = (await ctx.kv.get(LANE_STATE_KEY(lane), 'json')) || {};
  let r;
  try { r = { ok: true, out: await fns[lane]() }; } catch (e) { r = { ok: false, out: { error: String(e?.message || e).slice(0, 300) } }; }
  await ctx.kv.put(LANE_STATE_KEY(lane), JSON.stringify(afterRun(state, { ok: r.ok, now: Date.now() })));
  return { worker: 'tennis-ingest', version: VERSION, lane, budget: b, ok: r.ok, upstream_requests: ctx.upstream, store_requests: ctx.store.requests, client: ctx.client.stats, result: r.out, runs: ctx.log.slice(-80) };
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
      const [last, bfCal, bfEvents, bfRank, active, bfEspn, bfEspnRank, laneEspn, bfEspnW, bfEspnRankW] = await Promise.all(['tennis-ingest:last_run', 'bf:cal', 'bf:events', 'bf:rank', 'cal:active', 'bf:espn', 'bf:espnrank', 'lane:espn_atp', 'bf:espn:wta', 'bf:espnrank:wta'].map((k) => env.TENNIS_STATE.get(k, 'json')));
      const espnState = bfEspn ? { history_year: bfEspn.year, history_queue: bfEspn.queue ? bfEspn.queue.length : null, current_listed_at: bfEspn.cur?.listed_at, current_queue: bfEspn.cur?.queue?.length ?? 0, current_done: bfEspn.cur?.done?.length ?? 0, lane: laneEspn } : null;
      return json({ ok: true, data: { last_run: last, backfill: { calendar: bfCal, events_remaining: bfEvents?.length ?? null, ranking_history: bfRank, espn_atp: espnState, espn_wta: bfEspnW ? { history_year: bfEspnW.year, history_queue: bfEspnW.queue ? bfEspnW.queue.length : null, current_queue: bfEspnW.cur?.queue?.length ?? 0, current_done: bfEspnW.cur?.done?.length ?? 0 } : null, espn_wta_rankings: bfEspnRankW ? { current: `${bfEspnRankW.season} w${bfEspnRankW.week}`, history: bfEspnRankW.hist, source_errors: bfEspnRankW.source_errors || [] } : null, espn_rankings: bfEspnRank ? { current: `${bfEspnRank.season} w${bfEspnRank.week}`, history: bfEspnRank.hist, relinked: bfEspnRank.relinked } : null }, active_editions: active }, meta: { semantics: 'most recent ingest tick + backfill cursors' } }, { headers: { 'cache-control': 'no-store' } });
    }
    // admin: store an approved, pipeline-generated player-media derivative (scripts/media/photos.mjs)
    if (path === '/v1/media' && request.method === 'PUT') {
      const auth = request.headers.get('authorization') || '';
      if (!env.INGEST_ADMIN_TOKEN || auth !== `Bearer ${env.INGEST_ADMIN_TOKEN}`) return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      const key = url.searchParams.get('key') || '';
      // player identity derivatives, or editorial derivatives (scripts/media/editorial.mjs)
      if (!(/^players\/[0-9a-f-]{36}\/(portrait|square|thumb|wide)\.(webp|jpg)$/.test(key) || /^editorial\/[a-z0-9-]{1,60}\/(wide-(2400|1600|1200|800|480)|std-(1200|800)|card)\.(webp|jpg)$/.test(key)) || !env.TENNIS_MEDIA) return json({ ok: false, error: 'bad_key' }, { status: 400 });
      const ct = key.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
      await env.TENNIS_MEDIA.put(key, await request.arrayBuffer(), { httpMetadata: { contentType: ct, cacheControl: 'public, max-age=31536000, immutable' } });
      return json({ ok: true, key });
    }
    // admin: one honest request to an allow-listed source URL from Cloudflare egress (access research only:
    // no retries, no alternate user agents, no bypass). Reports status, size, latency and challenge markers.
    if (path === '/v1/probe' && request.method === 'POST') {
      const auth = request.headers.get('authorization') || '';
      if (!env.INGEST_ADMIN_TOKEN || auth !== `Bearer ${env.INGEST_ADMIN_TOKEN}`) return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      const PROBES = { espn_core_event: 'https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/events/154-2026', espn_site_scoreboard: 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard', usopen_robots: 'https://www.usopen.org/robots.txt', usopen_ms_2025: 'https://www.usopen.org/en_US/scores/feeds/2025/draws/MS.json', usopen_home: 'https://www.usopen.org/' };
      const target = PROBES[url.searchParams.get('target')];
      if (!target) return json({ ok: false, error: 'unknown target', targets: Object.keys(PROBES) }, { status: 400 });
      const t0 = Date.now();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      try {
        const r = await fetch(target, { headers: { 'user-agent': 'PropBetEdge-Tennis/0.2 (+https://tennis.propbetedge.ai/sources)', accept: '*/*' }, signal: ctl.signal });
        const body = await r.text();
        return json({ ok: true, data: { target, status: r.status, bytes: body.length, ms: Date.now() - t0, server: r.headers.get('server'), challenge: /challenge|captcha|akamai|access denied|cf-chl/i.test(body.slice(0, 4000)), content_type: r.headers.get('content-type') } }, { headers: { 'cache-control': 'no-store' } });
      } catch (e) {
        return json({ ok: true, data: { target, status: null, ms: Date.now() - t0, error: ctl.signal.aborted ? 'timeout_20s' : String(e.message).slice(0, 200) } }, { headers: { 'cache-control': 'no-store' } });
      } finally { clearTimeout(timer); }
    }
    // admin: one allow-listed official draw sheet (PDF) via the polite client, archived byte-exact to R2
    if (path === '/v1/drawsheet' && request.method === 'GET') {
      const auth = request.headers.get('authorization') || '';
      if (!env.INGEST_ADMIN_TOKEN || auth !== `Bearer ${env.INGEST_ADMIN_TOKEN}`) return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      const store = storeFromEnv(env);
      const ctx = { env, store, kv: env.TENNIS_STATE, client: new SourceClient({ policies: { 'www.protennislive.com': { min_interval_ms: 1500, timeout_ms: 30000, retries: 1 }, 'wtafiles.wtatennis.com': { min_interval_ms: 1500, timeout_ms: 30000, retries: 1 } } }), upstream: 0, log: [] };
      let r;
      try { r = await drawSheet(ctx, { source: url.searchParams.get('source'), year: url.searchParams.get('year'), tid: url.searchParams.get('tid'), doc: url.searchParams.get('doc') }); } catch (e) { return json({ ok: false, error: String(e?.message || e).slice(0, 200), blocked: e?.code === 'source_blocked' }, { status: 502 }); }
      if (r.status !== 200) return json({ ok: false, status: r.status, error: r.error || null, content_type: r.content_type || null }, { status: r.status === 400 ? 400 : 404 });
      return new Response(r.body, { headers: { 'content-type': 'application/pdf', 'x-capture-id': r.capture.capture_id, 'x-sha256': r.capture.content_sha256, 'x-source-url': r.capture.url, 'x-captured-at': r.capture.captured_at, 'cache-control': 'no-store' } });
    }
    if (path === '/v1/runs' && request.method === 'POST') {
      const auth = request.headers.get('authorization') || '';
      if (!env.INGEST_ADMIN_TOKEN || auth !== `Bearer ${env.INGEST_ADMIN_TOKEN}`) return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      return json({ ok: true, data: await tick(env, { force: { calendar: url.searchParams.get('calendar') === '1', dna: url.searchParams.get('dna') === '1' }, only: url.searchParams.get('lane'), budget: url.searchParams.get('budget'), params: { as_of: url.searchParams.get('as_of'), write: url.searchParams.get('write'), shard: url.searchParams.get('shard'), shards: url.searchParams.get('shards'), resume: url.searchParams.get('resume') } }) }, { headers: { 'cache-control': 'no-store' } });
    }
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env));
  }
};
