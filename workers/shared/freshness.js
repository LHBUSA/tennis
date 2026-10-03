// Schedule / results freshness guard — PURE + one bounded read (tests/freshness.test.js).
//
// A tournament's schedule is behind its source when matches stay unfinalized long after their start: a fixture whose
// start passed OVERDUE_H hours ago and is still 'scheduled', or an 'in_progress' row nobody has updated for
// STUCK_LIVE_H hours. On 2026-10-03 the Beijing ATP edition sat at round 1 for 3+ days (21 such rows, last write
// 09-30 04:59Z) while the schedule envelope still said CURRENT, because its age is the newest row of ANY tournament.
// This guard is per tournament, so one fresh tour can no longer hide a stalled one.

import { inList } from './store/postgrest.js';

export const OVERDUE_H = 6;
export const STUCK_LIVE_H = 2;
export const LOOKBACK_D = 30;
export const GUARD_VERSION = 'schedule-freshness/1';

/** PostgREST query for candidate rows (scheduled_at index range; optional edition filter). */
export function overdueQuery(nowMs, editionIds = null) {
  const cutoff = new Date(nowMs - OVERDUE_H * 3600e3).toISOString();
  const floor = new Date(nowMs - LOOKBACK_D * 86400e3).toISOString();
  const ed = editionIds ? `&edition_id=${inList(editionIds)}` : '';
  return `select=match_id,edition_id,status,scheduled_at,updated_at${ed}&status=in.(scheduled,in_progress)&scheduled_at=gte.${floor}&scheduled_at=lt.${cutoff}&limit=1000`;
}

/** Is this row an unfinalized match that should have a result (or a live update) by now? */
export function isOverdue(m, nowMs) {
  const at = Date.parse(m?.scheduled_at);
  if (!Number.isFinite(at) || nowMs - at < OVERDUE_H * 3600e3) return false;
  if (m.status === 'scheduled') return true;
  if (m.status === 'in_progress') { const u = Date.parse(m.updated_at); return !Number.isFinite(u) || nowMs - u >= STUCK_LIVE_H * 3600e3; }
  return false;
}

/** rows -> Map(edition_id -> { overdue, oldest_start, last_update }) for overdue rows only. */
export function overdueByEdition(rows, nowMs) {
  const by = new Map();
  for (const m of rows || []) {
    if (!isOverdue(m, nowMs)) continue;
    const e = by.get(m.edition_id) || { overdue: 0, oldest_start: null, last_update: null };
    e.overdue += 1;
    if (!e.oldest_start || m.scheduled_at < e.oldest_start) e.oldest_start = m.scheduled_at;
    if (m.updated_at && (!e.last_update || m.updated_at > e.last_update)) e.last_update = m.updated_at;
    by.set(m.edition_id, e);
  }
  return by;
}

/** Per-tournament freshness object. `asOf` = newest stored write of the tournament's matches (null = not read). */
export function tournamentFreshness(asOf, overdue) {
  return { as_of: asOf || null, state: overdue ? 'STALE' : 'CURRENT', overdue_unfinalized: overdue ? overdue.overdue : 0, oldest_overdue_start: overdue ? overdue.oldest_start : null, rule: `matches ${OVERDUE_H}+ h past their start with no result, or live with no update for ${STUCK_LIVE_H}+ h` };
}

export async function readOverdue(store, nowMs, editionIds = null) {
  if (editionIds && !editionIds.length) return new Map();
  return overdueByEdition(await store.select('tennis_matches', overdueQuery(nowMs, editionIds)), nowMs);
}
