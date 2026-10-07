// Recorded-payload tick replay for the canonical writer (tests/change-only-writer.test.js).
// Ticks are built from REAL official-feed captures: the 2026-10-03 live observations (WTA 1000 Beijing singles x3, WTA 125
// doubles x1; one row per changed observation) are re-polled every TICK_S like tennis-ingest / tennis-live do (the
// latest observation at the tick time, so most ticks repeat the previous payload), plus the full WTA 250 edition 1152
// payload on every tick (finished matches that never change) with a few scripted source edits (seed, court, start time,
// a score correction, a status regression) to exercise every change path.
import { readFileSync } from 'node:fs';
import { parseWtaMatch } from '../../workers/providers/wta.js';
import { MemStore } from './memstore.js';

const LIVE = JSON.parse(readFileSync(new URL('../fixtures/wta/live-observations-2026-10-03.json', import.meta.url), 'utf8'));
const STATIC = JSON.parse(readFileSync(new URL('../fixtures/wta/matches-1152.json', import.meta.url), 'utf8')).payload.matches;
export const EDITIONS = {
  1020: { edition_id: '00000000-0000-4000-8000-000000001020', surface: 'hard', indoor: false, level: 'WTA 1000' },
  1143: { edition_id: '00000000-0000-4000-8000-000000001143', surface: 'clay', indoor: false, level: 'WTA 125' },
  1152: { edition_id: '00000000-0000-4000-8000-000000001152', surface: 'hard', indoor: true, level: 'WTA 250' }
};
const TICK_S = 120;

/** Scripted edits to the static edition: tick -> (rows) => rows (applied from that tick on). */
const EDITS = [
  [12, (rows) => rows.map((r) => (r.MatchID === 'RS014' ? { ...r, SeedA: '3' } : r))], // seed change (participants only)
  [25, (rows) => rows.map((r) => (r.MatchState === 'P' ? { ...r, CourtID: 7 } : r))], // court move of the scheduled match
  [40, (rows) => rows.map((r) => (r.MatchState === 'P' ? { ...r, MatchTimeStamp: '2026-09-20T09:30:00+08:00' } : r))], // start time
  [55, (rows) => rows.map((r) => (r.MatchID === 'RS014' ? { ...r, ScoreSet2A: '7', ScoreSet2B: '5', ScoreString: '6-3,7-5' } : r))], // score correction on a final
  [70, (rows) => rows.map((r) => (r.MatchID === 'RS014' ? { ...r, MatchState: 'P' } : r))] // final -> scheduled regression: held, never written
];

function staticRows(tick) {
  let rows = STATIC.map((r) => ({ ...r }));
  for (const [at, f] of EDITS) if (tick >= at) rows = f(rows);
  return rows;
}

/** -> [{ tick, at, groups: [{ edition, records }] }] */
export function buildTicks({ extraIdle = 6 } = {}) {
  const keys = Object.keys(LIVE.matches);
  const times = keys.flatMap((k) => LIVE.matches[k].map((o) => Date.parse(o.at)));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times) + extraIdle * TICK_S * 1000;
  const ticks = [];
  for (let t = t0, i = 0; t <= t1; t += TICK_S * 1000, i += 1) {
    const groups = [];
    for (const ev of ['1020', '1143']) {
      const rows = keys.filter((k) => k.startsWith(`${ev}:`)).map((k) => LIVE.matches[k].filter((o) => Date.parse(o.at) <= t).at(-1)?.row).filter(Boolean);
      if (rows.length) groups.push({ edition: EDITIONS[ev], records: rows.map((r) => parseWtaMatch(r, { level: LIVE.level[ev] })) });
    }
    groups.push({ edition: EDITIONS[1152], records: staticRows(i).map((r) => parseWtaMatch(r, { level: 'WTA 250' })) });
    ticks.push({ tick: i, at: new Date(t).toISOString(), groups });
  }
  return ticks;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Replay ticks through `write(store, records, edition, opts)` (one call per edition per tick, as editionMatches does). */
export async function replay(write, ticks, { opts = {}, onTick = null } = {}) {
  const store = new MemStore();
  for (const t of ticks) {
    for (const g of t.groups) await write(store, g.records, g.edition, { captureId: `cap-${t.tick}`, dedupe: true, scheduleDay: true, ...opts });
    if (onTick) await onTick(store, t);
    await sleep(2); // distinct writer clock per tick (updated_at analysis)
  }
  return store;
}

// columns whose value is the writer's wall clock at write time (never source content)
const CLOCK = { tennis_matches: ['updated_at'], tennis_players: ['updated_at'], tennis_match_events: ['observed_at'], tennis_ingest_holds: ['last_seen_at'] };
const PRESENCE = { tennis_ingest_holds: ['resolved_at'] };
/** Canonical dump of every table: rows sorted, clock columns removed (presence-only where noted). */
export function stateOf(store, { keepClock = false } = {}) {
  const out = {};
  for (const [table, rows] of [...store.t.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    out[table] = rows.map((r) => {
      const x = { ...r };
      if (!keepClock) for (const c of CLOCK[table] || []) delete x[c];
      for (const c of PRESENCE[table] || []) x[c] = x[c] != null;
      return JSON.stringify(Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])));
    }).sort();
  }
  return out;
}

/** Row-write volume by table from the MemStore request log (UPSERT rows + inserts). */
export function writeVolume(store) {
  const v = {};
  for (const [op, table, n] of store.log) if (op === 'UPSERT') v[table] = (v[table] || 0) + n;
  return v;
}

/** Content of one match (row without updated_at + its sets + participants) for change detection. */
export function matchContent(store, id) {
  const m = store.rows('tennis_matches').find((r) => r.match_id === id);
  if (!m) return null;
  const { updated_at: _u, ...row } = m;
  const sets = store.rows('tennis_sets').filter((s) => s.match_id === id).sort((a, b) => a.set_no - b.set_no);
  const parts = store.rows('tennis_match_participants').filter((p) => p.match_id === id).sort((a, b) => (a.side < b.side ? -1 : 1));
  return JSON.stringify([Object.fromEntries(Object.keys(row).sort().map((k) => [k, row[k]])), sets, parts]);
}
