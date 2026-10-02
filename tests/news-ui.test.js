// Newsroom V3 UI (docs/NEWSROOM_V3.md): hierarchy, desk counts, wire rows, at-a-glance cells, the article modules.
// Every renderer degrades to nothing (never an empty module / cell / blank hero) when the data is thin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hierarchy, deskCounts, navDesks, wireRow, glanceCells, readingMinutes, longestSameRun } from '../src/lib/newsroom.js';
import { wireList, storyRow, leadStory, __test as N } from '../src/pages/news.js';

const NOW = Date.parse('2026-09-29T16:00:00Z');
const iso = (h) => new Date(NOW - h * 3600e3).toISOString();
const art = (slug, h, extra = {}) => ({ slug, headline: `H ${slug}`, desk: 'wta', story_type: 'title', published_at: iso(h), ...extra });
const str = (x) => String(x);

test('hierarchy: the most significant recent story leads; majors next; nothing dropped or duplicated', () => {
  const cards = [art('a', 1, { story_class: 'brief' }), art('b', 3, { story_class: 'full' }), art('c', 2), art('d', 30 * 24, { story_class: 'deep' }), art('e', 5, { story_class: 'full' })];
  const h = hierarchy(cards, { now: NOW });
  assert.equal(h.lead.slug, 'b', 'recent full beats recent brief; an old deep story never leads');
  assert.deepEqual(h.majors.map((x) => x.slug), ['e', 'a', 'c']);
  assert.deepEqual(h.rest.map((x) => x.slug), ['d']);
  assert.equal(new Set([h.lead, ...h.majors, ...h.rest]).size, cards.length);
  assert.deepEqual(hierarchy([], { now: NOW }), { lead: null, majors: [], rest: [] });
});

test('desk counts are CURRENT content (articles 14 d, wire 72 h); ITF / Challenger listed only when populated', () => {
  const c = deskCounts([art('a', 2, { desk: 'atp' }), art('b', 20 * 24, { desk: 'wta' })], [{ desk: 'atp', detected_at: iso(1) }, { desk: 'rankings', detected_at: iso(100) }, { desk: 'itf', detected_at: iso(2) }], { now: NOW });
  assert.deepEqual([c.all.total, c.atp.total, c.wta.total, c.rankings.total, c.itf.total], [3, 2, 0, 0, 1]);
  const nav = navDesks(c);
  assert.ok(nav.find((d) => d.key === 'wta').empty, 'an empty desk is marked (rendered de-emphasised)');
  assert.ok(nav.some((d) => d.key === 'itf') && !nav.some((d) => d.key === 'challenger'));
});

test('wire row: deterministic served headline, time, event label, links in contract order (article, match, tournament, player)', () => {
  const r = wireRow({ id: 'e1', kind: 'upset', tour: 'atp', desk: 'atp', detected_at: '2026-09-29T11:42:00Z', headline: 'Carlos Alcaraz defeats X 6-4 7-6 in Tokyo', tournament: { name: 'Kinoshita Group Japan Open Tennis Championships', slug: 'tokyo', year: 2026 },
    links: [{ rel: 'player', href: '/players/carlos-alcaraz/dna', label: 'Alcaraz DNA' }, { rel: 'match', href: '/matches/m1', label: 'Match' }, { rel: 'tournament', href: '/tournaments/tokyo/2026' }, { rel: 'article', href: '/news/s1', label: 'Story' }] }, { tz: 'UTC' });
  assert.equal(r.headline, 'Carlos Alcaraz defeats X 6-4 7-6 in Tokyo');
  assert.equal(r.time, '11:42 AM');
  assert.equal(r.label, 'Kinoshita Group Japan Open Tennis Championships · ATP');
  assert.deepEqual(r.links.map((l) => l.rel), ['article', 'match', 'tournament']);
  assert.equal(r.links[2].label, 'Tournament');
  // no served links: built from ids, still in order; no headline -> no row
  const r2 = wireRow({ headline: 'Y wins', match_id: 'm2', tournament: { slug: 't', year: 2026, name: 'Adana Open - Adana, TUR' }, players: [{ slug: 'y', name: 'Y' }] });
  assert.deepEqual(r2.links.map((l) => l.href), ['/matches/m2', '/tournaments/t/2026', '/players/y/dna']);
  assert.equal(r2.label, 'Adana Open');
  assert.equal(wireRow({ kind: 'upset' }), null);
});

test('wire list: ruled rows with day separators, a "show more" only beyond the limit, nothing when empty', () => {
  const items = Array.from({ length: 16 }, (_, i) => ({ id: `w${i}`, headline: `Result ${i}`, detected_at: iso(i * 3), tour: 'wta' }));
  const h = str(wireList(items, { limit: 14 }));
  assert.equal((h.match(/class="nf-w(?: nf-w-more)?"/g) || []).length, 16);
  assert.match(h, /data-wire-more/);
  assert.match(h, /nf-w-day/);
  assert.doesNotMatch(h, /<img/, 'no thumbnails on the wire');
  assert.equal(wireList([]), '');
  assert.doesNotMatch(str(wireList(items.slice(0, 3), { limit: 14 })), /data-wire-more/);
  assert.equal((str(wireList(items, { limit: 6, more: false })).match(/class="nf-w"/g) || []).length, 6, 'no hidden rows without a reveal button');
});

test('at-a-glance: served cells first, never an empty cell, derived only from frozen facts, no strip below 2 cells', () => {
  assert.deepEqual(glanceCells({ glance: [{ label: 'Final', value: '6-4 7-6' }, { label: 'PBE Rating before', value: 2277 }, { label: 'Empty', value: '' }, { label: 'Dash', value: '—' }, { label: 'Surface', value: 'Hard' }] }).map((c) => c.label), ['Final', 'PBE Rating before', 'Surface']);
  const derived = glanceCells({ plan: { modules: [{ id: 'scoreboard', data: { winner_side: 'B', sets: [{ A: 4, B: 6 }, { A: 6, B: 7, tb: { A: 5, B: 7 } }], duration: { hours: 1, minutes: 52 } } }] }, evidence: { match: { round_label: 'quarterfinal' }, tournament: { surface: 'hard', level: 'WTA 500' } } });
  assert.deepEqual(derived.map((c) => `${c.label}=${c.value}`), ['Final=6-4 7-6', 'Round=Quarterfinal', 'Surface=Hard', 'Event=WTA 500', 'Duration=1h 52m']);
  assert.deepEqual(glanceCells({ evidence: { tournament: { surface: 'clay' } } }), [], 'one cell is not a strip');
  assert.equal(str(N.glanceStrip({})), '');
  assert.ok(glanceCells({ glance: Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`, value: i + 1 })) }).length === 5);
});

test('article modules: intelligence only from served data; source & method is always open (never an accordion) with versions visible; hero never blank', () => {
  assert.equal(str(N.intelligenceMod(null)), '');
  const intel = str(N.intelligenceMod({ takeaway: 'The return numbers separated most sharply after the first serve.', evidence: [{ label: 'PBE Rating', value: 2277 }, 'Opponent quality: 99th pct'], counterpoint: 'Only 7 matches carry statistics.' }));
  assert.match(intel, /PBE Intelligence/);
  assert.match(intel, /Counterpoint/);
  assert.doesNotMatch(intel, /odds|bet |wager|sportsbook/i, 'not a betting ad');
  const sm = str(N.sourceMethod({ evidence: { frozen_at: '2026-09-28T07:08:00Z', packet_version: 'tennis-packet/3', packet_hash: 'abc123', provenance: { upstream: [{ family: 'wta', what: 'match' }] }, unavailable: ['point-by-point'] }, method: { writer: 'gpt', gates: 'tennis-gates/2', gates_passed: true } }, { version: '0.8.0' }));
  assert.match(sm, /^<section class="nf-method"/);
  assert.doesNotMatch(sm, /<details|<summary/, 'owner 2026-10-02: Source & Method is never collapsed');
  assert.match(sm, /<h2 id="nf-method-h" class="nf-method-k">Source &amp; Method<\/h2>.*How this story was built/s);
  assert.match(sm, /Not available for this story\.<\/b> point-by-point/);
  assert.match(sm, /<div class="nf-method-adv">.*Versions.*Packet hash.*abc123.*Composer.*gpt.*Gates.*passed.*API.*0\.8\.0/s);
  const band = str(N.articleHero({ story_type: 'title', tournament: { name: 'Porto 125', year: 2026 }, media: { hero: { type: 'fallback', images: [] } } }));
  assert.match(band, /nf-band-hero/);
  assert.match(band, /Porto 125 2026/);
  assert.doesNotMatch(band, /<svg/, 'no generated illustration as editorial media');
});

test('front-page treatments are distinct (lead / major / feature / row) and a thin desk never renders a tile wall', () => {
  const a = art('x', 1, { story_class: 'full', dek: 'Dek', team: [{ slug: 'p', name: 'Pat Q' }], match_id: 'm1', tournament: { name: 'Beijing', slug: 'china-open', year: 2026 } });
  assert.match(str(leadStory(a)), /class="nf-lead"/);
  assert.match(str(leadStory(a)), /Pat Q/);
  assert.match(str(leadStory(a)), /\/players\/p\/dna/);
  assert.match(str(leadStory(a)), /nf-brand-art/, 'no real photo -> the restrained branded treatment, not a blank frame');
  assert.match(str(N.majorStory(a)), /class="nf-major"/);
  assert.match(str(N.featureStory(a)), /class="nf-feature no-img"/);
  assert.match(str(storyRow(a)), /class="nf-row"/);
  assert.equal(longestSameRun(['lead', 'major', 'major', 'feature', 'row', 'row', 'row']), 3);
});

test('fallbacks from real data only: latest results when the wire is unavailable; movers only where the rating is published', () => {
  const m = { id: 'm1', status: 'completed', winner_side: 'A', score: '6-4 6-3', sets: [{ A: 6, B: 4 }, { A: 6, B: 3 }], tour: 'wta', tournament: { name: 'Adana Open', slug: 'adana', year: 2026 }, sides: { A: { players: [{ name: 'A One', slug: 'a' }] }, B: { players: [{ name: 'B Two', slug: 'b' }] } } };
  const rows = N.resultRows([m, { ...m, id: 'm2', status: 'in_progress' }], (t) => (t?.tour === 'atp' || t?.tour === 'wta' ? t.tour : null));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].headline, 'A One defeats B Two 6-4 6-3');
  assert.equal(rows[0].day_only, true, 'no batch timestamp is shown as a match time');
  // winner-oriented score when the winner is side B (the served score text is A/B oriented)
  const mb = { ...m, id: 'm3', winner_side: 'B', score: '2-6 3-6', sets: [{ A: 2, B: 6 }, { A: 6, B: 7, tb: { A: 5, B: 7 } }] };
  assert.equal(N.resultRows([mb], () => 'wta')[0].headline, 'B Two defeats A One 6-2 7-6(5)');
  assert.equal(rows[0].tour, 'wta');
  const ptw = { tours: { ATP: { rating_published: true, biggest_30d_change: { risers: [{ change: 75, rating: 1657, rank: { rank: 111 }, matches_30d: 5, player: { slug: 'bu', name: 'Yunchaokete Bu' } }] } }, WTA: { rating_published: false, biggest_30d_change: { risers: [{ change: 90, player: { slug: 'w', name: 'W' } }] } } } };
  const mv = str(N.moversModule(ptw, [], null));
  assert.match(mv, /Yunchaokete Bu/);
  assert.match(mv, /\+75 PBE Rating in 30 days/);
  assert.doesNotMatch(mv, />W</, 'an unpublished tour rating is never shown');
  assert.equal(str(N.moversModule({ tours: {} }, [], null)), '');
  assert.equal(str(N.tournamentsModule({ tournaments: [] }, null)), '');
});

test('reading time from served prose only', () => {
  assert.equal(readingMinutes([{ paragraphs: [Array.from({ length: 660 }, () => 'w').join(' ')] }]), 3);
  assert.equal(readingMinutes([]), 0);
});
