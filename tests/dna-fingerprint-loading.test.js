// 2026-09-30 production UX correction: (1) the Match DNA fingerprint renders for ATP and WTA from published Match DNA
// percentiles, independent of the Technical DNA 30-player gate; (2) the homepage DNA module is never all-or-nothing;
// (3) the /players directory critical path is the ranking lists, never /v1/slams or the Grand Slam aggregate;
// (4) the player route starts /dna in parallel with the base player request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchDnaFingerprint, fingerprintDims, FINGERPRINT_DIMS, FINGERPRINT_MIN } from '../src/ui/match-dna.js';
import { dnaColumnsSkeleton, dnaBoard } from '../src/ui/home.js';
import { leaderBoard } from '../src/lib/v4.js';
import { DNA_MIN_QUALIFIED } from '../workers/tennis-api/src/v2.js';
import { COMPARATIVE_MIN } from '../workers/shared/dna/match-dna.js';

const str = (x) => String(x);
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const pub = (key, percentile, population = 500) => ({ key, label: key, value: 0.7, confidence: 'high', percentile, comparative_published: true, population_qualified: population, status: 'published' });
const held = (key) => ({ key, label: key, value: 0.7, confidence: 'medium', percentile: null, comparative_published: false, population_qualified: 12, status: 'population_building' });
const md = (tour, metrics) => ({ tour, as_of: '2026-10-01', families: [{ key: 'result', label: 'Results', metrics }] });
// production-shaped ATP Match DNA (Alcaraz percentiles/populations from the public PBEcast contract, 2026-10-01)
const ATP = md('ATP', [pub('match_win_rate', 99, 573), pub('set_win_rate', 99, 572), pub('game_win_rate', 99, 601), pub('straight_sets_win_rate', 87, 417), pub('deciding_set_win_rate', 98, 433), pub('tiebreak_win_rate', 93, 440), pub('comeback_win_rate', 100, 525), pub('top10_win_rate', 99, 251), pub('wins_above_expectation', 94, 486)]);
// the Technical DNA block as served while ATP is held at 17/30
const TECH_HELD = { tour: 'ATP', comparative: { published: false, qualified: 17, threshold: 30 } };

test('ATP Match DNA fingerprint renders a radar while Technical DNA is held at 17/30', () => {
  assert.equal(TECH_HELD.comparative.published, false);
  const h = str(matchDnaFingerprint(ATP));
  assert.match(h, /<svg class="radar"/, 'radar drawn');
  assert.match(h, /data-fp-state="published"/);
  assert.match(h, /data-dna-fingerprint="ATP"/);
  assert.match(h, /compared only with ATP players/);
  assert.match(h, /ATP and WTA are never compared/);
  assert.doesNotMatch(h, /\bWTA players\b/);
  // fixed dimension order, every published dimension present
  assert.match(h, /data-fp-dims="match_win_rate,set_win_rate,game_win_rate,deciding_set_win_rate,tiebreak_win_rate,comeback_win_rate,top10_win_rate,wins_above_expectation"/);
  assert.match(h, /251–601 players per metric/);
});

test('the fingerprint never reads the Technical DNA gate (the DNA page draws it before the technical section)', () => {
  const src = read('src/ui/match-dna.js');
  const fn = src.slice(src.indexOf('export function fingerprintDims'), src.indexOf('/** Headline Match DNA card'));
  assert.doesNotMatch(fn, /comparative\.published|\.dna\b|technical/i);
  const page = read('src/pages/live-pages.js');
  const tab = page.slice(page.indexOf('if (tab) {'), page.indexOf("const [dres, prof] = await Promise.all"));
  assert.ok(tab.indexOf('${matchDnaFingerprint(md)}') > 0, 'DNA tab renders the fingerprint');
  assert.ok(tab.indexOf('${matchDnaFingerprint(md)}') < tab.indexOf('familyTable'), 'fingerprint sits above the long tables');
  assert.ok(tab.indexOf('${matchDnaFingerprint(md)}') < tab.indexOf('dnaSection(d)'), 'fingerprint sits above Technical DNA');
  assert.doesNotMatch(tab.slice(0, tab.indexOf('${matchDnaFingerprint(md)}')), /published \? html`/, 'no technical condition wraps the fingerprint');
});

test('WTA uses the identical fingerprint contract; tours are never pooled', () => {
  const WTA = md('WTA', ATP.families[0].metrics.map((m) => ({ ...m, percentile: 80, population_qualified: 900 })));
  const a = str(matchDnaFingerprint(ATP));
  const w = str(matchDnaFingerprint(WTA));
  assert.match(w, /<svg class="radar"/);
  assert.match(w, /data-dna-fingerprint="WTA"/);
  assert.match(w, /compared only with WTA players/);
  assert.doesNotMatch(w, /\bATP players\b/);
  // same structure: identical once tour label, numbers and percentiles are normalized
  const shape = (h) => h.replace(/ATP|WTA/g, 'T').replace(/\d+(\.\d+)?/g, 'n');
  assert.equal(shape(a), shape(w));
});

test('unpublished dimensions are left out, never drawn as zero; too few -> explicit building state, no radar', () => {
  const partial = md('ATP', [pub('match_win_rate', 70), pub('set_win_rate', 60), held('game_win_rate'), pub('deciding_set_win_rate', 50), pub('tiebreak_win_rate', 40), pub('comeback_win_rate', 30), held('top10_win_rate')]);
  const dims = fingerprintDims(partial);
  assert.deepEqual(dims.map((d) => d.key), ['match_win_rate', 'set_win_rate', 'deciding_set_win_rate', 'tiebreak_win_rate', 'comeback_win_rate']);
  assert.ok(dims.every((d) => d.percentile > 0));
  const h = str(matchDnaFingerprint(partial));
  assert.match(h, /<svg class="radar"/);
  assert.match(h, /3 dimensions without a published comparison are left out, not drawn as zero/);
  assert.doesNotMatch(h, /\(n\/a\)/, 'no placeholder axis');
  const thin = md('WTA', [pub('match_win_rate', 70), pub('set_win_rate', 60), held('game_win_rate'), held('deciding_set_win_rate')]);
  const t = str(matchDnaFingerprint(thin));
  assert.doesNotMatch(t, /<svg/);
  assert.match(t, /data-fp-state="building"/);
  assert.match(t, new RegExp(`2 of ${FINGERPRINT_DIMS.length} dimensions have a published WTA comparison`));
  assert.equal(FINGERPRINT_MIN, 5);
  // a percentile without the publication flag is never drawn
  assert.equal(fingerprintDims(md('ATP', [{ ...pub('match_win_rate', 90), comparative_published: false }])).length, 0);
});

test('the Technical DNA 30-player gate is unchanged', () => {
  assert.equal(DNA_MIN_QUALIFIED, 30);
  assert.equal(COMPARATIVE_MIN, 30);
  const page = read('src/pages/live-pages.js');
  assert.match(page, /\$\{cmp\.published \? html`<div class="dna-wrap"><div>\$\{dnaRadar\(d\.dimensions\)\}/, 'technical radar still needs the published tour gate');
});

test('homepage DNA: Match DNA boards, skeleton from first paint, every board fills its own slot (no all-or-nothing)', () => {
  const src = read('src/pages/today.js');
  const boards = /HOME_DNA_BOARDS = \[(.+?)\];/.exec(src)[1];
  const keys = [...boards.matchAll(/\['([a-z_0-9]+)', '/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['pbe_rating', 'match_win_rate', 'game_win_rate']);
  assert.doesNotMatch(boards, /hold_rate|return_games_won|deciding_set_win_rate/, 'no Technical DNA metric on the homepage while ATP is held');
  // the API's public preview allowlist is exactly the homepage boards
  const api = read('workers/tennis-api/src/index.js');
  const allow = /PUBLIC_DNA_PREVIEW_METRICS = new Set\(\[(.+?)\]\)/.exec(api)[1];
  assert.deepEqual([...allow.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]), keys);
  // no Promise.all over the leaders requests; each slot is addressed on its own
  const dna = src.slice(src.indexOf('HOME_DNA_BOARDS.forEach'));
  assert.doesNotMatch(src, /Promise\.all\([^)]*dna\/leaders/s);
  assert.match(dna, /data-dna-slot="\$\{metric\}:\$\{tour\}"/);
  assert.match(dna, /Promise\.race\(\[req, late\]\)/, 'a slow board times out into its own state');
  assert.match(src, /body: dnaColumnsSkeleton\(HOME_DNA_BOARDS\)/, 'skeleton is in the first render');
  const sk = str(dnaColumnsSkeleton([['pbe_rating', 'PBE Rating'], ['match_win_rate', 'Match win %'], ['game_win_rate', 'Games won %']]));
  assert.equal((sk.match(/data-dna-slot=/g) || []).length, 6);
  assert.match(sk, /data-dna-slot="match_win_rate:atp"/);
  assert.match(sk, /data-dna-slot="game_win_rate:wta"/);
  assert.equal((sk.match(/class="hm-dna-skel"/g) || []).length, 6);
});

test('homepage boards: a failed board, a held board and a published board render side by side; ATP and WTA separate', () => {
  const fmt = (v) => `${(v * 100).toFixed(1)}%`;
  const failed = str(dnaBoard('match_win_rate', 'atp', fmt, leaderBoard(null, { tour: 'atp' })));
  assert.match(failed, /ATP leaders unavailable right now/);
  const heldB = str(dnaBoard('match_win_rate', 'wta', fmt, leaderBoard({ published: false, qualified: 12, threshold: 30, rows: [] }, { tour: 'wta' })));
  assert.match(heldB, /12<\/b> of <b class="tabnum">30<\/b> WTA players meet the comparison standard/);
  const ok = str(dnaBoard('match_win_rate', 'atp', fmt, leaderBoard({ published: true, qualified: 573, threshold: 30, definition: 'Share of singles matches won among ATP players', rows: [{ rank: 1, value: 0.84, player: { slug: 'jannik-sinner', name: 'Jannik Sinner' } }] }, { tour: 'atp' })));
  assert.match(ok, /Jannik Sinner/);
  assert.match(ok, /84\.0%/);
  assert.match(ok, /ATP and WTA are never pooled/);
  assert.match(ok, /href="\/dna\?metric=match_win_rate&tour=atp"/);
});

test('/players: the directory critical path is the ranking lists; /v1/slams and the Grand Slam aggregate never block it', () => {
  const page = read('src/pages/live-pages.js');
  const fn = page.slice(page.indexOf('export const players = mountWith('), page.indexOf('export const search = mountWith('));
  assert.doesNotMatch(fn, /Promise\.all\(/, 'no all-or-nothing wait');
  assert.match(page, /RANK_PATH = \{ atp: '\/v1\/rankings\?tour=atp&type=singles&limit=200', wta: '\/v1\/rankings\?tour=wta&type=singles&limit=200' \}/);
  // every /v1/slams and /v1/men/players request sits inside an enhance() step that runs after a list painted
  const enh = [...fn.matchAll(/const enhance = \(\) => \{[\s\S]*?\n  \};|const enhance = \(\) => \{ if \(asked\)[\s\S]*?\}\)\); \};/g)].map((m) => m[0]).join('\n');
  for (const p of ["api('/v1/slams'", "api('/v1/men/players'"]) {
    const total = fn.split(p).length - 1;
    const inside = enh.split(p).length - 1;
    assert.ok(total >= 1, p);
    assert.equal(inside, total, `${p} only as an enhancement`);
  }
  // men + women render straight from their ranking list
  assert.match(fn, /fill\(root, RANK_PATH\.wta, women/);
  assert.match(fn, /fill\(root, RANK_PATH\.atp,/);
  // the All view draws on each list's arrival and paginates
  assert.match(fn, /api\(RANK_PATH\.wta, \{ signal \}\)\.then\(got\('wta'\)\)/);
  assert.match(fn, /api\(RANK_PATH\.atp, \{ signal \}\)\.then\(got\('atp'\)\)/);
  assert.match(fn, /list\.slice\(0, shown\)/);
  assert.match(page, /export const DIR_PAGE = 100;/);
});

test('player route: /dna starts with the base player request; the hero never waits for profile or DNA', () => {
  const page = read('src/pages/live-pages.js');
  const fn = page.slice(page.indexOf('export const player = mountWith('), page.indexOf('/** PBE Rating line in the hero'));
  const iPr = fn.indexOf('const prP = api(');
  const iDna = fn.indexOf('const dnaP = api(');
  const iAwait = fn.indexOf('await prP');
  assert.ok(iPr > 0 && iDna > 0 && iDna < iAwait, 'DNA request issued before awaiting the player');
  assert.match(fn, /profP = tab \? Promise\.resolve\(null\)/, 'the DNA tab does not request /profile');
  const iHero = fn.indexOf('render(root, html`${playerHero(p, pr.meta, tab)}');
  assert.ok(iHero > iAwait && iHero < fn.indexOf('await dnaP'), 'hero renders before DNA resolves');
  assert.match(fn, /data-player-body><p class="loading">/, 'localized body loader');
});

test('PBE Rating leaders fast path: DB-limited query returns the same board as the full scan', async () => {
  const { matchDnaLeaders } = await import('../workers/tennis-api/src/dna2.js');
  const player = (i) => ({ pbe_player_id: `p${i}`, slug: `p-${i}`, full_name: `Player ${i}`, last_name: `P${i}`, nationality: 'POL', gender: 'F' });
  const all = Array.from({ length: 60 }, (_, i) => ({ pbe_player_id: `p${i}`, m: { value: 1500 + i * 7, rated_matches: 20 + i, established: i % 4 !== 0, published: true, population_established: 45 }, tennis_players: player(i) }));
  const mk = (fast) => ({ queries: [], async select(t, q) {
    this.queries.push(q);
    if (/order=as_of\.desc&limit=1/.test(q)) return [{ as_of: '2026-10-01' }];
    if (/->>established=eq\.true/.test(q)) {
      if (!fast) throw new Error('no fast path');
      const n = Number(/limit=(\d+)/.exec(q)[1]);
      return all.filter((r) => r.m.established).sort((a, b) => b.m.value - a.m.value).slice(0, n);
    }
    const off = Number(/offset=(\d+)/.exec(q)?.[1] || 0);
    return all.slice(off, off + 1000);
  } });
  const fastStore = mk(true);
  const slowStore = mk(false);
  const a = await matchDnaLeaders(fastStore, { metric: 'pbe_rating', tour: 'wta', limit: 5 });
  const b = await matchDnaLeaders(slowStore, { metric: 'pbe_rating', tour: 'wta', limit: 5 });
  assert.ok(!fastStore.queries.some((q) => /offset=/.test(q)), 'fast path never pages the table');
  assert.ok(slowStore.queries.some((q) => /offset=/.test(q)), 'fallback still works');
  assert.equal(a.qualified, 45);
  assert.equal(b.qualified, 45);
  assert.equal(a.published, true);
  assert.deepEqual(a.rows.map((r) => [r.rank, r.player.slug, r.value, r.sample_matches]), b.rows.map((r) => [r.rank, r.player.slug, r.value, r.sample_matches]));
});
