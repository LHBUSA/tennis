// Replays archived official-feed observations through the SAME chain the live writer runs
// (writer.js writeSnapshotEvents: parseWtaMatch -> snapshotOf -> diffSnapshots against the previously stored state).
import { readFileSync } from 'node:fs';
import { parseWtaMatch } from '../../workers/providers/wta.js';
import { snapshotOf, diffSnapshots } from '../../workers/shared/canonical/events.js';

export const LIVE_FIX = JSON.parse(readFileSync(new URL('../fixtures/wta/live-observations-2026-10-03.json', import.meta.url), 'utf8'));

/** -> { events, format, final } for one fixture match key ('1020:LS043'). Events carry the writer's fields. */
export function replayMatch(key) {
  const obs = LIVE_FIX.matches[key];
  const level = LIVE_FIX.level[key.split(':')[0]];
  const events = [];
  let prev = null;
  let format = null;
  let last = null;
  for (const o of obs) {
    const sm = parseWtaMatch(o.row, { level });
    if (!sm.status) continue; // the writer holds rows without a mapped status: nothing is written
    format = sm.format_key || format;
    const next = snapshotOf({ status: sm.status, sets: sm.sets, live: sm.live });
    const live = sm.status === 'in_progress' || prev?.status === 'in_progress';
    if (live) {
      const e = diffSnapshots(prev, next, sm.format_key);
      if (e) events.push({ ...e, event_sequence: events.length, event_id: `${key}#${events.length}`, observed_at: o.at, set_number: next.sets.length || null, source: 'wta' });
    }
    prev = next;
    last = sm;
  }
  return { events, format, final: last, doubles: /^LD/.test(key.split(':')[1]) };
}
