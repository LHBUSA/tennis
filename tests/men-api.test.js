// /v1/men and /v1/men/players must stay bounded as ATP history grows (regression 2026-09-27: a 10,000-row scan of
// men's matches produced an edition_id=in.(...) list PostgREST refused with 400 -> "canonical store read failed").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { men, menPlayers, slams, SLAM_COUNTED } from '../workers/tennis-api/src/men.js';
import { resultState } from '../src/ui/state.js';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const player = (n) => ({ pbe_player_id: uuid(9000 + n), slug: `player-${n}`, full_name: `Player ${n}`, last_name: `P${n}`, nationality: 'ITA', gender: 'M', tennis_player_media: [] });

// A store that answers like PostgREST over a large men's graph and records every request.
function recordingStore({ slamEditions = 102, rankings = 150 } = {}) {
  const log = [];
  const eds = Array.from({ length: slamEditions }, (_, i) => ({ edition_id: uuid(i + 1), year: 2026 - Math.floor(i / 4), name: 'Slam', level: 'Grand Slam', source_family: 'ausopen', updated_at: null, tennis_tournaments: { slug: ['australian-open', 'roland-garros', 'wimbledon', 'us-open'][i % 4], name: 'Slam' } }));
  const store = {
    requests: 0,
    async select(table, q) {
      this.requests += 1;
      log.push({ table, q });
      if (table === 'tennis_tournament_editions' && /level=eq\.Grand Slam|tennis_tournaments\.slug=in/.test(q)) return eds.slice(0, Number(/limit=(\d+)/.exec(q)[1]));
      if (table === 'tennis_tournament_editions') return [{ year: /asc/.test(q) ? 2007 : 2026 }];
      if (table === 'tennis_ranking_snapshots') return /ranking_date=lt/.test(q) ? [{ snapshot_id: 'prev', ranking_date: '2026-09-10' }] : [{ snapshot_id: 'snap', ranking_date: '2026-09-17', row_count: rankings, source_family: 'espn', captured_at: '2026-09-27T10:00:00Z' }];
      if (table === 'tennis_rankings' && /snapshot_id=eq\.snap/.test(q)) return Array.from({ length: rankings }, (_, i) => ({ rank: i + 1, points: 10000 - i, previous_rank: i + 2, provider_player_id: `espn:${i}`, pbe_player_id: i < rankings - 2 ? uuid(9000 + i) : null, tennis_players: i < rankings - 2 ? player(i) : null }));
      if (table === 'tennis_rankings') return Array.from({ length: rankings }, (_, i) => ({ provider_player_id: `espn:${i}`, rank: i + 2 }));
      return [];
    },
    async count() { this.requests += 1; log.push({ table: 'count' }); return 47033; },
    async req() { return null; }
  };
  return { store, log };
}

const unbounded = (log) => log.filter(({ table, q }) => table === 'tennis_matches' && !/edition_id=(eq\.|in\.)/.test(q || ''));
const inListSize = (q) => { const m = /edition_id=in\.\(([^)]*)\)/.exec(q || ''); return m ? m[1].split(',').length : 0; };

test('/v1/men/players: ATP secondary list is the directory; Slam matches read only for the newest editions', async () => {
  const { store, log } = recordingStore();
  const res = await menPlayers(store);
  const d = res.data ?? res.body?.data ?? res;
  const body = typeof res.json === 'function' ? await res.json() : res;
  const data = body.data || d;
  assert.equal(data.ranking.rows.length, 150);
  assert.equal(data.ranking.linked, 148);
  assert.equal(data.ranking.disclosure, 'Ranking list carried by a secondary source · not an official ATP feed');
  assert.equal(data.ranking.rows[0].previous_rank, 2, 'movement vs our previous archived list');
  assert.deepEqual(unbounded(log), [], 'no tennis_matches read without an edition filter');
  assert.ok(log.every(({ q }) => inListSize(q) <= SLAM_COUNTED), 'no edition in.() larger than the counted window');
  assert.ok(store.requests <= 12 + SLAM_COUNTED, `requests: ${store.requests}`);
  assert.doesNotMatch(body.meta.semantics, /official ATP (ranking|list)s? (feed )?dated/);
});

test('/v1/men: bounded regardless of how many Slam editions / men\'s matches exist; totals are exact counts', async () => {
  for (const n of [12, 102, 200]) {
    const { store, log } = recordingStore({ slamEditions: n });
    const res = await men(store);
    const body = typeof res.json === 'function' ? await res.json() : res;
    assert.equal(body.ok, true);
    assert.equal(body.data.totals.matches, 47033);
    assert.equal(body.data.editions.length + body.data.archive_editions.length >= 0, true);
    assert.equal(body.data.atp_tour.first_year, 2007);
    assert.deepEqual(unbounded(log), []);
    assert.ok(log.every(({ q }) => inListSize(q) <= SLAM_COUNTED));
    assert.ok(store.requests <= 25 + SLAM_COUNTED, `requests with ${n} editions: ${store.requests} (independent of edition count)`);
  }
});

test('/v1/slams: edition filter chunked (never one giant in.() list)', async () => {
  const { store, log } = recordingStore({ slamEditions: 200 });
  await slams(store);
  assert.ok(log.every(({ q }) => inListSize(q) <= 10));
  assert.deepEqual(unbounded(log), []);
});

test('UI: an API error is never rendered as an empty dataset', () => {
  assert.equal(resultState({ ok: false, data: null, meta: { freshness: 'ERROR', semantics: 'canonical store read failed' } }), 'error');
  assert.equal(resultState(null), 'error');
  assert.equal(resultState({ ok: true, data: { rows: [] }, meta: { freshness: 'CURRENT' } }, (d) => d.rows.length === 0), 'empty');
  assert.equal(resultState({ ok: true, data: { rows: [1] }, meta: {} }, (d) => d.rows.length === 0), 'data');
  assert.equal(resultState({ ok: true, data: null, meta: { freshness: 'UNAVAILABLE' } }), 'empty');
});
