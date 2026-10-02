// Tour-aware live state gate (2026-10-02). One-shot. For each scenario (only WTA live, only ATP live, both, neither,
// one tour with no upcoming match, doubles-only) x width, the homepage status row and the PBEcast top state must list
// BOTH tours with the right text; no horizontal overflow, no console errors, CLS recorded.
//   Local build (scenarios mocked from the live /v1/today):  BASE=http://localhost:5197 node scripts/qa/tour-state.mjs
//   Production, real data only (no mocks):                  BASE=https://tennis.propbetedge.ai REAL=1 node scripts/qa/tour-state.mjs
// /v1/today and /v1/live are replaced per scenario; every other API call passes through to production.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'http://localhost:5197').replace(/\/+$/, '');
const API = 'https://tennis-api.propbetedge.ai';
const OUT = process.env.OUT || 'qa-artifacts/tour-state';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTHS = (process.env.WIDTHS || '390,768,1024,1440').split(',').map(Number);
const REAL = process.env.REAL === '1';
const SHOTS = new Set((process.env.SHOTS || '390,1440').split(',').map(Number));
fs.mkdirSync(OUT, { recursive: true });

const today = await (await fetch(`${API}/v1/today`, { headers: { origin: BASE } })).json();
const now = Date.now();
const fam = (m) => (m.tour === 'atp' ? 'atp' : String(m.tour || '').startsWith('wta') ? 'wta' : null);
const future = (m) => m.status === 'scheduled' && /T\d{2}:\d{2}/.test(m.scheduled_at || '') && Date.parse(m.scheduled_at) > now;
const up = today.data.upcoming;
const pick = (tour, ev, n) => up.filter((m) => fam(m) === tour && (!ev || ev.test(m.event_type))).slice(0, n).map((m) => ({ ...m, status: 'in_progress' }));
const realLive = today.data.live;
const wtaLive = realLive.filter((m) => fam(m) === 'wta').length ? realLive.filter((m) => fam(m) === 'wta') : pick('wta', /S$/, 1);
const SCEN = REAL ? { real: { live: realLive, upcoming: up } } : {
  wta_only: { live: wtaLive, upcoming: up, expect: { atp: 0, wta: wtaLive.length } },
  atp_only: { live: [...pick('atp', /MS/, 2), ...pick('atp', /MD/, 1)], upcoming: up.filter((m) => fam(m) !== 'atp' || future(m)), expect: { atp: 3, wta: 0 } },
  both: { live: [...wtaLive, ...pick('atp', /MS/, 1)], upcoming: up, expect: { atp: 1, wta: wtaLive.length } },
  neither: { live: [], upcoming: up, expect: { atp: 0, wta: 0 } },
  atp_no_window: { live: [], upcoming: up.filter((m) => fam(m) !== 'atp'), expect: { atp: 0, wta: 0 }, atpNone: true },
  doubles_only: { live: pick('wta', /WD/, 2), upcoming: up, expect: { atp: 0, wta: 2 }, doubles: true },
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const fails = [];
const rows = [];
const ONLY = process.env.SCEN ? new Set(process.env.SCEN.split(',')) : null;
const PATHS = (process.env.PATHS || '/,/pbecast').split(',');
const WAIT = Number(process.env.WAIT || 30000);
for (const [name, sc] of Object.entries(SCEN)) {
  if (ONLY && !ONLY.has(name)) continue;
  for (const w of WIDTHS) {
    for (const path of PATHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(() => {
        window.__cls = 0; window.__shifts = [];
        const d = (n) => (n ? `${n.tagName?.toLowerCase() || '#text'}${n.className && typeof n.className === 'string' ? `.${n.className.split(' ')[0]}` : ''}${n.dataset ? Object.keys(n.dataset).map((k) => `[data-${k}]`).join('') : ''}` : '?');
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push({ v: Number(e.value.toFixed(4)), t: Math.round(e.startTime), src: (e.sources || []).map((s) => `${d(s.node)} ${Math.round(s.previousRect.y)}->${Math.round(s.currentRect.y)}`).slice(0, 4) }); } }).observe({ type: 'layout-shift', buffered: true });
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      if (!REAL) await page.route(`${API}/**`, async (route) => {
        const u = new URL(route.request().url());
        const origin = route.request().headers().origin || BASE;
        const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' };
        if (u.pathname === '/v1/today') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ...today, data: { ...today.data, live: sc.live, upcoming: sc.upcoming } }) });
        if (u.pathname === '/v1/live') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ...today, data: sc.live.map(({ tour, ...m }) => m) }) });
        try {
          const r = await route.fetch();
          return await route.fulfill({ response: r, headers: { ...r.headers(), ...cors } });
        } catch { /* context closed mid-flight */ }
      });
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      const sel = path === '/' ? '.hm-tours li.hm-tour .hm-tour-t:not(:empty)' : '.ts .ts-n:not(:empty)';
      await page.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => !/Checking|…/.test(e.textContent)), sel, { timeout: WAIT }).catch(() => {});
      await page.waitForTimeout(1500);
      const s = await page.evaluate((home) => {
        const box = home ? document.querySelector('.hm-tours') : document.querySelector('.ts');
        const tours = home ? [...document.querySelectorAll('.hm-tours .hm-tour')].map((li) => ({ tour: li.dataset.tour, text: li.textContent.replace(/\s+/g, ' ').trim() }))
          : [...document.querySelectorAll('.ts-live .ts-row')].map((li) => ({ tour: li.dataset.tour, text: li.textContent.replace(/\s+/g, ' ').trim() }));
        const next = home ? [] : [...document.querySelectorAll('.ts-next .ts-tour')].map((li) => ({ tour: li.dataset.tour, text: li.textContent.replace(/\s+/g, ' ').trim() }));
        const r = box?.getBoundingClientRect();
        return { url: location.pathname, tours, next, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, boxOverflow: box ? box.scrollWidth - box.clientWidth : null, boxH: r ? Math.round(r.height) : null, cls: Number((window.__cls || 0).toFixed(4)), shifts: (window.__shifts || []).filter((x) => x.v >= 0.01) };
      }, path === '/');
      if (SHOTS.has(w)) {
        const el = path === '/' ? page.locator('.hm-status') : page.locator('.ts').first();
        await el.screenshot({ path: `${OUT}/${name}-${path === '/' ? 'home' : 'pbecast'}-${w}.png` }).catch(() => {});
        await page.screenshot({ path: `${OUT}/${name}-${path === '/' ? 'home' : 'pbecast'}-${w}-page.png` }).catch(() => {});
      }
      const bad = [];
      const by = Object.fromEntries(s.tours.map((t) => [t.tour, t.text]));
      if (!by.atp || !by.wta) bad.push(`tour rows ${JSON.stringify(Object.keys(by))} (need atp+wta)`);
      if (sc.expect) for (const t of ['atp', 'wta']) {
        const n = sc.expect[t];
        const T = t.toUpperCase();
        const ok = path === '/' ? (n ? new RegExp(`${n} match(es)? live`).test(by[t] || '') : new RegExp(`No ${T} matches live · (next at|no scheduled match in current window)`).test(by[t] || ''))
          : new RegExp(`×${n}`).test(by[t] || '');
        if (!ok) bad.push(`${t} text "${by[t]}" (expected ${n} live)`);
      }
      if (sc.atpNone && path === '/' && !/no scheduled match in current window/.test(by.atp || '')) bad.push('atp should say no scheduled match in window');
      if (sc.atpNone && path !== '/' && !/No scheduled match in current window/.test(s.next.find((x) => x.tour === 'atp')?.text || '')) bad.push('pbecast atp up next should say none in window');
      if (sc.doubles && !/2 doubles/.test(by.wta || '') && path === '/') bad.push('doubles split missing');
      if (s.overflow > 0) bad.push(`page overflow ${s.overflow}px`);
      if (s.boxOverflow > 1) bad.push(`tour box overflow ${s.boxOverflow}px`);
      if (errors.length) bad.push(`console: ${errors.slice(0, 2).join(' | ').slice(0, 200)}`);
      if (s.cls > 0.1) bad.push(`CLS ${s.cls}`);
      if (bad.length) fails.push(`${name} ${path} @${w}: ${bad.join('; ')}`);
      rows.push({ name, path, w, ...s, errors, fail: bad });
      console.log(`${bad.length ? 'FAIL' : 'ok  '} ${name.padEnd(13)} ${(path === '/' ? 'home' : s.url.slice(0, 18)).padEnd(18)} ${String(w).padStart(4)} cls=${s.cls} h=${s.boxH} | ${s.tours.map((t) => t.text).join(' || ').slice(0, 120)} ${bad.join('; ')}`);
      await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
      await ctx.close();
    }
  }
}
await browser.close();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ base: BASE, real: REAL, at: new Date().toISOString(), rows }, null, 2));
console.log(`${fails.length} fail(s) of ${rows.length}; ${OUT}/report.json`);
process.exitCode = fails.length ? 1 : 0;
