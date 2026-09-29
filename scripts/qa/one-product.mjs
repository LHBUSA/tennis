#!/usr/bin/env node
// One-Tennis-product acceptance against a deployed site (default production). Never visits /men.
//   node scripts/qa/one-product.mjs            (QA_BASE=https://... to point elsewhere; API_BASE for the API)
// Proves a visitor meets ATP and WTA (men's AND women's) tennis on the everyday surfaces — /, /players,
// /tournaments, /news, /dna — plus doubles, without a gender silo. Men/Women are not primary nav.
// A requirement is enforced only where the API shows legitimate data exists for it (e.g. men on /news only
// when a recent ATP story is published; a men's live card only when /v1/live holds a live MS/MD match).
// Nothing is fabricated to pass: a quiet schedule is reported as "not required", never as a pass by invention.
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.QA_BASE || 'https://tennis.propbetedge.ai';
const API = process.env.API_BASE || 'https://tennis-api.propbetedge.ai';
const SIGNS = {
  men: /Men’s singles|Men's singles|Men’s doubles|ATP No\.|ATP Tour|ATP singles|\bATP\b|Alcaraz|Sinner|Zverev|Djokovic|Fritz|Draper/,
  women: /Women’s singles|Women's singles|Women’s doubles|WTA No\.|WTA \d|WTA singles|Sabalenka|Swiatek|Świątek|Rybakina|Gauff/,
  doubles: /doubles/i,
  mixed: /Mixed doubles|mixed/i
};
const j = async (p) => { try { const r = await fetch(API + p); return r.ok ? (await r.json()).data : null; } catch { return null; } };

// ---- what legitimately exists right now (API truth) ----------------------------------------------------------
const [live, news, tours, atpRank, wtaRank] = await Promise.all([j('/v1/live'), j('/v1/news?limit=40'), j('/v1/tournaments'), j('/v1/rankings?tour=atp&type=singles&limit=5'), j('/v1/rankings?tour=wta&type=singles&limit=5')]);
const recent = (a) => Date.now() - Date.parse(a.published_at || 0) < 7 * 86400e3;
const has = {
  liveMen: (live || []).some((m) => /^M/.test(m.event_type)),
  liveWomen: (live || []).some((m) => /^W/.test(m.event_type)),
  newsAtp: (news?.articles || []).some((a) => a.desk === 'atp' && recent(a)),
  newsWta: (news?.articles || []).some((a) => a.desk === 'wta' && recent(a)),
  toursAtp: (tours || []).some((t) => t.tour === 'atp'),
  toursWta: (tours || []).some((t) => /^wta/.test(t.tour || '') || /^WTA/.test(t.level || '')),
  atpList: !!atpRank?.rows?.length,
  wtaList: !!wtaRank?.rows?.length
};
console.log('API truth:', has);

const ROUTES = [
  ['/', ['men', 'women']],
  ['/players', [has.atpList && 'men', has.wtaList && 'women']],
  ['/tournaments', [has.toursAtp && 'men', has.toursWta && 'women', 'doubles']],
  ['/news', [has.newsAtp && 'men', has.newsWta && 'women']],
  ['/news/atp', [has.newsAtp && 'men']],
  ['/news/wta', [has.newsWta && 'women']],
  ['/dna', ['men', 'women']],
  ['/schedule', ['women', 'doubles', has.toursAtp && 'men']],
  ['/live', [has.liveMen && 'men', has.liveWomen && 'women']],
  ['/pbecast', [has.liveMen && 'men']],
  ['/search?q=sinner', ['men']],
  ['/search?q=sabalenka', ['women']]
].map(([p, need]) => [p, need.filter(Boolean)]);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()}: ${m.text()}`); });
const fails = [];
const report = [];
for (const [path, need] of ROUTES) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 20000 }).catch(() => {});
  if (/^\/men(\/|$)/.test(new URL(page.url()).pathname)) fails.push(`${path}: redirected into /men`);
  const r = await page.evaluate(() => ({ text: document.querySelector('#main')?.innerText || '', nav: [...document.querySelectorAll('.nav [data-nav]')].map((a) => a.textContent.trim()), sw: document.documentElement.scrollWidth, iw: innerWidth }));
  const found = Object.fromEntries(Object.entries(SIGNS).map(([k, re]) => [k, re.test(r.text)]));
  for (const k of need) if (!found[k]) fails.push(`${path}: no ${k} content`);
  if (r.nav.some((l) => /^(Men|Women)$/.test(l))) fails.push(`${path}: gender item in primary nav (${r.nav.join(', ')})`);
  if (!r.nav.includes('News')) fails.push(`${path}: News missing from primary nav`);
  if (r.sw > r.iw) fails.push(`${path}: horizontal overflow`);
  report.push({ path, required: need.join(',') || '—', ...found });
}
// PBEcast: with a men's match live, its court must render (reachable from the switcher; no men's tab needed)
if (has.liveMen) {
  const id = live.find((m) => /^M/.test(m.event_type)).id;
  await page.goto(`${BASE}/pbecast/${id}`, { waitUntil: 'networkidle' });
  const ok = await page.evaluate(() => !!document.querySelector('#main')?.innerText.trim());
  if (!ok) fails.push(`/pbecast/${id}: men's live court did not render`);
  report.push({ path: `/pbecast/${id}`, required: 'men live court', men: ok });
} else report.push({ path: '/pbecast (men live)', required: 'not required: no MS/MD match live in /v1/live right now' });
// ATP singles list: rendered and labelled secondary (never "official ATP")
await page.goto(`${BASE}/rankings/men`, { waitUntil: 'networkidle' });
const atp = await page.evaluate(() => ({ rows: document.querySelectorAll('table.tbl tbody tr').length, text: document.querySelector('#main')?.innerText || '' }));
if (has.atpList && !atp.rows) fails.push('/rankings/men: ATP list exists in the API but no rows rendered');
if (atp.rows && !/secondary source/i.test(atp.text)) fails.push('/rankings/men: ATP rows without the secondary-source label');
// a public story renders and is indexable
const story = (news?.articles || [])[0];
if (story) {
  await page.goto(`${BASE}/news/${story.slug}`, { waitUntil: 'networkidle' });
  const ok = await page.evaluate(() => ({ h1: document.querySelector('h1')?.textContent?.trim(), robots: document.querySelector('meta[name="robots"]')?.content }));
  if (!ok.h1 || /noindex/.test(ok.robots || '')) fails.push(`/news/${story.slug}: story not public/indexable`);
}
for (const e of errors) fails.push(`console: ${e}`);
await browser.close();
console.table(report);
console.log(fails.length ? `FAIL\n${fails.join('\n')}` : 'ONE TENNIS PRODUCT QA: PASS');
if (fails.length) process.exitCode = 1;
