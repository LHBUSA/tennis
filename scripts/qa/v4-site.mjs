#!/usr/bin/env node
// Tennis V4 site QA: newsroom front + visual identity across home, /news, one article, two players, one tournament, one
// match and rankings, at 320/360/390/430/768/1024/1440, in a real browser.
//   node scripts/qa/v4-site.mjs                         -> production (https://tennis.propbetedge.ai)
//   QA_BASE=http://localhost:5194 QA_LABEL=local node scripts/qa/v4-site.mjs   (npm run build && npm run preview first)
// Checks per page x width: no horizontal overflow; WCAG AA contrast of body text over its effective backdrop; no broken
// cards or images and no SVG / fake athlete imagery in content; no duplicate news sections (and no story twice on /news);
// freshness labels (backfills show "Match <date> · Added to PropBetEdge …"); CLS < 0.1 (PerformanceObserver); basic a11y
// (landmarks, one h1, heading order, img alt, button names, focus visible). Records page heights.
// Output: qa-artifacts/v4/<label>-<page>-<width>.png, qa-artifacts/v4/results-<label>.json, docs/evidence/v4-site-latest.md
// (the report merges every results-*.json present, so a production run + a local run give a before/after table).
// Read-only: GETs public pages and the public API only.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const WEB = (process.env.QA_BASE || 'https://tennis.propbetedge.ai').replace(/\/+$/, '');
const API = (process.env.API_BASE || 'https://tennis-api.propbetedge.ai').replace(/\/+$/, '');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LABEL = process.env.QA_LABEL || (WEB.includes('localhost') || WEB.includes('127.0.0.1') ? 'local' : 'production');
const WIDTHS = (process.env.QA_WIDTHS || '320,360,390,430,768,1024,1440').split(',').map(Number);
const FULL_SHOT = new Set([390, 1440]);
const OUT = 'qa-artifacts/v4';
fs.mkdirSync(OUT, { recursive: true });

const j = async (p, tries = 3) => { try { const r = await fetch(`${API}${p}`, { headers: { accept: 'application/json' } }); return await r.json(); } catch (e) { if (tries <= 1) throw e; await new Promise((x) => setTimeout(x, 1500)); return j(p, tries - 1); } };

async function targets() {
  const [news, today] = await Promise.all([j('/v1/news?limit=60'), j('/v1/today')]);
  const arts = news?.data?.articles || [];
  const art = arts[0];
  const t = today?.data?.tournaments?.[0] || art?.tournament;
  const m = today?.data?.latest_results?.[0];
  const pages = [
    ['home', '/'],
    ['news', '/news'],
    art && ['article', `/news/${art.slug}`],
    ['player-alcaraz', '/players/carlos-alcaraz'],
    ['player-swiatek', '/players/iga-swiatek'],
    t?.slug && ['tournament', `/tournaments/${t.slug}/${t.year}`],
    m?.id && ['match', `/matches/${m.id}`],
    ['rankings', '/rankings'],
  ].filter(Boolean);
  const bySlug = Object.fromEntries(arts.map((a) => [a.slug, a]));
  return { pages, bySlug };
}

// runs in the page: every measurement is DOM-only
function measure() {
  const out = { fails: [], notes: [] };
  const fail = (k, d) => out.fails.push(`${k}: ${d}`);
  const vw = window.innerWidth;
  out.height = document.documentElement.scrollHeight;
  if (document.documentElement.scrollWidth > vw + 1) {
    const wide = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`);
    fail('overflow', `scrollWidth ${document.documentElement.scrollWidth} > ${vw} (${wide.join(', ')})`);
  }
  // ---- contrast ----
  const parse = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  // night bands are gradients: measure against their LIGHTEST point (floodlight at 14% cream over the lightest night stop)
  const BAND_WORST = over({ r: 255, g: 244, b: 205, a: 0.14 }, { r: 11, g: 51, b: 38, a: 1 });
  // effective backdrop(s) behind a text element: solid layers composite over the html paper; a gradient panel contributes
  // every colour stop (text must pass against the worst one); photo backgrounds carry their own scrim and are skipped
  const bgOf = (el) => {
    const layers = [];
    let stops = null;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        if (/url\(/.test(cs.backgroundImage) && !/gradient/.test(cs.backgroundImage)) return { skip: 'photo background' };
        if (e.matches('.hero, .hero *')) return { skip: 'photo hero (own scrim)' };
        if (e.matches('.tn-band, .nf-mast, .ph-band')) { stops = [BAND_WORST, { r: 5, g: 26, b: 20, a: 1 }]; break; }
        if (/gradient/.test(cs.backgroundImage)) {
          const cols = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse).filter((c) => c && c.a >= 0.6);
          if (cols.length) { stops = cols; break; }
        }
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      if (e.tagName === 'IMG' || e.tagName === 'PICTURE') return { skip: 'image' };
    }
    let base = { r: 246, g: 245, b: 240, a: 1 }; // html paper
    const inner = layers.reverse();
    if (stops) return { cs: stops.map((st) => inner.reduce((b, l) => over(l, b), over(st, base))) };
    for (const l of inner) base = over(l, base);
    return { cs: [base] };
  };
  const seen = new Set();
  let measured = 0; const bad = [];
  const tw = document.createTreeWalker(document.querySelector('main') || document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim()) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || cs.visibility === 'hidden' || +cs.opacity === 0 || el.closest('[hidden], [aria-hidden="true"], svg, .sr-only')) continue;
    const bg = bgOf(el);
    if (bg.skip) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const size = parseFloat(cs.fontSize); const bold = +cs.fontWeight >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const k = Math.min(...bg.cs.map((b) => ratio(over(fg, b), b)));
    measured += 1;
    if (k < need) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${n.textContent.trim().slice(0, 28)}" ${k.toFixed(2)}<${need}`);
  }
  out.contrast = { measured, failing: bad.length };
  if (bad.length) fail('contrast', bad.slice(0, 5).join(' | '));
  // ---- images ----
  const imgs = [...document.querySelectorAll('main img')];
  const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.getBoundingClientRect().width > 0 && !i.closest('[hidden]'));
  if (broken.length) fail('broken images', broken.slice(0, 3).map((i) => i.currentSrc || i.src).join(', '));
  // the only SVG allowed in content is the initials monogram (img.av.is-mono: a court-green tile with the player's
  // initials as <text>, never a drawn person); any other SVG / data-SVG image in content is fake imagery
  const src = (i) => decodeURIComponent(i.currentSrc || i.src || '');
  const isMonogram = (i) => i.matches('img.av') && /^data:image\/svg/i.test(src(i)) && /<text[\s>]/.test(src(i)) && !/<(image|ellipse|polygon)[\s>]/.test(src(i));
  const svgImgs = imgs.filter((i) => /\.svg(\?|$)|^data:image\/svg/i.test(i.currentSrc || i.src) && !i.closest('.nf-brand-art, .brand, .logo, [data-brand]'));
  const svgArt = svgImgs.filter((i) => !isMonogram(i));
  out.monograms = svgImgs.length - svgArt.length;
  out.photos = imgs.filter((i) => i.classList.contains('is-photo')).length;
  if (svgArt.length) fail('svg/fake imagery in content', svgArt.slice(0, 3).map((i) => (i.currentSrc || i.src).slice(0, 80)).join(', '));
  const noAlt = imgs.filter((i) => !i.hasAttribute('alt'));
  if (noAlt.length) fail('img without alt', `${noAlt.length}`);
  // ---- cards ----
  const cards = [...document.querySelectorAll('.nf-lead, .nf-major, .nf-row, .nf-feature, .lb-card')];
  const empty = cards.filter((c) => !c.closest('[hidden]') && !(c.querySelector('h2, h3')?.textContent || '').trim());
  if (empty.length) fail('broken cards', `${empty.length} card(s) without a headline`);
  out.cards = cards.length;
  // ---- duplicate news sections / stories ----
  const heads = [...document.querySelectorAll('main h2')].map((h) => h.textContent.trim().toLowerCase()).filter(Boolean);
  const dupH = heads.filter((h, i) => heads.indexOf(h) !== i);
  if (dupH.length) fail('duplicate sections', [...new Set(dupH)].join(', '));
  const storyLinks = [...document.querySelectorAll('main :is(h2, h3) a[href^="/news/"]')].filter((a) => !a.closest('[hidden]')).map((a) => a.getAttribute('href').split('?')[0]);
  const dupS = storyLinks.filter((h, i) => storyLinks.indexOf(h) !== i);
  if (dupS.length) fail('story shown twice', [...new Set(dupS)].slice(0, 3).join(', '));
  out.sections = heads;
  out.stories = [...new Set(storyLinks)].map((href) => { const a = document.querySelector(`main :is(h2, h3) a[href="${href}"]`); const card = a?.closest('.nf-lead, .nf-major, .nf-row, .nf-feature, article, li, div'); return { slug: href.replace('/news/', ''), clock: card?.querySelector('time')?.textContent.trim() || '', added: /Added to PropBetEdge/.test(card?.textContent || '') }; });
  // ---- a11y ----
  for (const [sel, name] of [['header, [role=banner]', 'banner'], ['main, [role=main]', 'main'], ['footer, [role=contentinfo]', 'contentinfo'], ['nav, [role=navigation]', 'navigation']]) if (!document.querySelector(sel)) fail('landmark', `missing ${name}`);
  const hs = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => h.getBoundingClientRect().height > 0 && !h.closest('[hidden], [aria-hidden="true"]'));
  const h1s = hs.filter((h) => h.tagName === 'H1').length;
  if (h1s !== 1) fail('h1', `${h1s} visible h1`);
  let prev = 0; const jumps = [];
  for (const h of hs) { const l = +h.tagName[1]; if (prev && l > prev + 1) jumps.push(`h${prev}->h${l} "${h.textContent.trim().slice(0, 24)}"`); prev = l; }
  if (jumps.length) fail('heading order', jumps.slice(0, 3).join(' | '));
  const unnamed = [...document.querySelectorAll('button, [role=button]')].filter((b) => b.getBoundingClientRect().width > 0 && !(b.getAttribute('aria-label') || b.getAttribute('aria-labelledby') || b.textContent.trim() || b.title));
  if (unnamed.length) fail('button names', `${unnamed.length} unnamed`);
  return out;
}

async function run() {
  const { pages, bySlug } = await targets();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-smooth-scrolling'] });
  const results = [];
  try {
    for (const [id, route] of pages) {
      for (const w of WIDTHS) {
        const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        const page = await ctx.newPage();
        await page.addInitScript(() => { window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; if (e.value > 0.02) (window.__shifts ||= []).push(`${e.value.toFixed(3)}@${Math.round(e.startTime)}ms ${(e.sources || []).map((x) => `${x.node?.nodeName || '?'}.${String(x.node?.className || '').split(' ')[0]} ${Math.round(x.previousRect.y)}->${Math.round(x.currentRect.y)}`).join(', ')}`); } }).observe({ type: 'layout-shift', buffered: true }); } catch {} });
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e.message || e).slice(0, 120)));
        let r;
        try {
          await page.goto(`${WEB}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForFunction(() => !document.querySelector('main .loading'), null, { timeout: 20000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(1200);
          const cls = await page.evaluate(() => window.__cls); // CLS of the load, before our own scrolling
          await page.evaluate(async () => { document.documentElement.style.scrollBehavior = 'auto'; for (let y = 0; y < document.documentElement.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((x) => setTimeout(x, 60)); } window.scrollTo(0, 0); });
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(500);
          r = await page.evaluate(measure);
          r.cls = +cls.toFixed(4);
          if (r.cls >= 0.1) r.fails.push(`cls: ${r.cls} >= 0.1 (${(await page.evaluate(() => window.__shifts || [])).slice(0, 3).join(' ; ')})`);
          // focus visible: first focusable element after a Tab has a visible outline or ring
          await page.keyboard.press('Tab');
          const focus = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return 'nothing focused'; const cs = getComputedStyle(e); return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none') ? '' : `${e.tagName.toLowerCase()} has no visible focus`; });
          if (focus) r.fails.push(`focus: ${focus}`);
          // freshness: backfilled stories carry the match date + "Added to PropBetEdge"; live stories never do
          for (const s of r.stories || []) {
            const a = bySlug[s.slug];
            if (!a) continue;
            if (a.freshness?.is_backfill && a.freshness?.event_at && !(s.clock.startsWith('Match ') && s.added)) r.fails.push(`freshness: backfill ${s.slug} shows "${s.clock}"`);
            if (!a.freshness?.is_backfill && s.added) r.fails.push(`freshness: live story ${s.slug} labelled as added later`);
          }
          if (errs.length) r.fails.push(`pageerror: ${errs.slice(0, 2).join(' | ')}`);
          await page.bringToFront();
          await page.screenshot({ path: path.join(OUT, `${LABEL}-${id}-${w}.png`), fullPage: FULL_SHOT.has(w) });
        } catch (e) {
          r = { fails: [`load: ${String(e.message || e).slice(0, 140)}`], height: null };
        }
        await ctx.close();
        const row = { page: id, route, width: w, height: r.height, cls: r.cls ?? null, contrast: r.contrast || null, cards: r.cards ?? null, photos: r.photos ?? null, monograms: r.monograms ?? null, sections: r.sections || [], fails: r.fails };
        results.push(row);
        console.log(`${row.fails.length ? 'FAIL' : 'PASS'} ${id} @${w} h=${row.height} cls=${row.cls}${row.fails.length ? ` — ${row.fails.join(' ; ')}` : ''}`);
      }
    }
  } finally {
    await browser.close();
  }
  const doc = { label: LABEL, base: WEB, at: new Date().toISOString(), results };
  fs.writeFileSync(path.join(OUT, `results-${LABEL}.json`), JSON.stringify(doc, null, 1));
  report();
  const failing = results.filter((x) => x.fails.length).length;
  console.log(`${failing ? 'FAIL' : 'PASS'} ${results.length - failing}/${results.length} page x width checks green (${LABEL})`);
  process.exitCode = failing ? 1 : 0;
}

function report() {
  const runs = fs.readdirSync(OUT).filter((f) => /^results-.+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')));
  const L = [];
  L.push('# Tennis V4 site QA — latest', '', `Generated ${new Date().toISOString()} by \`scripts/qa/v4-site.mjs\`. Screenshots: \`qa-artifacts/v4/<label>-<page>-<width>.png\` (full page at 390 and 1440).`, '');
  const newsH = (run, w) => run.results.find((x) => x.page === 'news' && x.width === w)?.height ?? '—';
  L.push('## /news page height', '', `| run | base | ${WIDTHS.map((w) => `${w}px`).join(' | ')} |`, `|---|---|${WIDTHS.map(() => '---').join('|')}|`);
  for (const run of runs) L.push(`| ${run.label} (${run.at.slice(0, 16)}Z) | ${run.base} | ${WIDTHS.map((w) => newsH(run, w)).join(' | ')} |`);
  L.push('', 'Reference: the old endless wire measured 12,459px at 1440; V3 about 5,200px.', '');
  for (const run of runs) {
    const bad = run.results.filter((x) => x.fails.length);
    L.push(`## ${run.label} — ${run.results.length - bad.length}/${run.results.length} green`, '', `Base ${run.base}, run ${run.at}.`, '');
    L.push('| page | width | height | CLS | text measured / failing AA | result |', '|---|---|---|---|---|---|');
    for (const x of run.results) L.push(`| ${x.page} | ${x.width} | ${x.height ?? '—'} | ${x.cls ?? '—'} | ${x.contrast ? `${x.contrast.measured} / ${x.contrast.failing}` : '—'} | ${x.fails.length ? x.fails.join('<br>').replace(/\|/g, '\\|') : 'PASS'} |`);
    const news = run.results.find((x) => x.page === 'news' && x.width === 1440);
    if (news) L.push('', `/news sections at 1440: ${news.sections.join(' · ') || '—'}`);
    L.push('');
  }
  fs.mkdirSync('docs/evidence', { recursive: true });
  fs.writeFileSync('docs/evidence/v4-site-latest.md', L.join('\n'));
}

if (process.argv.includes('--report-only')) report(); else run().catch((e) => { console.error(e); process.exitCode = 2; });
