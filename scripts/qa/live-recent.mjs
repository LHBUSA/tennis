// Production gate for the homepage LIVE & RECENT strip (src/ui/live-recent.js, src/styles/live-recent.css). One-shot.
//   BASE=https://tennis.propbetedge.ai OUT=qa-artifacts/live-recent/after node scripts/qa/live-recent.mjs
// Per width (390 / 430 / 768 / 1024 / 1440 / 1920): no page overflow; CLS < 0.1 (TICKER=0 isolates the known ticker
// insertion); cards fully visible before scrolling (4 at >= 1280, 3 at 1024, 2 at 768, 1 + a peek on phones); arrows
// only when the strip overflows and never on phones, sitting in the header row; no clipped tour / tournament / round
// metadata; no blank band under the cards; both tours among the finals and a doubles final; a live card (when one exists)
// first and marked; every card has player rows, and every participant /v1/today serves with an approved photo renders
// .av.is-photo in that card (the text-only regression of 2026-10-03).
// Writes a section screenshot per width to OUT.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'https://tennis.propbetedge.ai').replace(/\/+$/, '');
const WIDTHS = (process.env.WIDTHS || '390,430,768,1024,1440,1920').split(',').map(Number);
const OUT = process.env.OUT || 'qa-artifacts/live-recent';
const STRICT = process.env.STRICT !== '0'; // STRICT=0 records the numbers only (the "before" capture)
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const fails = [];
const say = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };
const wantCards = (w) => (w >= 1280 ? 4 : w >= 900 ? 3 : w >= 760 ? 2 : 1);

for (const w of WIDTHS) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 } });
  await ctx.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  if (process.env.TICKER === '0') await p.route(/tennis-api\.propbetedge\.ai\/v1\/live(\?|$)/, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ ok: true, data: [], meta: { freshness: 'CURRENT' } }) }));
  // a local preview (BASE=http://localhost:…) is not an allowed API origin: relay the production API through the test
  // browser and answer with this origin's CORS headers (read-only GETs; nothing is written)
  if (/localhost|127\.0\.0\.1/.test(BASE)) {
    await p.route(/tennis-api\.propbetedge\.ai\//, async (r) => {
      if (process.env.TICKER === '0' && /\/v1\/live(\?|$)/.test(r.request().url())) return r.fallback();
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*' } });
      const res = await r.fetch({ headers: { ...r.request().headers(), origin: 'https://tennis.propbetedge.ai' } }).catch(() => null);
      if (!res) return r.abort();
      return r.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' } });
    });
  }
  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.lr-card', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(3000);
  const s = await p.evaluate(() => {
    const sec = document.querySelector('[data-lr]')?.closest('section') || document.querySelector('[data-lr] section') || document.querySelector('[data-lr]');
    const track = sec?.querySelector('.hm-track');
    const cards = [...(sec?.querySelectorAll('.lr-card') || [])];
    const tr = track?.getBoundingClientRect();
    const full = tr ? cards.filter((c) => { const r = c.getBoundingClientRect(); return r.left >= tr.left - 2 && r.right <= tr.right + 2; }).length : 0;
    const nav = sec?.querySelector('.hm-nav');
    const navOn = !!nav && !nav.hidden && getComputedStyle(nav).display !== 'none';
    const head = sec?.querySelector('h2')?.getBoundingClientRect();
    const nr = navOn ? nav.getBoundingClientRect() : null;
    const metas = [...(sec?.querySelectorAll('.lr-meta > *, .lr-card .hm-mh1 > *') || [])];
    const clipped = metas.filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent.trim()).slice(0, 4);
    const sr = sec?.getBoundingClientRect();
    const last = [...(sec?.querySelectorAll('h2, .hm-track') || [])].reduce((m, x) => Math.max(m, x.getBoundingClientRect().bottom), 0);
    const finals = cards.filter((c) => c.dataset.lr === 'final');
    const tours = new Set(finals.map((c) => c.dataset.tour || (/\bATP\b/.test(c.innerText) ? 'atp' : /\bWTA\b/.test(c.innerText) ? 'wta' : '?')));
    const hs = cards.map((c) => Math.round(c.getBoundingClientRect().height));
    return {
      secH: Math.round(sr?.height || 0), tail: Math.round((sr?.bottom || 0) - last), cards: cards.length, full, cardW: Math.round(cards[0]?.getBoundingClientRect().width || 0),
      peek: tr && cards[full] ? Math.round(tr.right - cards[full].getBoundingClientRect().left) : 0,
      over: track ? track.scrollWidth - track.clientWidth > 4 : false, navOn, navDy: nr && head ? Math.round(nr.top - head.top) : null, navGap: nr && tr ? Math.round(nr.top - tr.top) : null,
      clipped, tours: [...tours], liveFirst: cards[0]?.dataset.lr === 'live', live: cards.filter((c) => c.dataset.lr === 'live').length, hMin: Math.min(...hs), hMax: Math.max(...hs),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, cls: Number((window.__cls || 0).toFixed(4)),
      dbl: cards.filter((c) => c.querySelector('.sg.is-dbl')).length, textOnly: cards.filter((c) => !c.querySelector('.sg-row .av')).length,
      ids: cards.map((c) => c.dataset.id), photos: Object.fromEntries(cards.map((c) => [c.dataset.id, [...c.querySelectorAll('img.av.is-photo')].map((i) => i.getAttribute('src'))]))
    };
  });
  // photo regression: every participant in /v1/today with an approved photo must render .av.is-photo in its card
  const today = await p.evaluate(async () => { const r = await fetch('https://tennis-api.propbetedge.ai/v1/today', { credentials: 'omit' }).catch(() => null); return r && r.ok ? r.json() : null; });
  const rows = [...(today?.data?.live || today?.live || []), ...(today?.data?.latest_results || today?.latest_results || [])];
  let want = 0; const missing = [];
  for (const id of s.ids) {
    const m = rows.find((x) => x.id === id);
    for (const side of ['A', 'B']) for (const pl of m?.sides?.[side]?.players || []) {
      if (!pl.photo) continue;
      want += 1;
      if (!(s.photos[id] || []).some((src) => src.includes(`/players/${pl.id}/`))) missing.push(pl.name);
    }
  }
  const bad = [];
  if (s.overflow > 0) bad.push(`page overflow ${s.overflow}`);
  if (s.cls > 0.1) bad.push(`CLS ${s.cls}`);
  if (!s.cards) bad.push('no cards');
  if (STRICT) {
    const want = Math.min(wantCards(w), s.cards);
    if (s.full < want) bad.push(`${s.full} full cards visible, want ${want}`);
    if (w < 760 && s.cards > 1 && s.peek < 24) bad.push(`no peek of the next card (${s.peek}px)`);
    if (w < 760 && s.navOn) bad.push('arrows on a phone');
    if (s.navOn && !s.over) bad.push('arrows without overflow');
    if (s.navOn && s.navGap > 0) bad.push(`arrows not in the header row (${s.navGap}px into the strip)`);
    if (s.clipped.length) bad.push(`clipped metadata: ${s.clipped.join(' | ')}`);
    if (s.tail > 40) bad.push(`blank band under the cards ${s.tail}px`);
    if (!s.tours.includes('atp') || !s.tours.includes('wta')) bad.push(`finals tours ${s.tours}`);
    if (s.live && !s.liveFirst) bad.push('live card not first');
  }
  if (s.textOnly) bad.push(`${s.textOnly} card(s) without player rows`);
  if (!today) bad.push('could not read /v1/today for the photo check');
  if (missing.length) bad.push(`approved photo not rendered: ${missing.slice(0, 4).join(', ')}`);
  if (STRICT && !s.dbl) bad.push('no doubles final in the strip');
  if (errs.length) bad.push(`console: ${errs[0].slice(0, 120)}`);
  say(!bad.length, `${w} section=${s.secH}px tail=${s.tail} cards=${s.cards} full=${s.full} w=${s.cardW} peek=${s.peek} h=${s.hMin}-${s.hMax} arrows=${s.navOn}${s.navOn ? `@${s.navDy}` : ''} tours=${s.tours} dbl=${s.dbl} photos=${want - missing.length}/${want} live=${s.live}${s.liveFirst ? '(first)' : ''} cls=${s.cls} ${bad.join('; ')}`);
  const sec = await p.$('[data-lr]');
  if (sec) { await sec.scrollIntoViewIfNeeded(); await p.waitForTimeout(400); await sec.screenshot({ path: `${OUT}/lr-${w}.png` }); }
  // LIVE & RECENT above UP NEXT in one frame (the richness comparison)
  const box = await p.evaluate(() => { const a = document.querySelector('[data-lr]')?.getBoundingClientRect(); const n = document.querySelector('[data-next]')?.getBoundingClientRect(); return a && n ? { y: a.top + scrollY, h: n.bottom - a.top } : null; });
  if (box) await p.screenshot({ path: `${OUT}/lr-vs-next-${w}.png`, fullPage: true, clip: { x: 0, y: box.y, width: w, height: Math.min(box.h, 1600) } });
  await ctx.close();
}
await b.close();
console.log(`${fails.length} fail(s)`);
process.exitCode = fails.length ? 1 : 0;
