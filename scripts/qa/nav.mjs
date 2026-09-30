#!/usr/bin/env node
// Primary nav acceptance: seven direct desktop links (Today · Live · PBEcast · News · Players · Tournaments · Tennis DNA),
// no Explore / More; correct aria-current per route (utility pages mark no desktop item); header on one row with no
// overlap between brand, nav, live pill, search and menu; no page overflow; keyboard order; drawer + footer keep every
// deeper destination.
//   npm run build && node scripts/qa/nav.mjs            -> local preview of dist/
//   QA_BASE=https://tennis.propbetedge.ai node scripts/qa/nav.mjs
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const API = 'https://tennis-api.propbetedge.ai';
const server = process.env.QA_BASE ? null : await preview({ preview: { port: 5199, strictPort: true } });
const WEB = (process.env.QA_BASE || server.resolvedUrls.local[0]).replace(/\/+$/, '');
const WIDTHS = [1440, 1280, 1141, 1024, 768, 430, 390, 360, 320];
const ORDER = ['Today', 'Live', 'PBEcast', 'News', 'Players', 'Tournaments', 'Tennis DNA'];
const DEEP = ['/matchups', '/players-to-watch', '/schedule', '/rankings', '/methodology', '/sources', '/credits', '/labs'];

const article = (await fetch(`${API}/v1/news?limit=1`).then((r) => r.json()).catch(() => null))?.data?.articles?.[0]?.slug;
const liveId = (await fetch(`${API}/v1/live`).then((r) => r.json()).catch(() => null))?.data?.[0]?.id;
// path -> expected current desktop item (null = none) and drawer item
const ROUTES = [
  ['/', 'Today'], ['/live', 'Live'], ['/pbecast', 'PBEcast'], ['/news', 'News'], ['/players', 'Players'], ['/tournaments', 'Tournaments'], ['/dna', 'Tennis DNA'],
  ['/players/elena-rybakina', 'Players'], ['/players/elena-rybakina/dna', 'Players'], ['/tournaments/singapore/2026', 'Tournaments'],
  ...(article ? [[`/news/${article}`, 'News']] : []), ...(liveId ? [[`/pbecast/${liveId}`, 'PBEcast']] : []),
  ['/schedule', null, 'Schedule'], ['/rankings/women', null, 'Rankings'], ['/matchups', null, 'Matchups'], ['/methodology', null, 'Methodology'], ['/labs', null, 'Labs']
];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const fails = [];
let checks = 0;
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  for (const [path, want, drawerWant] of ROUTES) {
    if (w < 1141 && ![...ROUTES.slice(0, 7).map((r) => r[0]), '/schedule'].includes(path)) continue; // phones: primaries + one utility page
    errors.length = 0;
    await page.goto(WEB + path, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(1600); // live pill hydration
    const r = await page.evaluate(() => {
      const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' && !e.hidden;
      const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
      const hdr = document.querySelector('.hdr-in');
      const parts = ['.brand', '.nav', '.hdr-live', '.hdr-search', '.menu-btn'].map((s) => [s, document.querySelector(s)]).filter(([, e]) => vis(e));
      const boxes = parts.map(([s, e]) => [s, box(e)]);
      const overlaps = [];
      for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) if (boxes[i][1].r > boxes[j][1].l + 0.5) overlaps.push(`${boxes[i][0]}|${boxes[j][0]}`);
      const nav = document.querySelector('.nav');
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        hdrH: Math.round(hdr.getBoundingClientRect().height),
        outside: boxes.filter(([, b]) => b.r > document.documentElement.clientWidth + 0.5 || b.t < 0 || b.b > 64.5).map(([s]) => s),
        overlaps, navShown: vis(nav), live: vis(document.querySelector('.hdr-live')),
        links: [...nav.querySelectorAll('a')].map((a) => a.textContent.trim()),
        navClipped: nav.scrollWidth > nav.clientWidth + 1,
        extra: !!nav.querySelector('button, [data-dd], a[href="/labs"]'),
        current: [...nav.querySelectorAll('[aria-current="page"]')].map((a) => a.textContent.trim()),
        drawerCurrent: [...document.querySelectorAll('.drawer [aria-current="page"]')].map((a) => a.textContent.trim()),
        drawer: [...document.querySelectorAll('.drawer a')].map((a) => a.getAttribute('href')),
        footer: [...document.querySelectorAll('.ftr a')].map((a) => a.getAttribute('href'))
      };
    });
    checks += 1;
    const f = (m) => fails.push(`${w}px ${path}: ${m}`);
    if (r.overflow > 0) f(`page overflow ${r.overflow}px`);
    if (r.hdrH !== 64) f(`header height ${r.hdrH} (wrapped?)`);
    if (r.outside.length) f(`outside the header row: ${r.outside.join(',')}`);
    if (r.overlaps.length) f(`overlap ${r.overlaps.join(', ')}`);
    if (JSON.stringify(r.links) !== JSON.stringify(ORDER)) f(`nav links ${r.links.join(' · ')}`);
    if (r.extra) f('Explore / More / dropdown still in the primary nav');
    if (w >= 1141 && !r.navShown) f('desktop nav hidden');
    if (w < 1141 && r.navShown) f('desktop nav shown below the drawer breakpoint');
    if (r.navShown && r.navClipped) f('nav links clipped');
    if (JSON.stringify(r.current) !== JSON.stringify(want ? [want] : [])) f(`desktop current ${JSON.stringify(r.current)} (want ${want})`);
    const dw = want || drawerWant;
    if (JSON.stringify(r.drawerCurrent) !== JSON.stringify(dw ? [dw] : [])) f(`drawer current ${JSON.stringify(r.drawerCurrent)} (want ${dw})`);
    for (const d of DEEP) { if (!r.drawer.includes(d)) f(`drawer missing ${d}`); if (!r.footer.includes(d)) f(`footer missing ${d}`); }
    if (errors.length) f(`console: ${errors[0]}`);
  }
  // keyboard
  await page.goto(WEB + '/dna', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  if (w >= 1141) {
    const seq = [];
    for (let i = 0; i < 14; i += 1) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(() => { const a = document.activeElement; return a.closest('.nav') ? a.textContent.trim() : a.className || a.tagName; })); }
    const navSeq = seq.filter((x) => ORDER.includes(x));
    if (JSON.stringify(navSeq.slice(0, 7)) !== JSON.stringify(ORDER)) fails.push(`${w}px keyboard: nav tab order ${navSeq.join(' > ')}`);
    const ring = await page.evaluate(() => { const a = [...document.querySelectorAll('.nav a')].at(-1); a.focus(); return getComputedStyle(a).outlineStyle; });
    if (ring === 'none') fails.push(`${w}px keyboard: no visible focus ring on nav links`);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/dna$/, { timeout: 8000 }).catch(() => fails.push(`${w}px keyboard: Enter on Tennis DNA did not navigate`));
  } else {
    await page.locator('[data-menu]').focus();
    await page.keyboard.press('Enter');
    const open = await page.evaluate(() => !document.querySelector('[data-drawer]').hidden);
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement.closest('.drawer') ? document.activeElement.textContent.trim() : null);
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => document.querySelector('[data-drawer]').hidden);
    if (!open || !closed) fails.push(`${w}px keyboard: drawer open=${open} closed-on-Escape=${closed}`);
    if (first !== 'Today') fails.push(`${w}px keyboard: first drawer stop ${first}`);
  }
  console.log(`${fails.some((x) => x.startsWith(`${w}px`)) ? 'FAIL' : 'PASS'} @${w}`);
  await ctx.close();
}
await browser.close();
if (server) await new Promise((r) => server.httpServer.close(r));
for (const f of fails) console.error(`  ✖ ${f}`);
console.log(`NAV: ${fails.length ? 'FAIL' : 'PASS'} (${checks} route × width checks over ${WIDTHS.length} widths; routes: ${ROUTES.map((r) => r[0]).join(' ')})`);
process.exitCode = fails.length ? 1 : 0;
