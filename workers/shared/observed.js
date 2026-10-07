// Per-edition observation heartbeat (2026-10-07, change-only writes).
//
// tennis_matches.updated_at used to be rewritten on every ingest / live pass for every row of every observed edition,
// so "newest updated_at of these rows" doubled as "when did we last confirm this edition with its source". The writer now
// leaves unchanged rows alone (updated_at = last real change), and that confirmation time lives here instead:
//   KV obs:editions:ingest  { edition_id: ISO }  written once per tennis-ingest tick (after the match lanes)
//   tennis-live:last_run.observed  { edition_id: ISO }  carried by the live cycle's existing run record (no extra write)
// tennis-api (store-heartbeat.js) merges it back at read time, so response freshness is what it was.
// Entries older than KEEP_MS are dropped (an edition not observed for days is STALE either way).

export const OBS_KEY = 'obs:editions:ingest';
export const KEEP_MS = 3 * 86400e3;
export const MAX_ENTRIES = 600;

/** Merge `observed` (Map edition_id -> ISO) into a stored map: newest per edition, pruned by age and size. Pure. */
export function mergeObserved(stored, observed, nowMs = Date.now()) {
  const out = new Map(Object.entries(stored || {}));
  for (const [id, at] of observed || []) if (!out.has(id) || Date.parse(at) > Date.parse(out.get(id))) out.set(id, at);
  const live = [...out].filter(([, at]) => nowMs - Date.parse(at) < KEEP_MS).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, MAX_ENTRIES);
  return Object.fromEntries(live);
}

/** One KV write per call, and only when an edition was observed. Never throws (a heartbeat must not fail a tick). */
export async function flushObserved(kv, observed, { key = OBS_KEY, now = Date.now() } = {}) {
  if (!kv || !observed?.size) return 0;
  try {
    const merged = mergeObserved(await kv.get(key, 'json'), observed, now);
    await kv.put(key, JSON.stringify(merged));
    const n = observed.size;
    observed.clear();
    return n;
  } catch {
    return 0;
  }
}
