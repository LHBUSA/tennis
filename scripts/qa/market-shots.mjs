// Screenshots of the Tennis LIVE MARKET module on real matches (local or production build). One-shot.
//   BASE=http://localhost:5207 node scripts/qa/market-shots.mjs <matchId> [...]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const BASE = (process.env.BASE || 'http://localhost:5207').replace(/\/+$/, '');
const OUT = process.env.OUT || 'qa-artifacts/market';
fs.mkdirSync(OUT, { recursive: true });
const ids = process.argv.slice(2);
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const w of [390, 1440]) for (const id of ids) for (const page of ['pbecast', 'matches']) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1100 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  if (!BASE.includes('propbetedge.ai')) await p.route(/(tennis-api\.propbetedge\.ai|propsports-markets\.sales-fd3\.workers\.dev)/, async (r) => { try { const x = await r.fetch(); await r.fulfill({ response: x, headers: { ...x.headers(), 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' } }); } catch { /* closed */ } });
  await p.goto(`${BASE}/${page}/${id}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.lm', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(800);
  const s = await p.evaluate(() => { const el = document.querySelector('.lm'); if (!el) return null; el.scrollIntoView({ block: 'center' }); return { state: el.dataset.lm, text: el.innerText.replace(/\s+/g, ' ').slice(0, 260), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${page}-${id.slice(0, 8)}-${w}.png` });
  console.log(`${w} ${page} ${id.slice(0, 8)} ${JSON.stringify(s)} ${errs.length ? 'ERR ' + errs[0].slice(0, 100) : ''}`);
  await ctx.close();
}
await b.close();
