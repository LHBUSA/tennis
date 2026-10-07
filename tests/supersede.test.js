// Superseded match rows by id (2026-10-07): /v1/matches/:id exposes superseded_by + the resolved canonical survivor
// (bounded chain, no loops, no guess); the live wire never links a superseded match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supersession } from '../workers/tennis-api/src/supersede.js';

const storeOf = (rows) => ({ async select(t, q) { const id = /match_id=eq\.([^&]+)/.exec(q)?.[1]; return t === 'tennis_matches' ? rows.filter((r) => r.match_id === id) : []; } });

test('supersession: direct survivor, two-hop chain, loop, dangling pointer, superseded end, non-superseded row', async () => {
  const rows = [
    { match_id: 'old', status: 'superseded', superseded_by: 'mid' },
    { match_id: 'mid', status: 'superseded', superseded_by: 'new' },
    { match_id: 'new', status: 'completed', superseded_by: null },
    { match_id: 'o1', status: 'superseded', superseded_by: 'new' },
    { match_id: 'l1', status: 'superseded', superseded_by: 'l2' },
    { match_id: 'l2', status: 'superseded', superseded_by: 'l1' },
    { match_id: 'd1', status: 'superseded', superseded_by: 'gone' },
    { match_id: 'n1', status: 'superseded', superseded_by: null }
  ];
  const s = storeOf(rows);
  assert.deepEqual(await supersession(s, 'o1', 'superseded'), { superseded_by: 'new', canonical_match_id: 'new' });
  assert.deepEqual(await supersession(s, 'old', 'superseded'), { superseded_by: 'mid', canonical_match_id: 'new' });
  assert.deepEqual(await supersession(s, 'l1', 'superseded'), { superseded_by: 'l2', canonical_match_id: null });
  assert.deepEqual(await supersession(s, 'd1', 'superseded'), { superseded_by: 'gone', canonical_match_id: null });
  assert.deepEqual(await supersession(s, 'n1', 'superseded'), { superseded_by: null, canonical_match_id: null });
  assert.deepEqual(await supersession(s, 'new', 'completed'), {}, 'additive only for superseded rows');
  const long = Array.from({ length: 8 }, (_, i) => ({ match_id: `c${i}`, status: i === 7 ? 'completed' : 'superseded', superseded_by: i === 7 ? null : `c${i + 1}` }));
  assert.equal((await supersession(storeOf(long), 'c0', 'superseded')).canonical_match_id, null, 'chain bounded');
});

test('live wire (/v1/news/live): an event on a superseded match is skipped; the survivor event links the survivor', async () => {
  const { newsRoute } = await import('../workers/tennis-api/src/news.js');
  const ED = { edition_id: 'e', year: 2026, name: 'China Open', level: 'WTA 1000', tennis_tournaments: { slug: 'china-open', name: 'China Open' } };
  const pl = (id, name) => ({ side: id === 'p1' ? 'A' : 'B', participant_key: `S:${id}`, tennis_participants: { kind: 'single', tennis_participant_members: [{ slot: 1, tennis_players: { pbe_player_id: id, slug: name.toLowerCase().replace(/ /g, '-'), full_name: name, gender: 'F', tennis_player_media: [] } }] } });
  const base = { event_type: 'WS', round: 'Q-1', status: 'completed', winner_side: 'B', score_text: '6-4 1-6 3-6', edition_id: 'e', tennis_tournament_editions: ED, tennis_sets: [], source_family: 'wta' };
  const OLD = '95d3c15d-a6b2-5bb5-9d58-afc79f70ae2e';
  const NEW = '1acf3f48-bf28-5cf1-8206-1fa825ec9e8e';
  const matches = [{ ...base, match_id: OLD, status: 'superseded', tennis_match_participants: [] }, { ...base, match_id: NEW, tennis_match_participants: [pl('p1', 'Yexin Ma'), pl('p2', 'Yufei Ren')] }];
  const ev = (id, mid) => ({ event_id: id, kind: 'comeback', state: 'wire', occurred_at: '2026-09-26T00:00:00Z', detected_at: '2026-09-28T10:44:14Z', match_id: mid, article_id: null, entities: ['p1', 'p2'], evidence: { facts: { tour: 'wta', round: 'Q-1', first_set: '4-6', event_type: 'WS', tournament_slug: 'china-open' } }, class_history: [] });
  const store = { async select(t, q) {
    if (t === 'tennis_news_events') return [ev('comeback:old', OLD), ev('comeback:new', NEW)];
    if (t === 'tennis_matches') { const ids = /match_id=in\.\(([^)]*)\)/.exec(q)?.[1]?.split(',') || []; return matches.filter((m) => ids.includes(m.match_id)); }
    return [];
  } };
  const res = await newsRoute('/v1/news/live', new URL('https://x/v1/news/live?limit=100'), store, {});
  const body = typeof res?.json === 'function' ? await res.json() : res;
  const items = (body?.data ?? body?.body?.data ?? body).items;
  const txt = JSON.stringify(items);
  assert.ok(!txt.includes(OLD), 'superseded id never linked from the wire');
  assert.ok(items.some((c) => c.match_id === NEW), 'survivor card served');
});
