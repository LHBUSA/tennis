#!/usr/bin/env node
// Homepage V2 browser acceptance (docs/evidence/home-v2-production.md), in a real browser at 320/360/390/430/768/1024/1440.
//   node scripts/qa/home-visual.mjs                                   -> production (https://tennis.propbetedge.ai)
//   QA_BASE=http://localhost:5194 node scripts/qa/home-visual.mjs     -> local preview (npm run build && npx vite preview --port 5194)
// Per width: hero + exactly one h1 + primary CTA; live/status strip hydrated; Up Next / Live section when /v1/today has matches;
// tournament, players, intelligence, Tennis DNA, PBEcast and coverage sections hydrated (no skeleton left); no broken
// images; no SVG / data-URI imagery in editorial or hero slots (monogram avatars are the approved fallback); no console
// errors; no horizontal page overflow; no runaway section height; every VISIBLE rail arrow scrolls its rail both ways;
// no visible rail scrollbars; CLS < 0.1. Once: every internal link on the page answers 200. Screenshots -> docs/evidence/home-v2/ (production) or
// qa-artifacts/home-v2/ (local). Read-only: GETs public pages and the public API only.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const WEB = (process.env.QA_BASE || 'https://tennis.propbetedge.ai').replace(/\/+$/, '');
const API = (process.env.API_BASE || 'https://tennis-api.propbetedge.ai').replace(/\/+$/, '');
const LOCAL = /localhost|127\.0\.0\.1/.test(WEB);
const OUT = LOCAL ? 'qa-artifacts/home-v2' : 'docs/evidence/home-v2';
const WIDTHS = (process.env.QA_WIDTHS || '320,360,390,430,768,1024,1440').split(',').map(Number);
const SHOTS = new Set([320, 390, 768, 1024, 1440]);
const MAX_SECTION = { 320: 2400, 360: 2400, 390: 2400, 430: 2400, 768: 2000, 1024: 1700, 1440: 1500 };
fs.mkdirSync(OUT, { recursive: true });

const today = await fetch(`${API}/v1/today`).then((r) => r.json()).then((j) => j.data).catch(() => null);
const expectNext = !!(today && (today.live.length || today.upcoming.length || today.latest_results?.length));

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const results = [];
let links = null;
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  await page.goto(`${WEB}/`, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const cls = await page.evaluate(() => window.__cls);
  // scroll the whole page so lazy images load, then settle
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < H; y += 500) { await page.evaluate((v) => scrollTo(0, v), y); await page.waitForTimeout(120); }
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(1200);
  const fail = [];
  const r = await page.evaluate(({ maxSection }) => {
    const q = (s) => document.querySelector(s);
    const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const out = {};
    out.hero = !!q('.hm-hero');
    out.h1 = document.querySelectorAll('h1').length;
    out.cta = vis(q('.hm-btn.primary'));
    out.status = (q('[data-status]')?.textContent || '').trim();
    out.next = !!q('#h-next') && !!q('[data-next] .hm-rail');
    out.sections = Object.fromEntries(['h-tours', 'h-players', 'h-news', 'h-dna', 'h-cast', 'h-cov'].map((id) => { const s = document.getElementById(id)?.closest('section'); return [id, s ? { h: Math.round(s.getBoundingClientRect().height), wait: !!s.querySelector('.hm-wait'), text: (s.querySelector('.hm-body')?.textContent || '').trim().length } : null]; }));
    out.maxSection = maxSection;
    out.loading = [...document.querySelectorAll('.loading, .hm-wait')].filter(vis).length;
    out.overflow = document.documentElement.scrollWidth - innerWidth;
    const imgs = [...document.querySelectorAll('main img')];
    out.broken = imgs.filter((i) => i.complete && i.naturalWidth === 0 && vis(i)).map((i) => i.currentSrc || i.src).slice(0, 5);
    out.svgEditorial = [...document.querySelectorAll('.hm-hero-media img, .hm-news img, .hm-tcard img')].filter((i) => /^data:|\.svg(\?|$)/.test(i.currentSrc || i.src)).length;
    out.heroPhoto = q('.hm-hero-photo img')?.currentSrc || null;
    out.heroCredit = (q('.hm-hero-fig figcaption small')?.textContent || '').trim();
    out.clipped = [...document.querySelectorAll('.hm-pcard b, .hm-tbot b, .hm-intro h2, .hm-hero h1')].filter((e) => vis(e) && e.scrollWidth > e.clientWidth + 2).map((e) => e.textContent.trim()).slice(0, 5);
    out.scrollbars = [...document.querySelectorAll('.hm-track, .hm-st-list')].filter((t) => vis(t) && t.offsetHeight - t.clientHeight > 0).length;
    out.navs = [...document.querySelectorAll('.hm-nav')].filter((n) => !n.hidden && vis(n)).length;
    out.footer = vis(q('footer'));
    out.links = [...new Set([...document.querySelectorAll('main a[href^="/"]')].map((a) => a.getAttribute('href').split('#')[0]))];
    return out;
  }, { maxSection: MAX_SECTION[w] });
  // rail arrows: each visible "next" must move its rail, "prev" must bring it back
  const arrowResults = [];
  const navCount = await page.locator('.hm-nav:not([hidden])').count();
  for (let i = 0; i < navCount; i += 1) {
    const nav = page.locator('.hm-nav:not([hidden])').nth(i);
    if (!(await nav.isVisible())) continue;
    const track = nav.locator('xpath=../div[contains(@class,"hm-track")]');
    const before = await track.evaluate((t) => t.scrollLeft);
    await nav.locator('button').nth(1).click();
    await page.waitForTimeout(400);
    const after = await track.evaluate((t) => t.scrollLeft);
    await nav.locator('button').nth(0).click();
    await page.waitForTimeout(400);
    const back = await track.evaluate((t) => t.scrollLeft);
    arrowResults.push({ before, after, back, ok: after > before && back < after });
  }
  if (!r.hero) fail.push('no hero');
  if (r.h1 !== 1) fail.push(`h1 count ${r.h1}`);
  if (!r.cta) fail.push('primary CTA not visible');
  if (!r.status || /Checking live/i.test(r.status)) fail.push('status strip not hydrated');
  if (expectNext && !r.next) fail.push('Up Next / Live section missing');
  for (const [id, s] of Object.entries(r.sections)) {
    if (!s) fail.push(`${id} missing`);
    else { if (s.wait || s.text < 20) fail.push(`${id} not hydrated`); if (s.h > r.maxSection) fail.push(`${id} runaway height ${s.h}px`); }
  }
  if (r.loading) fail.push(`${r.loading} loading placeholder(s) left`);
  if (r.overflow > 0) fail.push(`horizontal overflow ${r.overflow}px`);
  if (r.broken.length) fail.push(`broken images: ${r.broken.join(', ')}`);
  if (r.svgEditorial) fail.push(`${r.svgEditorial} SVG/data-URI editorial image(s)`);
  if (r.heroPhoto && !r.heroCredit) fail.push('hero photo without credit');
  if (r.clipped.length) fail.push(`clipped text: ${r.clipped.join(' | ')}`);
  if (r.scrollbars) fail.push(`${r.scrollbars} visible rail scrollbar(s)`);
  if (!r.footer) fail.push('footer missing');
  if (errors.length) fail.push(`console errors: ${errors.slice(0, 3).join(' | ')}`);
  if (cls >= 0.1) fail.push(`CLS ${cls.toFixed(3)}`);
  for (const a of arrowResults) if (!a.ok) fail.push(`rail arrow did not scroll (${a.before}->${a.after}->${a.back})`);
  if (SHOTS.has(w)) await page.screenshot({ path: `${OUT}/home-${w}.png`, fullPage: true });
  if (w === 1440) {
    await page.locator('.hm-hero').screenshot({ path: `${OUT}/hero-1440.png` });
    await page.locator('#h-tours').evaluate((e) => e.closest('section').id = 'qa-tours');
    await page.locator('#qa-tours').screenshot({ path: `${OUT}/tournaments-1440.png` });
    await page.locator('#h-dna').evaluate((e) => e.closest('section').id = 'qa-dna');
    await page.locator('#qa-dna').screenshot({ path: `${OUT}/dna-1440.png` });
    links = r.links;
  }
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  results.push({ width: w, pass: !fail.length, fail, height: h, cls: Number(cls.toFixed(4)), arrows: arrowResults.length, hero_photo: r.heroPhoto, sections: r.sections });
  console.log(`${fail.length ? 'FAIL' : 'PASS'} @${w} h=${h} cls=${cls.toFixed(4)} arrows=${arrowResults.length}${fail.length ? ` :: ${fail.join('; ')}` : ''}`);
  await ctx.close();
}
await browser.close();

// internal links (once, from the 1440 render): every one must answer 200
const linkResults = [];
for (const href of links || []) {
  const res = await fetch(`${WEB}${href}`, { redirect: 'follow' }).then((x) => x.status).catch(() => 0);
  linkResults.push({ href, status: res });
}
const badLinks = linkResults.filter((l) => l.status !== 200);
console.log(`links: ${linkResults.length} checked, ${badLinks.length} bad${badLinks.length ? `: ${badLinks.map((l) => `${l.href} ${l.status}`).join(', ')}` : ''}`);
const pass = results.every((x) => x.pass) && !badLinks.length;
fs.writeFileSync(`${OUT}/qa-${LOCAL ? 'local' : 'production'}.json`, JSON.stringify({ base: WEB, at: new Date().toISOString(), pass, expect_next: expectNext, results, links: linkResults }, null, 2) + '\n');
console.log(`HOME VISUAL V2: ${pass ? 'PASS' : 'FAIL'} (${results.filter((x) => x.pass).length}/${results.length} widths, ${linkResults.length} links)`);
process.exitCode = pass ? 0 : 1;
