// SEO, social identity, analytics, share, court and image-fallback guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { routeMeta, headHtml, jsonLdGraph, personLd, sportsEventLd, OG_DEFAULT, X_HANDLE, X_URL, SITE } from '../src/seo/meta.js';
import { resolveRoute } from '../src/lib/routes.js';
import { shareLinks } from '../src/ui/share.js';
import { GA_ID, EVENTS, isProductionHost, initAnalytics, trackPageView, track, __test as gaTest } from '../src/analytics.js';
import { serveCourt, courtSvg } from '../src/ui/court.js';
import { monogramSrc } from '../src/ui/avatar.js';
import { __test as pbc } from '../src/pages/pbecast.js';

test('every head carries the full OG + X card set with @PROPBETEDGE and the 1200x630 card', () => {
  const h = headHtml(routeMeta(resolveRoute('/rankings/women')));
  for (const k of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:secure_url', 'og:image:type', 'og:image:width', 'og:image:height', 'og:image:alt']) assert.ok(h.includes(`property="${k}"`), k);
  for (const k of ['twitter:card', 'twitter:site', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt']) assert.ok(h.includes(`name="${k}"`), k);
  assert.ok(h.includes('content="summary_large_image"'));
  assert.ok(h.includes(`name="twitter:site" content="${X_HANDLE}"`));
  assert.equal(X_HANDLE, '@PROPBETEDGE');
  assert.ok(h.includes('<link rel="canonical" href="https://tennis.propbetedge.ai/rankings/women" />'));
  assert.ok(h.includes('og:image:width" content="1200"') && h.includes('og:image:height" content="630"'));
  assert.match(OG_DEFAULT.url, /propbetedge-tennis-1200x630\.png\?v=\d{8}$/);
});

test('the generic social card on disk is a 1200x630 RGB PNG', async () => {
  const sharp = (await import('sharp')).default;
  const m = await sharp('public/brand/propbetedge-tennis-1200x630.png').metadata();
  assert.equal(m.width, 1200);
  assert.equal(m.height, 630);
  assert.equal(m.format, 'png');
  assert.equal(m.channels, 3);
});

test('JSON-LD: Organization sameAs x.com/PROPBETEDGE; Person and SportsEvent only from real fields', () => {
  const g = jsonLdGraph(routeMeta(resolveRoute('/')));
  assert.equal(g['@context'], 'https://schema.org');
  const org = g['@graph'].find((n) => n['@type'] === 'Organization');
  assert.deepEqual(org.sameAs, [X_URL]);
  assert.equal(org.url, 'https://propbetedge.ai');
  assert.ok(g['@graph'].some((n) => n['@type'] === 'WebSite') && g['@graph'].some((n) => n['@type'] === 'WebPage'));
  const p = personLd({ name: 'Test Player', nationality: 'ITA' }, `${SITE}/players/test-player`);
  assert.equal(p['@type'], 'Person');
  assert.equal(p.birthDate, undefined, 'no invented bio');
  assert.equal(sportsEventLd({ sides: { A: { players: [{ name: 'A', slug: 'a' }] } }, tournament: null }, SITE), null, 'no SportsEvent without players + tournament');
  const e = sportsEventLd({ status: 'completed', sides: { A: { players: [{ name: 'A', slug: 'a' }] }, B: { players: [{ name: 'B', slug: 'b' }] } }, tournament: { tournament: 'T', start_date: '2026-09-21', city: 'Singapore', country: 'SGP' } }, `${SITE}/matches/x`);
  assert.equal(e['@type'], 'SportsEvent');
  assert.equal(e.competitor.length, 2);
});

test('no stale or retired social handles anywhere in shipped code', () => {
  const files = ['index.html'];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${f.name}`; if (f.isDirectory()) walk(p); else if (/\.(js|css|html|json)$/.test(f.name)) files.push(p); } };
  walk('src');
  walk('workers');
  const retired = ['@MLBHRALERTSPBE', '@propbetedgeai', 'twitter.com/propbetedge', 'x.com/propbetedgeai', 'x.com/MLBHRALERTSPBE'];
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    for (const bad of retired) assert.ok(!t.includes(bad), `${f} contains ${bad}`);
  }
});

test('share intent: x.com/intent/post with encoded text + url; LinkedIn; copy', () => {
  const l = shareLinks({ url: 'https://tennis.propbetedge.ai/players/elena-rybakina', text: 'Rybakina & co — PropBetEdge' });
  assert.equal(l.x, 'https://x.com/intent/post?text=Rybakina%20%26%20co%20%E2%80%94%20PropBetEdge&url=https%3A%2F%2Ftennis.propbetedge.ai%2Fplayers%2Felena-rybakina');
  assert.match(l.linkedin, /^https:\/\/www\.linkedin\.com\/sharing\/share-offsite\/\?url=https%3A/);
  assert.equal(l.copy, 'https://tennis.propbetedge.ai/players/elena-rybakina');
});

function fakeEnv(host) {
  const head = { children: [], appendChild(n) { this.children.push(n); } };
  const doc = { title: 'Player page', head, querySelector: (sel) => head.children.find((n) => sel.includes(n.dataset && n.dataset.pbeGa4)) || null, createElement: () => ({ dataset: {} }), addEventListener() {} };
  const win = { location: { hostname: host, pathname: '/players/x', search: '?token=secret', hash: '', origin: `https://${host}` } };
  return { win, doc };
}

test('GA: network ID, production host only, one script, one page_view per route, no query strings, allowlisted params', () => {
  assert.equal(GA_ID, 'G-BRS48R8PG9');
  assert.ok(isProductionHost('tennis.propbetedge.ai'));
  for (const h of ['localhost', '127.0.0.1', 'tennis-abc-justins-projects.vercel.app']) assert.ok(!isProductionHost(h), h);
  gaTest.reset();
  const dev = fakeEnv('localhost');
  assert.equal(initAnalytics({ win: dev.win, doc: dev.doc }), false);
  assert.equal(dev.doc.head.children.length, 0);
  gaTest.reset();
  const { win, doc } = fakeEnv('tennis.propbetedge.ai');
  assert.equal(initAnalytics({ win, doc }), true);
  assert.equal(initAnalytics({ win, doc }), false, 'no double init');
  assert.equal(doc.head.children.length, 1);
  const cfg = win.dataLayer.find((a) => a[0] === 'config');
  assert.equal(cfg[1], GA_ID);
  assert.equal(cfg[2].send_page_view, false);
  assert.equal(cfg[2].cookie_domain, '.propbetedge.ai');
  assert.equal(trackPageView({ routeId: 'player', win, doc }), true);
  assert.equal(trackPageView({ routeId: 'player', win, doc }), false, 'same route+title never counts twice');
  const pv = win.dataLayer.filter((a) => a[0] === 'event' && a[1] === 'page_view');
  assert.equal(pv.length, 1);
  assert.ok(!JSON.stringify(pv).includes('secret'), 'query strings never sent');
  assert.equal(track('tennis_player_open', { player_id: 'p1', email: 'x@y.z', search_text: 'me' }, { win }), true);
  const ev = win.dataLayer.find((a) => a[1] === 'tennis_player_open');
  assert.deepEqual(Object.keys(ev[2]).sort(), ['pbe_surface', 'player_id']);
  assert.equal(track('tennis_simulation_run', {}, { win }), false, 'simulator events are not registered before the simulator ships');
  assert.ok(EVENTS.includes('tennis_pbecast_open') && EVENTS.includes('tennis_broadcast_click'));
});

test('GA loads only via the bundled module (no inline gtag); CSP allows GA + API images', () => {
  const doc = fs.readFileSync('index.html', 'utf8');
  assert.ok(!/gtag\(|googletagmanager/.test(doc), 'no inline GA in the document');
  const vj = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const csp = vj.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /script-src[^;]*https:\/\/www\.googletagmanager\.com/);
  assert.match(csp, /connect-src[^;]*google-analytics\.com/);
  assert.match(csp, /img-src[^;]*https:\/\/tennis-api\.propbetedge\.ai/);
});

test('court: serve side follows the scoring rules; no ball without source coordinates; SIMULATION stamp', () => {
  assert.equal(serveCourt({ A: '0', B: '0' }, false), 'deuce');
  assert.equal(serveCourt({ A: '15', B: '0' }, false), 'ad');
  assert.equal(serveCourt({ A: '40', B: '40' }, false), 'deuce');
  assert.equal(serveCourt({ A: 'AD', B: '40' }, false), 'ad');
  assert.equal(serveCourt({ A: '3', B: '2' }, true), 'ad');
  assert.equal(serveCourt(null, false), null);
  assert.ok(!String(courtSvg({ server: 'A', point: { A: '0', B: '0' } })).includes('c-ball'));
  assert.ok(String(courtSvg({ ball: { x: 1, y: 2 } })).includes('c-ball'));
  assert.ok(String(courtSvg({ simulation: true })).includes('SIMULATION'));
  assert.ok(!String(courtSvg({})).includes('SIMULATION'));
});

test('PBEcast text: snapshots never read as points; unsupported reasons/speeds never shown', () => {
  const m = { players: { A: [{ name: 'Ann Alpha' }], B: [{ name: 'Bea Beta' }] } };
  const snap = pbc.eventText({ quality: 'score_snapshot', event_type: 'score_update', event_detail: { from: { games: '4-3', point: '15–0' }, to: { games: '4-3', point: '40–30' } } }, m);
  assert.equal(snap.tag, 'SCORE UPDATE');
  assert.equal(snap.quality, 'snapshot');
  assert.ok(!/wins the point|ace|winner/i.test(snap.line));
  const brk = pbc.eventText({ quality: 'score_snapshot', event_type: 'break', winner_side: 'B', event_detail: { game_won: { result: 'break' }, from: { games: '4-3' }, to: { games: '4-4' } } }, m);
  assert.equal(brk.tag, 'BREAK');
  assert.match(brk.line, /Beta breaks/);
  const pt = pbc.eventText({ quality: 'point_event', event_type: 'ace', winner_side: 'A', event_detail: {} }, m);
  assert.equal(pt.tag, 'ACE');
  assert.ok(!/km\/h/.test(pt.line), 'no speed unless the event carries it');
  const plain = pbc.eventText({ quality: 'point_event', event_type: 'point', winner_side: 'B', event_detail: { stroke: null } }, m);
  assert.equal(plain.line, 'Beta wins the point');
});

test('missing player photo always yields a monogram data URI (never a broken image)', () => {
  const s = monogramSrc('Iga Świątek');
  assert.match(s, /^data:image\/svg\+xml/);
  assert.ok(decodeURIComponent(s).includes('>IS<'));
});
