// Newsroom publication-drought watchdog (LHBUSA/tennis#15). Eligible stories kept failing their gates for three days while
// zero articles published, and nothing surfaced it. Every DROUGHT_CHECK_MIN the cron computes, from two small reads, the
// last DROUGHT_WINDOW_H of events (wire / duplicate / eligible / held / published), the top model-vs-baseline gate
// families, first/last timestamps and the age of the newest published article. It raises an alert when publication has
// been zero for the window while at least DROUGHT_MIN_HELD eligible stories held. Quiet days with only wire items are
// a legitimate state and never alert. The record lives in KV news:alert:drought (served on /health as alerts.newsroom_drought)
// and is logged with console.error while active. Tennis has no push alert channel bound (owner decision); nothing is
// created here.

export const WATCHDOG_VERSION = 'news-drought-watchdog/1';
export const DROUGHT_KEY = 'news:alert:drought';
export const DROUGHT_WINDOW_H = 18;
export const DROUGHT_MIN_HELD = 2;
export const DROUGHT_CHECK_MIN = 30;

export const RUNBOOK = [
  '1. GET /v1/news/editorial-audit and the held rows below: read the model=[...] and baseline=[...] gate families.',
  '2. Never use a destructive re-run: POST /v1/news/enrich?event_id=<id>&attempts=2 retries a held story IN PLACE from its frozen packet (same id, slug, hold history) and publishes only on a full gate pass.',
  '3. Do not relax factual or editorial gates and do not hand-publish. A story the evidence cannot support stays HOLD.',
  '4. If every model draft fails the same gate, fix the prompt or source, run tests and the canary, then retry the holds.'
].join(' ');

const EXCLUDED = new Set(['wire', 'duplicate', 'below_threshold']);

/** Gate families from a hold reason: model=[..] / baseline=[..] (#15 format) or the legacy "gates: a, b" (baseline). */
export function reasonFamilies(reason = '') {
  const s = String(reason || '');
  const grab = (k) => { const m = new RegExp(`${k}=\\[([^\\]]*)\\]`).exec(s); return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : null; };
  const model = grab('model');
  const baseline = grab('baseline');
  if (model || baseline) return { model: model || [], baseline: baseline || [] };
  const legacy = /^gates:\s*(.+)$/.exec(s);
  return { model: [], baseline: legacy ? legacy[1].split(',').map((x) => x.trim()).filter(Boolean) : [] };
}

const top = (counts, n = 6) => Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([gate, count]) => ({ gate, count }));

/** Pure: events in the window + newest published article -> drought record. */
export function droughtStatus({ events = [], lastPublishedAt = null, now = new Date(), windowH = DROUGHT_WINDOW_H, minHeld = DROUGHT_MIN_HELD } = {}) {
  const since = new Date(now.getTime() - windowH * 3600e3).toISOString();
  const rows = events.filter((e) => (e.detected_at || '') >= since);
  const counts = { wire: 0, duplicate: 0, eligible: 0, held: 0, published: 0, pending: 0 };
  const model = {};
  const baseline = {};
  for (const e of rows) {
    if (e.state === 'wire') counts.wire += 1;
    else if (e.state === 'duplicate') counts.duplicate += 1;
    if (EXCLUDED.has(e.state)) continue;
    counts.eligible += 1;
    if (e.state === 'held') {
      counts.held += 1;
      const f = reasonFamilies(e.state_reason);
      for (const g of f.model) model[g] = (model[g] || 0) + 1;
      for (const g of f.baseline) baseline[g] = (baseline[g] || 0) + 1;
    } else if (e.state === 'published') counts.published += 1;
    else counts.pending += 1;
  }
  const times = rows.map((e) => e.detected_at).filter(Boolean).sort();
  const publishedInWindow = !!lastPublishedAt && lastPublishedAt >= since;
  const active = !publishedInWindow && counts.published === 0 && counts.held >= minHeld;
  return {
    version: WATCHDOG_VERSION, checked_at: now.toISOString(), window_h: windowH, min_held: minHeld,
    status: active ? 'ALERT' : 'OK',
    reason: active ? `0 articles published in ${windowH}h while ${counts.held} eligible stories held` : null,
    counts,
    last_published_at: lastPublishedAt,
    hours_since_publish: lastPublishedAt ? Math.round((now.getTime() - Date.parse(lastPublishedAt)) / 36e5 * 10) / 10 : null,
    first_event_at: times[0] || null, last_event_at: times.at(-1) || null,
    top_model_failures: top(model), top_baseline_failures: top(baseline),
    held: rows.filter((e) => e.state === 'held').slice(0, 10).map((e) => ({ event_id: e.event_id, detected_at: e.detected_at, reason: String(e.state_reason || '').slice(0, 240) })),
    runbook: active ? RUNBOOK : null
  };
}

/** Cron step: throttled to one check per DROUGHT_CHECK_MIN; keeps since_at across consecutive alerting checks. */
export async function checkDrought(env, store, { now = new Date(), force = false } = {}) {
  const kv = env.TENNIS_STATE;
  if (!kv) return null;
  const prev = await kv.get(DROUGHT_KEY, 'json').catch(() => null);
  if (!force && prev?.checked_at && now.getTime() - Date.parse(prev.checked_at) < DROUGHT_CHECK_MIN * 60e3) return { skipped: 'throttled', status: prev.status };
  const windowH = Number(env.NEWS_DROUGHT_WINDOW_H) || DROUGHT_WINDOW_H;
  const minHeld = Number(env.NEWS_DROUGHT_MIN_HELD) || DROUGHT_MIN_HELD;
  const since = new Date(now.getTime() - windowH * 3600e3).toISOString();
  const [events, last] = await Promise.all([
    store.select('tennis_news_events', `select=event_id,state,state_reason,detected_at&detected_at=gte.${since}&order=detected_at.asc&limit=1000`),
    store.select('tennis_articles', 'select=first_published_at&status=eq.published&first_published_at=not.is.null&order=first_published_at.desc&limit=1')
  ]);
  const rec = droughtStatus({ events, lastPublishedAt: last[0]?.first_published_at || null, now, windowH, minHeld });
  rec.since_at = rec.status === 'ALERT' ? (prev?.status === 'ALERT' && prev.since_at ? prev.since_at : rec.checked_at) : null;
  await kv.put(DROUGHT_KEY, JSON.stringify(rec), { expirationTtl: 7 * 86400 });
  if (rec.status === 'ALERT') console.error(`[tennis-news] NEWSROOM DROUGHT ALERT: ${rec.reason}; model=${JSON.stringify(rec.top_model_failures)} baseline=${JSON.stringify(rec.top_baseline_failures)}`);
  return rec;
}

/** Public /health view: status, counts, gate families and timestamps; never the per-story held list. */
export const publicDrought = (rec) => (rec && typeof rec === 'object' ? (({ held: _held, ...rest }) => rest)(rec) : null);
