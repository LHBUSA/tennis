#!/usr/bin/env node
// Tennis News V2 production acceptance.
//   node scripts/qa/news-v2.mjs            (QA_BASE overrides the site)
// Crawler half (raw HTML, no JS): 200, self canonical, index robots, unique title/description, complete OG +
// X meta, 1200x630 PNG share card, valid NewsArticle + BreadcrumbList JSON-LD, sitemap lists exactly the
// published stories. Browser half: no hydration noindex, every in-text/chip link points at a player in the
// story's evidence or its tournament, share links carry the canonical URL, player + tournament pages link
// back to the story, the article stays readable with images blocked.
import { chromium } from 'playwright-core';

const BASE = process.env.QA_BASE || 'https://tennis.propbetedge.ai';
const API = 'https://tennis-api.propbetedge.ai';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const j = async (u) => (await fetch(`${u}${u.includes('?') ? '&' : '?'}t=${Date.now()}`)).json();

const list = (await j(`${API}/v1/news?limit=60`)).data.articles;
ok(list.length > 0, 'no published stories');
const meta = (h, attr, key) => (h.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`)) || [])[1];
const titles = new Set();
const descs = new Set();
const report = [];
for (const a of list) {
  const url = `${BASE}/news/${a.slug}`;
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; PBE-QA crawler check)' } });
  const h = await r.text();
  const d = (await j(`${API}/v1/news/${a.slug}`)).data;
  const canon = (h.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  const title = (h.match(/<title>([^<]+)<\/title>/) || [])[1];
  const desc = meta(h, 'name', 'description');
  ok(r.status === 200, `${a.slug}: HTTP ${r.status}`);
  ok(canon === url, `${a.slug}: canonical ${canon}`);
  ok(/^index, follow/.test(meta(h, 'name', 'robots') || ''), `${a.slug}: robots ${meta(h, 'name', 'robots')}`);
  ok(title && !titles.has(title), `${a.slug}: title missing or duplicate`); titles.add(title);
  ok(desc && !descs.has(desc), `${a.slug}: description missing or duplicate`); descs.add(desc);
  const og = Object.fromEntries(['og:type', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:width', 'og:image:height', 'og:site_name'].map((k) => [k, meta(h, 'property', k)]));
  ok(og['og:type'] === 'article' && og['og:url'] === url && og['og:image:width'] === '1200' && og['og:image:height'] === '630' && og['og:site_name'] === 'PropBetEdge Tennis' && og['og:title'] && og['og:description'], `${a.slug}: OG ${JSON.stringify(og)}`);
  ok(og['og:image']?.includes(`/og/news/${a.slug}`), `${a.slug}: og:image is not article-specific (${og['og:image']})`);
  const tw = Object.fromEntries(['twitter:card', 'twitter:site', 'twitter:title', 'twitter:description', 'twitter:image'].map((k) => [k, meta(h, 'name', k)]));
  ok(tw['twitter:card'] === 'summary_large_image' && tw['twitter:site'] === '@PROPBETEDGE' && tw['twitter:image'] === og['og:image'] && tw['twitter:title'] && tw['twitter:description'], `${a.slug}: X meta ${JSON.stringify(tw)}`);
  // share card: real 1200x630 PNG
  const img = await fetch(og['og:image']);
  const buf = Buffer.from(await img.arrayBuffer());
  const w = buf.readUInt32BE(16); const hh = buf.readUInt32BE(20);
  ok(img.status === 200 && /image\/png/.test(img.headers.get('content-type') || '') && w === 1200 && hh === 630, `${a.slug}: share card ${img.status} ${w}x${hh}`);
  // JSON-LD
  let graph = [];
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { const x = JSON.parse(m[1]); graph.push(...(x['@graph'] || [x])); }
  const art = graph.find((x) => x['@type'] === 'NewsArticle');
  const bc = graph.find((x) => x['@type'] === 'BreadcrumbList');
  ok(art && art.headline && art.description && art.image?.length && art.datePublished && art.dateModified && art.author && art.publisher && art.mainEntityOfPage === url && art.articleSection && art.about?.length && art.mentions?.length, `${a.slug}: NewsArticle incomplete`);
  const people = ['A', 'B'].flatMap((s) => d.evidence?.participants?.[s]?.players || []).filter((p) => p.slug);
  const personIds = new Set(people.map((p) => `${BASE}/players/${p.slug}#person`));
  ok((art?.mentions || []).filter((x) => x['@type'] === 'Person').every((x) => personIds.has(x['@id'])), `${a.slug}: schema person not in evidence`);
  ok(bc && bc.itemListElement.map((i) => i.name).slice(0, 3).join('>') === 'PropBetEdge>Tennis>News' && bc.itemListElement.length === 4, `${a.slug}: breadcrumb ${JSON.stringify(bc?.itemListElement?.map((i) => i.name))}`);
  const org = graph.find((x) => x['@id'] === 'https://propbetedge.ai/#org');
  ok(org?.logo?.url, `${a.slug}: publisher logo missing`);
  report.push({ story: a.slug.slice(0, 44), http: r.status, card: `${w}x${hh}`, persons: (art?.mentions || []).filter((x) => x['@type'] === 'Person').length, about: art?.about?.length || 0 });
}
// sitemap: every published story + /news, nothing else under /news/
const sm = await (await fetch(`${BASE}/sitemap.xml?t=${Date.now()}`)).text();
const inMap = [...sm.matchAll(/<loc>[^<]*\/news\/([a-z0-9-]+)<\/loc>/g)].map((m) => m[1]);
ok(sm.includes(`<loc>${BASE}/news</loc>`), 'sitemap: /news missing');
ok(inMap.length === list.length && list.every((a) => inMap.includes(a.slug)), `sitemap: news urls ${inMap.length} vs published ${list.length}`);

// ---- browser half ----------------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 860 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
for (const a of list) {
  const d = (await j(`${API}/v1/news/${a.slug}`)).data;
  const slugs = new Set(['A', 'B'].flatMap((s) => d.evidence?.participants?.[s]?.players || []).map((p) => `/players/${p.slug}`));
  const t = d.evidence?.tournament || d.tournament;
  await page.goto(`${BASE}/news/${a.slug}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.nw-body', { timeout: 20000 });
  const r = await page.evaluate(() => ({
    robots: document.querySelector('meta[name="robots"]')?.content,
    ents: [...document.querySelectorAll('.nw-ent, .nwv-chip, .nwv-face')].map((x) => x.getAttribute('href')),
    share: [...document.querySelectorAll('.nwv .share a, .nwv .share button')].map((x) => x.getAttribute('href') || x.dataset.copy),
    pbecast: [...document.querySelectorAll('a[href^="/pbecast/"]')].length,
    heroImgs: [...document.querySelectorAll('.nwv-hero img')].map((i) => ({ ok: i.complete && i.naturalWidth > 0, eager: i.loading === 'eager', w: i.getAttribute('width') })),
    sw: document.documentElement.scrollWidth, iw: innerWidth
  }));
  const url = `${BASE}/news/${a.slug}`;
  ok(/^index/.test(r.robots || ''), `${a.slug}: robots after hydration ${r.robots}`);
  for (const href of r.ents) ok(slugs.has(href) || href === `/tournaments/${t?.slug}/${t?.year}`, `${a.slug}: link ${href} not an evidence entity`);
  ok(r.ents.length >= slugs.size, `${a.slug}: players not all linked`);
  ok(r.share.length === 3 && r.share[0].includes(encodeURIComponent(url)) && r.share[1].includes(encodeURIComponent(url)) && r.share[2] === url, `${a.slug}: share ${JSON.stringify(r.share)}`);
  ok(d.replay?.available ? r.pbecast > 0 : r.pbecast === 0, `${a.slug}: PBEcast links ${r.pbecast} vs replay ${JSON.stringify(d.replay)}`);
  ok(r.heroImgs.every((i) => i.ok && i.eager && i.w), `${a.slug}: hero image state ${JSON.stringify(r.heroImgs)}`);
  ok(r.sw <= r.iw, `${a.slug}: overflow at 390`);
  // cross-links back: a featured player's page and the tournament page list this story
  const first = [...slugs][0];
  await page.goto(BASE + first, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  ok(await page.evaluate((s) => !!document.querySelector(`[data-stories]:not([hidden]) a[href="/news/${s}"]`), a.slug), `${first}: no link to ${a.slug}`);
  if (t?.slug) {
    await page.goto(`${BASE}/tournaments/${t.slug}/${t.year}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    ok(await page.evaluate((s) => !!document.querySelector(`[data-stories]:not([hidden]) a[href="/news/${s}"]`), a.slug), `/tournaments/${t.slug}/${t.year}: no link to ${a.slug}`);
  }
}
// images blocked: the article still reads (headline + prose)
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx2.route('**/*.{webp,jpg,png,avif}', (r) => r.abort());
const p2 = await ctx2.newPage();
await p2.goto(`${BASE}/news/${list[0].slug}`, { waitUntil: 'networkidle' });
const blocked = await p2.evaluate(() => ({ h1: document.querySelector('h1')?.textContent?.trim(), paras: document.querySelectorAll('.nw-body p').length }));
ok(blocked.h1 && blocked.paras > 3, `images blocked: ${JSON.stringify(blocked)}`);
for (const e of errors) fails.push(`console: ${e}`);
await browser.close();
console.table(report);
console.log(fails.length ? `FAIL (${fails.length})\n${fails.join('\n')}` : `NEWS V2 QA: PASS (${list.length} stories)`);
if (fails.length) process.exitCode = 1;
