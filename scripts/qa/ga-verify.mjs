#!/usr/bin/env node
// Live GA4 verification on the production domain: loads the site in headless Chrome, performs SPA
// navigations, and records every GA4 /g/collect request (measurement id, event name, page path,
// hostname). Fails on: wrong id, missing/duplicate page_view, any collect request carrying a query
// string or token-like parameter, console errors.
//   node scripts/qa/ga-verify.mjs [https://tennis.propbetedge.ai]

import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'https://tennis.propbetedge.ai';
const EXPECT_ID = 'G-BRS48R8PG9';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const hits = [];
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  const u = r.url();
  if (!/google-analytics\.com\/(g|j)\/collect/.test(u)) return;
  const url = new URL(u);
  const body = r.postData() || '';
  const lines = body ? body.split('\n') : [''];
  for (const line of lines) {
    const p = new URLSearchParams(line);
    hits.push({ tid: url.searchParams.get('tid'), en: p.get('en') || url.searchParams.get('en'), dl: p.get('dl') || url.searchParams.get('dl'), dp: p.get('ep.page_path') || url.searchParams.get('ep.page_path'), raw: `${url.search}&${line}` });
  }
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
async function nav(href) {
  await page.evaluate((h) => { const a = document.createElement('a'); a.href = h; document.body.appendChild(a); a.click(); a.remove(); }, href);
  await wait(3500);
}
try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await wait(4000);
  const scripts = await page.evaluate(() => document.querySelectorAll('script[data-pbe-ga4]').length);
  if (scripts !== 1) failures.push(`expected exactly one GA loader script, found ${scripts}`);
  const liveMatch = await page.evaluate(async () => {
    const r = await fetch('https://tennis-api.propbetedge.ai/v1/today').then((x) => x.json());
    const m = [...(r.data?.live || []), ...(r.data?.latest_results || [])][0];
    return m ? m.id : null;
  });
  await nav('/players/elena-rybakina');
  await nav('/schedule');
  if (liveMatch) { await nav(`/matches/${liveMatch}`); await nav(`/pbecast/${liveMatch}`); }
  await nav('/live');
  await wait(3000);
} finally {
  await browser.close();
}
const pv = hits.filter((h) => h.en === 'page_view');
const ids = new Set(hits.map((h) => h.tid));
if (!hits.length) failures.push('no GA4 collect requests observed');
if ([...ids].some((i) => i !== EXPECT_ID)) failures.push(`unexpected measurement ids: ${[...ids].join(',')}`);
const paths = pv.map((h) => new URL(h.dl).pathname);
const dup = paths.filter((p, i) => paths.indexOf(p) !== i);
if (dup.length) failures.push(`duplicate page_view for ${dup.join(', ')}`);
for (const p of ['/', '/players/elena-rybakina', '/schedule', '/live']) if (!paths.includes(p)) failures.push(`missing page_view for ${p}`);
for (const h of hits) if (/token|secret|apikey|key=|email/i.test(decodeURIComponent(h.raw))) failures.push(`sensitive-looking parameter in a collect request: ${h.en}`);
for (const h of hits) if (h.dl && new URL(h.dl).search) failures.push(`page_location carries a query string: ${h.dl}`);
const events = [...new Set(hits.map((h) => h.en))];
console.log(JSON.stringify({ base: BASE, measurement_ids: [...ids], collect_requests: hits.length, page_views: paths, events, hosts: [...new Set(hits.map((h) => h.dl && new URL(h.dl).host))], console_errors: errors }, null, 2));
if (errors.length) failures.push(`${errors.length} console error(s)`);
if (failures.length) { console.error(`ga-verify: FAIL\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('ga-verify: PASS');
