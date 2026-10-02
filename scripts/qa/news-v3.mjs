#!/usr/bin/env node
// Newsroom V3 UI gate (docs/NEWSROOM_V3.md, owner brief §27-28). Production by default.
//   node scripts/qa/news-v3.mjs            QA_BASE=http://localhost:5194 API_BASE=... WIDTHS=390,1440 SHOTS=0
// Pages: /news, /news/atp, /news/wta, /news/doubles, /news/rankings + every published article, at
// 320/360/390/430/768/1024/1440. Fails on: horizontal overflow, giant blank hero, broken images, stretched low-res
// images, an identical card wall, lead not visibly larger than majors (1440), unreadable wire at 320, article measure
// over ~75ch, a rail that crushes the article (<600px at 1440), Source & Method collapsed or hidden (owner 2026-10-02: always open), unresolved player /
// tournament links, wrong share links, SVG mock media in editorial slots, console errors.
// Screenshots -> qa-artifacts/news-v3/ ; heading report -> docs/evidence/news-v3-ui-latest.md
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = (process.env.QA_BASE || 'https://tennis.propbetedge.ai').replace(/\/$/, '');
const API = (process.env.API_BASE || 'https://tennis-api.propbetedge.ai').replace(/\/$/, '');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTHS = (process.env.WIDTHS || '320,360,390,430,768,1024,1440').split(',').map(Number);
const SHOTS = process.env.SHOTS !== '0';
const OUT = 'qa-artifacts/news-v3';
const DESKS = ['/news', '/news/atp', '/news/wta', '/news/doubles', '/news/rankings'];
fs.mkdirSync(OUT, { recursive: true });

const j = async (p) => { try { const r = await fetch(`${API}${p}`); return r.ok ? r.json() : null; } catch { return null; } };
const list = (await j('/v1/news?limit=60'))?.data?.articles || [];
const details = [];
for (const a of list) { const d = (await j(`/v1/news/${a.slug}`))?.data; if (d) details.push(d); }
const richness = (d) => (d.sections?.length || 0) + ((d.plan?.modules || []).find((m) => m.id === 'charts')?.data?.charts?.length || 0) * 2 + (d.glance?.length || 0) + (d.intelligence ? 3 : 0);
const byRich = [...details].sort((a, b) => richness(b) - richness(a));
const rich = byRich[0]?.slug || null;
const thin = byRich.at(-1)?.slug || null;
const ARTICLES = details.map((d) => `/news/${d.slug}`);
// V3 backfills (API freshness.is_backfill): their cards and article meta must show the EVENT date, never publication-relative time
const BACKFILL = details.filter((d) => d.freshness?.is_backfill).map((d) => d.slug);

const fails = [];
const rows = [];
const report = [];
const linkSet = new Set();
let histChecked = 0;
const fail = (w, path, msg) => fails.push(`${w}px ${path}: ${msg}`);

const browser = await chromium.launch({ executablePath: CHROME });
for (const w of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/google|gtag|favicon/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  // failed requests are attributed by URL (Chrome's console line does not name it); QA_ALLOW_MISSING_LIVE=1 tolerates
  // only a 404 from /v1/news/live (local runs before the engine deploys it) — never in production acceptance
  const badRes = [];
  page.on('response', (res) => { if (res.status() >= 400 && !/google|favicon/i.test(res.url())) badRes.push(`${res.status()} ${res.url().replace(/\?.*$/, '')}`); });
  for (const path of [...DESKS, ...ARTICLES]) {
    errs.length = 0;
    badRes.length = 0;
    await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('.loading') && (document.querySelector('.nf-body, .nwm, .nw-empty, .nf-empty') !== null), null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(1200);
    const r = await page.evaluate((isArticle) => {
      const px = (el, prop) => parseFloat(getComputedStyle(el)[prop]) || 0;
      const imgs = [...document.querySelectorAll('#main img')];
      const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src);
      const stretched = imgs.filter((i) => { const b = i.getBoundingClientRect(); return i.naturalWidth > 0 && b.width >= 200 && getComputedStyle(i).objectFit !== 'contain' && b.width / i.naturalWidth > 1.6; }).map((i) => `${Math.round(i.getBoundingClientRect().width)}/${i.naturalWidth} ${i.currentSrc || i.src}`);
      const heroes = [...document.querySelectorAll('.nwm-hero, .nf-lead-img, .nf-band-hero, .nf-feature-img, .nf-major-img')];
      const blankHero = heroes.filter((h) => h.getBoundingClientRect().height > 250 && ![...h.querySelectorAll('img')].some((i) => i.naturalWidth > 0) && !h.innerText.trim()).length;
      const svgMock = heroes.reduce((n, h) => n + h.querySelectorAll('svg').length, 0);
      const cardRun = (() => { let best = 0, run = 0; for (const el of document.querySelectorAll('#main article')) { run = el.classList.contains('nw-card') ? run + 1 : 0; best = Math.max(best, run); } return best; })();
      const lead = document.querySelector('.nf-lead h2');
      const major = document.querySelector('.nf-major h3');
      const leadBox = document.querySelector('.nf-top-lead')?.getBoundingClientRect().width || 0;
      const majBox = document.querySelector('.nf-top-majors')?.getBoundingClientRect().width || 0;
      const wireH = [...document.querySelectorAll('.nf-w-h')];
      const bodyP = [...document.querySelectorAll('.nw-body > section > p')];
      const measure = bodyP.length ? Math.max(...bodyP.map((p) => p.getBoundingClientRect().width / (px(p, 'fontSize') * 0.5))) : 0;
      const art = document.querySelector('.nwm-art');
      const share = [...document.querySelectorAll('#main .share a[href]')].map((a) => a.getAttribute('href'));
      const links = [...document.querySelectorAll('#main a[href^="/players/"], #main a[href^="/tournaments/"]')].map((a) => a.getAttribute('href'));
      return {
        sw: document.documentElement.scrollWidth, iw: innerWidth, broken, stretched, blankHero, svgMock, cardRun,
        leadPx: lead ? px(lead, 'fontSize') : 0, majorPx: major ? px(major, 'fontSize') : 0, leadBox, majBox,
        wireVisible: [...document.querySelectorAll('.nf-wire-list > .nf-w')].filter((e) => e.offsetParent !== null).length,
        wire: wireH.length, wireMinPx: wireH.length ? Math.min(...wireH.map((e) => px(e, 'fontSize'))) : 0,
        measure, artW: art ? art.getBoundingClientRect().width : 0, details: (() => { const m = document.querySelector('.nf-method'); return !!m && !m.closest('details:not([open])') && m.getClientRects().length > 0 && /packet|composer/i.test(m.innerText); })(),
        share, links, url: location.href.split('?')[0], isArticle,
        h1: [...document.querySelectorAll('#main h1')].map((h) => h.textContent.trim()),
        h2: [...document.querySelectorAll('#main h2')].map((h) => h.textContent.trim().replace(/\s+/g, ' ')).slice(0, 30),
        h3: [...document.querySelectorAll('#main h3')].map((h) => h.textContent.trim().replace(/\s+/g, ' ')).slice(0, 20)
      };
    }, path.split('/').length > 2 && !DESKS.includes(path));
    const clocks = await page.evaluate(([bf, here]) => {
      const out = [];
      let hist = 0;
      for (const a of document.querySelectorAll('#main a[href^="/news/"]')) {
        const slug = a.getAttribute('href').split('/')[2];
        if (!bf.includes(slug) || slug === here) continue;
        const box = a.closest('article, li') || a.parentElement;
        const t = box?.querySelector('time');
        if (!t) continue;
        hist += 1;
        const txt = t.textContent.trim();
        if (/ago|just now/i.test(txt) || !/^Match /.test(txt)) out.push(`${slug}: "${txt}"`);
      }
      if (bf.includes(here)) {
        const t = document.querySelector('.nwm-meta time');
        hist += 1;
        if (!t || !/^Match /.test(t.textContent.trim())) out.push(`article meta: "${t?.textContent.trim() || 'none'}"`);
      }
      return { hist, bad: [...new Set(out)] };
    }, [BACKFILL, path.split('/')[2] || '']);
    histChecked += clocks.hist;
    const bad = [];
    if (clocks.bad.length) bad.push(`backfilled story shown as fresh: ${clocks.bad.slice(0, 3).join(' | ')}`);
    if (r.sw > r.iw) bad.push(`overflow ${r.sw}>${r.iw}`);
    // the wire shows a bounded window (14 desktop / 8 phone) until 'Show more': a CSS rule must never un-hide the rest
    if (r.wireVisible > (w < 768 ? 8 : 14)) bad.push(`wire shows ${r.wireVisible} rows before 'Show more' (max ${w < 768 ? 8 : 14})`);
    if (r.broken.length) bad.push(`broken images ${r.broken.slice(0, 2).join(' ')}`);
    if (r.stretched.length) bad.push(`stretched low-res image ${r.stretched.slice(0, 2).join(' ')}`);
    if (r.blankHero) bad.push(`${r.blankHero} giant blank hero`);
    if (r.svgMock) bad.push(`${r.svgMock} SVG in editorial media slots`);
    if (r.cardRun > 6) bad.push(`identical card wall (${r.cardRun} tiles in a row)`);
    if (w === 1440 && r.leadPx && r.majorPx && (r.leadPx < r.majorPx * 1.4 || r.leadBox < r.majBox * 1.5)) bad.push(`lead not dominant (font ${r.leadPx}/${r.majorPx}, width ${Math.round(r.leadBox)}/${Math.round(r.majBox)})`);
    if (w === 320 && r.wire && r.wireMinPx < 14) bad.push(`wire text too small at 320 (${r.wireMinPx}px)`);
    if (r.isArticle) {
      if (r.measure > 80) bad.push(`article measure ~${Math.round(r.measure)}ch`);
      if (w === 1440 && r.artW < 600) bad.push(`rail crushes article (${Math.round(r.artW)}px)`);
      if (!r.details) bad.push('Source & Method is not visible without a click (with packet/composer versions)');
      const enc = encodeURIComponent(r.url.replace(BASE, 'https://tennis.propbetedge.ai'));
      if (r.share.length && !r.share.some((h) => h.includes(enc) || h.includes(r.url.replace(BASE, 'https://tennis.propbetedge.ai')))) bad.push('share links do not carry the canonical story URL');
    }
    const res = badRes.filter((x) => !(process.env.QA_ALLOW_MISSING_LIVE === '1' && /^404 .*\/v1\/news\/live$/.test(x)));
    if (res.length) bad.push(`failed requests: ${[...new Set(res)].slice(0, 3).join(' | ')}`);
    const cons = errs.filter((e) => !/^Failed to load resource/.test(e));
    if (cons.length) bad.push(`console: ${cons.slice(0, 2).join(' | ')}`);
    for (const l of r.links) linkSet.add(l);
    for (const b of bad) fail(w, path, b);
    rows.push({ w, path, ok: bad.length ? 'FAIL' : 'ok' });
    const shotName = { '/news': 'news-front', '/news/atp': 'atp-desk', '/news/wta': 'wta-desk' }[path] || (path === `/news/${rich}` ? 'article-rich' : path === `/news/${thin}` ? 'article-limited' : null);
    const wanted = SHOTS && shotName && ((shotName === 'news-front' && [390, 1440].includes(w)) || (['atp-desk', 'wta-desk', 'article-limited'].includes(shotName) && w === 1440) || (shotName === 'article-rich' && [390, 1440].includes(w)));
    if (wanted) {
      const file = `${OUT}/${shotName}-${w}.png`;
      await page.screenshot({ path: file, fullPage: true });
      report.push({ title: `${shotName} @${w}px`, path, file, h1: r.h1, h2: r.h2, h3: r.h3 });
    }
  }
  await page.close();
}
await browser.close();

// player / tournament links resolve through the API (the site renders them from the same data)
const toApi = (h) => { let m = /^\/players\/([a-z0-9-]+)(?:\/dna)?$/.exec(h); if (m) return `/v1/players/${m[1]}`; m = /^\/tournaments\/([a-z0-9-]+)\/(\d{4})/.exec(h); return m ? `/v1/tournaments/${m[1]}/${m[2]}` : null; };
const checks = [...new Set([...linkSet].map(toApi).filter(Boolean))].slice(0, 80);
let unresolved = 0;
for (const p of checks) { const r = await j(p); if (!r?.data) { unresolved += 1; fails.push(`link does not resolve: ${p}`); } }

const md = [`# Newsroom V3 UI — ${new Date().toISOString()}`, '', `Base ${BASE} · API ${API} · widths ${WIDTHS.join(', ')} · pages ${DESKS.length + ARTICLES.length} · checks ${rows.length} · links checked ${checks.length} (${unresolved} unresolved)`, '',
  `Richest article: ${rich || '—'} · limited-evidence article: ${thin || '—'}`, '',
  ...report.flatMap((x) => [`## ${x.title} — ${x.path}`, `- screenshot: ${x.file}`, `- H1: ${x.h1.join(' | ') || '—'}`, `- H2: ${x.h2.join(' | ') || '—'}`, `- H3: ${x.h3.join(' | ') || '—'}`, '']),
  `## Result`, fails.length ? fails.map((f) => `- ${f}`).join('\n') : 'PASS — no failures'];
fs.mkdirSync('docs/evidence', { recursive: true });
fs.writeFileSync('docs/evidence/news-v3-ui-latest.md', md.join('\n') + '\n');
console.log(`pages ${DESKS.length + ARTICLES.length} x widths ${WIDTHS.length} = ${rows.length} checks; links ${checks.length}`);
console.log(fails.length ? `NEWS V3 UI: FAIL (${fails.length})\n${fails.slice(0, 60).join('\n')}` : `NEWS V3 UI: PASS (${rows.length} page x width checks; ${histChecked} backfilled-story clocks verified; ${BACKFILL.length} backfill articles)`);
process.exitCode = fails.length ? 1 : 0;
