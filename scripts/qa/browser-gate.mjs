#!/usr/bin/env node
// Browser gate (ATP/WTA parity) at every supported width. Read-only against a deployed site.
//   node scripts/qa/browser-gate.mjs                    default routes + Alcaraz, Sinner, Swiatek, Sabalenka
//   node scripts/qa/browser-gate.mjs /path1 /path2      extra routes
//   QA_BASE=https://... API_BASE=https://... WIDTHS=390,1440 SHOTS=1 (screenshots to qa-artifacts/gate-*)
// Checks per route x width: no horizontal overflow; no broken images; no console errors; player pages carry
// identity (name + avatar/photo or initials card); no empty DNA shell (a DNA block with no content or a stuck
// loader); no duplicate live match on /live; no WTA-only label on ATP content (men's player pages, /news/atp).
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.QA_BASE || 'https://tennis.propbetedge.ai';
const WIDTHS = (process.env.WIDTHS || '320,360,390,430,768,1024,1440').split(',').map(Number);
const MEN = ['carlos-alcaraz', 'jannik-sinner'];
const WOMEN = ['iga-swiatek', 'aryna-sabalenka', 'elena-rybakina'];
const FULL_DNA = ['PBE Rating', 'Form windows', 'Opponent archetypes', 'Tournament level & round', 'Result strength', 'Pressure', 'Opponent quality', 'By surface', 'Technical DNA'];
const ROUTES = ['/', '/live', '/pbecast', '/news', '/news/atp', '/news/wta', '/news/grand-slams', '/players', '/tournaments', '/schedule', '/dna', '/rankings', '/rankings/men',
  ...[...MEN, ...WOMEN].flatMap((s) => [`/players/${s}`, `/players/${s}/dna`]), ...process.argv.slice(2)];
const isMenRoute = (p) => MEN.some((s) => p.startsWith(`/players/${s}`)) || p === '/news/atp' || p === '/rankings/men';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const fails = [];
const rows = [];
for (const w of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
  let errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  for (const path of ROUTES) {
    errs = [];
    await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch((e) => errs.push(`nav: ${e.message}`));
    await page.waitForFunction(() => !document.querySelector('#main .loading'), null, { timeout: 20000 }).catch(() => {});
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 800) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); });
    await page.waitForTimeout(400);
    const r = await page.evaluate((men) => {
      const main = document.querySelector('#main');
      const text = main?.innerText || '';
      const broken = [...document.images].filter((i) => i.complete && i.currentSrc && i.naturalWidth === 0).map((i) => i.currentSrc);
      const dnaShells = [...document.querySelectorAll('[class*="dna"]')].filter((el) => el.offsetParent !== null && !el.innerText.trim() && !el.querySelector('img,svg,canvas'));
      const stuck = [...document.querySelectorAll('#main .loading')].length;
      const liveIds = [...document.querySelectorAll('.mc.is-live a[href^="/matches/"]')].map((a) => a.getAttribute('href'));
      const h1 = document.querySelector('h1')?.textContent?.trim() || '';
      const identity = !!document.querySelector('#main img[alt], #main .av, #main [class*="avatar"], #main [class*="initials"]');
      // WTA-only labels on ATP content: a men's page naming a WTA list/number for the player
      // (navigation links to the WTA lists — e.g. the rankings list switcher — are not labels on this content)
      const content = (() => { const c = (document.querySelector('#main') || document.body).cloneNode(true); c.querySelectorAll('nav, a[href^="/rankings/women"]').forEach((x) => x.remove()); return c.innerText || c.textContent || ''; })();
      const wtaOnAtp = men ? (content.match(/WTA (No\.|singles|doubles)[^\n]{0,40}/g) || []) : [];
      const h2s = [...document.querySelectorAll('#main h2')].map((h) => h.textContent.trim());
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, broken, dnaEmpty: dnaShells.length, stuck, dupLive: liveIds.length - new Set(liveIds).size, h1, identity, wtaOnAtp, len: text.length, h2s, matchDnaLive: /MATCH DNA — LIVE/.test(text) };
    }, isMenRoute(path));
    const bad = [];
    if (r.sw > r.iw) bad.push(`overflow ${r.sw}>${r.iw}`);
    if (r.broken.length) bad.push(`broken images: ${r.broken.slice(0, 3).join(' ')}`);
    if (errs.length) bad.push(`console: ${errs.slice(0, 3).join(' | ')}`);
    if (/^\/players\/[a-z-]+/.test(path) && (!r.h1 || !r.identity)) bad.push('missing player identity');
    if (r.dnaEmpty || (r.stuck && /dna/.test(path))) bad.push(`empty DNA shell (${r.dnaEmpty} empty, ${r.stuck} loaders)`);
    if (r.dupLive) bad.push(`${r.dupLive} duplicate live match(es)`);
    // a full player DNA page must render the whole Match DNA architecture — never pass on page health alone
    // (2026-09-29: a thin ATP presentation passed 147/147 because only empty-shell checks existed)
    if (/^\/players\/[^/]+\/dna$/.test(path)) {
      const missing = ['MATCH DNA — LIVE', ...FULL_DNA].filter((h) => (h === 'MATCH DNA — LIVE' ? !r.matchDnaLive : !r.h2s.some((x) => x.startsWith(h))));
      if (missing.length) bad.push(`full DNA modules missing: ${missing.join(', ')}`);
    }
    if (r.wtaOnAtp.length) bad.push(`WTA label on ATP content: ${r.wtaOnAtp.slice(0, 2).join(' | ')}`);
    if (process.env.SHOTS) await page.screenshot({ path: `qa-artifacts/gate-${w}-${path.replace(/[^a-z0-9]+/gi, '_').slice(0, 50)}.png` });
    rows.push({ width: w, path, ok: bad.length ? 'FAIL' : 'ok', chars: r.len });
    for (const b of bad) fails.push(`${w}px ${path}: ${b}`);
  }
  await page.close();
}
await browser.close();
console.table(rows.filter((r) => r.ok !== 'ok').length ? rows.filter((r) => r.ok !== 'ok') : [{ routes: ROUTES.length, widths: WIDTHS.join(','), checks: rows.length }]);
console.log(fails.length ? `BROWSER GATE: FAIL (${fails.length})\n${fails.join('\n')}` : `BROWSER GATE: PASS (${rows.length} route x width checks)`);
if (fails.length) process.exitCode = 1;
