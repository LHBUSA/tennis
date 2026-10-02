#!/usr/bin/env node
// Newsroom desk pages vs All Access endpoints. Read-only.
//   MODE=anon      (default) real anonymous visitor: desks load, ZERO requests to /v1/players-to-watch or /v1/matchups,
//                  no 4xx, no console errors, nothing stuck loading, no gated payload rendered (rating risers, previews).
//   MODE=entitled  only the /v1/membership verdict is replaced with an entitled one (no session is forged; the API still
//                  answers the gated calls with its real 401 for this unauthenticated browser) -> proves the hub DOES
//                  request both endpoints for an entitled visitor. Real signed-in rendering needs QA_PBE_SESSION.
//   QA_BASE=http://localhost:5197 PREVIEW_SHELL=1 MODE=anon node scripts/qa/news-desks-anon.mjs
// JSON -> docs/evidence/news-desks-<MODE>-<LABEL>.json
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = (process.env.QA_BASE || 'https://tennis.propbetedge.ai').replace(/\/$/, '');
const MODE = process.env.MODE || 'anon';
const LABEL = process.env.LABEL || 'run';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTHS = (process.env.WIDTHS || '320,390,768,1024,1440').split(',').map(Number);
const DESKS = ['/news', '/news/atp', '/news/wta', '/news/doubles', '/news/rankings', '/news/grand-slams'];
const GATED = /\/v1\/(players-to-watch|matchups)(?:[/?]|$)/;
const SESSION = process.env.QA_PBE_SESSION || '';

const browser = await chromium.launch({ executablePath: CHROME });
const rows = [];
const fails = [];
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  if (SESSION) await ctx.addCookies([{ name: 'pbe_session', value: SESSION, domain: '.propbetedge.ai', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  if (process.env.PREVIEW_SHELL === '1') {
    await ctx.route(/\/news\/[^/?]+(\?.*)?$/, async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const r = await ctx.request.get(`${BASE}/app-shell.html`);
      await route.fulfill({ status: 200, body: await r.body(), headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
  }
  await ctx.route(/^https:\/\/tennis-api\.propbetedge\.ai\//, async (route) => {
    const url = route.request().url();
    if (MODE === 'entitled' && /\/v1\/membership(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ ok: true, membership: { sport: 'tennis', state: 'all_access', entitled: true, access_source: 'all_access' } }) });
    }
    if (process.env.PREVIEW_SHELL !== '1') return route.continue();
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' } });
  });
  const page = await ctx.newPage();
  for (const path of DESKS) {
    const errs = [];
    const reqs = [];
    const bad = [];
    const onC = (m) => { if (m.type() === 'error' && !/google|gtag|favicon/i.test(m.text())) errs.push(m.text().slice(0, 160)); };
    const onE = (e) => errs.push(String(e).slice(0, 160));
    const onQ = (r) => { if (/tennis-api/.test(r.url())) reqs.push(r.url().replace(/^https:\/\/[^/]+/, '')); };
    const onR = (r) => { if (r.status() >= 400 && !/google|favicon/i.test(r.url())) bad.push(`${r.status()} ${r.url().replace(/\?.*$/, '')}`); };
    page.on('console', onC); page.on('pageerror', onE); page.on('request', onQ); page.on('response', onR);
    const nav = await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('.nf-body .loading, [data-body] > .loading'), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({
      loading: !!document.querySelector('.loading'),
      sections: [...document.querySelectorAll('.nf-body h2')].map((h) => h.textContent.trim()),
      stories: document.querySelectorAll('.nf-body a[href^="/news/"]').length,
      risers: document.querySelectorAll('.nf-mv-k').length ? [...document.querySelectorAll('.nf-mv-k')].filter((x) => /PBE Rating/.test(x.textContent)).length : 0,
      previews: document.querySelectorAll('.nf-pv-v').length,
      overflow: document.documentElement.scrollWidth - innerWidth,
      title: document.title,
      canonical: document.querySelector('link[rel=canonical]')?.href || null,
      robots: document.querySelector('meta[name=robots]')?.content || null,
    }));
    for (const [ev, fn] of [['console', onC], ['pageerror', onE], ['request', onQ], ['response', onR]]) page.off(ev, fn);
    const gatedReqs = reqs.filter((u) => GATED.test(u));
    const row = { w, path, status: nav?.status(), gatedReqs, bad, errs, ...r };
    rows.push(row);
    const f = (m) => fails.push(`${w}px ${path}: ${m}`);
    if (!nav || nav.status() >= 400) f(`document ${nav?.status()}`);
    if (r.loading) f('stuck loading');
    if (!r.sections.length) f('no modules rendered');
    if (r.overflow > 0) f(`overflow ${r.overflow}px`);
    if (MODE === 'anon') {
      if (gatedReqs.length) f(`gated requests ${gatedReqs.join(', ')}`);
      if (bad.length) f(`failed responses ${bad.join(' | ')}`);
      if (errs.length) f(`console ${errs.join(' | ')}`);
      if (r.risers || r.previews) f(`gated data rendered (risers ${r.risers}, previews ${r.previews})`);
    } else {
      const want = ['/v1/players-to-watch', ...(['/news', '/news/atp', '/news/wta'].includes(path) ? ['/v1/matchups'] : [])];
      for (const p of want) if (!gatedReqs.some((u) => u.startsWith(p))) f(`entitled visitor did not request ${p}`);
      const nonGatedBad = bad.filter((b) => !GATED.test(b));
      if (nonGatedBad.length) f(`failed responses ${nonGatedBad.join(' | ')}`);
    }
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`docs/evidence/news-desks-${MODE}-${LABEL}.json`, JSON.stringify({ base: BASE, mode: MODE, label: LABEL, session: !!SESSION, at: new Date().toISOString(), fails, rows }, null, 1));
console.log(`${MODE}/${LABEL}: ${rows.length} desk-widths, ${fails.length} fails`);
for (const x of fails) console.log('FAIL', x);
for (const r of rows.filter((x) => x.w === 1440)) console.log(r.path, r.status, `stories ${r.stories}`, `gated ${r.gatedReqs.length}`, `risers ${r.risers} previews ${r.previews}`, '|', r.sections.join(' / '));
process.exitCode = fails.length ? 1 : 0;
