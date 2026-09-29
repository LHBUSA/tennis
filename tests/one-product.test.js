// One Tennis product (ATP + WTA + Grand Slams): tour classification, schedule filters, availability-aware
// mixing, ranking-list labels and copy guards. Men and women are peers; secondary-source ATP data is never
// described as official.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { editionTour, keepTour, coveredEditions, TOUR_FILTERS, TOUR_COVERAGE } from '../workers/tennis-api/src/tours.js';
import { ensureEach, eventGender, storyTour } from '../src/lib/balance.js';
import { tourLabel } from '../src/ui/render.js';
import { orderLive } from '../src/lib/pbecast-live.js';
import { playerRank } from '../workers/tennis-web/src/heads.js';
import { DESKS, RANK_LIST } from '../src/pages/news.js';
import { resolveRoute } from '../src/lib/routes.js';

test('tour classification: official levels, Slams, and ESPN ATP editions only when they hold men\'s singles', () => {
  const atp = new Set(['e-atp']);
  assert.equal(editionTour({ level: 'Grand Slam', source_family: 'espn' }), 'grand-slam');
  assert.equal(editionTour({ level: 'WTA 1000' }), 'wta');
  assert.equal(editionTour({ level: 'WTA Finals' }), 'wta');
  assert.equal(editionTour({ level: 'WTA 125' }), 'wta-125');
  assert.equal(editionTour({ edition_id: 'e-atp', level: null, source_family: 'espn', competition_key: null }, atp), 'atp');
  assert.equal(editionTour({ edition_id: 'e-atp', level: null, source_family: 'espn', competition_key: 'atp_finals' }, atp), 'atp');
  // an ESPN edition without a stored men's singles match (e.g. an unmapped WTA-league edition) is not ATP
  assert.equal(editionTour({ edition_id: 'e-w', level: null, source_family: 'espn', competition_key: null }, atp), null);
  // team / exhibition competitions are never labelled ATP Tour
  assert.equal(editionTour({ edition_id: 'e-atp', level: null, source_family: 'espn', competition_key: 'united_cup' }, atp), null);
  assert.equal(editionTour({ level: 'ITF' }), null);
});

test('schedule tour filter: atp is a first-class filter; no filter keeps every classified tour', () => {
  assert.deepEqual(TOUR_FILTERS, ['atp', 'wta', 'wta-125', 'grand-slam']);
  assert.ok(keepTour('atp', 'atp') && !keepTour('atp', 'wta') && !keepTour('wta', 'atp'));
  assert.ok(keepTour('', 'atp') && keepTour(null, 'wta') && keepTour('grand-slam', 'grand-slam'));
  assert.ok(!keepTour('', null), 'an unclassified edition never appears');
  assert.ok(keepTour('bogus', 'atp'), 'an unknown filter value filters nothing');
});

test('coverage semantics: ATP layers are secondary-source and never claim official or point-by-point', () => {
  const a = TOUR_COVERAGE.atp;
  assert.equal(a.provenance, 'secondary');
  for (const v of Object.values(a)) assert.ok(!/official ATP/i.test(v) || /not an official ATP/i.test(v), v);
  assert.match(a.live, /no point-by-point/);
  assert.match(a.rankings, /not an official ATP ranking/);
  assert.equal(TOUR_COVERAGE.wta.provenance, 'official');
  for (const k of TOUR_FILTERS) for (const f of ['tournaments_results', 'schedule', 'live', 'rankings']) assert.ok(TOUR_COVERAGE[k][f], `${k}.${f}`);
});

test('coveredEditions: one query per family; ESPN editions are ATP only with an embedded MS match', async () => {
  const calls = [];
  const store = {
    async select(table, q) {
      calls.push(q);
      assert.equal(table, 'tennis_tournament_editions');
      if (q.includes('level=is.null')) {
        assert.match(q, /tennis_matches\(match_id\)&tennis_matches\.event_type=eq\.MS&tennis_matches\.limit=1/);
        return [
          { edition_id: 'china-open', name: 'China Open', level: null, source_family: 'espn', competition_key: null, start_date: '2026-09-26', tennis_matches: [{ match_id: 'm1' }] },
          { edition_id: 'wta-league', name: 'Unmapped', level: null, source_family: 'espn', competition_key: null, start_date: '2026-09-26', tennis_matches: [] },
          { edition_id: 'united', name: 'United Cup', level: null, source_family: 'espn', competition_key: 'united_cup', start_date: '2026-01-02', tennis_matches: [{ match_id: 'm2' }] }
        ];
      }
      return [{ edition_id: 'beijing', name: 'Beijing', level: 'WTA 1000', source_family: 'wta', start_date: '2026-09-30' }, { edition_id: 'adana', name: 'Adana', level: 'WTA 125', source_family: 'wta', start_date: '2026-09-28' }];
    }
  };
  const eds = await coveredEditions(store, '2026-09-29', '2026-09-29');
  assert.equal(calls.length, 2, 'no per-edition probes');
  assert.deepEqual(eds.map((e) => [e.edition_id, e.tour]), [['china-open', 'atp'], ['adana', 'wta-125'], ['beijing', 'wta']]);
  assert.ok(eds.every((e) => !('tennis_matches' in e)), 'the probe embed never leaks into the response');
  // a failing ATP query degrades to the official tours; the page still renders
  const flaky = { async select(_t, q) { if (q.includes('level=is.null')) throw new Error('400'); return [{ edition_id: 'b', name: 'B', level: 'WTA 500', start_date: '2026-09-29' }]; } };
  assert.deepEqual((await coveredEditions(flaky, 'x', 'y')).map((e) => e.tour), ['wta']);
});

test('availability-aware mixing: both tours surface when both exist; nothing invented, nothing duplicated', () => {
  const w = (id) => ({ id, event_type: 'WS' });
  const m = (id) => ({ id, event_type: 'MS' });
  const g = (x) => eventGender(x);
  // 8 women's results newer than 1 men's: the cut of 6 still shows the men's result, newest-first order kept
  const list = [w(1), w(2), w(3), w(4), w(5), w(6), w(7), w(8), m(9)];
  const cut = ensureEach(list, 6, g);
  assert.equal(cut.length, 6);
  assert.deepEqual(cut.map((x) => x.id), [1, 2, 3, 4, 5, 9]);
  // only women available: exactly the newest 6 women, no padding, no duplicate
  assert.deepEqual(ensureEach(list.slice(0, 8), 6, g).map((x) => x.id), [1, 2, 3, 4, 5, 6]);
  // fewer than n: everything, unchanged
  assert.deepEqual(ensureEach([m(1), w(2)], 6, g).map((x) => x.id), [1, 2]);
  // neutral (mixed doubles) never forced in and never displaced first
  const x = { id: 'x', event_type: 'XD' };
  assert.deepEqual(ensureEach([x, w(1), w(2), m(3)], 3, (v) => (g(v) === 'mixed' ? null : g(v))).map((v) => v.id), ['x', 1, 3]);
});

test('news: a recent ATP story surfaces on the homepage cut; an old one is never pulled forward', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  const s = (id, desk, at) => ({ id, desk, published_at: at });
  const list = [s(1, 'wta', '2026-09-29T10:00Z'), s(2, 'wta', '2026-09-29T09:00Z'), s(3, 'doubles', '2026-09-29T08:00Z'), s(4, 'wta', '2026-09-29T07:00Z'), s(5, 'wta', '2026-09-29T06:00Z'), s(6, 'atp', '2026-09-28T06:00Z'), s(7, 'atp', '2026-09-01T06:00Z')];
  assert.deepEqual(ensureEach(list, 5, (a) => storyTour(a, now)).map((a) => a.id), [1, 2, 3, 4, 6]);
  const old = [...list.slice(0, 5), s(7, 'atp', '2026-09-01T06:00Z')];
  assert.deepEqual(ensureEach(old, 5, (a) => storyTour(a, now)).map((a) => a.id), [1, 2, 3, 4, 5]);
  assert.equal(storyTour(s(8, 'grand-slams', '2026-09-29T10:00Z'), now), null, 'Slam desk is neutral (both tours)');
});

test('news desks: ATP is routable and listed next to WTA; rank labels come from the list actually held', () => {
  const keys = DESKS.map(([k]) => k);
  assert.ok(keys.includes('atp') && keys.includes('wta') && keys.includes('grand-slams') && keys.includes('doubles'));
  assert.equal(resolveRoute('/news/atp').id, 'news-desk');
  assert.equal(resolveRoute('/news/wta').id, 'news-desk');
  assert.equal(resolveRoute('/news/grand-slams').id, 'news-desk');
  assert.equal(RANK_LIST.atp_singles, 'ATP singles');
  assert.equal(RANK_LIST.wta_singles, 'WTA singles');
  assert.equal(RANK_LIST.nonexistent, undefined, 'an unknown list is never labelled WTA');
});

test('tournament rows: an ATP edition without a source level reads "ATP Tour", never blank or WTA', () => {
  assert.equal(tourLabel({ level: null, tour: 'atp' }), 'ATP Tour');
  assert.equal(tourLabel({ level: 'WTA 500', tour: 'wta' }), 'WTA 500');
  assert.equal(tourLabel({ level: 'Grand Slam' }), 'Grand Slam');
  assert.equal(tourLabel({ level: null }), '');
});

test('PBEcast live order: an ATP court with no published level never sorts behind a WTA 125 court', () => {
  const live = (id, level, et) => ({ id, status: 'in_progress', event_type: et, round: '1', tournament: { level } });
  assert.deepEqual(orderLive([live('w125', 'WTA 125', 'WS'), live('atp', null, 'MS')]).map((x) => x.id), ['atp', 'w125']);
  assert.deepEqual(orderLive([live('atp', null, 'MS'), live('w500', 'WTA 500', 'WS')]).map((x) => x.id), ['w500', 'atp']);
});

test('player heads/cards: men carry their ATP list position labelled secondary; women the official WTA list', () => {
  assert.deepEqual(playerRank({ rankings: { atp_singles: { rank: 1, date: '2026-09-21', secondary_source: true } } }), { rank: 1, date: '2026-09-21', label: 'ATP singles', card: 'ATP SINGLES · SECONDARY SOURCE', secondary: true });
  assert.equal(playerRank({ rankings: { wta_singles: { rank: 2, date: '2026-09-21' } } }).label, 'WTA singles');
  assert.equal(playerRank({ rankings: {} }), null);
});

// ---- copy guards ------------------------------------------------------------------------------------------
function files(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(js|html|json)$/.test(f)) out.push(p);
  }
  return out;
}
const COPY = [...files('src'), ...files('workers/tennis-web/src'), ...files('workers/tennis-api/src'), 'workers/shared/tour-coverage.js', 'index.html'];

test('copy guard: "official ATP" appears only as a negation (we hold no official ATP feed)', () => {
  const bad = [];
  for (const f of COPY) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/official ATP/gi)) {
      const before = s.slice(Math.max(0, m.index - 60), m.index);
      const after = s.slice(m.index, m.index + 60);
      if (!/\b(not|no|never|nor|without)\b[^.]*$/i.test(before) && !/official ATP[^.]{0,40}\b(are not|is not|have no|has no)\b/i.test(after)) bad.push(`${f}: …${before}${after}…`);
    }
  }
  assert.deepEqual(bad, []);
});

test('copy guard: no WTA-first coverage framing that demotes men to "Grand Slam sources only"', () => {
  const stale = [/Men and mixed: supported Grand Slam sources only/i, /ATP Tour events are not yet available/i, /ATP Tour scheduling is not yet available/i, /Men’s stories come from supported Grand Slam sources/i, /WTA Tour, WTA 125 and Grand Slam events — live, results/i, /ATP, Challenger and ITF match data are not yet acquirable/i];
  const hits = [];
  for (const f of COPY) { const s = readFileSync(f, 'utf8'); for (const re of stale) if (re.test(s)) hits.push(`${f}: ${re}`); }
  assert.deepEqual(hits, []);
});
