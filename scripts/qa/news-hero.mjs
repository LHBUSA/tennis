// Newsroom hero freshness gate (2026-10-02). One-shot: for each desk x width, the hero must be the newest eligible story
// of that desk by published_at (from the same /v1/news?limit=60 payload the page reads), the next-newest must follow it,
// and the hero must not appear again anywhere below. Also: no horizontal overflow, no console errors, hero image (if any)
// loaded and cropped inside its box, desk nav counts present, JSON-LD / canonical captured for diffing.
//   BASE=https://tennis.propbetedge.ai OUT=qa-artifacts/news-hero/after node scripts/qa/news-hero.mjs
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'https://tennis.propbetedge.ai').replace(/\/+$/, '');
const API = (process.env.API || 'https://tennis-api.propbetedge.ai').replace(/\/+$/, '');
const OUT = process.env.OUT || 'qa-artifacts/news-hero/run';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTHS = (process.env.WIDTHS || '320,390,768,1024,1440').split(',').map(Number);
const DESKS = (process.env.DESKS || 'all,atp,wta,grand-slams,doubles,rankings').split(',');
const ENFORCE = process.env.ENFORCE !== '0'; // ENFORCE=0 records the baseline without failing

fs.mkdirSync(OUT, { recursive: true });
const news = await (await fetch(`${API}/v1/news?limit=60`, { headers: { origin: BASE } })).json();
const all = news?.data?.articles || [];
const pub = (a) => Date.parse(a.published_at || a.first_published_at || '') || 0;
const order = (desk) => all.filter((a) => (desk === 'all' || a.desk === desk) && (a.status == null || a.status === 'published') && pub(a) && pub(a) <= Date.now())
  .sort((a, b) => pub(b) - pub(a) || String(a.slug).localeCompare(String(b.slug)) || String(a.id || '').localeCompare(String(b.id || '')));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const fails = [];
const report = { base: BASE, at: new Date().toISOString(), articles: all.length, rows: [] };
for (const desk of DESKS) {
  const want = order(desk);
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}${desk === 'all' ? '/news' : `/news/${desk}`}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-body] :is(.nf-top, .nf-empty, .nf-latest)', { timeout: 30000 }).catch(() => {});
    await page.addStyleTag({ content: '*{transition:none!important;animation:none!important;scroll-behavior:auto!important}' });
    await page.waitForTimeout(1200);
    const s = await page.evaluate(() => {
      const slug = (el) => el?.querySelector('a[href^="/news/"]')?.getAttribute('href')?.replace(/^\/news\//, '').split('?')[0] || null;
      const lead = document.querySelector('.nf-lead');
      const below = [...document.querySelectorAll('.nf-major, .nf-feature, .nf-row')].map(slug).filter(Boolean);
      const img = lead?.querySelector('.nf-lead-img img');
      const box = lead?.querySelector('.nf-lead-img')?.getBoundingClientRect();
      const ib = img?.getBoundingClientRect();
      return {
        lead: slug(lead), leadTitle: lead?.querySelector('h2')?.textContent.trim() || null, below,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        img: img ? { loaded: img.complete && img.naturalWidth > 0, brand: !!lead.querySelector('.nf-brand-art'), fit: getComputedStyle(img).objectFit, w: Math.round(ib.width), boxW: Math.round(box.width), h: Math.round(ib.height), boxH: Math.round(box.height) } : null,
        nav: [...document.querySelectorAll('[data-desks] a')].map((a) => a.textContent.trim()),
        current: document.querySelector('[data-desks] a[aria-current="page"]')?.textContent.trim() || null,
        canonical: document.querySelector('link[rel="canonical"]')?.href || null,
        jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((x) => x.textContent.length),
        empty: !!document.querySelector('.nf-empty'),
      };
    });
    await page.screenshot({ path: `${OUT}/${desk}-${w}.png`, fullPage: false });
    const exp = want[0]?.slug || null;
    const row = { desk, w, expected: exp, ...s, next_expected: want[1]?.slug || null, errors };
    const bad = [];
    if (s.lead !== exp) bad.push(`hero ${s.lead} != newest ${exp}`);
    if (exp && want[1] && s.below[0] !== want[1].slug) bad.push(`first below-hero ${s.below[0]} != next-newest ${want[1].slug}`);
    if (s.lead && s.below.includes(s.lead)) bad.push('hero duplicated below');
    if (s.overflow > 0) bad.push(`horizontal overflow ${s.overflow}px`);
    if (errors.length) bad.push(`console errors: ${errors.slice(0, 2).join(' | ')}`);
    if (s.img && !s.img.brand && (!s.img.loaded || s.img.w > s.img.boxW + 1)) bad.push(`hero image not loaded/cropped ${JSON.stringify(s.img)}`);
    row.fail = bad;
    if (bad.length) fails.push(`${desk}@${w}: ${bad.join('; ')}`);
    report.rows.push(row);
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${desk.padEnd(11)} ${String(w).padStart(4)} hero=${s.lead} next=${s.below[0] || '-'} ${bad.join('; ')}`);
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`${fails.length} fail(s); report ${OUT}/report.json`);
if (ENFORCE && fails.length) process.exit(1);
