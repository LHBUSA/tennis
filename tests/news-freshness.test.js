// Backfill freshness (owner rule 2026-09-29): a story written after its event by the V3 reclassification backfill must never
// read as breaking news — its EVENT date is the primary clock; a live story keeps its publication-relative time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshnessOf } from '../workers/tennis-api/src/news.js';
import { storyClock, latestFresh } from '../src/lib/newsroom.js';

// the production pattern: Birrell wins Seoul (final 2026-09-27), detected 09-27 08:18, reclassified + published 09-29 16:56
const backfill = {
  first_published_at: '2026-09-29T16:56:05Z', published_at: '2026-09-29T16:56:05Z',
  tennis_news_events: { occurred_at: '2026-09-27T06:18:00Z', detected_at: '2026-09-27T08:18:58Z', class_history: [{ stage: 'reclassify_v3', class: 'brief', at: '2026-09-29T16:54:16Z' }, { stage: 'enrich', class: 'brief' }] },
  tennis_matches: { started_at: '2026-09-27T06:18:05Z', scheduled_at: null }
};
// a live-path story: detected and published a minute apart
const live = { first_published_at: '2026-09-30T05:02:00Z', published_at: '2026-09-30T05:02:00Z', tennis_news_events: { occurred_at: '2026-09-30T03:00:00Z', detected_at: '2026-09-30T05:01:00Z', class_history: [{ stage: 'detect', class: 'brief' }, { stage: 'enrich', class: 'brief' }] } };

test('freshnessOf: backfill = published BY the reclassification (lifecycle record), never inferred from age', () => {
  const f = freshnessOf(backfill);
  assert.equal(f.is_backfill, true); assert.equal(f.basis, 'event'); assert.equal(f.event_at, '2026-09-27T06:18:05Z', 'the match start, not the event row');
  assert.equal(freshnessOf(live).is_backfill, false);
  // published BEFORE the reclassification (the 2026-09-26/27 stories), later re-classified: not a backfill
  const early = { ...backfill, first_published_at: '2026-09-27T05:49:23Z' };
  assert.equal(freshnessOf(early).is_backfill, false);
  // a result with no match time (secondary source): day-precision scheduled time, never the tournament start in occurred_at
  const espn = { first_published_at: '2026-09-29T16:57:44Z', tennis_news_events: { occurred_at: '2026-09-21T00:00:00Z', detected_at: '2026-09-29T13:51:00Z', class_history: [{ stage: 'reclassify_v3', at: '2026-09-29T16:54:16Z' }] }, tennis_matches: { started_at: null, scheduled_at: '2026-09-29T11:40:00Z' } };
  const fe = freshnessOf(espn);
  assert.equal(fe.is_backfill, true); assert.equal(fe.event_at, '2026-09-29T11:40:00Z');
});

test('storyClock: a backfill shows the event date + "Added to PropBetEdge", never "N min ago"', () => {
  const rel = () => '42 min ago';
  const b = storyClock({ ...backfill, freshness: freshnessOf(backfill) }, { relative: rel });
  assert.equal(b.text, 'Match Sep 27'); assert.equal(b.note, 'Added to PropBetEdge Sep 29'); assert.equal(b.backfill, true);
  assert.doesNotMatch(`${b.text} ${b.note}`, /ago/);
  const l = storyClock({ ...live, freshness: freshnessOf(live) }, { relative: rel });
  assert.equal(l.text, '42 min ago'); assert.equal(l.note, null);
  assert.equal(latestFresh([{ ...backfill, freshness: freshnessOf(backfill) }, { ...live, freshness: freshnessOf(live) }]), live.published_at, 'the masthead "Updated" ignores backfills');
});
