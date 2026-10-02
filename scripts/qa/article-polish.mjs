#!/usr/bin/env node
// Tennis article polish gate (stat tables, sticky rail, DNA baseline vs match, Evidence & Method). Read-only.
//   QA_BASE=https://tennis.propbetedge.ai LABEL=before node scripts/qa/article-polish.mjs
//   QA_BASE=http://localhost:5194 LABEL=after SHOTS=1 node scripts/qa/article-polish.mjs
// Per article x width: horizontal overflow, clipped values in stat tables/method, console errors, CLS (layout-shift sum),
// rail geometry (sticky only >=1100 and only when it fits the viewport; top >= header bottom; never over the footer;
// inline after the article below 1100), Source & Method visible without a click and carrying packet/composer versions,
// structured data + narrative text hashes (must be identical before/after). JSON -> docs/evidence/article-polish-<LABEL>.json
import fs from 'node:fs';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';

const BASE = (process.env.QA_BASE || 'https://tennis.propbetedge.ai').replace(/\/$/, '');
const LABEL = process.env.LABEL || 'run';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTHS = (process.env.WIDTHS || '320,360,390,430,768,1024,1440').split(',').map(Number);
const SHOTS = process.env.SHOTS === '1';
const OUT = `qa-artifacts/article-polish/${LABEL}`;
const ARTICLES = (process.env.ARTICLES || [
  'fernandez-wins-the-singapore-title-c6c3a0', // completed match (full class, title)
  'fernandez-beats-no-5-andreeva-in-the-singapore-quarterfinal-eb35c6', // dense serve/return, 8 sections
  'birrell-wins-the-seoul-title-48ee62', // Tennis DNA + Match DNA pre-match baselines
  'fils-knocks-out-no-2-seed-tiafoe-at-kinoshita-group-japan-open-tennis-championsh-ffae98', // V4 tables + long rail
].join(',')).split(',');
fs.mkdirSync(OUT, { recursive: true });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

const browser = await chromium.launch({ executablePath: CHROME });
const rows = [];
const fails = [];
const links = new Set();
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    window.__cls = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  });
  // local preview: /news/:slug is an edge (tennis-web) route in production; serve this build's app-shell.html for it
  if (process.env.PREVIEW_SHELL === '1') {
    await ctx.route(/\/news\/[^/?]+(\?.*)?$/, async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const r = await ctx.request.get(`${BASE}/app-shell.html`);
      await route.fulfill({ status: 200, body: await r.body(), headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    // the API answers credentialed requests from localhost with ACAO '*', which Chrome rejects: relay the same live
    // response with the preview origin allowed (read-only GETs; data unchanged)
    await ctx.route(/^https:\/\/tennis-api\.propbetedge\.ai\//, async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' } });
    });
  }
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/google|gtag|favicon/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  for (const slug of ARTICLES) {
    errs.length = 0;
    await page.goto(`${BASE}/news/${slug}`, { waitUntil: 'load' });
    await page.waitForSelector('.nwm-art', { timeout: 30000 }).catch(() => {});
    await page.addStyleTag({ content: 'html,body{scroll-behavior:auto!important}' });
    await page.waitForTimeout(1500);
    const clsLoad = await page.evaluate(() => window.__cls);
    // scroll through (rail sticks / live module may appear) then measure at three scroll positions
    const r = await page.evaluate(async () => {
      const q = (s) => document.querySelector(s);
      const rect = (el) => el?.getBoundingClientRect();
      const doc = document.documentElement;
      const art = q('.nwm-art');
      const rail = q('.nwm-rail');
      const hdr = q('.hdr');
      const ftr = q('footer, .ftr');
      const sticky = (el) => getComputedStyle(el).position === 'sticky';
      const clipped = [];
      for (const el of document.querySelectorAll('.nw-chart, .nw-chart *, .nwd-t, .nwd-t *, .nw-score table, .nf-method, .nf-method *, .nwm-rail *')) {
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' && el.clientWidth > 0) clipped.push(`${el.tagName}.${el.className}`.slice(0, 60));
        const p = el.closest('.nw-chart, .nwd, .nw-score, .nf-method, .nwm-rbox');
        if (p && p !== el && el.getClientRects().length) { const a = rect(el); const b = rect(p); if (a.right > b.right + 1 || a.left < b.left - 1) clipped.push(`overhang ${el.tagName}.${el.className}`.slice(0, 60)); }
      }
      const samples = [];
      const H = doc.scrollHeight;
      for (const f of [0.35, 0.7, 1]) {
        window.scrollTo(0, Math.round((H - innerHeight) * f));
        await new Promise((res) => setTimeout(res, 250));
        const rr = rect(rail);
        samples.push({ f, railTop: Math.round(rr.top), railBottom: Math.round(rr.bottom), hdrBottom: Math.round(rect(hdr)?.bottom ?? 0), footerTop: ftr ? Math.round(rect(ftr).top) : null, artBottom: Math.round(rect(art).bottom) });
      }
      window.scrollTo(0, 0);
      const method = q('.nf-method');
      const mClosed = method?.closest('details:not([open])');
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join('\n');
      const narrative = [...document.querySelectorAll('.nw-body > section:not(.nf-method)')].map((s) => [...s.querySelectorAll(':scope > h2, :scope > p')].map((x) => x.textContent).join('\n')).join('\n\n');
      const values = [...document.querySelectorAll('.nw-chart, .nwd-t, .nw-score table, .nwd-tiles')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join('|');
      const hrefs = [...document.querySelectorAll('.nwm-art a[href], .nwm-rail a[href]')].map((a) => a.getAttribute('href'));
      return {
        overflow: doc.scrollWidth - innerWidth,
        clipped: [...new Set(clipped)],
        railPos: rail ? getComputedStyle(rail).position : null,
        railSticky: rail ? sticky(rail) : false,
        railH: Math.round(rect(rail)?.height || 0), railScrollH: rail ? rail.scrollHeight : 0,
        railBelowArticle: rail && art ? rect(rail).top + scrollY >= rect(art).bottom + scrollY - 1 : null,
        samples,
        method: method ? { visible: !mClosed && method.getClientRects().length > 0, isDetails: method.tagName === 'DETAILS', text: method.innerText.slice(0, 2000), hasPacket: /packet/i.test(method.innerText), hasComposer: /composer/i.test(method.innerText) } : null,
        ldHash: ld, narrative, values, hrefs,
        dnaLabels: [...document.querySelectorAll('.nw-chart[data-chart*="dna"]')].map((c) => c.querySelector('.nw-chart-k')?.textContent || null),
      };
    });
    const cls = await page.evaluate(() => window.__cls);
    for (const h of r.hrefs) if (h && h.startsWith('/')) links.add(h);
    const row = { w, slug: slug.slice(0, 48), overflow: r.overflow, clipped: r.clipped, errors: [...errs], clsLoad: +clsLoad.toFixed(4), clsTotal: +cls.toFixed(4), railPos: r.railPos, railH: r.railH, railScrollH: r.railScrollH, railBelowArticle: r.railBelowArticle, samples: r.samples, method: r.method && { visible: r.method.visible, isDetails: r.method.isDetails, hasPacket: r.method.hasPacket, hasComposer: r.method.hasComposer }, ldHash: sha(r.ldHash), narrativeHash: sha(r.narrative), valuesHash: sha(r.values.replace(/PRE-MATCH BASELINE|MATCH PRODUCTION|Pre-match baseline|Match production/g, '').replace(/\s+/g, '')), dnaLabels: r.dnaLabels };
    rows.push(row);
    const f = (m) => fails.push(`${w}px ${slug.slice(0, 40)}: ${m}`);
    if (r.overflow > 0) f(`horizontal overflow ${r.overflow}px`);
    if (r.clipped.length) f(`clipped ${r.clipped.join(', ')}`);
    if (errs.length) f(`console ${errs.join(' | ')}`);
    if (cls > 0.1) f(`CLS ${cls.toFixed(3)}`);
    if (w < 1100 && r.railSticky) f('rail sticky below 1100');
    if (w < 1100 && r.railBelowArticle === false) f('rail not inline after the article');
    for (const s of r.samples) {
      if (s.footerTop != null && s.railBottom > s.footerTop + 1 && w >= 1100) f(`rail overlaps footer at ${s.f} (${s.railBottom} > ${s.footerTop})`);
      if (r.railSticky && s.artBottom > s.railBottom + 1 && s.railTop < s.hdrBottom - 1) f(`rail under header at ${s.f} (${s.railTop} < ${s.hdrBottom})`);
    }
    if (SHOTS && [320, 390, 768, 1440].includes(w)) {
      const shot = async (sel, name) => { const el = await page.$(sel); if (el) { await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await el.screenshot({ path: `${OUT}/${w}-${slug.slice(0, 24)}-${name}.png` }).catch(() => {}); } };
      await page.bringToFront();
      await shot('#match_data .nw-chart, #match_data .nwd', 'serve');
      await shot('.nw-chart[data-chart*="dna"], #dna .nw-chart', 'dna');
      await shot('.nwd-sets', 'sets');
      await shot('.nf-method', 'method');
      if (w >= 1024) { await page.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.5)); await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/${w}-${slug.slice(0, 24)}-rail-mid.png` }); await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/${w}-${slug.slice(0, 24)}-rail-end.png` }); }
    }
  }
  await ctx.close();
}
// link check: every internal href the article and rail carry (tennis serves an app shell for unknown paths -> check the API-resolvable ones by page title later; here: well-formed + 200)
const linkRes = [];
for (const h of links) { try { const res = await fetch(`${BASE}${h}`, { redirect: 'manual' }); linkRes.push([h, res.status]); if (res.status >= 400) fails.push(`link ${h} ${res.status}`); } catch (e) { fails.push(`link ${h} ${e.message}`); } }
await browser.close();
fs.writeFileSync(`docs/evidence/article-polish-${LABEL}.json`, JSON.stringify({ base: BASE, label: LABEL, at: new Date().toISOString(), fails, rows, links: linkRes }, null, 1));
console.log(`${LABEL}: ${rows.length} page-widths, ${linkRes.length} links, ${fails.length} fails`);
for (const x of fails) console.log('FAIL', x);
const byW = {};
for (const r of rows) (byW[r.w] ||= []).push(`${r.railPos}/${r.railH}px cls ${r.clsTotal}`);
for (const [w, v] of Object.entries(byW)) console.log(w, v.join(' · '));
process.exitCode = fails.length ? 1 : 0;
