// Newsroom V3 UI (docs/NEWSROOM_V3.md): hierarchy, desk counts, wire rows, at-a-glance cells, the article modules.
// Every renderer degrades to nothing (never an empty module / cell / blank hero) when the data is thin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hierarchy, deskStories, deskCounts, navDesks, wireRow, glanceCells, readingMinutes, longestSameRun } from '../src/lib/newsroom.js';
import { wireList, storyRow, leadStory, __test as N } from '../src/pages/news.js';
import { newsPlan } from '../src/lib/v4.js';

const NOW = Date.parse('2026-09-29T16:00:00Z');
const iso = (h) => new Date(NOW - h * 3600e3).toISOString();
const art = (slug, h, extra = {}) => ({ slug, headline: `H ${slug}`, desk: 'wta', story_type: 'title', published_at: iso(h), ...extra });
const str = (x) => String(x);

test('hierarchy: freshness wins — newest eligible story leads whatever its class; majors + rest newest-first; nothing dropped or duplicated', () => {
  const cards = [art('a', 1, { story_class: 'brief' }), art('b', 3, { story_class: 'full' }), art('c', 2), art('d', 30 * 24, { story_class: 'deep' }), art('e', 5, { story_class: 'full' })];
  const h = hierarchy(cards, { now: NOW });
  assert.equal(h.lead.slug, 'a', 'a newer brief beats an older full story');
  assert.deepEqual(h.majors.map((x) => x.slug), ['c', 'b', 'e']);
  assert.deepEqual(h.rest.map((x) => x.slug), ['d']);
  assert.equal(new Set([h.lead, ...h.majors, ...h.rest]).size, cards.length);
  assert.deepEqual(hierarchy([], { now: NOW }), { lead: null, majors: [], rest: [] });
});

// Hero regression fixtures (2026-10-02: a Sep 28 Fernandez full story held the hero over newer briefs).
const lead = (cards, desk = 'all', majors = 4) => hierarchy(deskStories(cards, desk), { now: NOW, majors });
test('hero 1: newest story is a brief -> the brief leads (no full-story preference, no 7-day class bonus)', () => {
  const h = lead([art('old-full', 4 * 24, { story_class: 'full', media: { hero: { images: [{ id: 'p1' }] } } }), art('new-brief', 1, { story_class: 'brief', desk: 'atp' })]);
  assert.equal(h.lead.slug, 'new-brief');
  assert.deepEqual(h.majors.map((x) => x.slug), ['old-full']);
});
test('hero 2: newest story is a full story -> it leads', () => {
  assert.equal(lead([art('brief', 3, { story_class: 'brief' }), art('full', 1, { story_class: 'full' }), art('deep', 9, { story_class: 'deep' })]).lead.slug, 'full');
});
test('hero 3: newest ATP story leads on ALL even over a WTA title', () => {
  assert.equal(lead([art('wta-title', 2, { desk: 'wta', story_class: 'full' }), art('atp-upset', 1, { desk: 'atp', story_type: 'upset', story_class: 'brief' })]).lead.slug, 'atp-upset');
});
test('hero 4: WTA desk -> newest WTA story leads regardless of newer ATP stories (desk filter BEFORE the hero pick)', () => {
  const cards = [art('atp-1', 0.5, { desk: 'atp' }), art('atp-2', 1, { desk: 'atp' }), art('wta-old', 6, { desk: 'wta' }), art('wta-new', 3, { desk: 'wta' }), art('dbl', 0.2, { desk: 'doubles' })];
  const h = lead(cards, 'wta');
  assert.equal(h.lead.slug, 'wta-new');
  assert.deepEqual([h.lead, ...h.majors, ...h.rest].map((x) => x.desk), ['wta', 'wta']);
  for (const desk of ['atp', 'doubles', 'grand-slams', 'rankings']) {
    const d = lead(cards, desk);
    assert.ok(!d.lead || d.lead.desk === desk, `${desk} desk leads with its own story`);
  }
  assert.equal(lead(cards, 'doubles').lead.slug, 'dbl');
  assert.equal(lead(cards, 'rankings').lead, null, 'empty desk: no hero borrowed from another desk');
});
test('hero 5: newest story with no image still leads; the lead renders the branded text treatment', () => {
  const h = lead([art('photo', 5, { story_class: 'full', media: { hero: { images: [{ id: 'p1', src: '/x.webp' }] } } }), art('no-img', 1, { media: { hero: null } })]);
  assert.equal(h.lead.slug, 'no-img');
  const out = str(leadStory(h.lead));
  assert.match(out, /nf-brand-art/);
  assert.match(out, /H no-img/);
});
test('hero 6: the hero never appears again in majors, Latest intelligence, tour rails or more', () => {
  const cards = Array.from({ length: 16 }, (_, i) => art(`s${i}`, i + 1, { desk: i % 2 ? 'atp' : 'wta' }));
  const h = lead(cards, 'all');
  const plan = newsPlan(h.rest, { desk: 'all', latest: 5, rail: 4 });
  const below = [...h.majors, ...plan.latest, ...plan.atp, ...plan.wta, ...plan.more];
  assert.equal(h.lead.slug, 's0');
  assert.ok(!below.includes(h.lead));
  assert.equal(new Set([h.lead, ...below]).size, cards.length, 'every story exactly once');
  assert.equal(h.majors[0].slug, 's1', 'the next-newest story follows the hero');
});
test('hero 7: future-dated or unpublished cards never lead (kept below the fold, not dropped)', () => {
  const cards = [art('future', -2), art('held', 0.1, { status: 'held' }), art('draft', 0.2, { status: 'draft' }), art('no-time', 0, { published_at: null }), art('live', 4)];
  const h = lead(cards);
  assert.equal(h.lead.slug, 'live');
  assert.deepEqual(h.majors, []);
  assert.equal(h.rest.length, 4);
  assert.equal(lead([art('future', -1), art('held', 1, { status: 'held' })]).lead, null);
});
test('hero 8: identical timestamps resolve deterministically (slug, then id) whatever the input order', () => {
  const same = [art('zeta', 1, { id: '2' }), art('alpha', 1, { id: '9' }), art('alpha', 1, { id: '1' }), art('mid', 1)];
  const orders = [same, [...same].reverse(), [same[2], same[0], same[3], same[1]]];
  const seqs = orders.map((o) => { const h = lead(o); return [h.lead, ...h.majors].map((x) => `${x.slug}:${x.id || ''}`).join(','); });
  assert.equal(new Set(seqs).size, 1);
  assert.equal(seqs[0], 'alpha:1,alpha:9,mid:,zeta:2');
});
test('hero: published_at is the clock — updated_at, ids and event dates never reorder', () => {
  const cards = [art('a', 5, { updated_at: iso(0), id: 'zzz', occurred_at: iso(0) }), art('b', 2, { updated_at: iso(48), id: 'aaa' })];
  assert.equal(lead(cards).lead.slug, 'b');
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

test('newsroom hub: anonymous / free visitors never request All Access endpoints; entitled visitors keep them', async () => {
  const { hubProPaths } = await import('../src/pages/news.js');
  for (const desk of ['all', 'atp', 'wta', 'doubles', 'rankings', 'grand-slams']) assert.deepEqual(hubProPaths(desk, false), [], desk);
  assert.deepEqual(hubProPaths('all', true), ['/v1/players-to-watch', '/v1/matchups?limit=40']);
  assert.deepEqual(hubProPaths('wta', true), ['/v1/players-to-watch', '/v1/matchups?limit=40']);
  assert.deepEqual(hubProPaths('doubles', true), ['/v1/players-to-watch']);
});
