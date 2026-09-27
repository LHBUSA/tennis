#!/usr/bin/env node
// Production QA for the men's directory repair (2026-09-27): /players, /players?gender=men|women, /men,
// /rankings, /rankings/men and 5 men's canonical profiles at desktop + mobile. Fails on: an error module, the
// false empty copy, horizontal overflow, console errors, broken images. -> docs/evidence/men-directory-qa-latest.json
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'https://tennis.propbetedge.ai';
const api = await (await fetch('https://tennis-api.propbetedge.ai/v1/men/players?qa=1')).json();
const slugs = api.data.ranking.rows.filter((r) => r.player).slice(0, 5).map((r) => `/players/${r.player.slug}`);
const routes = ['/players', '/players?gender=men', '/players?gender=women', '/men', '/rankings', '/rankings/men', ...slugs];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const out = [];
for (const [w, h] of [[1440, 900], [390, 844]]) {
  for (const r of routes) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    const t0 = Date.now();
    await page.goto(BASE + r, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 20000 }).catch(() => {});
    const res = await page.evaluate(() => ({
      text: document.body.innerText,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).length,
      rows: document.querySelectorAll('table.tbl tbody tr').length,
      h1: document.querySelector('h1')?.innerText || ''
    }));
    const fails = [];
    if (/No men.s players stored yet/.test(res.text)) fails.push('false_empty_copy');
    if (/Could not load|could not be loaded|canonical store read failed/i.test(res.text)) fails.push('error_state');
    if (res.overflow) fails.push('horizontal_overflow');
    if (res.broken) fails.push(`broken_images:${res.broken}`);
    if (errors.length) fails.push(`console:${errors[0]}`);
    if (/official ATP (ranking|list)/i.test(res.text) && !/not an official ATP/i.test(res.text) && !/official ATP rank(ing)? feeds? (are|is) not/i.test(res.text)) fails.push('official_atp_claim');
    out.push({ route: r, width: w, ms: Date.now() - t0, h1: res.h1, table_rows: res.rows, result: fails.length ? 'FAIL' : 'PASS', fails });
    console.log(`${fails.length ? 'FAIL' : 'PASS'} ${w} ${r} rows=${res.rows} h1="${res.h1}" ${fails.join(',')}`);
    await page.close();
  }
}
await browser.close();
const doc = { checked_at: new Date().toISOString(), base: BASE, result: out.every((o) => o.result === 'PASS') ? 'PASS' : 'FAIL', checks: out };
fs.writeFileSync('docs/evidence/men-directory-qa-latest.json', `${JSON.stringify(doc, null, 2)}\n`);
console.log(`men directory QA: ${doc.result}`);
if (doc.result !== 'PASS') process.exitCode = 1;
