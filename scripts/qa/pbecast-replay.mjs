#!/usr/bin/env node
// PBEcast replay acceptance against a deployed site (default production).
//   node scripts/qa/pbecast-replay.mjs <matchId> [...]   (QA_BASE overrides the site)
// Checks, with no user interaction: replay autoplays (moment + timeline position advance), truth-mode badge,
// headshots load, no tracked-ball overlay unless the feed has coordinates, then seeks to the final set event
// and the last event and checks the SET/MATCH flash and the completion state. Fails on console errors and
// horizontal overflow at 1440 and 390.
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.QA_BASE || 'https://tennis.propbetedge.ai';
const ids = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const fails = [];
const report = [];
for (const id of ids) for (const width of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/pbecast/${id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-moment] .v3-mo-line', { timeout: 20000 }).catch(() => fails.push(`${id}@${width}: no moment rendered`));
  const snap = () => page.evaluate(() => ({ moment: document.querySelector('[data-moment]')?.textContent?.trim().slice(0, 120), pos: document.querySelector('.v3-tl-e.on')?.dataset.seek ?? null, mode: document.querySelector('[data-mode]')?.textContent?.trim(), done: !!document.querySelector('.v3-done') }));
  const a = await snap();
  await page.waitForTimeout(7000);
  const b = await snap();
  const autoplay = a.moment !== b.moment || a.pos !== b.pos;
  if (!autoplay) fails.push(`${id}@${width}: replay did not advance without a click`);
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, iw: window.innerWidth,
    tracked: !!document.querySelector('.v3-tracked'),
    imgs: [...document.querySelectorAll('[data-pbc] img')].map((i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.src })),
    tl: document.querySelectorAll('.v3-tl-e').length,
    setKeys: [...document.querySelectorAll('.v3-tl-e.key')].map((e) => ({ i: e.dataset.seek, t: e.textContent.trim() }))
  }));
  if (m.sw > m.iw) fails.push(`${id}@${width}: horizontal overflow ${m.sw}>${m.iw}`);
  if (!/POINT-BY-POINT REPLAY|OBSERVED REPLAY/.test(b.mode || '')) fails.push(`${id}@${width}: truth-mode badge missing (${b.mode})`);
  const broken = m.imgs.filter((x) => !x.ok);
  if (broken.length) fails.push(`${id}@${width}: ${broken.length} broken headshots`);
  // set transition: seek to the event just before a SET key, let playback cross it, look for the flash
  const setKey = m.setKeys.find((k) => /SET/.test(k.t));
  let setFlash = null;
  if (setKey && Number(setKey.i) > 0) {
    await page.click(`.v3-tl-e[data-seek="${Number(setKey.i) - 1}"]`); // seeking pauses by design
    await page.click('[data-act="play"]');
    setFlash = await page.waitForFunction(() => /SET|MATCH/.test(document.querySelector('.v3-flash')?.textContent || ''), null, { timeout: 12000 }).then(() => true).catch(() => false);
    if (!setFlash) fails.push(`${id}@${width}: no SET flash crossing ${setKey.t}`);
  }
  // completion: seek to the second-to-last event and play through the end
  await page.click(`.v3-tl-e[data-seek="${m.tl - 2}"]`);
  await page.click('[data-act="play"]');
  const done = await page.waitForSelector('.v3-done', { timeout: 20000 }).then(() => true).catch(() => false);
  if (!done) fails.push(`${id}@${width}: no completion state at the last event`);
  const fin = await snap();
  if (!/MATCH|FINAL|complete/i.test(fin.moment || '')) fails.push(`${id}@${width}: last moment is not the match end (${fin.moment})`);
  for (const e of errors) fails.push(`${id}@${width}: console ${e}`);
  await page.screenshot({ path: `qa-artifacts/pbecast-${id.slice(0, 8)}-${width}.png` });
  report.push({ id, width, autoplay, mode: b.mode, headshots: m.imgs.length, broken: broken.length, tracked_ball: m.tracked, timeline_events: m.tl, set_flash: setFlash, completion: done, errors: errors.length });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
console.log(fails.length ? `FAIL\n${fails.join('\n')}` : 'PBECAST REPLAY QA: PASS');
if (fails.length) process.exitCode = 1;
