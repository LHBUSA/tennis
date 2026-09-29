// Backfill freshness (owner rule 2026-09-29): a story written after its event by the V3 reclassification backfill must never
// read as breaking news — its EVENT date is the primary clock; a live story keeps its publication-relative time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshnessOf, BACKFILL_LAG_MS } from '../workers/tennis-api/src/news.js';
import { storyClock, latestFresh } from '../src/lib/newsroom.js';

// the production pattern: Birrell wins Seoul (final 2026-09-27), detected 09-27 08:18, reclassified + published 09-29 16:56
const backfill = {
  first_published_at: '2026-09-29T16:56:05Z', published_at: '2026-09-29T16:56:05Z',
  tennis_news_events: { occurred_at: '2026-09-27T06:18:00Z', detected_at: '2026-09-27T08:18:58Z', class_history: [{ stage: 'reclassify_v3', class: 'brief' }, { stage: 'enrich', class: 'brief' }] }
};
// a live-path story: detected and published a minute apart
const live = { first_published_at: '2026-09-30T05:02:00Z', published_at: '2026-09-30T05:02:00Z', tennis_news_events: { occurred_at: '2026-09-30T03:00:00Z', detected_at: '2026-09-30T05:01:00Z', class_history: [{ stage: 'detect', class: 'brief' }, { stage: 'enrich', class: 'brief' }] } };

test('freshnessOf: backfill only from the lifecycle record + a publication lag, never from age alone', () => {
  const f = freshnessOf(backfill);
  assert.equal(f.is_backfill, true); assert.equal(f.basis, 'event'); assert.equal(f.event_at, '2026-09-27T06:18:00Z');
  assert.equal(freshnessOf(live).is_backfill, false);
  // old but NOT reclassified (the 2026-09-26 launch batch): not flagged, its own publication date is honest
  const launch = { ...backfill, tennis_news_events: { ...backfill.tennis_news_events, class_history: [] } };
  assert.equal(freshnessOf(launch).is_backfill, false);
  // reclassified but published promptly: not a backfill
  const prompt = { ...backfill, first_published_at: new Date(Date.parse(backfill.tennis_news_events.detected_at) + BACKFILL_LAG_MS - 60e3).toISOString() };
  assert.equal(freshnessOf(prompt).is_backfill, false);
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
