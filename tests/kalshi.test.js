// Kalshi Market Intelligence on Tennis (contract market-intel/1).
// Vendored shared component (src/vendor/kalshi/, unchanged) + Tennis placements: match page (full card, bounded first
// paint, polled while mounted), PBEcast (strip, never blocking), schedule / live / home cards (restrained line), /sources.
// Truth rules: no entry -> nothing; every price links to kalshi.com with rel="noopener noreferrer sponsored"; both
// players render; the browser never calls a Kalshi API host; CSP allows our markets Worker.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MARKETS = 'https://propsports-markets.sales-fd3.workers.dev';
const BOARD = JSON.parse(fs.readFileSync(new URL('./fixtures/kalshi/tennis-board.json', import.meta.url), 'utf8'));
const EVENT = JSON.parse(fs.readFileSync(new URL('./fixtures/kalshi/tennis-event.json', import.meta.url), 'utf8'));
const ATP_ID = EVENT.event.event.canonical_event_id; // Alcaraz vs Shapovalov (captured live)
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

const fetched = [];
let marketsUp = true;
globalThis.fetch = async (url) => {
  url = String(url);
  fetched.push(url);
  if (!marketsUp) throw new Error('markets down');
  if (url === `${MARKETS}/v1/market-intelligence/sport/tennis`) return { ok: true, json: async () => BOARD };
  const ev = url.match(/\/v1\/market-intelligence\/event\/tennis\/([0-9a-f-]+)$/);
  if (ev) return { ok: true, json: async () => ({ ...EVENT, event: ev[1] === ATP_ID ? EVENT.event : null }) };
  throw new Error(`unexpected fetch ${url}`);
};

let ui, data, render, home;
before(async () => {
  ui = await import('../src/vendor/kalshi/kalshi-market-ui.js');
  data = await import('../src/data/kalshi.js');
  render = await import('../src/ui/render.js');
  home = await import('../src/ui/home.js');
});

const match = (id, status) => ({
  id, status, event_type: 'MS', round: 'M-S', sets: [], winner_side: null,
  sides: { A: { players: [{ slug: 'carlos-alcaraz', name: 'Carlos Alcaraz' }] }, B: { players: [{ slug: 'denis-shapovalov', name: 'Denis Shapovalov' }] } },
  tournament: { slug: 'x', year: 2026, tournament: 'X' }
});

describe('vendored component with a real tennis entry', () => {
  test('no entry -> nothing at every placement', () => {
    assert.equal(ui.kalshiCard(null, { placement: 'match' }), '');
    assert.equal(ui.kalshiStrip(null, { placement: 'pbecast' }), '');
    assert.equal(ui.kalshiLine(null), '');
    assert.equal(ui.kalshiCard({ event: {}, kalshi: null }, { placement: 'match' }), '');
  });

  test('tennis entry renders both players (sides A and B) with prediction-market wording', () => {
    const e = EVENT.event;
    const [a, b] = e.kalshi.outcomes;
    assert.deepEqual([a.role, b.role], ['a', 'b']);
    assert.equal(e.kalshi.proposition, 'player_wins_match');
    const card = ui.kalshiCard(e, { placement: 'match' });
    const t = text(card);
    for (const o of [a, b]) assert.ok(t.includes(o.abbr) && t.includes(o.contract), o.abbr);
    assert.equal((card.match(/class="kx__panel"/g) || []).length, 2, 'one panel per player');
    assert.match(t, /not sportsbook odds and not a PropBetEdge model/);
    assert.match(t, /Mid-market/);
    assert.doesNotMatch(t, /win probability|chance to win|PBE prediction/i);
    const strip = text(ui.kalshiStrip(e, { placement: 'pbecast' }));
    for (const o of [a, b]) assert.ok(strip.includes(o.abbr), `strip ${o.abbr}`);
    for (const ev of BOARD.events) {
      const line = text(ui.kalshiLine(ev));
      for (const o of ev.kalshi.outcomes) assert.ok(line.includes(`${o.abbr} ${(o.mid_bp / 100).toFixed(1)}`), `${ev.event.competition} ${o.abbr}`);
    }
    assert.deepEqual([...new Set(BOARD.events.map((x) => x.event.competition))].sort(), ['atp', 'wta'], 'ATP + WTA lanes');
  });

  test('every Kalshi link goes to kalshi.com, new tab, rel sponsored', () => {
    const e = EVENT.event;
    for (const h of [ui.kalshiCard(e, { placement: 'match' }), ui.kalshiStrip(e, { placement: 'pbecast' })]) {
      const anchors = h.match(/<a [^>]*>/g) || [];
      assert.ok(anchors.length >= 3, 'prices + footer are links');
      for (const a of anchors) {
        assert.match(a, /href="https:\/\/kalshi\.com\/markets\//);
        assert.match(a, /target="_blank"/);
        assert.match(a, /rel="noopener noreferrer sponsored"/);
      }
    }
  });
});

describe('tennis data client', () => {
  test('reads only our propsports-markets Worker for sport tennis; poll lanes', async () => {
    fetched.length = 0;
    const board = await data.kalshi.loadBoard({ force: true });
    assert.ok(board.get(ATP_ID), 'board keyed by our match UUID');
    const ev = await data.kalshi.loadEvent(ATP_ID, { force: true });
    assert.ok(ev?.movement?.kalshi?.a, 'event detail carries observed movement');
    assert.equal(await data.kalshi.loadEvent('00000000-0000-0000-0000-000000000000', { force: true }), null);
    assert.ok(fetched.length >= 3 && fetched.every((u) => u.startsWith(`${MARKETS}/v1/market-intelligence/`) && /\/tennis(\/|$)/.test(u)), fetched.join(','));
    assert.equal(data.kalshi.pollMsFor(data.kalshiPollState('in_progress')), 20_000);
    assert.equal(data.kalshi.pollMsFor(data.kalshiPollState('scheduled')), 45_000);
    for (const s of ['completed', 'retired', 'walkover']) assert.equal(data.kalshiPollState(s), null, s);
  });

  test('market API down -> nothing, never a throw', async () => {
    marketsUp = false;
    try {
      assert.equal(await data.kalshi.loadEvent('11111111-1111-1111-1111-111111111111', { force: true }), null);
      assert.equal(await data.bounded(Promise.reject(new Error('x')), 50), null);
      assert.equal(await data.bounded(new Promise(() => {}), 20), undefined, 'bounded wait gives up');
    } finally { marketsUp = true; }
  });
});

describe('compact card line (schedule / live / home)', () => {
  test('not-completed match with a market -> one restrained line; completed / no market -> none', async () => {
    await data.kalshi.loadBoard({ force: true });
    const pre = String(render.matchCard(match(ATP_ID, 'scheduled')));
    assert.match(pre, /class="kx-line mono"/);
    assert.ok(text(pre).includes('KALSHI Carlos Alcaraz 88.5¢ · Denis Shapovalov 11.5¢'), text(pre));
    assert.match(pre, new RegExp(`<div class="mc-kx" data-kx-line="${ATP_ID}">`));
    assert.doesNotMatch(String(render.matchCard(match(ATP_ID, 'completed'))), /kx-line|data-kx-line/);
    assert.doesNotMatch(String(render.matchCard(match(ATP_ID, 'scheduled'), { kalshi: false })), /kx-line|data-kx-line/, 'match page uses the full card instead');
    const none = String(render.matchCard(match('22222222-2222-2222-2222-222222222222', 'scheduled')));
    assert.match(none, /<div class="mc-kx" data-kx-line="22222222-2222-2222-2222-222222222222"><\/div>/, 'empty slot only (hidden by CSS :empty), no placeholder');
    const h = String(home.matchCard(match(ATP_ID, 'in_progress')));
    assert.match(h, /<div class="hm-kx" data-kx-line=/);
    assert.match(h, /KALSHI/);
  });
});

describe('placements', () => {
  const live = read('src/pages/live-pages.js');
  const cast = read('src/pages/pbecast.js');
  test('match page: full card in its own block, loaded with the match (bounded), polled while mounted, cleared on unmount', () => {
    assert.match(live, /kalshiCard\(entry, \{ placement: 'match' \}\)/);
    assert.match(live, /<div class="kx-slot" data-kx-card>\$\{kxCardHtml\(kx\)\}<\/div>/);
    assert.match(live, /ready: \(\) => bounded\(kxFirst\)/);
    assert.match(live, /clearTimeout\(kxTimer\)/);
    assert.match(live, /wireKalshi/);
    assert.equal(data.KALSHI_FIRST_PAINT_MS <= 800, true);
  });
  test('PBEcast: strip in its own slot, never awaited, cleared on unmount', () => {
    assert.match(cast, /kalshiStrip\(kx, \{ placement: 'pbecast' \}\)/);
    assert.match(cast, /data-kx-strip/);
    assert.doesNotMatch(cast, /await\s+loadKx/);
    assert.match(cast, /^\s*loadKx\(false\);$/m, 'background read, not awaited by the cast');
    assert.match(cast, /return \(\) => \{ ctl\.abort\(\); clearTimeout\(kxTimer\);/);
  });
  test('/sources has the Kalshi row: prediction market, not sportsbook odds, not a PBE model; links; Mid-market; observed-only movement', () => {
    const src = read('src/pages/sources.js');
    assert.match(src, /<th scope="row">Kalshi<\/th>/);
    assert.match(src, /not sportsbook odds and not a PropBetEdge model/);
    assert.match(src, /Every price links to that market on Kalshi/);
    assert.match(src, /Mid-market<\/b> = the midpoint of the best YES bid and best YES ask/);
    assert.match(src, /only snapshots we actually observed/);
  });
});

describe('browser code never calls Kalshi; vendored files unchanged; CSP', () => {
  const KALSHI_API = /(?:api\.elections\.kalshi\.com|trading-api\.kalshi\.com|external-api\.kalshi\.com|demo-api\.kalshi\.co|api\.kalshi\.com)/i;
  const walk = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, out);
      else if (/\.(m?js|html|css|json)$/.test(ent.name)) out.push(full);
    }
    return out;
  };
  test('no Kalshi API host in src/, public/ or the HTML entry points', () => {
    const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'public')), ...fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, f))];
    assert.ok(files.length > 50);
    assert.deepEqual(files.filter((f) => KALSHI_API.test(fs.readFileSync(f, 'utf8'))), []);
  });

  const VENDORED = {
    'kalshi-market-ui.js': '6f1c1244403f078da96182c7658e0f3da3e3777ccffa80b834257245a2aa2d81',
    'kalshi-market-ui.css': '43cbdcc9313a82618c38bd3998e020943e0db2031b95ed34ef566e91883901fd',
    'kalshi-market-client.js': '653cb0fc2673f909552453052560bfd6194e0e4d045c51b1eb73483957d4c049'
  };
  const norm = (s) => s.replace(/\r\n/g, '\n');
  test('vendored files are byte-identical to the pinned shared release', () => {
    for (const [f, sha] of Object.entries(VENDORED)) assert.equal(crypto.createHash('sha256').update(norm(read(`src/vendor/kalshi/${f}`))).digest('hex'), sha, f);
  });
  test('vendored files match the canonical shared client (when the canonical checkout is present)', (t) => {
    const canon = 'D:/Workers/propbetedge-workers/workers/propsports-markets/client';
    if (!fs.existsSync(canon)) { t.skip('canonical checkout not present on this machine'); return; }
    for (const f of Object.keys(VENDORED)) assert.equal(norm(read(`src/vendor/kalshi/${f}`)), norm(fs.readFileSync(path.join(canon, f), 'utf8')), f);
  });

  test('CSP connect-src allows our markets Worker (and no Kalshi host)', () => {
    const vj = JSON.parse(read('vercel.json'));
    const csp = vj.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
    const connect = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('connect-src'));
    assert.ok(connect.split(/\s+/).includes(MARKETS), connect);
    assert.doesNotMatch(csp, /kalshi/i);
  });
});
