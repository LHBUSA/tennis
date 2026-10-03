// Tennis official video lane (workers/tennis-ingest/src/video.js) on REAL titles from the seven official channels
// (feeds read 2026-10-03). Candidates use real players and editions from the store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyVideo, titleSides, resolveVideo, editionTokens, rankVideos, RANK } from '../workers/tennis-ingest/src/video.js';
import { parseFeed } from '../workers/providers/youtube.js';

const P = (first_name, last_name, id) => ({ pbe_player_id: id, first_name, last_name, full_name: `${first_name} ${last_name}` });
const BEIJING_W = { edition_id: 'ed-bj-w', year: 2026, start_date: '2026-09-30', end_date: '2026-10-11', name: 'China Open - Beijing, CHN', city: 'Beijing', tournament_name: 'Beijing' };
const BEIJING_M = { edition_id: 'ed-bj-m', year: 2026, start_date: '2026-09-26', end_date: '2026-10-11', name: 'China Open', city: 'Beijing', tournament_name: 'China Open' };
const TOKYO = { edition_id: 'ed-tyo', year: 2026, start_date: '2026-09-26', end_date: '2026-10-06', name: 'Kinoshita Group Japan Open Tennis Championships', city: 'Tokyo', tournament_name: 'Kinoshita Group Japan Open Tennis Championships' };
const USO = { edition_id: 'ed-uso', year: 2026, start_date: '2026-08-24', end_date: '2026-09-13', name: 'US Open', city: 'New York', tournament_name: 'US Open' };
const editions = new Map([BEIJING_W, BEIJING_M, TOKYO, USO].map((e) => [e.edition_id, { ...e, tokens: editionTokens(e) }]));
const M = (match_id, edition_id, A, B, extra = {}) => ({ match_id, edition_id, event_type: 'MS', status: 'completed', started_at: '2026-10-03T05:00:00Z', scheduled_at: null, sides: { A, B }, ...extra });
const candidates = [
  M('m-ryb', 'ed-bj-w', [P('Elena', 'Rybakina', 'p1')], [P('Alina', 'Charaeva', 'p2')], { event_type: 'WS' }),
  M('m-zve', 'ed-bj-m', [P('Alexander', 'Zverev', 'p3')], [P('Juncheng', 'Shang', 'p4')]),
  M('m-alc', 'ed-tyo', [P('Carlos', 'Alcaraz', 'p5')], [P('Matteo', 'Arnaldi', 'p6')]),
  M('m-mar', 'ed-uso', [P('Tatjana', 'Maria', 'p7')], [P('Jelena', 'Ostapenko', 'p8')], { event_type: 'WS', started_at: '2026-08-25T15:00:00Z' }),
  M('m-zve-tyo', 'ed-tyo', [P('Alexander', 'Zverev', 'p3')], [P('Some', 'Body', 'p9')]) // same player, other event: tournament must decide
];
const v = (title, published_at, extra = {}) => ({ video_id: 'abcdefghijk', title, published_at, ...extra });

test('classification ranks full replay > condensed/extended > match highlights > interview > coverage; shorts never link', () => {
  assert.equal(classifyVideo('Tatjana Maria vs. Jelena Ostapenko Full Match | 2026 US Open Round 1').video_type, 'full_match');
  assert.equal(classifyVideo('A BLOCKBUSTER Final | Jannik Sinner vs Alexander Zverev Full Match Replay | Wimbledon 2026').video_type, 'full_match');
  assert.equal(classifyVideo('Ben Shelton vs. Denis Shapovalov Condensed Match | 2026 US Open Round 3').video_type, 'extended_highlights');
  assert.equal(classifyVideo('Elena Rybakina vs. Alina Charaeva | 2026 Beijing Round 2 | WTA Match Highlights').video_type, 'match_highlights');
  assert.equal(classifyVideo('Jakub Mensik vs Francisco Cerundolo Highlights | Beijing 2026 Round 2').video_type, 'match_highlights');
  assert.equal(classifyVideo('Zverev Faces Shang; Medvedev, Rublev & De Minaur In Action | Beijing 2026 Highlights Day 4').video_type, 'tournament_coverage');
  assert.equal(classifyVideo('"Mum left a couple of times!" | Jannik Sinner Champion\'s Dinner Speech | Wimbledon 2026').video_type, 'interview');
  assert.equal(classifyVideo('Jovic is here 🔥', { is_short: true }).video_type, 'short');
  assert.ok(RANK.full_match < RANK.extended_highlights && RANK.extended_highlights < RANK.match_highlights && RANK.match_highlights < RANK.interview);
  // highlights are never a replay
  assert.notEqual(classifyVideo('Carlos Alcaraz Continues Title Defence vs Matteo Arnaldi | Tokyo 2026 Match Highlights').video_type, 'full_match');
});

test('real titles resolve to exactly the right match', () => {
  const r1 = resolveVideo(v('Elena Rybakina vs. Alina Charaeva | 2026 Beijing Round 2 | WTA Match Highlights', '2026-10-03T15:22:00Z'), candidates, editions);
  assert.deepEqual([r1.status, r1.match_id, r1.confidence], ['linked', 'm-ryb', 'high']);
  const r2 = resolveVideo(v('Alexander Zverev vs Juncheng Shang Highlights | Beijing 2026 Round 2', '2026-10-03T12:33:00Z'), candidates, editions);
  assert.equal(r2.match_id, 'm-zve', 'Zverev also played Tokyo: the tournament decides');
  const r3 = resolveVideo(v('RUTHLESS Alexander Zverev vs Jerry Shang 🔥 | Beijing 2026 Highlights', '2026-10-03T12:38:00Z'), candidates, editions);
  assert.deepEqual([r3.status, r3.match_id, r3.confidence], ['linked', 'm-zve', 'medium'], 'a different first name links only on a pool-unique surname, at medium');
  const r4 = resolveVideo(v('Carlos Alcaraz Continues Title Defence vs Matteo Arnaldi | Tokyo 2026 Match Highlights', '2026-10-03T07:00:00Z'), candidates, editions);
  assert.equal(r4.match_id, 'm-alc');
  const r5 = resolveVideo(v('Tatjana Maria vs. Jelena Ostapenko Full Match | 2026 US Open Round 1', '2026-10-03T15:00:00Z'), candidates, editions);
  assert.equal(r5.match_id, 'm-mar', 'a full replay posted weeks later still links (title year + tournament)');
});

test('no false links: archive classics, other tournaments, one name only, out-of-window', () => {
  assert.equal(resolveVideo(v('Monfils vs Murray | Classic Match | Roland-Garros 2006', '2026-09-30T08:00:00Z'), candidates, editions).status, 'unlinked');
  assert.equal(resolveVideo(v('Elena Rybakina vs. Alina Charaeva | 2025 Beijing Round 2 | WTA Match Highlights', '2026-10-03T15:22:00Z'), candidates, editions).status, 'unlinked', 'wrong year');
  assert.equal(resolveVideo(v('Elena Rybakina vs. Alina Charaeva | 2026 Wuhan | Match Highlights', '2026-10-03T15:22:00Z'), candidates, editions).status, 'unlinked', 'tournament not named');
  assert.equal(resolveVideo(v('Rybakina reacts to her loss | Beijing 2026', '2026-10-03T15:22:00Z'), candidates, editions).status, 'unlinked', 'needs both sides');
  assert.equal(resolveVideo(v('Elena Rybakina vs. Alina Charaeva | Beijing | Match Highlights', '2026-12-30T15:22:00Z'), candidates, editions).status, 'unlinked', 'no title year -> publish window applies');
  // two matches satisfy -> ambiguous, held for review
  const dup = [...candidates, M('m-ryb-2', 'ed-bj-w', [P('Elena', 'Rybakina', 'p1')], [P('Alina', 'Charaeva', 'p2')], { event_type: 'WS' })];
  assert.equal(resolveVideo(v('Elena Rybakina vs. Alina Charaeva | 2026 Beijing Round 2 | WTA Match Highlights', '2026-10-03T15:22:00Z'), dup, editions).status, 'ambiguous');
});

test('doubles: both partners of each side must be named', () => {
  const D = M('m-dbl', 'ed-bj-w', [P('Katerina', 'Siniakova', 'd1'), P('Taylor', 'Townsend', 'd2')], [P('Sara', 'Errani', 'd3'), P('Jasmine', 'Paolini', 'd4')], { event_type: 'WD' });
  assert.equal(resolveVideo(v('Katerina Siniakova / Taylor Townsend vs Sara Errani / Jasmine Paolini | 2026 Beijing | Highlights', '2026-10-03T10:00:00Z'), [D], editions).match_id, 'm-dbl');
  assert.equal(resolveVideo(v('Katerina Siniakova vs Sara Errani | 2026 Beijing | Highlights', '2026-10-03T10:00:00Z'), [D], editions).status, 'unlinked');
});

test('feed parsing keeps channel id, shorts flag, entity-decoded titles', () => {
  const xml = '<feed><title>WTA</title><yt:channelId>aBIVVpHjq6j3tSyxwTE-8Q</yt:channelId><entry><yt:videoId>AAAAAAAAAAA</yt:videoId><yt:channelId>UCaBIVVpHjq6j3tSyxwTE-8Q</yt:channelId><title>A &amp; B vs. C</title><link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAAA"/><published>2026-10-03T15:22:00+00:00</published><media:thumbnail url="https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg"/></entry><entry><yt:videoId>BBBBBBBBBBB</yt:videoId><title>short</title><link rel="alternate" href="https://www.youtube.com/shorts/BBBBBBBBBBB"/><published>2026-10-03T15:00:00+00:00</published></entry></feed>';
  const f = parseFeed(xml);
  assert.equal(f.feed_title, 'WTA'); assert.equal(f.channel_id, 'UCaBIVVpHjq6j3tSyxwTE-8Q');
  assert.equal(f.entries[0].title, 'A & B vs. C'); assert.equal(f.entries[1].is_short, true);
});

test('ranking puts a full replay first and never mixes up labels', () => {
  const r = rankVideos([{ video_type: 'match_highlights', published_at: '2026-10-03' }, { video_type: 'full_match', published_at: '2026-09-01' }, { video_type: 'interview', published_at: '2026-10-04' }]);
  assert.deepEqual(r.map((x) => x.video_type), ['full_match', 'match_highlights', 'interview']);
});

test('the registry enables only channels with two proofs; no Data API anywhere', () => {
  const reg = JSON.parse(readFileSync(new URL('../data/source-registry/youtube-channels.json', import.meta.url), 'utf8'));
  for (const c of reg.channels.filter((x) => x.enabled)) {
    assert.match(c.id, /^UC[\w-]{22}$/);
    assert.ok(c.verification.checks.includes('feed_title_match') && c.verification.checks.length >= 2, c.handle);
  }
  for (const f of ['../workers/providers/youtube.js', '../workers/tennis-ingest/src/video.js']) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /googleapis|YOUTUBE_API_KEY|youtube\/v3/);
});
