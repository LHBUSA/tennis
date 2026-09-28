#!/usr/bin/env node
// Phase 6 visual QA (desktop 1440 / tablet 1024 / mobile 390, plus 320 overflow-only).
//   QA_BASE=<site> [QA_SHARE=<vercel share query>] [API_OVERRIDE=<tennis-api version preview>] QA_TAG=pre|post node scripts/qa/phase6-screens.mjs
// API_OVERRIDE (pre-deploy only): the browser's tennis-api requests are answered by the uploaded, not-yet-deployed
// tennis-api version (test-side routing; the site itself is unchanged). Every page must render from real data or
// its truthful empty / withheld state: fails on overflow, console errors, "undefined"/"NaN"/"[object" text, broken images.
// Output: qa-artifacts/phase6-<tag>/ screenshots + report.json.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = (process.env.QA_BASE || 'https://tennis.propbetedge.ai').replace(/\/+$/, '');
const SHARE = process.env.QA_SHARE || '';
const OVERRIDE = (process.env.API_OVERRIDE || '').replace(/\/+$/, '');
const TAG = process.env.QA_TAG || 'pre';
const API = 'https://tennis-api.propbetedge.ai';
const OUT = path.resolve(`qa-artifacts/phase6-${TAG}`);
fs.mkdirSync(OUT, { recursive: true });
const apiBase = OVERRIDE || API;
const j = async (p) => (await (await fetch(`${apiBase}${p}${p.includes('?') ? '&' : '?'}qa=${Date.now()}`)).json()).data;

// real ids: a completed ATP match (Sinner's latest), an upcoming matchup if any exists
const sinner = await j('/v1/players/jannik-sinner/dna');
const done = sinner?.match_dna?.recent?.[0]?.match_id;
const list = (await j('/v1/matchups'))?.matchups || [];
const upcoming = list.map((x) => x.match.id);
const PATHS = ['/players/jannik-sinner/dna', '/players/carlos-alcaraz/dna', '/players/aryna-sabalenka/dna', '/players/iga-swiatek/dna', '/players/jannik-sinner', '/matchups', '/matchups?tour=atp', '/matchups?tour=wta',
  ...upcoming.slice(0, 3).map((id) => `/matchups/${id}`), ...(done ? [`/matchups/${done}`] : []), '/players-to-watch', '/players-to-watch?tour=wta', '/dna?metric=pbe_rating&tour=wta', '/', '/labs'];
const WIDTHS = [[1440, 'desktop'], [1024, 'tablet'], [390, 'mobile'], [320, 'narrow']];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
try {
  for (const [width, label] of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    if (OVERRIDE) {
      await ctx.route(`${API}/**`, async (route) => {
        const u = new URL(route.request().url());
        if (!u.pathname.startsWith('/v1/') && u.pathname !== '/health') return route.continue();
        const r = await fetch(`${OVERRIDE}${u.pathname}${u.search}`);
        await route.fulfill({ status: r.status, body: Buffer.from(await r.arrayBuffer()), headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'access-control-allow-origin': '*' } });
      });
    }
    // a Vercel PREVIEW cannot render edge-SSR routes: tennis-web builds them from PRODUCTION's app shell (production
    // asset hashes). PREVIEW_SHELL=1 serves those documents from the preview's own app-shell.html instead, which is what
    // tennis-web will serve once this build is in production. The page code and data are the preview's / API's own.
    if (process.env.PREVIEW_SHELL === '1') {
      await ctx.route(/\/(players\/[^/?]+(\/[^/?]+)?|matches\/[^/?]+|pbecast\/[^/?]+|tournaments\/[^/?]+\/\d{4}(\/[^/?]+)?|news\/[^/?]+)(\?.*)?$/, async (route) => {
        if (route.request().resourceType() !== 'document') return route.continue();
        const r = await ctx.request.get(`${BASE}/app-shell.html`);
        await route.fulfill({ status: 200, body: await r.body(), headers: { 'content-type': 'text/html; charset=utf-8' } });
      });
    }
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|googletagmanager|_vercel\/insights/.test(m.text())) errors.push(`console: ${m.text().slice(0, 160)}`); });
    if (SHARE) await page.goto(`${BASE}/?${SHARE}`, { waitUntil: 'domcontentloaded' });
    for (const p of PATHS) {
      errors.length = 0;
      await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 30000 }).catch(() => errors.push('still loading after 30s'));
      const m = await page.evaluate(() => {
        const text = document.querySelector('main')?.innerText || '';
        return {
          sw: document.documentElement.scrollWidth, iw: window.innerWidth, h1: document.querySelector('h1')?.textContent?.trim() || '',
          bad: (text.match(/\bundefined\b|\bNaN\b|\[object /g) || []).length,
          broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && !i.src.startsWith('data:')).map((i) => i.src),
          blocks: { rating_chart: !!document.querySelector('.rc'), windows: !!document.querySelector('.win-grid'), splits: document.querySelectorAll('.split-tbl').length, surface_charts: document.querySelectorAll('.surf-chart .rc').length, matchup_cards: document.querySelectorAll('.mu-card').length, prob_bars: document.querySelectorAll('.pbar').length, withheld: document.querySelectorAll('.mu-withheld').length, why: !!document.querySelector('.mu-why'), watch_rows: document.querySelectorAll('.ptw li').length, empty: !!document.querySelector('.empty-h'), empty_text: document.querySelector('.empty-h')?.textContent?.trim() || null }
        };
      });
      const fail = [];
      if (m.sw > m.iw) fail.push(`overflow ${m.sw}>${m.iw}`);
      if (!m.h1) fail.push('no h1');
      if (m.bad) fail.push(`${m.bad} undefined/NaN text`);
      for (const b of m.broken) fail.push(`broken image ${b}`);
      fail.push(...errors);
      const shot = width !== 320 ? `${label}-${width}${p.replace(/[/?=&]/g, '_')}.png` : null;
      if (shot) await page.screenshot({ path: path.join(OUT, shot), fullPage: true });
      results.push({ width, label, path: p, h1: m.h1, pass: !fail.length, fail, blocks: m.blocks, shot });
      console.log(`${fail.length ? 'FAIL' : 'PASS'} ${width} ${p} ${fail.join('; ')} ${JSON.stringify(m.blocks)}`);
    }
    await ctx.close();
  }
} finally { await browser.close(); }
const rep = { tag: TAG, base: BASE, preview_shell: process.env.PREVIEW_SHELL === '1', api: OVERRIDE ? `override -> ${OVERRIDE}` : API, run_at: new Date().toISOString(), pass: results.filter((r) => r.pass).length, fail: results.filter((r) => !r.pass).length, results };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rep, null, 1));
console.log(`\n${rep.pass} PASS / ${rep.fail} FAIL -> ${OUT}`);
if (rep.fail) process.exitCode = 1;
