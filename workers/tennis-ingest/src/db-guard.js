// Production guard for bulk work against the SHARED sports database (tkmln also serves NFL / UFC).
// 2026-09-28 00:24 UTC our own backfill load took PostgREST down for ~2-3 min; this is the server-side replacement for
// the local watchdog + driver breaker that protected the rest of that backfill.
//
//  - health: every cron tick reads one row; 2 consecutive failures or a read slower than 8 s pause bulk lanes 10 min
//  - circuit breaker: 3 store 5xx errors within 5 min from any bulk lane pause bulk lanes 10 min
//  - concurrency ceiling: at most MAX_HEAVY bulk invocations at once (KV slots; KV is eventually consistent, so the
//    ceiling is approximate — drivers must also cap themselves, scripts/ops/lane.mjs does)
// A pause never touches the live cron lanes (current-season ESPN / WTA / Slam feeds); it only refuses admin bulk runs
// and the history rotation.

export const BULK_LANES = new Set(['wta_history', 'edition_merge', 'espn_extras', 'wta_records', 'wta_edition_facts', 'dna_v2']);
export const MAX_HEAVY = 5;
const HEALTH = 'db:health';
const ERRS = 'db:errs';
const PAUSE_MS = 10 * 60e3;
const SLOW_MS = 8000;
export const STORE_5XX = /postgrest 5\d\d|PGRST00\d|error code: 5\d\d|Network connection lost|timed out/i;

export async function pausedReason(kv) {
  const h = (await kv.get(HEALTH, 'json')) || {};
  return h.paused_until && Date.now() < Date.parse(h.paused_until) ? { paused_until: h.paused_until, reason: h.reason } : null;
}

async function pause(kv, reason) {
  const h = (await kv.get(HEALTH, 'json')) || {};
  h.paused_until = new Date(Date.now() + PAUSE_MS).toISOString();
  h.reason = reason;
  h.pauses = (h.pauses || 0) + 1;
  await kv.put(HEALTH, JSON.stringify(h));
  return h;
}

/** Cron health probe: one cheap read. */
export async function probe(store, kv, now = Date.now) {
  const t0 = now();
  let ok = true;
  let err = null;
  try { await store.select('tennis_players', 'select=pbe_player_id&limit=1'); } catch (e) { ok = false; err = String(e?.message || e).slice(0, 160); }
  const ms = now() - t0;
  const h = (await kv.get(HEALTH, 'json')) || {};
  if (ok && ms < SLOW_MS) { h.fails = 0; h.last_ok = new Date().toISOString(); h.last_ms = ms; await kv.put(HEALTH, JSON.stringify(h)); return { ok, ms }; }
  h.fails = (h.fails || 0) + 1;
  h.last_fail = new Date().toISOString();
  h.last_error = err || `slow_read_${ms}ms`;
  await kv.put(HEALTH, JSON.stringify(h));
  if (h.fails >= 2 || ms >= SLOW_MS) await pause(kv, `health: ${h.last_error}`);
  return { ok: false, ms, error: h.last_error };
}

/** A bulk lane saw a store error: 3 within 5 minutes pause every bulk lane. */
export async function noteStoreError(kv, message) {
  if (!STORE_5XX.test(String(message || ''))) return null;
  const e = (await kv.get(ERRS, 'json')) || { count: 0, since: new Date().toISOString() };
  if (Date.now() - Date.parse(e.since) > 5 * 60e3) { e.count = 0; e.since = new Date().toISOString(); }
  e.count += 1;
  await kv.put(ERRS, JSON.stringify(e), { expirationTtl: 900 });
  return e.count >= 3 ? pause(kv, `breaker: ${e.count} store errors since ${e.since}`) : null;
}

/** Take one of MAX_HEAVY slots (value = holder id, TTL 5 min); null when all are held. */
export async function acquireSlot(kv, holder) {
  for (let i = 0; i < MAX_HEAVY; i += 1) {
    const k = `heavy:slot:${i}`;
    if (!(await kv.get(k))) { await kv.put(k, holder, { expirationTtl: 300 }); return k; }
  }
  return null;
}
export const releaseSlot = (kv, k) => (k ? kv.delete(k) : null);
