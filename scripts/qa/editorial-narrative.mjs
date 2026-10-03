#!/usr/bin/env node
// Editorial overhaul browser gate (owner brief 2026-10-03, "Prose leads. Data supports."). Read-only.
// Loads real article pages, measures the RENDERED story: genuine narrative prose words (story paragraphs only) vs
// structured-module text (charts, tables, stat tiles, DNA, glance strip, intelligence box, evidence/method), the visual
// sequence (words of prose between consecutive visual blocks — the page rhythm), interpretations under visuals,
// horizontal overflow and console errors; captures full-page screenshots at 1440 and 390.
//   QA_BASE=https://tennis.propbetedge.ai LABEL=after SLUGS=a,b node scripts/qa/editorial-narrative.mjs
//   QA_BASE=http://localhost:5199 PREVIEW_SHELL=1 MOCK_DIR=<dir of {slug}.json API payloads> LABEL=mock node ...
// Output: qa-artifacts/editorial/<LABEL>/{report.json, <slug>-<w>.png}
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = (process.env.QA_BASE || 'https://tennis.propbetedge.ai').replace(/\/$/, '');
const LABEL = process.env.LABEL || 'run';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTHS = (process.env.WIDTHS || '1440,390').split(',').map(Number);
const SLUGS = String(process.env.SLUGS || '').split(',').filter(Boolean);
const MOCK_DIR = process.env.MOCK_DIR || null;
const SHOTS = process.env.SHOTS !== '0';
const OUT = process.env.OUT || `qa-artifacts/editorial/${LABEL}`;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--disable-gpu'] });
const report = [];
try {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    if (process.env.PREVIEW_SHELL === '1') {
      await ctx.route(/\/news\/[^/?]+(\?.*)?$/, async (route) => {
        if (route.request().resourceType() !== 'document') return route.continue();
        const r = await ctx.request.get(`${BASE}/app-shell.html`);
        await route.fulfill({ status: 200, body: await r.body(), headers: { 'content-type': 'text/html; charset=utf-8' } });
      });
      await ctx.route(/^https:\/\/tennis-api\.propbetedge\.ai\//, async (route) => {
        const u = new URL(route.request().url());
        const m = /^\/v1\/news\/([a-z0-9-]+)$/.exec(u.pathname);
        if (MOCK_DIR && m && fs.existsSync(`${MOCK_DIR}/${m[1]}.json`)) {
          return route.fulfill({ status: 200, body: fs.readFileSync(`${MOCK_DIR}/${m[1]}.json`, 'utf8'), headers: { 'content-type': 'application/json', 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' } });
        }
        const res = await route.fetch();
        await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' } });
      });
    }
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/google|gtag|favicon|Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
    for (const slug of SLUGS) {
      errs.length = 0;
      await page.goto(`${BASE}/news/${slug}${process.env.QS || ''}`, { waitUntil: 'load' });
      await page.waitForSelector('.nwm-art .nw-body section', { timeout: 45000 }).catch(() => {});
      await page.addStyleTag({ content: 'html,body{scroll-behavior:auto!important}' });
      await page.waitForTimeout(1200);
      const m = await page.evaluate(() => {
        const wc = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
        const body = document.querySelector('.nwm-art .nw-body');
        if (!body) return null;
        const VIS = '.mod, figure, table, .nf-glance, .nf-intel, .nwm-mu, .nw-chart, details, .nf-method, .nwd';
        // narrative prose = paragraphs of the story sections that are not inside a visual/module/method/reading
        const prose = [...body.querySelectorAll('section > p')].filter((p) => !p.closest(VIS) && !p.closest('#method') && !p.classList.contains('nw-read'));
        const proseWords = prose.reduce((t, p) => t + wc(p.innerText), 0);
        const allWords = wc(document.querySelector('.nwm-art')?.innerText || '');
        const headerWords = wc(document.querySelector('.nwm-head')?.innerText || '');
        // visual blocks in reading order (top-level within the body), with prose words since the previous block
        const blocks = [];
        let since = 0;
        const walk = (el) => {
          for (const c of el.children) {
            if (c.matches('section') && !c.matches('.nf-method, #data-appendix, #method, .nwm-mu')) { walk(c); continue; }
            if (c.matches('p') && !c.closest(VIS) && !c.classList.contains('nw-read')) { since += wc(c.innerText); continue; }
            if (c.matches('h2')) continue;
            if (c.matches(VIS + ', .nw-vis, .nw-opener, aside, .nwm-mu') && c.offsetHeight > 40) {
              const kind = c.getAttribute('data-visual') || c.querySelector('[data-module]')?.getAttribute('data-module') || c.getAttribute('data-module') || c.getAttribute('data-chart') || c.className.split(' ')[0];
              const interp = c.querySelector('.nw-read') ? wc(c.querySelector('.nw-read').innerText) : 0;
              blocks.push({ kind, prose_before: since, interpretation_words: interp });
              since = 0;
            }
          }
        };
        walk(body);
        const structuredWords = [...document.querySelectorAll('.nwm-art .nw-body .mod, .nwm-art .nw-body figure, .nwm-art .nf-glance, .nwm-art .nf-intel, .nwm-art .nwm-mu, .nwm-art .nw-body details, .nwm-art .nf-method')].filter((el, i, arr) => !arr.some((o) => o !== el && o.contains(el))).reduce((t, el) => t + wc(el.innerText), 0);
        const appendix = document.querySelector('#data-appendix details');
        return {
          headline: document.querySelector('.nwm-head h1')?.innerText || null,
          dek: document.querySelector('.nwm-dek')?.innerText || null,
          narrative_layout: !!document.querySelector('.nw-lead, .nw-vis'),
          prose_words: proseWords, structured_words: structuredWords, header_words: headerWords, page_words: allWords,
          structured_share: proseWords + structuredWords ? Math.round((structuredWords / (proseWords + structuredWords)) * 100) : null,
          headings: [...body.querySelectorAll('section > h2')].map((h) => h.innerText),
          blocks, min_prose_between_visuals: (() => { const xs = blocks.filter((b) => !/nf-method/.test(b.kind)).slice(1).map((b) => b.prose_before); return xs.length ? Math.min(...xs) : null; })(),
          appendix_modules: appendix ? appendix.querySelectorAll(':scope > .mod, :scope > figure, :scope > section').length : 0,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1, scroll_width: document.documentElement.scrollWidth,
          canonical: document.querySelector('link[rel=canonical]')?.href || null, robots: document.querySelector('meta[name=robots]')?.content || null,
          story_text: prose.map((p) => p.innerText).join('\n\n')
        };
      });
      let shot = null;
      if (SHOTS && m) { await page.bringToFront(); shot = `${OUT}/${slug.slice(0, 60)}-${w}.png`; await page.screenshot({ path: shot, fullPage: true }); }
      report.push({ slug, width: w, ...m, console_errors: [...errs], screenshot: shot });
      console.log(`${w} ${slug.slice(0, 50)} prose=${m?.prose_words} structured=${m?.structured_words} share=${m?.structured_share}% blocks=${m?.blocks?.length} minGap=${m?.min_prose_between_visuals} overflow=${m?.overflow} errs=${errs.length}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
