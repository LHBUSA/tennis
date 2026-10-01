#!/usr/bin/env node
// First-useful-render timings for /players (All / Men / Women) and the homepage Tennis DNA module, with every
// tennis-api request's start/end relative to navigation. Optional fault injection: SLOW=/v1/slams:8000 delays every
// matching request (comma-separated) so a slow enhancement request can be proven not to block first paint.
// Usage: BASE=https://tennis.propbetedge.ai LABEL=before node scripts/qa/perf-players-dna.mjs
//        -> docs/evidence/perf-players-dna-<LABEL>.json
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'https://tennis.propbetedge.ai';
const LABEL = process.env.LABEL || 'run';
const SLOW = (process.env.SLOW || '').split(',').filter(Boolean).map((s) => { const [p, ms] = s.split(':'); return { p, ms: Number(ms) || 8000 }; });
const RUNS = Number(process.env.RUNS || 2);

const CASES = [
  // first useful paint = a player link inside the directory body
  { route: '/players', ready: 'table a[href^="/players/"]' },
  { route: '/players?gender=men', ready: 'table a[href^="/players/"]' },
  { route: '/players?gender=women', ready: 'table a[href^="/players/"]' },
  // homepage DNA: first visible content (skeleton or board) and first real leader row
  { route: '/', ready: '[data-leaders] .hm-dna li, [data-leaders] .hm-dna-skel, [data-leaders] .hm-dna', rows: '[data-leaders] .hm-dna ol:not(.hm-dna-skel) li' }
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const out = { base: BASE, label: LABEL, slow: SLOW, at: new Date().toISOString(), runs: [] };
for (const [w, h] of [[1440, 900], [390, 844]]) {
  for (const c of CASES) {
    for (let run = 0; run < RUNS; run++) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      for (const s of SLOW) await page.route((u) => u.href.includes(s.p), async (r) => { await new Promise((ok) => setTimeout(ok, s.ms)); r.continue(); });
      const reqs = new Map();
      const t0 = Date.now();
      page.on('request', (r) => { if (r.url().includes('tennis-api')) reqs.set(r, { url: r.url().replace(/^https:\/\/[^/]+/, ''), start: Date.now() - t0 }); });
      page.on('requestfinished', (r) => { const x = reqs.get(r); if (x) x.end = Date.now() - t0; });
      page.on('requestfailed', (r) => { const x = reqs.get(r); if (x) { x.end = Date.now() - t0; x.failed = true; } });
      await page.goto(BASE + c.route, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const first = await page.waitForSelector(c.ready, { timeout: 30000 }).then(() => Date.now() - t0).catch(() => null);
      const rows = c.rows ? await page.waitForSelector(c.rows, { timeout: 30000 }).then(() => Date.now() - t0).catch(() => null) : null;
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      const dom = await page.evaluate(() => ({ trs: document.querySelectorAll('main tbody tr').length, imgs: document.querySelectorAll('main img').length, eagerImgs: [...document.querySelectorAll('main img')].filter((i) => i.loading !== 'lazy').length, leaders: document.querySelectorAll('[data-leaders] .hm-dna ol:not(.hm-dna-skel) li').length }));
      const rec = { width: w, route: c.route, run, first_useful_ms: first, leader_rows_ms: rows, dom, requests: [...reqs.values()].sort((a, b) => a.start - b.start) };
      out.runs.push(rec);
      console.log(`${w} ${c.route} run${run} first=${first}ms${c.rows ? ` rows=${rows}ms` : ''} trs=${dom.trs} imgs=${dom.imgs} leaders=${dom.leaders} | ${rec.requests.filter((r) => r.url.startsWith("/v1/")).map((r) => `${r.url.split('?')[0].replace('/v1/', '')}@${r.start}-${r.end ?? '…'}`).join(' ')}`);
      await ctx.close();
    }
  }
}
await browser.close();
fs.mkdirSync('docs/evidence', { recursive: true });
fs.writeFileSync(`docs/evidence/perf-players-dna-${LABEL}.json`, JSON.stringify(out, null, 2));
