#!/usr/bin/env node
// Release-standard viewport QA (docs/RELEASE.md): 1440 / 1024 / 430 / 390 / 360 / 320.
// Builds must exist (npm run build). Serves dist/ with vite preview, drives the installed Chrome via
// playwright-core, and fails on horizontal overflow, uncaught errors or console errors.
// Screenshots -> qa-artifacts/ (gitignored).

import fs from 'node:fs';
import path from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTHS = [1440, 1280, 1024, 768, 430, 390, 360, 320];
const PATHS = ['/', '/schedule', '/live', '/tournaments', '/tournaments/singapore/2026', '/players', '/players/elena-rybakina', '/players/elena-rybakina/dna', '/rankings/women', '/dna', '/pbecast', '/pbecast/4f748053-db73-5077-b7ca-e7ccfd57f7b9', '/matches/4f748053-db73-5077-b7ca-e7ccfd57f7b9', '/search?q=rybakina', '/credits', '/methodology', '/sources', '/does-not-exist'];
const OUT = path.resolve('qa-artifacts');
// QA_BASE=https://tennis.propbetedge.ai runs the matrix against production instead of a local preview.
const server = process.env.QA_BASE ? null : await preview({ preview: { port: 5195, strictPort: true } });
const base = process.env.QA_BASE || server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const failures = [];
fs.mkdirSync(OUT, { recursive: true });
try {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    for (const p of PATHS) {
      errors.length = 0;
      await page.goto(base + p, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 15000 }).catch(() => errors.push('modules still loading after 15s'));
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, h1: document.querySelector('h1')?.textContent?.trim() || '', robots: document.querySelector('meta[name="robots"]')?.content, canonical: document.querySelector('link[rel="canonical"]')?.href }));
      if (m.sw > m.iw) failures.push(`${width}px ${p}: horizontal overflow ${m.sw} > ${m.iw}`);
      if (!m.h1) failures.push(`${width}px ${p}: no h1`);
      const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && !i.src.startsWith('data:')).map((i) => i.src));
      for (const b of broken) failures.push(`${width}px ${p}: broken image ${b}`);
      for (const e of errors) failures.push(`${width}px ${p}: ${e}`);
      const name = `${width}${p.replace(/[/?=]/g, '_') || '_home'}.png`;
      if ([1440, 768, 390, 320].includes(width)) await page.screenshot({ path: path.join(OUT, name), fullPage: true });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  if (server) await new Promise((r) => server.httpServer.close(r));
}
if (failures.length) {
  console.error(`qa: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  ✖ ${f}`);
  process.exit(1);
}
console.log(`qa: OK — ${PATHS.length} routes × ${WIDTHS.length} widths, no overflow, no console errors`);
