// Player media queue (Newsroom V3 §21): deterministic, bounded, identity-first. Discovery never guesses a person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeQueue, order, due, markResult, identityFromWikidata, enqueueMissingPhotos, QUEUE_KEY, PRIORITY } from '../workers/shared/media-queue.js';
import { MemStore, MemKV } from './helpers/memstore.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const T0 = Date.parse('2026-09-29T12:00:00Z');

test('merge: no duplicates, reasons accumulate, best priority wins, first_seen is kept', () => {
  let q = mergeQueue({}, [{ id: A, reason: 'top100' }], T0);
  q = mergeQueue(q, [{ id: A, reason: 'news' }, { id: A, reason: 'news' }, { id: 'not-a-uuid', reason: 'news' }, { id: B, reason: 'bogus' }], T0 + 1000);
  assert.deepEqual(Object.keys(q), [A]);
  assert.deepEqual(q[A].reasons, ['news', 'top100']);
  assert.equal(q[A].priority, PRIORITY.news);
  assert.equal(q[A].first_seen, new Date(T0).toISOString());
});

test('order + due: priority, then oldest, then id; retries wait for retry_after', () => {
  let q = mergeQueue({}, [{ id: C, reason: 'top100' }, { id: B, reason: 'current_event' }], T0);
  q = mergeQueue(q, [{ id: A, reason: 'news' }], T0 + 5000);
  assert.deepEqual(order(q).map((x) => x.id), [A, B, C]);
  q = markResult(q, A, 'rejected:multiple_faces', T0);
  assert.deepEqual(due(q, T0 + 60e3).map((x) => x.id), [B, C], 'a rejected entry waits (the item or image may change)');
  assert.deepEqual(due(q, T0 + 31 * 86400e3).map((x) => x.id), [A, B, C]);
  assert.equal(q[A].attempts, 1);
  q = markResult(q, B, 'approved', T0);
  assert.equal(q[B], undefined, 'approved leaves the queue');
  q = markResult(q, C, 'error:timeout', T0);
  assert.ok(Date.parse(q[C].retry_after) - T0 === 86400e3, 'transient errors retry after a day');
});

test('identity: exactly one Wikidata item with the EXACT founding tour id; its P18 files are the only candidates', () => {
  const rows = [
    { item: 'Q1', atp: 'f0f1', wta: null, img: 'Arthur Fils 2024.jpg' },
    { item: 'Q1', atp: 'f0f1', wta: null, img: 'Arthur Fils 2023.jpg' },
    { item: 'Q9', atp: null, wta: '330332', img: 'Alexandra Eala.jpg' }
  ];
  assert.deepEqual(identityFromWikidata(rows, 'atp:F0F1'), { ok: true, item: 'Q1', files: ['Arthur Fils 2023.jpg', 'Arthur Fils 2024.jpg'], evidence: ['wikidata:Q1 lists atp:F0F1'] });
  assert.equal(identityFromWikidata(rows, 'wta:330332').item, 'Q9');
  assert.equal(identityFromWikidata(rows, 'wta:33033').reason, 'no_identity:no_wikidata_item_with_tour_id', 'no prefix/fuzzy match');
  assert.equal(identityFromWikidata([...rows, { item: 'Q2', atp: 'F0F1', img: 'x.jpg' }], 'atp:F0F1').reason, 'ambiguous_identity:2_items');
  assert.equal(identityFromWikidata([{ item: 'Q5', atp: 'ZZ99', img: null }], 'atp:ZZ99').reason, 'no_image:no_p18');
  assert.equal(identityFromWikidata(rows, 'espn:123').reason, 'no_identity:no_tour_id');
});

test('newsroom hook: only players WITHOUT an approved photo are enqueued, as news priority', async () => {
  const store = new MemStore();
  await store.upsert('tennis_player_media', [{ pbe_player_id: A, approval: 'approved' }, { pbe_player_id: B, approval: 'rejected' }], { onConflict: 'pbe_player_id' });
  const kv = new MemKV();
  const n = await enqueueMissingPhotos(kv, store, [A, B, C, 'junk'], 'news', T0);
  assert.equal(n, 2);
  const q = await kv.get(QUEUE_KEY, 'json');
  assert.deepEqual(Object.keys(q).sort(), [B, C]);
  assert.ok(Object.values(q).every((x) => x.priority === PRIORITY.news));
  assert.equal(await enqueueMissingPhotos(kv, store, [A], 'news', T0), 0, 'approved players never enter the queue');
});
