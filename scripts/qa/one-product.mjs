#!/usr/bin/env node
// One-Tennis-product acceptance against a deployed site (default production).
//   node scripts/qa/one-product.mjs
// Proves a visitor meets men's AND women's tennis, doubles and mixed on the everyday surfaces without
// visiting /men; Men/Women are not primary navigation; News is. Reads rendered text only.
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.QA_BASE || 'https://tennis.propbetedge.ai';
// what counts as present, from rendered text (event labels on cards, player names, row context)
const SIGNS = {
  men: /Men’s singles|Men's singles|men’s singles|Alcaraz|Sinner|Zverev|Djokovic/,
  women: /Women’s singles|Women's singles|women’s singles|WTA No\.|Sabalenka|Swiatek|Rybakina|Gauff/,
  doubles: /doubles/i,
  mixed: /Mixed doubles|mixed/i,
  peers: /John Peers/ // a mixed-doubles champion (AO 2026) found by search with no gender selection
};
const ROUTES = [
  ['/', ['men', 'women', 'doubles', 'mixed']],
  ['/live', []],
  ['/pbecast', ['men', 'doubles', 'mixed']],
  ['/players', ['men', 'women']],
  ['/tournaments', ['men', 'women', 'doubles', 'mixed']],
  ['/schedule', ['women', 'doubles']],
  ['/search?q=sinner', ['men']],
  ['/search?q=sabalenka', ['women']],
  ['/search?q=peers', ['peers']],
  ['/news', []]
];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const fails = [];
const report = [];
for (const [path, need] of ROUTES) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 20000 }).catch(() => {});
  const r = await page.evaluate(() => ({ text: document.querySelector('#main')?.innerText || '', nav: [...document.querySelectorAll('.nav [data-nav]')].map((a) => a.textContent.trim()), sw: document.documentElement.scrollWidth, iw: innerWidth }));
  const found = Object.fromEntries(Object.entries(SIGNS).map(([k, re]) => [k, re.test(r.text)]));
  for (const k of need) if (!found[k]) fails.push(`${path}: no ${k} content`);
  if (r.nav.some((l) => /^(Men|Women)$/.test(l))) fails.push(`${path}: gender item in primary nav (${r.nav.join(', ')})`);
  if (!r.nav.includes('News')) fails.push(`${path}: News missing from primary nav`);
  if (r.sw > r.iw) fails.push(`${path}: horizontal overflow`);
  report.push({ path, ...found, nav: r.nav.join(' · ') });
}
// news: at least one public, gated story renders
await page.goto(`${BASE}/news`, { waitUntil: 'networkidle' });
const story = await page.evaluate(() => document.querySelector('.nw-card a')?.getAttribute('href'));
if (!story) fails.push('/news: no public story');
else {
  await page.goto(BASE + story, { waitUntil: 'networkidle' });
  const ok = await page.evaluate(() => ({ h1: document.querySelector('h1')?.textContent?.trim(), robots: document.querySelector('meta[name="robots"]')?.content }));
  report.push({ path: story, h1: ok.h1, robots: ok.robots });
  if (!ok.h1 || /noindex/.test(ok.robots || '')) fails.push(`${story}: story not public/indexable`);
}
// no invented ATP rankings
await page.goto(`${BASE}/rankings/men`, { waitUntil: 'networkidle' });
const atpRows = await page.evaluate(() => document.querySelectorAll('table.tbl tbody tr').length);
if (atpRows) fails.push(`/rankings/men: ${atpRows} ATP ranking rows rendered`);
for (const e of errors) fails.push(`console: ${e}`);
await browser.close();
console.table(report);
console.log(fails.length ? `FAIL\n${fails.join('\n')}` : 'ONE TENNIS PRODUCT QA: PASS');
if (fails.length) process.exitCode = 1;
