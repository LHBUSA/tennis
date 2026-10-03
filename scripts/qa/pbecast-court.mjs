// PBEcast Phase 2 — event-driven live court gate (2026-10-03). One-shot, read-only.
// REAL stored matches (the same ones tests/pbecast-court.test.js replays from raw captures):
//   singles 3dd55919 (Gauff–Osorio, WTA Beijing, 7-6(4) 4-6 6-2) and doubles 238d6c36 (WTA 125 Jingshan, match tiebreak),
//   plus an ATP (game-level) payload as tennis-api serves a live ATP match today. Live cases re-serve the REAL stored
//   payload truncated at a real position with the mode set to live (deterministic UI test; NOT live acceptance).
// Proves per width: each court reaction appears exactly when the state machine says (point, advantage, break, hold,
// set, match), the break-point pressure band sits on the returner's half, game-by-game rail completeness, proven point
// dots only, doubles serving TEAM, ATP shows no point / server / pressure / dots, the stale chip, no tracked ball,
// no upstream name in the rendered page, no overflow, no console errors, CLS < 0.1.
//   BASE=http://localhost:5198 [TICKER=0] node scripts/qa/pbecast-court.mjs
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { courtReaction, gameLedger, actionRail, provenPoints, liveGranularity } from '../../src/lib/pbecast-court.js';
import { situationOf } from '../../src/lib/pbecast-feed.js';

const BASE = (process.env.BASE || 'http://localhost:5198').replace(/\/+$/, '');
const API = 'https://tennis-api.propbetedge.ai';
const WIDTHS = (process.env.WIDTHS || '390,768,1024,1440').split(',').map(Number);
const OUT = process.env.OUT || 'qa-artifacts/pbecast-court';
fs.mkdirSync(OUT, { recursive: true });
const SINGLES = '3dd55919-dd75-5c2d-9c6c-2722d367ae5e';
const DOUBLES = '238d6c36-0445-50c4-b07c-0bc349d896be';
const ATP = '934ef4d1-a78e-584e-b638-834b9a26225f';
const H = { headers: { origin: 'https://tennis.propbetedge.ai' } };
const get = async (id) => (await fetch(`${API}/v1/pbecast/${id}?cb=${Date.now()}`, H)).json();
const UPSTREAM = /ESPN|wtatennis|ausopen|official WTA (?:live )?feed|WTA feed|Australian Open (?:feed|match cent)/i;

const pay = { [SINGLES]: await get(SINGLES), [DOUBLES]: await get(DOUBLES) };
const atpBase = await get(ATP);
const atpLive = { ...atpBase, data: { ...atpBase.data, mode: 'observed_live', live_granularity: 'game', events: [], moments: [], match: { ...atpBase.data.match, status: 'in_progress', winner_side: null, live: null, sets: [{ A: 6, B: 3, tb: null }, { A: 4, B: 3, tb: null }] } } };
for (const [id, p] of Object.entries(pay)) if (!p?.data?.events?.length) throw new Error(`no stored events for ${id}`);

// positions from the state machine itself (what the page must show at each)
function positions(d) {
  const m = d.match; const evs = d.events;
  const rx = evs.map((_, i) => courtReaction(evs, i, { match: m, granularity: liveGranularity(d), name: (s) => s }));
  const first = (k) => rx.findIndex((x, i) => i > 1 && x?.kind === k);
  const bp = evs.findIndex((e) => situationOf(e.state, m.format)?.kind === 'break_point');
  return { rx, point: first('point'), advantage: first('advantage'), break: first('break'), hold: first('hold'), set: first('set'), match: rx.length - 1, bp };
}
const P = { [SINGLES]: positions(pay[SINGLES].data), [DOUBLES]: positions(pay[DOUBLES].data) };

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const fails = [];
const say = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };

async function open(w, id, { serve = null, t = null } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 } });
  await ctx.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.route(`${API}/**`, async (r) => {
    const u = new URL(r.request().url());
    const cors = { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' };
    if (u.pathname === '/v1/membership') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, membership: { sport: 'tennis', state: 'free', entitled: false } }) });
    if (u.pathname === `/v1/pbecast/${id}` && serve) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify(serve) });
    // TICKER=0 isolates the court from the live-matches ticker (a pre-existing late insertion above the stage when other
    // matches are live: production measured CLS 0.138 from it on 2026-10-03, unrelated to the court)
    if (process.env.TICKER === '0' && u.pathname === '/v1/live') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, data: [], meta: { freshness: 'CURRENT' } }) });
    try { const x = await r.fetch(); return await r.fulfill({ response: x, headers: { ...x.headers(), ...cors } }); } catch { /* closed */ }
  });
  await p.goto(`${BASE}/pbecast/${id}${t ? `?t=${t}` : ''}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.court-wrap', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);
  return { ctx, p, errs };
}
const look = (p) => p.evaluate(() => ({
  banner: document.querySelector('.court-banner')?.textContent.trim() || null,
  react: [...document.querySelectorAll('.court .c-react')].map((x) => x.getAttribute('class')),
  pressure: document.querySelectorAll('.court .c-pressure').length,
  last: document.querySelectorAll('.court .c-last').length,
  srv: document.querySelectorAll('.court .c-srv').length,
  ball: document.querySelectorAll('.court .c-ball, .court .c-trail, [data-kind="tracked"]').length,
  key: [...document.querySelectorAll('.court-key')].map((x) => x.textContent.trim()).join(' | '),
  gran: document.querySelector('.pbc-gran')?.textContent.trim() || null,
  rail: document.querySelectorAll('.gr .gr-i:not(.gr-now)').length,
  railTop: document.querySelector('.gr .gr-i:not(.gr-now) .gr-sc')?.textContent.trim() || null,
  now: document.querySelector('.gr-now')?.textContent.replace(/\s+/g, ' ').trim() || null,
  dots: document.querySelectorAll('.gr-pt').length,
  stale: (() => { const s = document.querySelector('[data-stale]'); return s && !s.hidden ? s.textContent : null; })(),
  pos: document.querySelector('.v3-pos')?.textContent || null,
  text: document.querySelector('.pbc')?.innerText || '',
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  cls: Number((window.__cls || 0).toFixed(4))
}));
const close = async ({ ctx, p }) => { await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.close(); };
const hygiene = (s, errs, tag) => {
  const bad = [];
  if (s.overflow > 0) bad.push(`overflow ${s.overflow}`);
  if (s.cls > 0.1) bad.push(`CLS ${s.cls}`);
  if (errs.length) bad.push(`console: ${errs[0].slice(0, 100)}`);
  if (s.ball) bad.push('tracked ball / trail drawn');
  if (UPSTREAM.test(s.text)) bad.push(`upstream name in page: ${UPSTREAM.exec(s.text)[0]}`);
  return bad.length ? `${tag}: ${bad.join('; ')}` : null;
};

const LABEL = { point: /^POINT · /, advantage: /^ADVANTAGE · /, break: /^BREAK · /, hold: /^HOLD · /, set: /^SET · /, match: /^MATCH · / };
for (const w of WIDTHS) {
  // A. replay: step INTO each real transition with Next (animated paint) and check the court's reaction
  for (const id of [SINGLES, DOUBLES]) {
    const d = pay[id].data; const pos = P[id];
    for (const kind of ['point', 'advantage', 'break', 'hold', 'set', 'match']) {
      const i = pos[kind];
      if (i < 1) { if (id === SINGLES && kind !== 'advantage') say(false, `${w} ${kind}: no real position found`); continue; }
      const o = await open(w, id, { t: d.events[i - 1].event_id });
      await o.p.click('[data-act="next"]').catch(() => {});
      await o.p.waitForTimeout(350);
      const s = await look(o.p);
      const want = pos.rx[i];
      const ok = LABEL[kind].test(s.banner || '') && s.pos?.startsWith(`${i + 1}/`) && (want.side ? s.react.some((c) => c.includes(`k-${want.kind}`)) : true);
      say(ok, `${w} ${id === SINGLES ? 'singles' : 'doubles'} ${kind.padEnd(9)} #${i} banner="${s.banner}" react=${s.react.join(',') || '-'}`);
      const h = hygiene(s, o.errs, `${w} ${kind}`); if (h) say(false, h);
      if (kind === 'break' && (w === 390 || w === 1440)) await o.p.screenshot({ path: `${OUT}/${id === SINGLES ? 'singles' : 'doubles'}-break-${w}.png` });
      await close(o);
    }
    // break-point pressure band on the returner's half, while the break point is the observed state
    if (pos.bp > 0) {
      const o = await open(w, id, { t: d.events[pos.bp].event_id });
      const s = await look(o.p);
      say(s.pressure === 1, `${w} ${id === SINGLES ? 'singles' : 'doubles'} pressure band at #${pos.bp}: ${s.pressure}`);
      await close(o);
    }
  }

  // B. live (real stored prefix served as live): rail completeness, proven dots only, doubles team, stale chip
  for (const id of [SINGLES, DOUBLES]) {
    const d = pay[id].data;
    const cut = Math.floor(d.events.length * 0.55);
    const evs = d.events.slice(0, cut + 1).map((e, k, a) => (k === a.length - 1 ? { ...e, observed_at: new Date(Date.now() - 6 * 60e3).toISOString() } : e));
    const served = { ...pay[id], data: { ...d, mode: 'observed_live', events: evs, match: { ...d.match, status: 'in_progress', winner_side: null } } };
    const o = await open(w, id, { serve: served });
    await o.p.waitForTimeout(600);
    const s = await look(o.p);
    const ledger = gameLedger(evs, cut);
    const railWant = Math.min(10, actionRail(ledger, 10).length);
    const dotsWant = provenPoints(evs, cut, d.match).length;
    const bad = [];
    if (s.rail !== railWant) bad.push(`rail ${s.rail} != ${railWant}`);
    const lastG = ledger.filter((g) => g.kind === 'game').at(-1);
    if (lastG && s.railTop !== `${lastG.after.A}–${lastG.after.B}`) bad.push(`rail top ${s.railTop} != ${lastG.after.A}–${lastG.after.B}`);
    if (s.dots !== dotsWant) bad.push(`dots ${s.dots} != proven ${dotsWant}`);
    if (!/Point-level live/.test(s.gran || '')) bad.push(`granularity chip ${s.gran}`);
    if (!/No new observation for 6 min/.test(s.stale || '')) bad.push(`stale chip ${s.stale}`);
    if (id === DOUBLES && !/Serving team/.test(s.key)) bad.push(`doubles key ${s.key}`);
    const h = hygiene(s, o.errs, 'live'); if (h) bad.push(h);
    say(!bad.length, `${w} live ${id === SINGLES ? 'singles' : 'doubles'} rail=${s.rail} dots=${s.dots} gran="${s.gran}" stale="${(s.stale || '').slice(0, 30)}" ${bad.join('; ')}`);
    if (w === 390 || w === 1440) await o.p.screenshot({ path: `${OUT}/live-${id === SINGLES ? 'singles' : 'doubles'}-${w}.png` });
    if (w === 1440 || w === 390) await o.p.screenshot({ path: `${OUT}/live-${id === SINGLES ? 'singles' : 'doubles'}-${w}-full.png`, fullPage: true });
    await close(o);
  }

  // C. ATP game level (as tennis-api serves a live ATP match today): no point, no server, no pressure, no dots
  {
    const o = await open(w, ATP, { serve: atpLive });
    const s = await look(o.p);
    const bad = [];
    if (!/Game-level live/.test(s.gran || '')) bad.push(`granularity chip ${s.gran}`);
    if (s.srv) bad.push('serve marker on game level');
    if (/Serve indicator|Serving team/.test(s.key)) bad.push(`serve key ${s.key}`);
    if (s.pressure) bad.push('pressure band on game level');
    if (s.dots) bad.push('point dots on game level');
    const h = hygiene(s, o.errs, 'atp'); if (h) bad.push(h);
    say(!bad.length, `${w} ATP game-level gran="${s.gran}" key="${s.key}" ${bad.join('; ')}`);
    if (w === 390 || w === 1440) await o.p.screenshot({ path: `${OUT}/atp-game-level-${w}.png` });
    await close(o);
  }
}
await b.close();
console.log(`${fails.length} fail(s)`);
process.exitCode = fails.length ? 1 : 0;
