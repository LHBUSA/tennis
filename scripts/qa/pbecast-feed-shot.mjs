// PBEcast point feed + live state card gate (2026-10-02). One-shot, real data.
//   BASE=https://tennis.propbetedge.ai LIVE=<live match id> REPLAY=<finished observed match id> node scripts/qa/pbecast-feed-shot.mjs
// LIVE: feed rows render (no "observed ×N"), state card callout, OBSERVED badge kept, no point reasons/speeds for
// observed rows, no overflow, no console errors, full-timeline toggle reveals rows. REPLAY: Next / Prev move exactly
// one stored event; the highlighted feed row, the position counter and the scoreboard follow it. Shots at 390 + 1440.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'http://localhost:5197').replace(/\/+$/, '');
const LIVE = process.env.LIVE || process.env.ID || '';
const REPLAY = process.env.REPLAY || '';
const OUT = process.env.OUT || 'qa-artifacts/pbecast-feed';
const WIDTHS = (process.env.WIDTHS || '390,768,1024,1440').split(',').map(Number);
const SHOTS = new Set((process.env.SHOTS || '390,1440').split(',').map(Number));
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const fails = [];
const BAD = /\b(ace|double fault|unforced|forced error|km\/h|mph|rally|serve speed)\b|observed ×/i;

async function open(id, w) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  if (BASE.includes('localhost')) await p.route('https://tennis-api.propbetedge.ai/**', async (r) => { try { const x = await r.fetch(); await r.fulfill({ response: x, headers: { ...x.headers(), 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' } }); } catch { /* closed */ } });
  await p.goto(`${BASE}/pbecast/${id}${id === REPLAY ? '?t=0' : ''}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.pf .pf-i', { timeout: 30000 }).catch(() => {});
  await p.addStyleTag({ content: '*{transition:none!important;animation:none!important}' });
  await p.waitForTimeout(1200);
  return { ctx, p, errs };
}
const state = (p) => p.evaluate(() => ({
  rows: document.querySelectorAll('.pf-i').length, groups: document.querySelectorAll('.pf-g').length,
  on: document.querySelector('.pf-i.on button')?.dataset.seek ?? null, pos: document.querySelector('.v3-pos')?.textContent || null,
  call: document.querySelector('.lsc-call, .v3-mo-tag')?.textContent?.trim() || null, score: document.querySelector('[data-score]')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) || '',
  text: [...document.querySelectorAll('.pf-line, .lsc-last')].map((x) => x.textContent).join(' | '),
  more: document.querySelector('.pf-more')?.dataset.act || null, badge: /OBSERVED/i.test(document.querySelector('[data-mode]')?.textContent || ''),
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));

for (const w of WIDTHS) {
  if (LIVE) {
    const { ctx, p, errs } = await open(LIVE, w);
    const s = await state(p);
    const bad = [];
    if (!s.rows) bad.push('no feed rows');
    if (BAD.test(s.text)) bad.push(`forbidden wording: ${s.text.match(BAD)[0]}`);
    if (!s.call) bad.push('no state callout');
    if (!s.badge) bad.push('observed badge missing');
    if (s.overflow > 0) bad.push(`overflow ${s.overflow}`);
    if (errs.length) bad.push(`console: ${errs[0].slice(0, 120)}`);
    if (s.more === 'feed-all') { await p.click('.pf-more'); await p.waitForTimeout(400); const t = await state(p); if (t.rows <= s.rows) bad.push('full timeline toggle did not reveal rows'); }
    if (SHOTS.has(w)) { await p.locator('.v3-rail').screenshot({ path: `${OUT}/live-rail-${w}.png` }).catch(() => {}); await p.screenshot({ path: `${OUT}/live-page-${w}.png` }).catch(() => {}); }
    console.log(`${bad.length ? 'FAIL' : 'ok  '} live   ${String(w).padStart(4)} rows=${s.rows} groups=${s.groups} call="${s.call}" ${bad.join('; ')}`);
    if (bad.length) fails.push(`live@${w}: ${bad.join('; ')}`);
    await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.close();
  }
  if (REPLAY) {
    const { ctx, p, errs } = await open(REPLAY, w);
    const bad = [];
    const s0 = await state(p);
    const steps = [];
    for (let i = 0; i < 6; i += 1) { await p.click('[data-act="next"]'); await p.waitForTimeout(250); steps.push(await state(p)); }
    await p.click('[data-act="prev"]'); await p.waitForTimeout(250);
    const back = await state(p);
    const ons = [s0, ...steps].map((x) => Number(x.on));
    for (let i = 1; i < ons.length; i += 1) if (ons[i] !== ons[i - 1] + 1) bad.push(`next moved ${ons[i - 1]} -> ${ons[i]}`);
    if (Number(back.on) !== ons.at(-1) - 1) bad.push(`prev moved ${ons.at(-1)} -> ${back.on}`);
    if ([s0, ...steps].some((x, i, a) => i && x.pos === a[i - 1].pos)) bad.push('position counter did not advance');
    if (new Set(steps.map((x) => x.score)).size < 2) bad.push('scoreboard did not follow replay');
    if (BAD.test(steps.map((x) => x.text).join(' '))) bad.push('forbidden wording in replay');
    if (s0.overflow > 0) bad.push(`overflow ${s0.overflow}`);
    if (errs.length) bad.push(`console: ${errs[0].slice(0, 120)}`);
    if (SHOTS.has(w)) await p.locator('.v3-rail').screenshot({ path: `${OUT}/replay-rail-${w}.png` }).catch(() => {});
    console.log(`${bad.length ? 'FAIL' : 'ok  '} replay ${String(w).padStart(4)} on=${ons.join(',')} back=${back.on} call="${steps.at(-1)?.call}" ${bad.join('; ')}`);
    if (bad.length) fails.push(`replay@${w}: ${bad.join('; ')}`);
    await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.close();
  }
}
await b.close();
console.log(`${fails.length} fail(s)`);
process.exitCode = fails.length ? 1 : 0;
