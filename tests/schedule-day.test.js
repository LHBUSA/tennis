// Sourced day of play (migration 20261004000100): WTA derivation precedence, the unproven-offset rule, the 23:59
// placeholder staying off, and the SCHEDULE_DAY_COLUMNS flag on the writer and the API select/shape.
// Row shapes mirror the order-of-play rows captured 2026-10-04 (docs/evidence/wta-oop-day-proof.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as wta from '../workers/providers/wta.js';
import { scheduleDayFields, writeMatches } from '../workers/tennis-ingest/src/writer.js';
import * as shape from '../workers/tennis-api/src/shape.js';

const base = { DrawLevelType: 'M', DrawMatchType: 'S', EventID: '1', EventYear: 2026, RoundID: '1', PlayerIDA: '1', PlayerIDB: '2', PlayerNameFirstA: 'A', PlayerNameLastA: 'A', PlayerNameFirstB: 'B', PlayerNameLastB: 'B' };
const oop = (o) => wta.parseWtaMatch({ ...base, MatchID: 'LS001', MatchState: 'U', ...o }, { level: 'WTA 1000' });

test('precedence 1: a full-ISO NotBeforeISOTime gives the day and offset directly', () => {
  const r = oop({ NotBeforeISOTime: '2026-09-27T12:00:00+08:00', MatchTimeStamp: '2026-09-27T23:59+08:00' });
  assert.deepEqual(r.schedule_day, { day: '2026-09-27', utc_offset: '+08:00', source: 'wta_not_before_iso', raw: { field: 'NotBeforeISOTime', value: '2026-09-27T12:00:00+08:00' } });
  assert.equal(r.scheduled_at, '2026-09-27T12:00:00+08:00'); // unchanged existing behaviour
});

test('precedence 2: MatchTimeStamp agreeing with the time-only NotBeforeISOTime (time + offset) gives the day', () => {
  const r = oop({ MatchTimeStamp: '2026-10-05T11:00+08:00', NotBefore: 'Starting at 11:00 AM', NotBeforeISOTime: '11:00+0800' });
  assert.deepEqual(r.schedule_day, { day: '2026-10-05', utc_offset: '+08:00', source: 'wta_order_of_play', raw: { field: 'MatchTimeStamp', value: '2026-10-05T11:00+08:00', corroborated_by: { field: 'NotBeforeISOTime', value: '11:00+0800' } } });
  assert.equal(r.scheduled_at, null, 'a not-before time is not an exact start');
  assert.equal(oop({ MatchTimeStamp: '2026-10-05T11:00+08:00', NotBeforeISOTime: '15:00+0800' }).schedule_day, null, 'times disagree');
  assert.equal(oop({ MatchTimeStamp: '2026-10-05T11:00+08:00', NotBeforeISOTime: '11:00+0300' }).schedule_day, null, 'offsets disagree');
  assert.equal(oop({ MatchTimeStamp: '2026-10-05T11:00+08:00' }).schedule_day, null, 'MatchTimeStamp alone is not corroborated');
  assert.equal(oop({ MatchTimeStamp: '2026-10-05T11:00+08:00', NotBeforeISOTime: '11:00+0800', Unscheduled: true }).schedule_day, null);
});

test('+00:00 / Z is unproven: the day is kept, the offset is null (-> HOLD); no timezone is ever guessed', () => {
  const z = oop({ NotBeforeISOTime: '2026-10-05T12:00:00Z' });
  assert.equal(z.schedule_day.day, '2026-10-05');
  assert.equal(z.schedule_day.utc_offset, null);
  const u = oop({ MatchTimeStamp: '2026-10-05T11:00+00:00', NotBeforeISOTime: '11:00+0000' });
  assert.equal(u.schedule_day.utc_offset, null);
  assert.equal(u.schedule_day.source, 'wta_order_of_play');
});

test('the 23:59 placeholder never sets the day (not proven) and is never a start time', () => {
  assert.equal(wta.PLACEHOLDER_DAY_PROVEN, false);
  const p = oop({ MatchTimeStamp: '2026-10-05T23:59+08:00', NotBefore: 'Followed By', NotBeforeISOTime: '' });
  assert.equal(p.schedule_day, null);
  assert.equal(p.scheduled_at, null);
  assert.equal(p.started_at, null);
  // the gated path, if it is ever proven: still never on an Unscheduled row
  const on = (o) => wta.wtaScheduleDay({ MatchTimeStamp: '2026-10-05T23:59+08:00', ...o }, { placeholderDay: true });
  assert.deepEqual(on({}), { day: '2026-10-05', utc_offset: '+08:00', source: 'wta_match_timestamp_placeholder', raw: { field: 'MatchTimeStamp', value: '2026-10-05T23:59+08:00' } });
  assert.equal(on({ Unscheduled: true }), null);
  // a 23:59 MatchTimeStamp never satisfies precedence 2, even with a matching 23:59 not-before time
  assert.equal(wta.wtaScheduleDay({ MatchTimeStamp: '2026-10-05T23:59+08:00', NotBeforeISOTime: '23:59+0800' }), null);
});

test('only order-of-play rows speak: live and final rows leave schedule_day undefined', () => {
  const live = wta.parseWtaMatch({ ...base, MatchID: 'LS002', MatchState: 'P', ScoreSys: '1', MatchTimeStamp: '2026-10-05T11:04:00+08:00', NotBeforeISOTime: '11:00+0800' }, {});
  assert.equal(live.schedule_day, undefined);
});

test('writer fields: the provider value (null included) on order-of-play rows; recorded value kept otherwise', () => {
  const rec = { scheduled_day: '2026-10-05', schedule_utc_offset: '+08:00', schedule_day_source: 'wta_order_of_play', schedule_day_raw: { field: 'MatchTimeStamp', value: '2026-10-05T11:00+08:00' } };
  assert.deepEqual(scheduleDayFields({ schedule_day: undefined }, rec), rec);
  assert.deepEqual(scheduleDayFields({}, undefined), { scheduled_day: null, schedule_utc_offset: null, schedule_day_source: null, schedule_day_raw: null });
  assert.deepEqual(scheduleDayFields({ schedule_day: null }, rec), { scheduled_day: null, schedule_utc_offset: null, schedule_day_source: null, schedule_day_raw: null });
  assert.deepEqual(scheduleDayFields({ schedule_day: { day: '2026-10-06', utc_offset: null, source: 'wta_not_before_iso', raw: { field: 'NotBeforeISOTime', value: 'x' } } }, rec),
    { scheduled_day: '2026-10-06', schedule_utc_offset: null, schedule_day_source: 'wta_not_before_iso', schedule_day_raw: { field: 'NotBeforeISOTime', value: 'x' } });
});

test('SCHEDULE_DAY_COLUMNS off: the writer never names the columns; on: it selects and writes them', async () => {
  const row = oop({ MatchTimeStamp: '2026-10-05T11:00+08:00', NotBeforeISOTime: '11:00+0800' });
  const run = async (opts) => {
    const seen = { selects: [], rows: [] };
    const store = {
      select: async (t, q) => { seen.selects.push(q); return []; },
      insert: async () => [], del: async () => null, req: async () => null, count: async () => 0,
      upsert: async (t, list) => { if (t === 'tennis_matches') seen.rows.push(...list); return []; }
    };
    await writeMatches(store, [row], { edition_id: '00000000-0000-4000-8000-000000000001' }, opts);
    return seen;
  };
  const off = await run({});
  assert.equal(off.rows.length, 1);
  assert.ok(!Object.keys(off.rows[0]).some((k) => /schedule_(day|utc)|scheduled_day/.test(k)));
  assert.ok(!off.selects.some((q) => /scheduled_day/.test(q)));
  const on = await run({ scheduleDay: true });
  assert.equal(on.rows[0].scheduled_day, '2026-10-05');
  assert.equal(on.rows[0].schedule_utc_offset, '+08:00');
  assert.equal(on.rows[0].schedule_day_source, 'wta_order_of_play');
  assert.equal(on.rows[0].schedule_day_raw.field, 'MatchTimeStamp');
  assert.equal(on.rows[0].scheduled_at, null);
  assert.ok(on.selects.some((q) => /scheduled_day,schedule_utc_offset,schedule_day_source,schedule_day_raw/.test(q)));
});

test('API: columns selected and schedule_day shaped only when SCHEDULE_DAY_COLUMNS = "1"', () => {
  shape.configureScheduleDay({ SCHEDULE_DAY_COLUMNS: '0' });
  assert.ok(!shape.MATCH.includes('scheduled_day'));
  assert.equal('schedule_day' in shape.shapeMatch({ match_id: 'm' }), false);
  shape.configureScheduleDay({ SCHEDULE_DAY_COLUMNS: '1' });
  assert.ok(shape.MATCH.startsWith('scheduled_day,schedule_utc_offset,schedule_day_source,schedule_day_raw,'));
  assert.deepEqual(shape.shapeMatch({ match_id: 'm', scheduled_day: '2026-10-05', schedule_utc_offset: null, schedule_day_source: 'wta_not_before_iso', schedule_day_raw: { field: 'NotBeforeISOTime', value: 'v' } }).schedule_day,
    { day: '2026-10-05', utc_offset: null, source: 'wta_not_before_iso', raw: { field: 'NotBeforeISOTime', value: 'v' } });
  assert.equal(shape.shapeMatch({ match_id: 'm', scheduled_day: null }).schedule_day, null);
  shape.configureScheduleDay({});
  assert.ok(!shape.MATCH.includes('scheduled_day'));
});
