#!/usr/bin/env node
// First-viewport screenshots for visual review (what a reader sees before scrolling).
//   node scripts/qa/viewports.mjs /path1 /path2 ...   -> qa-artifacts/vp-<width>-<slug>.png
import { chromium } from 'playwright-core';
const BASE = process.env.QA_BASE || 'https://tennis.propbetedge.ai';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SIZES = [[1440, 900], [1024, 768], [390, 844]];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
for (const [w, h] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  for (const p of process.argv.slice(2)) {
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `qa-artifacts/vp-${w}-${p.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.png` });
  }
  await page.close();
}
await browser.close();
console.log('viewports written');
