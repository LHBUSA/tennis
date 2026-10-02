// One live contract for /v1/live AND /v1/today.live (tennis-api isLiveRow): a stale or unlinked upstream
// 'in_progress' row never reads as LIVE on the homepage while /live hides it. Status is never inferred.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, isLiveRow, isCurrentUpcoming } from '../workers/tennis-api/src/index.js';

const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60e3).toISOString();
const inMin = (min) => new Date(NOW + min * 60e3).toISOString();
const dayOff = (d) => new Date(NOW + d * 86400e3).toISOString().slice(0, 10);
const ED = { edition_id: 'ed1', year: 2026, name: 'Adana Open - Adana, TUR', level: 'WTA 125', surface: 'hard', indoor: false, start_date: dayOff(-3), end_date: dayOff(2), city: 'Adana', country: 'TUR', source_status: 'in_progress', source_family: 'wta', competition_key: 'wta-125', updated_at: ago(5), tennis_tournaments: { slug: 'adana-125', name: 'Adana Open' } };
const row = (id, status, extra = {}) => ({ match_id: id, event_type: 'WS', round: 'M-1', format_key: 'BO3_TB7', status, winner_side: null, end_reason: null, score_text: null, duration_s: null, scheduled_at: null, court: null, schedule_note: null, live_state: null, stats_status: null, source_family: 'wta', source_updated_at: ago(1), updated_at: ago(1), edition_id: 'ed1', tennis_tournament_editions: ED, tennis_sets: [], tennis_match_participants: [], tennis_match_external_ids: [{ provider: 'wta' }], ...extra });

const ROWS = [
  row('00000000-0000-4000-8000-000000000001', 'in_progress'), // fresh official WTA row -> LIVE
  row('00000000-0000-4000-8000-000000000002', 'in_progress', { source_family: 'espn', source_updated_at: ago(45), event_type: 'MS' }), // ESPN row silent 45 min -> stale
  row('00000000-0000-4000-8000-000000000003', 'in_progress', { tennis_match_external_ids: [] }), // no source links it any more
  row('00000000-0000-4000-8000-000000000004', 'completed', { winner_side: 'A' }), // final
  row('00000000-0000-4000-8000-000000000005', 'scheduled', { scheduled_at: inMin(90), source_updated_at: null }), // up next
  row('00000000-0000-4000-8000-000000000006', 'in_progress', { tennis_tournament_editions: { ...ED, end_date: dayOff(-5) } }) // edition long over
];
const store = {
  async select(table, q) {
    if (table === 'tennis_tournament_editions') return [ED];
    if (table === 'tennis_matches') return /status=eq\.in_progress/.test(q) ? ROWS.filter((r) => r.status === 'in_progress') : ROWS;
    return [];
  },
  async count() { return 0; },
  async req() { return null; }
};
const body = async (r) => { const x = typeof r?.json === 'function' ? await r.json() : r; return x?.data ?? x?.body?.data ?? x; };

test('isLiveRow: fresh live -> LIVE; stale / unlinked / completed / scheduled / finished edition -> not LIVE', () => {
  assert.deepEqual(ROWS.map((r) => isLiveRow(r, NOW)), [true, false, false, false, false, false]);
});

test('/v1/today.live and /v1/live apply the SAME contract (same ids); scheduled future row stays UP NEXT', async () => {
  const live = await body(await route('/v1/live', new URL('https://x/v1/live'), store, {}));
  const today = await body(await route('/v1/today', new URL('https://x/v1/today'), store, {}));
  const ids = (l) => l.map((m) => m.id).sort();
  assert.deepEqual(ids(live), ['00000000-0000-4000-8000-000000000001']);
  assert.deepEqual(ids(today.live), ids(live), 'homepage live == /live');
  assert.ok(!today.live.some((m) => m.status !== 'in_progress'), 'no synthetic status');
  assert.deepEqual(today.upcoming.map((m) => m.id), ['00000000-0000-4000-8000-000000000005'], 'scheduled future row is up next, never live');
  assert.ok(today.latest_results.some((m) => m.id === '00000000-0000-4000-8000-000000000004'), 'completed row is a result');
  // a stale row is dropped from live but its stored status is untouched (not relabelled final/scheduled)
  const all = [...today.live, ...today.upcoming, ...today.latest_results];
  assert.ok(!all.some((m) => m.id === '00000000-0000-4000-8000-000000000002'));
  assert.equal(isCurrentUpcoming({ status: 'scheduled', scheduled_at: inMin(90) }, NOW), true);
});
