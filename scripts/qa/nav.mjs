#!/usr/bin/env node
// Primary nav acceptance: desktop Today · Live · PBEcast · News · Explore ▾ (Players, Tournaments) · Tennis DNA, no desktop
// More; the Explore menu opens / closes (click, Enter, ArrowDown, Escape, outside click) and its links work; correct
// current item per route (Players / Tournaments routes mark Explore; utility pages mark nothing); header on one row with no
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
const ORDER = ['Today', 'Live', 'PBEcast', 'News', 'Explore', 'Tennis DNA'];
const EXPLORE = ['Players', 'Tournaments'];
const DEEP = ['/matchups', '/players-to-watch', '/schedule', '/rankings', '/methodology', '/sources', '/credits', '/labs'];

const article = (await fetch(`${API}/v1/news?limit=1`).then((r) => r.json()).catch(() => null))?.data?.articles?.[0]?.slug;
const liveId = (await fetch(`${API}/v1/live`).then((r) => r.json()).catch(() => null))?.data?.[0]?.id;
// path -> expected current desktop item (null = none) and drawer item
const ROUTES = [
  // [path, desktop current, drawer current (defaults to the desktop one)]
  ['/', 'Today'], ['/live', 'Live'], ['/pbecast', 'PBEcast'], ['/news', 'News'], ['/players', 'Explore', 'Players'], ['/tournaments', 'Explore', 'Tournaments'], ['/dna', 'Tennis DNA'],
  ['/players/elena-rybakina', 'Explore', 'Players'], ['/players/elena-rybakina/dna', 'Explore', 'Players'], ['/tournaments/singapore/2026', 'Explore', 'Tournaments'],
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
        links: [...nav.querySelectorAll(':scope > a, :scope > .nav-dd > .nav-dd-btn')].map((a) => a.textContent.trim()),
        menu: [...nav.querySelectorAll('.nav-dd-menu a')].map((a) => [a.querySelector('b')?.textContent.trim(), a.getAttribute('href')]),
        menuOpen: nav.querySelector('.nav-dd-menu') ? !nav.querySelector('.nav-dd-menu').hidden : false,
        menuCurrent: [...nav.querySelectorAll('.nav-dd-menu a[aria-current="page"] b')].map((b) => b.textContent.trim()),
        more: [...nav.querySelectorAll('a, button')].some((a) => /^\s*More\s*$/i.test(a.textContent) || a.getAttribute('href') === '/labs'),
        navClipped: nav.scrollWidth > nav.clientWidth + 1,
        current: [...nav.querySelectorAll(':scope > a[aria-current="page"], .nav-dd-btn.is-current')].map((a) => a.textContent.trim()),
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
    if (r.more) f('desktop More (or /labs) is in the primary nav');
    if (JSON.stringify(r.menu) !== JSON.stringify([['Players', '/players'], ['Tournaments', '/tournaments']])) f(`Explore menu ${JSON.stringify(r.menu)}`);
    if (r.menuOpen) f('Explore menu open on page load');
    if (want === 'Explore' && JSON.stringify(r.menuCurrent) !== JSON.stringify([drawerWant])) f(`Explore menu current ${JSON.stringify(r.menuCurrent)} (want ${drawerWant})`);
    if (w >= 1141 && !r.navShown) f('desktop nav hidden');
    if (w < 1141 && r.navShown) f('desktop nav shown below the drawer breakpoint');
    if (r.navShown && r.navClipped) f('nav links clipped');
    if (JSON.stringify(r.current) !== JSON.stringify(want ? [want] : [])) f(`desktop current ${JSON.stringify(r.current)} (want ${want})`);
    const dw = drawerWant || want;
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
    // Explore menu behaviour
    const dd = async () => page.evaluate(() => ({ open: !document.querySelector('.nav-dd-menu').hidden, exp: document.querySelector('[data-dd-btn]').getAttribute('aria-expanded'), focus: document.activeElement.closest('.nav-dd-menu') ? document.activeElement.querySelector('b')?.textContent.trim() : document.activeElement.matches('[data-dd-btn]') ? 'Explore' : document.activeElement.tagName }));
    const e = (m) => fails.push(`${w}px Explore: ${m}`);
    const btn = page.locator('[data-dd-btn]');
    if (!(await btn.count())) { e('no Explore button in the desktop nav'); console.log(`FAIL @${w}`); await ctx.close(); continue; }
    await btn.click(); let st = await dd();
    if (!st.open || st.exp !== 'true') e(`click did not open (${JSON.stringify(st)})`);
    const menuBox = await page.locator('.nav-dd-menu').boundingBox();
    if (!menuBox || menuBox.x < 0 || menuBox.x + menuBox.width > w) e(`menu outside the viewport ${JSON.stringify(menuBox)}`);
    await btn.click(); st = await dd();
    if (st.open || st.exp !== 'false') e('second click did not close');
    await btn.click(); await page.mouse.click(10, 500); st = await dd();
    if (st.open) e('outside click did not close');
    await btn.focus(); await page.keyboard.press('Enter'); st = await dd();
    if (!st.open) e('Enter did not open'); await page.keyboard.press('Enter'); st = await dd();
    if (st.open) e('Enter did not close');
    await btn.focus(); await page.keyboard.press('ArrowDown'); st = await dd();
    if (!st.open || st.focus !== 'Players') e(`ArrowDown: open=${st.open} focus=${st.focus} (want Players)`);
    await page.keyboard.press('ArrowDown'); st = await dd();
    if (st.focus !== 'Tournaments') e(`second ArrowDown focus ${st.focus}`);
    await page.keyboard.press('ArrowUp'); st = await dd();
    if (st.focus !== 'Players') e(`ArrowUp focus ${st.focus}`);
    await page.keyboard.press('Escape'); st = await dd();
    if (st.open || st.focus !== 'Explore') e(`Escape: open=${st.open} focus=${st.focus} (want closed, focus on Explore)`);
    for (const [label, re] of [['Players', /\/players$/], ['Tournaments', /\/tournaments$/]]) {
      await btn.click();
      await page.locator('.nav-dd-menu a', { hasText: label }).click();
      await page.waitForURL(re, { timeout: 10000 }).catch(() => e(`${label} link did not navigate`));
      await page.waitForTimeout(600);
      st = await dd();
      const cur = await page.evaluate(() => ({ btn: document.querySelector('[data-dd-btn]').classList.contains('is-current'), item: document.querySelector('.nav-dd-menu a[aria-current="page"] b')?.textContent.trim() }));
      if (st.open) e(`menu still open after following ${label}`);
      if (!cur.btn || cur.item !== label) e(`after ${label}: Explore current=${cur.btn}, menu current=${cur.item}`);
    }
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
