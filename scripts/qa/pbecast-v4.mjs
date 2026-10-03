// PBEcast Broadcast V4 gate (2026-10-02). One-shot.
// Cases: POINT (real Australian Open point events, replay), OBSERVED (real WTA observations, replay), SNAPSHOT (an ESPN
// ATP match as tennis-api serves it live with no stored observations: game-level only). ENTITLED adds the compact
// pre-match panel (mocked membership + frozen matchup payload); FREE shows the teaser with no numbers.
// Proves per width: hero present; snapshot shows no server / no point score / no point feed / no break-point table;
// point mode shows source reasons; feed seek exact; [ and ] jump real game boundaries; reduced motion; player DNA
// links; no overflow; no console errors; CLS < 0.1.
//   BASE=http://localhost:5198 node scripts/qa/pbecast-v4.mjs
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'http://localhost:5198').replace(/\/+$/, '');
const API = 'https://tennis-api.propbetedge.ai';
const WIDTHS = (process.env.WIDTHS || '390,768,1024,1440,1920').split(',').map(Number);
const OUT = process.env.OUT || 'qa-artifacts/pbecast-v4';
const SHOTS = new Set((process.env.SHOTS || '390,1440,1920').split(',').map(Number));
fs.mkdirSync(OUT, { recursive: true });
const POINT = '86f126b1-58aa-5140-9451-977d0493dd01';  // Alcaraz–Zverev, AO point events
const OBS = '87bcb521-171b-530f-a515-fd22acc12d6a';    // Ruzic–Kostovic, observed WTA
const SNAP = '934ef4d1-a78e-584e-b638-834b9a26225f';   // Fils–Tiafoe, ESPN
const H = { headers: { origin: 'https://tennis.propbetedge.ai' } };
const snapBase = await (await fetch(`${API}/v1/pbecast/${SNAP}`, H)).json();
// exactly what /v1/pbecast serves for an in-progress ESPN match with no stored observations (v2.js: observed_live, [])
const snapLive = { ...snapBase, data: { ...snapBase.data, mode: 'observed_live', events: [], moments: [], match: { ...snapBase.data.match, status: 'in_progress', winner_side: null, live: null, sets: [{ A: 6, B: 3, tb: null }, { A: 4, B: 3, tb: null }] } } };
const frozenMatchup = { ok: true, meta: { freshness: 'CURRENT' }, data: { model: { status: 'published', probability: { A: 0.512, B: 0.488 } }, pre_match: { frozen: true, frozen_at: '2026-10-02T22:00:00.000Z' }, current: { status: 'in_progress' }, intel: { edge_map: { version: 'edge-map/1', categories: [{ key: 'overall', label: 'Overall', edge: 'A' }, { key: 'form', label: 'Form', edge: 'B' }, { key: 'serve', label: 'Serve', edge: 'insufficient' }] } } } };

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const fails = [];
async function open(id, w, { entitled = false, reduced = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.route(`${API}/**`, async (r) => {
    const u = new URL(r.request().url());
    const cors = { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' };
    if (u.pathname === '/v1/membership') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, membership: entitled ? { sport: 'tennis', state: 'all_access', entitled: true } : { sport: 'tennis', state: 'free', entitled: false } }) });
    if (u.pathname === `/v1/pbecast/${SNAP}`) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify(snapLive) });
    if (/^\/v1\/matchups\/[0-9a-f-]{36}$/.test(u.pathname)) return entitled ? r.fulfill({ status: 200, headers: cors, body: JSON.stringify(frozenMatchup) }) : r.fulfill({ status: 401, headers: cors, body: '{"ok":false,"error":"membership_required"}' });
    try { const x = await r.fetch(); return await r.fulfill({ response: x, headers: { ...x.headers(), ...cors } }); } catch { /* closed */ }
  });
  await p.goto(`${BASE}/pbecast/${id}${id === SNAP ? '' : '?t='}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.v4h', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);
  return { ctx, p, errs };
}
const state = (p) => p.evaluate(() => ({
  hero: !!document.querySelector('.v4h'), srv: !!document.querySelector('.v4h-srv'), pt: document.querySelector('.v4h-pt')?.textContent.trim() || null, tag: document.querySelector('.v4h-tag')?.textContent || null,
  feed: document.querySelectorAll('.pf-i').length, note: document.querySelector('[data-recent] .pf-note')?.textContent || '', bp: !!document.querySelector('.v4-bp'), bpNote: document.querySelector('[data-pressure]')?.textContent || '',
  pos: document.querySelector('.v3-pos')?.textContent || null, pm: document.querySelector('[data-pm-sec]:not([hidden])')?.textContent.replace(/\s+/g, ' ') || null,
  links: [...document.querySelectorAll('.pbc a.pl-dna')].map((a) => a.getAttribute('href')), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, cls: Number((window.__cls || 0).toFixed(4)),
  anim: getComputedStyle(document.querySelector('.v3-pid') || document.body).animationName
}));

for (const w of WIDTHS) {
  for (const [label, id, opts] of [['point', POINT, {}], ['observed', OBS, { entitled: true }], ['snapshot', SNAP, { entitled: false }]]) {
    const { ctx, p, errs } = await open(id, w, opts);
    const s = await state(p);
    const bad = [];
    if (!s.hero) bad.push('no hero');
    if (label === 'snapshot') {
      if (s.srv) bad.push('server shown on a game-level source');
      if (s.pt && /\d/.test(s.pt)) bad.push(`point score shown: ${s.pt}`);
      if (s.feed) bad.push(`point feed rows on snapshot: ${s.feed}`);
      if (!/Game-level live/.test(s.note)) bad.push('snapshot feed note missing');
      if (s.bp) bad.push('break-point table on snapshot');
      if (!s.pm || /\d+(\.\d)?%/.test(s.pm)) bad.push('free teaser missing or leaks numbers');
    } else {
      if (!s.feed) bad.push('no feed rows');
      if (!s.bp) bad.push('no break-point table');
      if (label === 'point' && !s.tag) bad.push('no source point reason on the hero');
      if (label === 'observed' && !/frozen before play/.test(s.pm || '') ) bad.push(`entitled pre-match panel ${s.pm}`);
      if (label === 'observed' && !/51\.2%/.test(s.pm || '')) bad.push('frozen probability not shown');
    }
    if (!s.links.length || !s.links.every((h) => /^\/players\/[a-z0-9-]+\/dna$/.test(h))) bad.push('player DNA links');
    if (s.overflow > 0) bad.push(`overflow ${s.overflow}`);
    if (s.cls > 0.1) bad.push(`CLS ${s.cls}`);
    if (errs.length) bad.push(`console: ${errs[0].slice(0, 120)}`);
    // feed seek exact + keyboard game jumps (replays)
    if (label !== 'snapshot' && w === 1440) {
      const k = await p.evaluate(() => { const bs = [...document.querySelectorAll('.pf-i button[data-seek]')]; return bs.length > 2 ? Number(bs[2].dataset.seek) : null; });
      if (k != null) { await p.click(`.pf-i button[data-seek="${k}"]`); await p.waitForTimeout(250); const pos = await p.evaluate(() => document.querySelector('.v3-pos')?.textContent); if (pos?.split('/')[0] !== String(k + 1)) bad.push(`feed seek ${k} -> ${pos}`); }
      await p.evaluate(() => document.activeElement?.blur());
      const before = await p.evaluate(() => Number(document.querySelector('.v3-pos')?.textContent.split('/')[0]));
      await p.keyboard.press(']'); await p.waitForTimeout(250);
      const after = await p.evaluate(() => Number(document.querySelector('.v3-pos')?.textContent.split('/')[0]));
      await p.keyboard.press('['); await p.waitForTimeout(250);
      const back = await p.evaluate(() => Number(document.querySelector('.v3-pos')?.textContent.split('/')[0]));
      if (!(after > before) || !(back < after)) bad.push(`keyboard game jump ${before} -> ${after} -> ${back}`);
    }
    if (SHOTS.has(w)) await p.screenshot({ path: `${OUT}/${label}-${w}.png`, fullPage: false }).catch(() => {});
    if (w === 1920 && label !== 'snapshot') {
      await p.keyboard.press('f'); await p.waitForTimeout(500);
      const fs1 = await p.evaluate(() => !!document.fullscreenElement || !!document.querySelector('.pbc.is-fs'));
      if (!fs1) bad.push('fullscreen did not engage');
      await p.screenshot({ path: `${OUT}/${label}-fullscreen-1920.png` }).catch(() => {});
    }
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${label.padEnd(8)} ${String(w).padStart(4)} pt=${s.pt} feed=${s.feed} bp=${s.bp} cls=${s.cls} pm=${(s.pm || '-').slice(0, 50)} ${bad.join('; ')}`);
    if (bad.length) fails.push(`${label}@${w}: ${bad.join('; ')}`);
    await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.close();
  }
}
// reduced motion
{ const { ctx, p } = await open(POINT, 390, { reduced: true }); const s = await state(p); if (s.anim !== 'none') fails.push(`reduced motion: animation ${s.anim}`); console.log(`${s.anim === 'none' ? 'ok  ' : 'FAIL'} reduced-motion animation=${s.anim}`); await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.close(); }
await b.close();
console.log(`${fails.length} fail(s)`);
process.exitCode = fails.length ? 1 : 0;
