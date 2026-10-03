// Production gate for the completed-match page (PBEcast FINAL state), WATCH and the homepage LIVE & RECENT. One-shot.
//   MATCH=<completed match id> BASE=https://tennis.propbetedge.ai node scripts/qa/final-page.mjs
// Per width (390 / 768 / 1024 / 1440): FINAL summary present and above the court; PBEcast replay court present; market
// history (when the shared contract has one) after the replay; WATCH with an honest chip; no iframe before a click;
// the click loads youtube-nocookie; no overflow; CLS < 0.1 (TICKER=0 isolates the known ticker insertion); no console
// errors; no upstream sports-data names. Homepage: LIVE & RECENT has its live item(s) and FINAL items with honest badges.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'https://tennis.propbetedge.ai').replace(/\/+$/, '');
const MATCH = process.env.MATCH || '00a0f4e8-67cb-593c-a77b-65b62d709937';
const WIDTHS = (process.env.WIDTHS || '390,768,1024,1440').split(',').map(Number);
const OUT = process.env.OUT || 'qa-artifacts/final-page';
fs.mkdirSync(OUT, { recursive: true });
const UPSTREAM = /ESPN|wtatennis|ausopen\.com|official WTA (?:live )?feed|WTA feed/i;
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const fails = [];
const say = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };

async function open(url, w) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 } });
  await ctx.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/youtube|ytimg|doubleclick|googlevideo/i.test(m.text())) errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  if (process.env.TICKER === '0') await p.route(/tennis-api\.propbetedge\.ai\/v1\/live(\?|$)/, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ ok: true, data: [], meta: { freshness: 'CURRENT' } }) }));
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  return { ctx, p, errs };
}

for (const w of WIDTHS) {
  const { ctx, p, errs } = await open(`${BASE}/pbecast/${MATCH}`, w);
  await p.waitForSelector('.court-wrap', { timeout: 30000 }).catch(() => {});
  await p.waitForSelector('.fin', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const s = await p.evaluate(() => {
    const y = (sel) => { const el = document.querySelector(sel); if (!el || el.hidden || !el.offsetParent && el.tagName !== 'SECTION') return null; return el.getBoundingClientRect().top + scrollY; };
    const watch = document.querySelector('[data-watch-sec]');
    return {
      fin: document.querySelector('.fin')?.innerText.replace(/\s+/g, ' ') || null, finY: y('.fin'), courtY: y('.court-wrap'), marketY: y('[data-kx-history-slot] .kx-h'), watchY: watch && !watch.hidden ? y('[data-watch-sec]') : null,
      chip: document.querySelector('.wv-chip')?.textContent || null, title: document.querySelector('.wv-title')?.textContent || null, iframes: document.querySelectorAll('iframe').length,
      story: (() => { const s = document.querySelector('[data-story-sec]'); return s && !s.hidden ? s.querySelectorAll('li').length : 0; })(),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, cls: Number((window.__cls || 0).toFixed(4)), text: document.querySelector('.pbc')?.innerText || ''
    };
  });
  const bad = [];
  if (!s.fin || !/def\./.test(s.fin)) bad.push('no FINAL summary');
  if (!(s.finY < s.courtY)) bad.push('summary not above the court');
  if (!s.courtY) bad.push('replay court missing');
  if (s.marketY && !(s.marketY > s.courtY)) bad.push('market history not after the replay');
  if (s.watchY && s.marketY && !(s.watchY > s.marketY)) bad.push('watch not after the market history');
  if (s.chip && /FULL MATCH REPLAY/.test(s.chip) && !/full match/i.test(s.title || '')) bad.push(`chip ${s.chip} vs title ${s.title}`);
  if (s.iframes) bad.push('an iframe loaded before any click');
  if (s.overflow > 0) bad.push(`overflow ${s.overflow}`);
  if (s.cls > 0.1) bad.push(`CLS ${s.cls}`);
  if (errs.length) bad.push(`console: ${errs[0].slice(0, 120)}`);
  if (UPSTREAM.test(s.text)) bad.push(`upstream name: ${UPSTREAM.exec(s.text)[0]}`);
  say(!bad.length, `${w} final ${(s.fin || '').slice(0, 70)} | market=${!!s.marketY} watch=${s.chip || '-'} story=${s.story} cls=${s.cls} ${bad.join('; ')}`);
  await p.screenshot({ path: `${OUT}/final-${w}.png`, fullPage: false });
  await p.screenshot({ path: `${OUT}/final-${w}-full.png`, fullPage: true });
  if (w === 1440 && s.chip) {
    await p.click('[data-wv-play]');
    await p.waitForTimeout(1500);
    const src = await p.evaluate(() => document.querySelector('iframe.wv-frame')?.src || null);
    say(/^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{11}/.test(src || ''), `1440 click loads youtube-nocookie player: ${src}`);
  }
  await ctx.close();
}

for (const w of WIDTHS) {
  const { ctx, p, errs } = await open(`${BASE}/`, w);
  await p.waitForSelector('.lr-card', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const s = await p.evaluate(() => ({
    live: document.querySelectorAll('.lr-card[data-lr="live"]').length, finals: document.querySelectorAll('.lr-card[data-lr="final"]').length,
    replay: document.querySelectorAll('.lr-card[data-lr="final"] .hm-go-cast').length, video: [...document.querySelectorAll('.lr-video')].map((x) => x.textContent.trim()),
    market: [...document.querySelectorAll('.lr-card .kx-line, .lr-card [class*="kx-line"]')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).slice(0, 3),
    first: document.querySelector('.lr-card')?.innerText.replace(/\s+/g, ' ').slice(0, 90) || null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, cls: Number((window.__cls || 0).toFixed(4)), text: document.querySelector('[data-lr]')?.innerText || ''
  }));
  const bad = [];
  if (!s.finals) bad.push('no recent final');
  if (s.overflow > 0) bad.push(`overflow ${s.overflow}`);
  if (s.cls > 0.1) bad.push(`CLS ${s.cls}`);
  if (errs.length) bad.push(`console: ${errs[0].slice(0, 120)}`);
  if (UPSTREAM.test(s.text)) bad.push(`upstream name: ${UPSTREAM.exec(s.text)[0]}`);
  say(!bad.length, `${w} home live=${s.live} finals=${s.finals} replay=${s.replay} video=${JSON.stringify(s.video.slice(0, 3))} market=${JSON.stringify(s.market)} cls=${s.cls} ${bad.join('; ')}`);
  await p.evaluate(() => document.querySelector('[data-lr]')?.scrollIntoView({ block: 'start' }));
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/home-lr-${w}.png` });
  await ctx.close();
}
await b.close();
console.log(`${fails.length} fail(s)`);
process.exitCode = fails.length ? 1 : 0;
