// Read-time observation heartbeat (2026-10-07, change-only writes; shared/observed.js).
//
// Response freshness (envelope source_updated_at = newest updated_at of the rows served, per-tournament as_of, the
// freshness guard's last_update) used to read the writer's every-tick rewrite of tennis_matches.updated_at. The writer
// now leaves unchanged rows alone, and the time each edition was last confirmed with its source is kept per edition:
//   KV obs:editions:ingest (tennis-ingest, once per tick) and tennis-live:last_run.observed (live cycle).
// Every tennis_matches row this API reads gets updated_at = max(stored updated_at, its edition's last confirmation),
// which is the value the old writer would have stored. In-progress rows are never touched: the writer still rewrites
// them on every pass (the stuck-live guard reads their real updated_at). No heartbeat readable -> rows as stored.

import { OBS_KEY } from '../../shared/observed.js';

const TTL_MS = 20e3; // one isolate trusts a heartbeat read this long (KV edge cache below it: 30 s)
let memo = { at: 0, map: null };

export async function editionHeartbeat(kv, now = Date.now()) {
  if (memo.map && now - memo.at < TTL_MS) return memo.map;
  try {
    const opt = { type: 'json', cacheTtl: 30 };
    const [ingest, live] = await Promise.all([kv.get(OBS_KEY, opt), kv.get('tennis-live:last_run', opt)]);
    const map = new Map();
    for (const src of [ingest, live?.observed]) for (const [id, at] of Object.entries(src || {})) if (!map.has(id) || Date.parse(at) > Date.parse(map.get(id))) map.set(id, at);
    memo = { at: now, map };
    return map;
  } catch {
    return null;
  }
}

/** In place: rows with edition_id + updated_at (not in progress) take their edition's confirmation time when newer. */
export function applyHeartbeat(rows, hb) {
  if (!hb?.size || !Array.isArray(rows)) return rows;
  for (const r of rows) {
    if (!r || !r.edition_id || !r.updated_at || r.status === 'in_progress') continue;
    const at = hb.get(r.edition_id);
    if (at && Date.parse(at) > Date.parse(r.updated_at)) r.updated_at = at;
  }
  return rows;
}

/** Wrap a per-request store: tennis_matches reads come back with the heartbeat applied. */
export function withHeartbeat(store, env) {
  const kv = env?.TENNIS_STATE;
  if (!store || !kv || store.heartbeat) return store;
  const select = store.select.bind(store);
  store.heartbeat = true;
  store.select = async (table, query) => {
    const rows = await select(table, query);
    if (table !== 'tennis_matches' || !rows?.length || !rows.some((r) => r?.updated_at && r.edition_id)) return rows;
    return applyHeartbeat(rows, await editionHeartbeat(kv));
  };
  return store;
}

export function resetHeartbeatMemo() { memo = { at: 0, map: null }; }
