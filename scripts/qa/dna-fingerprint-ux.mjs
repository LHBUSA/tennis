#!/usr/bin/env node
// Acceptance QA for the 2026-09-30 DNA + Players UX correction, at 390 / 768 / 1440:
//   A. /players/carlos-alcaraz/dna — hero, Match DNA fingerprint radar (ATP-only wording) ABOVE the tables, PBE Rating,
//      Match DNA families, Technical DNA still "coverage building" at 17/30.
//   B. WTA parity — /players/iga-swiatek/dna + /players/aryna-sabalenka/dna, same fingerprint contract, WTA-only wording.
//   C. Homepage — DNA module has visible content at first paint (skeleton), ATP + WTA Match DNA boards fill, and with one
//      board's request aborted the other five still render.
//   D. /players, ?gender=men, ?gender=women — first player row time, with /v1/slams + /v1/men/players delayed 8 s.
// /players/:slug/dna is All Access-gated. Without a session, MOCK_DNA=1 serves an owner membership + /dna payloads
// built from the PUBLIC PBEcast contract (the same stored Match DNA v2 values, real players, real percentiles); every
// other request goes to the live API. API_PREVIEW=<version preview URL> sends API requests to an uploaded Worker version.
//   BASE=http://localhost:5194 MOCK_DNA=1 node scripts/qa/dna-fingerprint-ux.mjs   -> docs/evidence/dna-fingerprint-ux-<LABEL>.json
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { MATCH_DEFINITIONS } from '../../workers/shared/dna/match-dna.js';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:5194';
const API = 'https://tennis-api.propbetedge.ai';
const LABEL = process.env.LABEL || 'local';
const MOCK = process.env.MOCK_DNA === '1';
// API_PREVIEW=https://<version>-tennis-api.sales-fd3.workers.dev sends every API request to an uploaded, not-yet-deployed version
const PREVIEW = (process.env.API_PREVIEW || '').replace(/\/+$/, '');
const SHOTS = `qa-artifacts/dna-fingerprint-ux/${LABEL}`;
fs.mkdirSync(SHOTS, { recursive: true });

const FAMILY_LABEL = { result_strength: 'Result strength', pressure: 'Pressure', opponent_quality: 'Opponent quality' };
async function fixtureFor(slug) {
  // a completed singles match of this player that has a PBEcast (public): its dna block is the player's stored Match DNA
  const p = (await (await fetch(`${API}/v1/players/${slug}`)).json()).data;
  const pre = { carlos: 'f535855a-6463-54f7-a023-7f954d4fad72' };
  const ids = [...(slug === 'carlos-alcaraz' ? [pre.carlos] : []), ...(p.recent_matches || []).filter((m) => ['MS', 'WS'].includes(m.event_type) && m.status === 'completed').map((m) => m.id)];
  for (const id of ids) {
    const d = (await (await fetch(`${API}/v1/pbecast/${id}`)).json()).data;
    const side = d && Object.entries(d.match.sides).find(([, v]) => v.players[0]?.slug === slug)?.[0];
    const x = side && d.dna?.[side];
    if (!x?.match_dna) continue;
    const md = x.match_dna;
    const fams = new Map();
    for (const m of md.metrics) { const f = MATCH_DEFINITIONS[m.key]?.family || 'result_strength'; if (!fams.has(f)) fams.set(f, []); fams.get(f).push(m); }
    const families = [...fams].map(([key, metrics]) => ({ key, label: FAMILY_LABEL[key] || key, metrics, published: metrics.filter((m) => m.comparative_published).length }));
    const held = /(\d+) of (\d+)/.exec(x.technical?.message || '');
    // PBEcast's compact form omits last5 / longest streak, so the fixture carries no form block (never invented)
    const dna = { tour: md.tour, definition_version: 1, as_of: md.as_of, percentile_basis: `${md.tour} singles`, comparative: { published: x.technical?.status !== 'building', qualified: held ? Number(held[1]) : null, threshold: held ? Number(held[2]) : 30 }, metrics: {}, dimensions: [] };
    return { ok: true, data: { dna, match_dna: { ...md, families, form: null, profile: null, profile_definitions: {}, by_surface: [], recent: [] }, surfaces: {} }, meta: { source: ['fixture:pbecast'], fetched_at: new Date().toISOString(), freshness: 'CURRENT', semantics: 'QA fixture from the public PBEcast Match DNA contract' } };
  }
  throw new Error(`no PBEcast with Match DNA for ${slug}`);
}
const fixtures = {};
if (MOCK) for (const s of ['carlos-alcaraz', 'iga-swiatek', 'aryna-sabalenka']) fixtures[s] = await fixtureFor(s);
const CORS = { 'access-control-allow-origin': new URL(BASE).origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'accept, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const OWNER = { ok: true, membership: { contract: '1.3.0', sport: 'tennis', state: 'owner', entitled: true, label: 'OWNER', show_purchase_cta: false } };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const check = (scope, name, ok, detail = '') => { results.push({ scope, name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${scope} :: ${name}${detail ? ` — ${detail}` : ''}`); };

async function newPage(w, { abort = [], slow = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(`${API}/**`, async (route) => {
    const u = route.request().url();
    if (abort.some((a) => u.includes(a))) return route.abort();
    if (MOCK && u.includes('/v1/membership')) return route.fulfill({ json: OWNER, headers: CORS });
    const m = MOCK && /\/v1\/players\/([^/]+)\/dna$/.exec(new URL(u).pathname);
    if (m && fixtures[m[1]]) return route.fulfill({ json: fixtures[m[1]], headers: CORS });
    const s = slow.find((x) => u.includes(x));
    if (s) await new Promise((ok) => setTimeout(ok, 8000));
    // the API grants credentialed CORS only to the production origin: proxy through Playwright and re-issue CORS for BASE
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const res = await route.fetch({ url: PREVIEW ? u.replace(API, PREVIEW) : u, headers: route.request().headers() }).catch(() => null);
    if (!res) return route.abort();
    return route.fulfill({ response: res, headers: { ...res.headers(), ...CORS } });
  });
  return { ctx, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

// WIDTHS=1440 (comma list) runs a subset — one width at a time keeps memory low on a busy workstation
const WIDTHS = (process.env.WIDTHS || '390,768,1440').split(',').map(Number).filter(Boolean);
for (const w of WIDTHS) {
  // ---- A + B: player DNA pages
  for (const [slug, tour] of [['carlos-alcaraz', 'ATP'], ['iga-swiatek', 'WTA'], ['aryna-sabalenka', 'WTA']]) {
    const scope = `${w} /players/${slug}/dna`;
    const { ctx, page, errors } = await newPage(w);
    const t0 = Date.now();
    await page.goto(`${BASE}/players/${slug}/dna`, { waitUntil: 'domcontentloaded' });
    const hero = await page.waitForSelector('.ph h1', { timeout: 20000 }).then(() => Date.now() - t0).catch(() => null);
    const fp = await page.waitForSelector('[data-dna-fingerprint] ', { timeout: 20000 }).then(() => Date.now() - t0).catch(() => null);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const fpEl = document.querySelector('[data-dna-fingerprint]');
      const fam = [...document.querySelectorAll('.dna-tbl')][0];
      const svg = fpEl?.querySelector('svg.radar');
      const box = svg?.getBoundingClientRect();
      return { h1: document.querySelector('.ph h1')?.innerText, tour: fpEl?.dataset.dnaFingerprint, state: fpEl?.dataset.fpState, dims: fpEl?.dataset.fpDims, fpText: fpEl?.innerText || '', svg: !!svg, svgW: box?.width || 0, svgH: box?.height || 0, fpTop: fpEl ? fpEl.getBoundingClientRect().top + scrollY : null, famTop: fam ? fam.getBoundingClientRect().top + scrollY : null, body: document.querySelector('#main')?.innerText || document.body.innerText, h2: [...document.querySelectorAll('#main h2')].map((h) => h.innerText) };
    });
    check(scope, 'hero renders', /alcaraz|swiatek|sabalenka/i.test(r.h1 || ''), `${r.h1} @${hero}ms`);
    check(scope, 'Match DNA fingerprint radar visible', r.svg && r.state === 'published' && r.svgW > 200 && r.svgH > 200, `${r.state} ${Math.round(r.svgW)}x${Math.round(r.svgH)} @${fp}ms dims=${r.dims}`);
    check(scope, `same-tour wording (${tour} only)`, r.tour === tour && new RegExp(`compared only with ${tour} players`, 'i').test(r.fpText) && !new RegExp(`${tour === 'ATP' ? 'WTA' : 'ATP'} players`, 'i').test(r.fpText));
    check(scope, 'fingerprint above the long tables', r.fpTop != null && r.famTop != null && r.fpTop < r.famTop, `${r.fpTop} < ${r.famTop}`);
    check(scope, 'PBE Rating + Match DNA families present', r.h2.some((h) => /PBE Rating/i.test(h)) && ['Result strength', 'Pressure', 'Opponent quality'].every((f) => r.h2.some((h) => h.toLowerCase().includes(f.toLowerCase()))), r.h2.join(' | '));
    if (tour === 'ATP') check(scope, 'Technical DNA still coverage building at 17/30', /TECHNICAL DNA — COVERAGE BUILDING/i.test(r.body) && /17 of 30/.test(r.body));
    check(scope, 'no horizontal overflow', !(await overflow(page)));
    check(scope, 'no page errors', !errors.length, errors[0] || '');
    await page.screenshot({ path: `${SHOTS}/${slug}-dna-${w}.png`, fullPage: false });
    await page.locator('[data-dna-fingerprint]').screenshot({ path: `${SHOTS}/${slug}-fingerprint-${w}.png` }).catch(() => {});
    await ctx.close();
  }
  // ---- C: homepage DNA (normal, then one board aborted)
  for (const abort of [[], ['metric=match_win_rate&tour=atp']]) {
    const scope = `${w} / ${abort.length ? '(ATP match-win board aborted)' : ''}`;
    const { ctx, page, errors } = await newPage(w, { abort });
    const t0 = Date.now();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const skel = await page.waitForSelector('[data-leaders] .hm-dna-col', { timeout: 10000 }).then(() => Date.now() - t0).catch(() => null);
    const firstState = await page.evaluate(() => { const el = document.querySelector('[data-leaders]'); return { cols: el?.querySelectorAll('.hm-dna-col').length || 0, h: el?.getBoundingClientRect().height || 0, text: el?.innerText || '' }; });
    await page.waitForFunction(() => !document.querySelector('[data-leaders] [aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {});
    const done = Date.now() - t0;
    const r = await page.evaluate(() => {
      const slots = [...document.querySelectorAll('[data-dna-slot]')].map((s) => ({ k: s.dataset.dnaSlot, rows: s.querySelectorAll('ol:not(.hm-dna-skel) li').length, text: s.innerText }));
      return { slots, cols: [...document.querySelectorAll('[data-leaders] .hm-dna-col h3')].map((h) => h.innerText) };
    });
    check(scope, 'DNA module has visible columns at first paint (never an empty band)', skel != null && firstState.cols === 3 && firstState.h > 150, `${skel}ms cols=${firstState.cols} h=${Math.round(firstState.h)}`);
    check(scope, 'boards are Match DNA (PBE Rating, Match win %, Games won %)', r.cols.map((c) => c.toLowerCase()).join('|') === 'pbe rating|match win %|games won %', r.cols.join('|'));
    const filled = r.slots.filter((s) => s.rows > 0).map((s) => s.k);
    if (!abort.length) {
      check(scope, 'all 6 ATP + WTA boards show leaders', filled.length === 6, `${filled.join(',')} @${done}ms`);
      check(scope, 'ATP Match DNA visible today', r.slots.filter((s) => s.k.endsWith(':atp') && s.rows > 0).length === 3);
    } else {
      const failed = r.slots.find((s) => s.k === 'match_win_rate:atp');
      check(scope, 'one failed board does not blank the module (5 others render)', filled.length === 5 && !filled.includes('match_win_rate:atp'), filled.join(','));
      check(scope, 'failed board states itself', /unavailable/i.test(failed?.text || ''), (failed?.text || '').replace(/\s+/g, ' ').slice(0, 80));
    }
    check(scope, 'no horizontal overflow', !(await overflow(page)));
    check(scope, 'no page errors', !errors.length, errors[0] || '');
    if (!abort.length) await page.locator('#h-dna').evaluate((h) => h.closest('section').scrollIntoView()).then(() => page.locator('#h-dna').evaluate((h) => h.closest('section').getBoundingClientRect().height)).then(() => page.locator('section:has(#h-dna)').screenshot({ path: `${SHOTS}/home-dna-${w}.png` })).catch(() => {});
    await ctx.close();
  }
  // ---- C2: homepage skeleton while every board is slow (screenshot proof of the loading state)
  {
    const { ctx, page } = await newPage(w, { slow: ['/v1/dna/leaders'] });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-leaders] .hm-dna-skel', { timeout: 10000 }).catch(() => {});
    const sk = await page.evaluate(() => document.querySelectorAll('[data-leaders] .hm-dna-skel').length);
    check(`${w} / (all boards slow)`, 'skeleton visible while boards load', sk === 6, `${sk} skeleton boards`);
    await page.locator('section:has(#h-dna)').screenshot({ path: `${SHOTS}/home-dna-skeleton-${w}.png` }).catch(() => {});
    await ctx.close();
  }
  // ---- D: players directory with the enhancement requests delayed 8 s
  for (const route of ['/players', '/players?gender=men', '/players?gender=women']) {
    const scope = `${w} ${route} (slams + men/players +8 s)`;
    const { ctx, page, errors } = await newPage(w, { slow: ['/v1/slams', '/v1/men/players'] });
    const t0 = Date.now();
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    const first = await page.waitForSelector('table a[href^="/players/"]', { timeout: 20000 }).then(() => Date.now() - t0).catch(() => null);
    const r = await page.evaluate(() => ({ rows: document.querySelectorAll('main tbody tr').length, filter: !!document.querySelector('#dir-f'), search: !!document.querySelector('form.search input'), chips: [...document.querySelectorAll('.chips a')].map((a) => a.innerText) }));
    check(scope, 'first player rows before the delayed enhancements (< 5 s)', first != null && first < 5000, `${first}ms rows=${r.rows}`);
    check(scope, 'search + Men/Women/All filters present', r.search && ['All', 'Men', 'Women'].every((c) => r.chips.some((x) => x.toLowerCase() === c.toLowerCase())));
    if (route === '/players') {
      check(scope, 'initial DOM bounded (<= 100 rows)', r.rows > 0 && r.rows <= 100, `${r.rows}`);
      // both ranking lists in (the first list paints alone; the filter re-applies when the second arrives)
      await page.waitForFunction(() => !/loading the other tour/.test(document.querySelector('[data-dir-total]')?.textContent || 'loading the other tour'), null, { timeout: 15000 }).catch(() => {});
      await page.fill('#dir-f', 'swiat');
      const f = await page.evaluate(() => [...document.querySelectorAll('[data-dir-rows] tbody a')].map((a) => a.innerText));
      check(scope, 'instant name filter works', f.some((n) => /Swiatek/i.test(n)), f.slice(0, 3).join(','));
      await page.fill('#dir-f', '');
      await page.click('[data-more]');
      const more = await page.evaluate(() => document.querySelectorAll('[data-dir-rows] tbody tr').length);
      check(scope, 'show more extends the list', more > 100, `${more}`);
      await page.waitForSelector('[data-featured]:not([hidden])', { timeout: 15000 }).catch(() => {});
      check(scope, 'featured Grand Slam players load after the directory', await page.evaluate(() => !!document.querySelector('[data-featured]:not([hidden]) .men-feat li')));
    }
    if (route === '/players?gender=men') {
      await page.waitForSelector('[data-slam-perf]:not([hidden])', { timeout: 15000 }).catch(() => {});
      check(scope, 'Grand Slam performance still loads (after the ATP list)', await page.evaluate(() => !!document.querySelector('[data-slam-perf]:not([hidden]) tbody tr')));
    }
    check(scope, 'no horizontal overflow', !(await overflow(page)));
    check(scope, 'no page errors', !errors.length, errors[0] || '');
    await page.screenshot({ path: `${SHOTS}/players${route.includes('men') ? (route.includes('women') ? '-women' : '-men') : ''}-${w}.png` });
    await ctx.close();
  }
}
await browser.close();
const fail = results.filter((r) => !r.ok);
fs.writeFileSync(`docs/evidence/dna-fingerprint-ux-${LABEL}.json`, JSON.stringify({ base: BASE, mock_dna: MOCK, api: PREVIEW || 'live', at: new Date().toISOString(), pass: results.length - fail.length, fail: fail.length, results }, null, 2));
console.log(`\n${results.length - fail.length}/${results.length} PASS`);
process.exit(fail.length ? 1 : 0);
