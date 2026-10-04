// Completed-match page (PBEcast FINAL state), WATCH, homepage LIVE & RECENT, and the permanent live-cache regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { watchPanel } from '../src/ui/watch.js';
import { liveRecentItems, liveRecentSection, liveRecentTrack } from '../src/ui/live-recent.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const V = (video_type, extra = {}) => ({ video_id: 'Qd4MQBnmF5A', title: 'Elena Rybakina vs. Alina Charaeva | 2026 Beijing Round 2 | WTA Match Highlights', channel: 'WTA', channel_class: 'tour_official', published_at: '2026-10-03T15:22:00Z', video_type, ...extra });

test('WATCH: the label is the real video type; highlights are never called a replay; poster first, no autoplay on load', () => {
  const h = watchPanel([V('match_highlights')]);
  assert.match(h, /MATCH HIGHLIGHTS/); assert.doesNotMatch(h, /FULL MATCH REPLAY|full replay/i);
  assert.match(h, /i\.ytimg\.com\/vi\/Qd4MQBnmF5A\/hqdefault\.jpg/); assert.doesNotMatch(h, /<iframe/, 'the player loads only on click');
  assert.match(h, /Watch on YouTube/); assert.match(h, /Official · WTA/); assert.match(h, /not hosted by PropBetEdge/);
  assert.match(watchPanel([V('full_match', { title: 'Tatjana Maria vs. Jelena Ostapenko Full Match | 2026 US Open Round 1', channel: 'US Open' })]), /FULL MATCH REPLAY/);
  assert.equal(watchPanel([]), ''); assert.equal(watchPanel([V('short')]), '', 'shorts / unknown types never render');
  assert.equal(watchPanel([{ ...V('match_highlights'), video_id: 'not-an-id' }]), '', 'only real video ids');
  const src = read('../src/ui/watch.js');
  assert.match(src, /youtube-nocookie\.com\/embed\//); assert.doesNotMatch(src, /youtube\.com\/embed\//);
});

test('PBEcast FINAL state keeps the court and adds summary -> market close (under the scoreboard) -> replay -> watch -> story; live polling stops', () => {
  const cast = read('../src/pages/pbecast.js');
  const order = ['data-final', 'data-score', 'id="pbc-market"', 'id="pbc-stage"', 'id="pbc-watch"', 'id="pbc-story"'].map((k) => cast.indexOf(k));
  assert.ok(order.every((i) => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]), `page order ${order}`);
  assert.match(cast, /else if \(!d\.mode\.includes\('live'\) && poll\) \{ clearInterval\(poll\); poll = null; \}/);
  assert.match(cast, /api\(`\/v1\/matches\/\$\{id\}\/videos`/); assert.match(cast, /api\(`\/v1\/news\?match=\$\{id\}&limit=3`/);
  assert.match(cast, /liveMarketPanel\(kx, data\.match, /, 'market close = the shared history contract, in the Market Pulse slot');
});

test('homepage LIVE & RECENT: live first, then finals; replay only when events are stored; market only from the shared board', () => {
  const live = { id: 'l1', status: 'in_progress', event_type: 'WS', round: 'M-2', tour: 'wta', tournament: { name: 'Adana', level: 'WTA 125' }, sides: { A: { players: [{ last_name: 'Ruzic' }] }, B: { players: [{ last_name: 'Jeanjean' }] } }, sets: [{ A: 3, B: 4 }] };
  const fin = (id, replay) => ({ id, status: 'completed', winner_side: 'B', score: '6-3 4-6 3-6', event_type: 'WS', round: 'M-2', tour: 'wta', replay, tournament: { name: 'Beijing' }, sides: { A: { players: [{ name: 'Elena Rybakina', slug: 'elena-rybakina', last_name: 'Rybakina' }] }, B: { players: [{ name: 'Alina Charaeva', slug: 'alina-charaeva', last_name: 'Charaeva' }] } } });
  const items = liveRecentItems({ live: [live], latest_results: [fin('f1', 'observed'), fin('f2', null), { ...fin('wo', null), status: 'walkover' }] }, { f1: { best: 'match_highlights' } }).map(String);
  assert.equal(items.length, 3, 'walkovers are not recent finals');
  assert.match(items[0], /LIVE/); assert.match(items[0], /Live PBEcast/); assert.match(items[0], /data-kx-line="l1"/);
  assert.match(items[1], /class="sg-row won"[\s\S]*Charaeva/, 'two scoreboard rows, the winner marked');
  assert.equal((items[1].match(/class="av /g) || []).length, 2, 'every participant row carries an avatar (monogram without a photo)');
  assert.match(items[1], /<p class="lr-score"><span class="tabnum">3–6 6–4 6–3<\/span><\/p>/, 'no structured sets: rows stay, the stored score text is shown beneath');
  assert.match(items[1], /data-tour="wta"/); assert.doesNotMatch(items[1], /lr-chip|>FINAL</, 'no FINAL pill on every final card');
  assert.match(items[1], /PBEcast replay/); assert.match(items[1], /▶ Highlights/);
  assert.match(read('../src/ui/live-recent.js'), /kalshiSlot\(m, 'hm-kx'\)/, 'finals use the shared slot: it renders only when the shared board recorded a close');
  assert.doesNotMatch(items[2], /PBEcast replay|▶/, 'no replay claimed without stored events; no video badge without a linked video');
  assert.doesNotMatch(read('../src/ui/live-recent.js'), /kalshi\.com|\bbp\b|mid_bp/, 'no market data hard-coded in the component');
});

test('LIVE & RECENT photo regression: every participant with an approved photo renders .av.is-photo in its card (singles + doubles)', () => {
  const P = (id, name, photo = true) => ({ id, slug: id, name, last_name: name.split(' ').slice(-1)[0], nationality: 'CZE', photo: photo ? { thumb: `https://tennis-api.propbetedge.ai/media/players/${id}/thumb.webp`, square: `https://tennis-api.propbetedge.ai/media/players/${id}/square.webp`, credit: 'Licensed' } : null });
  const sets = [{ A: 7, B: 6, tb: { A: 7, B: 3 }, winner: 'A' }, { A: 6, B: 4, winner: 'A' }];
  const singles = { id: 's1', status: 'completed', winner_side: 'A', score: '7-6(3) 6-4', event_type: 'MS', round: 'M-1', tour: 'atp', replay: null, tournament: { name: 'China Open' }, sets, sides: { A: { seed: 2, players: [P('a', 'Hubert Hurkacz')] }, B: { players: [P('b', 'Learner Tien')] } } };
  const doubles = { ...singles, id: 'd1', event_type: 'WD', tour: 'wta-125', sides: { A: { players: [P('c', 'Lucia Montarelli'), P('d', 'Anna Valdmannova', false)] }, B: { players: [P('e', 'Ena Jakupovic'), P('f', 'Mia Salden')] } } };
  const out = liveRecentItems({ live: [], latest_results: [singles, doubles] }).map(String);
  const cards = [singles, doubles].map((m) => out.find((c) => c.includes(`href="/matches/${m.id}"`)));
  for (const [i, m] of [singles, doubles].entries()) {
    for (const s of ['A', 'B']) for (const p of m.sides[s].players) {
      const re = new RegExp(`<img class="av is-photo[^>]*src="[^"]*/players/${p.id}/`);
      if (p.photo) assert.match(cards[i], re, `${p.name}: approved photo must render`);
      else assert.doesNotMatch(cards[i], re);
    }
    assert.match(cards[i], /href="\/players\//, 'names link to player profiles');
    assert.match(cards[i], /width="36" height="36"/, 'explicit avatar dimensions (CLS)');
  }
  assert.match(cards[0], /<sup>3<\/sup>/, 'tiebreak notation preserved'); assert.match(cards[0], /\[2\]/, 'seed shown');
  assert.match(cards[1], /class="av is-mono/, 'no photo: the branded monogram');
});

test('homepage LIVE & RECENT layout: own full-width header row (no intro column), arrows in the header, section omitted when empty', () => {
  const shell = String(liveRecentSection());
  assert.doesNotMatch(shell, /hm-intro/, 'not the generic intro-column section');
  assert.match(shell, /<header class="lr-head"><h2 id="h-lr">Live &amp; recent<\/h2><p>Live courts, recent finals, PBEcast and official highlights\.<\/p><span class="lr-tools"><a class="hm-more" href="\/pbecast">All PBEcasts/);
  assert.ok(shell.indexOf('class="hm-nav"') < shell.indexOf('data-lrbody'), 'arrows sit in the header row');
  assert.match(shell, /class="hm-in lr-in" data-rail/);
  assert.equal(liveRecentTrack([]), '');
  const today = read('../src/pages/today.js');
  assert.match(today, /wrap\.hidden = !items\.length/); assert.doesNotMatch(today, /No live match and no recent final/);
  const css = read('../src/styles/live-recent.css');
  assert.match(css, /grid-auto-columns: calc\(\(100% - 3 \* var\(--lr-gap\)\) \/ 4\)/, '4 across on desktop');
  assert.match(css, /\.lr-card\[data-tour="atp"\] \{ box-shadow: inset 0 2px 0 /, 'restrained tour accent: a thin top rule');
});

test('live-cache regressions (2026-10-03): no multi-hour browser TTL on live data; live reads bypass the browser cache; Last updated = observation', () => {
  const api = read('../workers/tennis-api/src/index.js');
  const ttl = (re) => Number(new RegExp(`\\[/\\^\\\\/v1\\\\/${re}[^,]*, (\\d+)\\]`).exec(api)?.[1]);
  assert.ok(ttl('live') <= 30 && ttl('pbecast') <= 30 && ttl('today') <= 60, `live ${ttl('live')} pbecast ${ttl('pbecast')} today ${ttl('today')}`);
  assert.match(api, /r\.headers\.set\('cache-control', `public, max-age=\$\{ttl\}`\)/, 'edge hits re-stamped with the route TTL');
  assert.match(read('../src/data/api.js'), /LIVE_PATH\.test\(path\) \? \{ cache: 'no-store' \}/);
  // the state card / stale chip use the stored observation time (observed_at), never the poll time
  const cast = read('../src/pages/pbecast.js');
  assert.match(cast, /const when = e\.event_at \|\| e\.observed_at;/);
  assert.match(cast, /staleness\(last\?\.observed_at \|\| last\?\.event_at \|\| null/);
});
