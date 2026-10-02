// Matchup Intelligence V2 UI gate (2026-10-02). One-shot.
// ENTITLED (mocked membership + real-data payloads from scripts/qa/matchup-v2-mock.mjs): /matchups/:id renders the
// dossier — hero probability equals the payload, why-stack separates MODEL / supporting / counterpoint, edge map, DNA
// face-off with samples, collision (or its honest unavailable state), validation; no overflow, no console errors;
// player links go to /players/:slug/dna. FREE: /matches/:id shows the teaser with NO premium numbers.
//   BASE=http://localhost:5197 IDS=<id>,<id> node scripts/qa/matchup-v2.mjs
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'http://localhost:5197').replace(/\/+$/, '');
const API = 'https://tennis-api.propbetedge.ai';
const IDS = (process.env.IDS || 'd54c6504-7fc1-5048-980a-6613cd15c383,1a65428f-9e66-5571-9919-3014827ada29').split(',');
const WIDTHS = (process.env.WIDTHS || '390,768,1024,1440,1920').split(',').map(Number);
const OUT = process.env.OUT || 'qa-artifacts/matchup-v2';
const SHOTS = new Set((process.env.SHOTS || '390,1440').split(',').map(Number));
fs.mkdirSync(OUT, { recursive: true });
const mock = (id) => JSON.parse(fs.readFileSync(`${OUT}/mock-${id}.json`, 'utf8'));
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const fails = [];

async function open(path, w, entitled, id) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.route(`${API}/**`, async (r) => {
    const u = new URL(r.request().url());
    const cors = { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' };
    if (u.pathname === '/v1/membership') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, membership: entitled ? { sport: 'tennis', state: 'all_access', entitled: true, access_source: 'qa_mock' } : { sport: 'tennis', state: 'free', entitled: false } }) });
    if (u.pathname === `/v1/matchups/${id}`) return entitled ? r.fulfill({ status: 200, headers: cors, body: JSON.stringify(mock(id)) }) : r.fulfill({ status: 401, headers: cors, body: JSON.stringify({ ok: false, error: 'membership_required' }) });
    try { const x = await r.fetch(); return await r.fulfill({ response: x, headers: { ...x.headers(), ...cors } }); } catch { /* closed */ }
  });
  await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  return { ctx, p, errs };
}

for (const id of IDS) {
  const d = mock(id).data;
  const pa = Math.round(d.model.probability.A * 1000) / 10;
  for (const w of WIDTHS) {
    // entitled dossier
    { const { ctx, p, errs } = await open(`/matchups/${id}`, w, true, id);
      await p.waitForSelector('.mx-hero', { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(800);
      const s = await p.evaluate(() => ({
        prob: document.querySelector('.mx-prob')?.textContent.replace(/\s+/g, ''), why: [...document.querySelectorAll('.mx-why-c h3')].map((x) => x.textContent),
        model: [...document.querySelectorAll('.mx-why-c.k-model li')].map((x) => x.textContent.trim()), edges: document.querySelectorAll('.mx-edge-l li').length,
        rows: document.querySelectorAll('.mx-row').length, samples: [...document.querySelectorAll('.mx-row .mx-v small')].every((x) => /(match|matches) · (medium|high)/.test(x.textContent)),
        col: document.querySelector('.mx-col')?.textContent.includes('Not available') ? 'unavailable' : document.querySelectorAll('.mx-col-s li').length,
        valid: !!document.querySelector('.mx-valid .mx-vg'), links: [...document.querySelectorAll('.mx-hero a[href^="/players/"]')].map((a) => a.getAttribute('href')),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, banned: /\b(clutch|fatigue|jet.?lag|tired)\b/i.test(document.body.innerText)
      }));
      const bad = [];
      if (!s.prob?.startsWith(`${pa}%`)) bad.push(`probability ${s.prob} != ${pa}%`);
      if (s.why.join('|') !== 'Model|Supporting context|Counterpoint') bad.push(`why stack ${s.why}`);
      if (s.edges !== 7) bad.push(`edge map ${s.edges}`);
      if (s.rows !== d.intel.faceoff.rows.length) bad.push(`face-off rows ${s.rows}`);
      if (!s.samples) bad.push('a face-off value lacks sample/confidence');
      if (d.intel.collision.available ? !(s.col > 0) : s.col !== 'unavailable') bad.push(`collision ${s.col}`);
      if (!s.valid) bad.push('validation block missing');
      if (!s.links.every((h) => /^\/players\/[a-z0-9-]+\/dna$/.test(h)) || !s.links.length) bad.push(`player links ${s.links}`);
      if (s.overflow > 0) bad.push(`overflow ${s.overflow}`);
      if (s.banned) bad.push('banned wording (clutch/fatigue/jet lag)');
      if (errs.length) bad.push(`console: ${errs[0].slice(0, 120)}`);
      if (SHOTS.has(w)) await p.screenshot({ path: `${OUT}/dossier-${id.slice(0, 8)}-${w}.png`, fullPage: true }).catch(() => {});
      console.log(`${bad.length ? 'FAIL' : 'ok  '} dossier ${id.slice(0, 8)} ${String(w).padStart(4)} prob=${s.prob} model=${JSON.stringify(s.model)} rows=${s.rows} col=${s.col} ${bad.join('; ')}`);
      if (bad.length) fails.push(`${id}@${w} dossier: ${bad.join('; ')}`);
      await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.close(); }
    // match page: entitled module + free teaser
    for (const entitled of [true, false]) {
      const { ctx, p, errs } = await open(`/matches/${id}`, w, entitled, id);
      await p.waitForSelector('.mi-mod', { timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(600);
      const s = await p.evaluate(() => ({ mi: document.querySelector('.mi-mod')?.textContent.replace(/\s+/g, ' ').trim() || null, beforeStats: (() => { const mi = document.querySelector('.mi-mod'); const st = [...document.querySelectorAll('.mod-h h2')].find((h) => /Match statistics/.test(h.textContent)); return !st || (mi && (mi.compareDocumentPosition(st) & Node.DOCUMENT_POSITION_FOLLOWING)); })(), research: /research-only/.test(document.body.innerText), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      const bad = [];
      if (!s.mi) bad.push('no matchup module');
      else if (entitled && !s.mi.includes(`${pa}%`)) bad.push(`entitled module lacks ${pa}%`);
      else if (!entitled && /\d+(\.\d)?%/.test(s.mi)) bad.push('free teaser leaks a percentage');
      if (!s.beforeStats) bad.push('module not before statistics');
      if (s.research) bad.push('"research-only" text still present');
      if (s.overflow > 0) bad.push(`overflow ${s.overflow}`);
      if (errs.length) bad.push(`console: ${errs[0].slice(0, 120)}`);
      if (SHOTS.has(w) && w === 390) await p.screenshot({ path: `${OUT}/match-${entitled ? 'entitled' : 'free'}-${id.slice(0, 8)}-${w}.png` }).catch(() => {});
      console.log(`${bad.length ? 'FAIL' : 'ok  '} match   ${id.slice(0, 8)} ${String(w).padStart(4)} ${entitled ? 'entitled' : 'free    '} "${(s.mi || '').slice(0, 80)}" ${bad.join('; ')}`);
      if (bad.length) fails.push(`${id}@${w} match ${entitled ? 'entitled' : 'free'}: ${bad.join('; ')}`);
      await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.close();
    }
  }
}
await b.close();
console.log(`${fails.length} fail(s)`);
process.exitCode = fails.length ? 1 : 0;
