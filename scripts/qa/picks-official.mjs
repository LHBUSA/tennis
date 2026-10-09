// OFFICIAL PBE PICKS UI gate (tennis#14). One-shot browser QA of /pbe-picks and /track-record on a local build.
// MEMBERSHIP IS SIMULATED (no entitled session exists for QA): the member /v1/picks payload is built through the REAL ledger
// code (picker.js / picker-v2-atp.js / picks-api.js) in memory with times relative to the real cutover — never a verified
// production access test. The public /track-record payload is the REAL one from PREVIEW (a tennis-api preview version on
// real R2), with fixture official results merged in so the settled-official layout is exercised too.
//   BASE=http://localhost:5197 PREVIEW=https://<version>-tennis-api.sales-fd3.workers.dev node scripts/qa/picks-official.mjs
// Checks at 320 / 390 / 768 / 1024 / 1440 / 1920: no page-level horizontal scroll, no nested horizontally-scrolling element,
// nothing clipped (no element wider than the viewport), no console errors, never left on "Loading…", the selection card
// carries player vs player, probability, lock time, reason and a named PBEcast link; guests get the gate and never request
// /v1/picks; the tour filter works; a failed read shows the error with a retry. Screenshots at 390 and 1440.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { PICKS_ACTIVATED_AT } from '../../workers/tennis-api/src/picker.js';
import { freezeOne } from '../../workers/tennis-api/src/matchup-freeze.js';
import { decideMatch } from '../../workers/tennis-api/src/picker-ledger.js';
import { decideShadowMatch, gradeShadowMatch, readShadowLedger, OFFICIAL_STREAM } from '../../workers/tennis-api/src/picker-v2-atp.js';
import { picksRoute } from '../../workers/tennis-api/src/picks-api.js';

const BASE = (process.env.BASE || 'http://localhost:5197').replace(/\/+$/, '');
const API = 'https://tennis-api.propbetedge.ai';
const PREVIEW = (process.env.PREVIEW || API).replace(/\/+$/, '');
const WIDTHS = (process.env.WIDTHS || '320,390,768,1024,1440,1920').split(',').map(Number);
const OUT = process.env.OUT || 'E:/Workers/scratch/qa-picks-official';
fs.mkdirSync(OUT, { recursive: true });

function memBucket() {
  const m = new Map();
  return { m, async list({ prefix }) { return { objects: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false }; },
    async head(k) { return m.has(k) ? {} : null; }, async get(k) { return m.has(k) ? { text: async () => m.get(k) } : null; },
    async put(k, v, o = {}) { if (m.has(k) && o.onlyIf) return null; m.set(k, v); return {}; } };
}
const T = Date.parse(PICKS_ACTIVATED_AT);
const at = (ms) => new Date(T + ms).toISOString();
const H = 3600e3;
const bench = async () => ({ ok: true, json: async () => ({ at_forecast: [] }) });
const P = (id, name, slug) => ({ players: [{ id, name, slug }] });
async function fixture() {
  const b = memBucket();
  const mk = (id, ev, level, slug, start, a, bb) => ({ id, event_type: ev, status: 'scheduled', round: 'R16', scheduled_at: at(start), schedule_day: null, tournament: { slug, level }, sides: { A: P(`${id}-a`, a, null), B: P(`${id}-b`, bb, null) } });
  const dos = (m, pA) => ({ as_of: '2026-10-09', tour: m.event_type === 'MS' ? 'ATP' : 'WTA', matchup_version: '1.1.0', fixture: 'upcoming', match: m, why: [`${m.sides.A.players[0].name} is rated 140 PBE Rating points above ${m.sides.B.players[0].name}.`], model: { status: 'published', probability: { A: pA, B: 1 - pA }, overall_probability: { A: pA, B: 1 - pA }, basis: 'overall', ratings: { A: { value: 1910, rated_matches: 90 }, B: { value: 1770, rated_matches: 70 } } } });
  const ms = [
    mk('00000000-0000-5000-8000-0000000000a1', 'MS', null, 'rolex-shanghai-masters-2026', 5 * H, 'Alexandros Konstantinopoulos-Vasilakis', 'Fixture Opponent B'),
    mk('00000000-0000-5000-8000-0000000000b1', 'WS', 'WTA 1000', 'china-open-2026', 6 * H, 'Fixture Player W', 'Fixture Player X'),
    mk('00000000-0000-5000-8000-0000000000a2', 'MS', null, 'rolex-shanghai-masters-2026', 3 * H, 'Fixture Settled A', 'Fixture Settled B'),
    mk('00000000-0000-5000-8000-0000000000a3', 'MS', null, 'rolex-shanghai-masters-2026', 3 * H, 'Fixture Settled C', 'Fixture Settled D'),
  ];
  for (const [m, p] of [[ms[0], 0.81], [ms[1], 0.66], [ms[2], 0.7], [ms[3], 0.62]]) await freezeOne(b, dos(m, p), { now: at(-H) });
  await decideShadowMatch({ bucket: b, match: ms[0], now: at(4 * H + 60e3), fetchImpl: bench, stream: OFFICIAL_STREAM });
  await decideMatch({ bucket: b, match: ms[1], now: at(5 * H + 60e3), fetchImpl: bench });
  for (const m of [ms[2], ms[3]]) await decideShadowMatch({ bucket: b, match: m, now: at(2 * H + 60e3), fetchImpl: bench, stream: OFFICIAL_STREAM });
  const off = await readShadowLedger(b, { stream: OFFICIAL_STREAM });
  for (const [m, w] of [[ms[2], 'A'], [ms[3], 'B']]) {
    const r = off.find((x) => x.record.canonical_event_id === m.id).record;
    await gradeShadowMatch({ bucket: b, record: r, match: { status: 'completed', winner_side: w, started_at: at(3 * H), score: '6-4 3-6 7-5' }, now: at(6 * H), fetchImpl: bench, stream: OFFICIAL_STREAM });
  }
  return { member: await picksRoute('/v1/picks', null, { TENNIS_SOURCE: b }), pub: await picksRoute('/v1/picks/track-record', null, { TENNIS_SOURCE: b }) };
}
const fx = await fixture();
const real = await (await fetch(`${PREVIEW}/v1/picks/track-record`)).json();
// schedule facts (no sides) from the real preview payload, so the waiting state is exercised with real lanes
const member = { ...fx.member, data: { ...fx.member.data, upcoming_locks: real.data.upcoming_locks } };
const memberWaiting = { ...member, data: { ...member.data, picks: member.data.picks.filter((p) => p.grade) } };
const publicTr = { ...real, data: { ...real.data, official: fx.pub.data.official, resolved: [...fx.pub.data.resolved, ...real.data.resolved], record: { ...real.data.record, ...fx.pub.data.record } } };
fs.writeFileSync(`${OUT}/payloads.json`, JSON.stringify({ member, publicTr }).slice(0, 2_000_000));

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const fails = [];
const summary = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
async function open(path, w, { entitled = false, waiting = false, failTr = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; const picksReqs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.route(`${API}/**`, async (r) => {
    const u = new URL(r.request().url());
    const cors = { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' };
    if (u.pathname === '/v1/membership') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, membership: entitled ? { sport: 'tennis', state: 'all_access', entitled: true, access_source: 'qa_mock' } : { sport: 'tennis', state: 'free', entitled: false } }) });
    if (u.pathname === '/v1/picks') { picksReqs.push(u.pathname); return entitled ? r.fulfill({ status: 200, headers: cors, body: JSON.stringify(waiting ? memberWaiting : member) }) : r.fulfill({ status: 401, headers: cors, body: JSON.stringify({ ok: false, error: 'membership_required' }) }); }
    if (u.pathname === '/v1/picks/track-record') return failTr ? r.abort('failed') : r.fulfill({ status: 200, headers: cors, body: JSON.stringify(publicTr) });
    try { const x = await r.fetch(); return await r.fulfill({ response: x, headers: { ...x.headers(), ...cors } }); } catch { /* page closed */ }
  });
  await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 60; i += 1) { if (await p.evaluate(() => { const bd = document.querySelector('.pk-page [data-body]'); return (!!bd && !bd.querySelector('.loading')) || !!document.querySelector('.progate'); })) break; await p.waitForTimeout(250); }
  await p.waitForTimeout(300);
  return { ctx, p, errs, picksReqs };
}
// layout: no page scroll, no nested horizontal scroller, nothing wider than the viewport inside the page
const layout = (p) => p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const nested = [...document.querySelectorAll('main *')].filter((el) => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1; }).map((el) => el.className || el.tagName);
  const wide = [...document.querySelectorAll('.pk-page *')].filter((el) => el.getBoundingClientRect().right > vw + 1 && getComputedStyle(el).position !== 'fixed').map((el) => el.className || el.tagName);
  return { pageScroll: document.documentElement.scrollWidth > vw, nested, wide: wide.slice(0, 5) };
});

for (const w of WIDTHS) {
  const row = { w };
  // 1. member (SIMULATED), current picks
  { const { ctx, p, errs } = await open('/pbe-picks', w, { entitled: true });
    const d = await p.evaluate(() => ({ cards: document.querySelectorAll('.pk-cards .pk-card').length, kicker: document.querySelector('.pk-kicker')?.textContent, h1: document.querySelector('.pk-hero h1')?.textContent, text: document.querySelector('.pk-page')?.innerText || '', cast: [...document.querySelectorAll('.pk-cards .pk-cast')].map((a) => a.textContent), loading: !!document.querySelector('.pk-page .loading'), how: !!document.querySelector('details#how-picks-work:not([open])'), rows: document.querySelectorAll('.pk-rows .pk-row').length }));
    const L = await layout(p);
    check(d.cards === 2, `[${w}] member: 2 current official picks (got ${d.cards})`);
    check(/Official Picks · All Access/i.test(d.kicker || '') && /PBE Picks/i.test(d.h1 || ''), `[${w}] member: heading + status`);
    check(/Konstantinopoulos/.test(d.text) && /76%/.test(d.text) && /Locked /.test(d.text) && /rated 140 PBE Rating points/.test(d.text), `[${w}] member: player, probability, lock, reason`);
    check(d.cast.length === 2 && d.cast.every((t) => /PBEcast: .+ vs .+/.test(t)), `[${w}] member: named PBEcast links`);
    check(d.rows === 2 && /Official record 1–1/.test(d.text), `[${w}] member: latest results strip + record`);
    check(d.how && !/RESEARCH ONLY|PROSPECTIVE · NOT OFFICIAL|Read this first/i.test(d.text), `[${w}] member: How Picks Work closed, no disclaimer wall`);
    check(!d.loading && !L.pageScroll && !L.nested.length && !L.wide.length, `[${w}] member layout ${JSON.stringify(L)}`);
    check(!errs.length, `[${w}] member console: ${errs.join(' | ')}`);
    if (w === 390 || w === 1440) await p.screenshot({ path: `${OUT}/pbe-picks-member-${w}.png`, fullPage: true });
    row.member = { cards: d.cards, ...L }; await ctx.close(); }
  // 2. member (SIMULATED), nothing locked: the exact waiting state
  { const { ctx, p, errs } = await open('/pbe-picks', w, { entitled: true, waiting: true });
    const d = await p.evaluate(() => ({ wait: document.querySelector('.pk-wait')?.innerText || '', cards: document.querySelectorAll('.pk-cards .pk-card').length }));
    check(d.cards === 0 && /Next selections will appear when locked/i.test(d.wait) && /ATP/.test(d.wait) && /WTA/.test(d.wait), `[${w}] waiting state: ${d.wait.replace(/s+/g, " ").slice(0, 160)} cards=${d.cards}`);
    check(!errs.length, `[${w}] waiting console: ${errs.join(' | ')}`);
    await ctx.close(); }
  // 3. guest: the gate, never a /v1/picks request, no values
  { const { ctx, p, picksReqs } = await open('/pbe-picks', w);
    const d = await p.evaluate(() => ({ gate: !!document.querySelector('.progate'), cards: document.querySelectorAll('.pk-card').length, text: document.body.innerText }));
    check(d.gate && d.cards === 0 && !picksReqs.length && !/Konstantinopoulos|76%/.test(d.text), `[${w}] guest gate (requests ${picksReqs.length})`);
    await ctx.close(); }
  // 4. public track record (real preview data + fixture official results)
  { const { ctx, p, errs } = await open('/track-record', w);
    const d = await p.evaluate(() => ({ text: document.querySelector('.pk-page')?.innerText || '', off: document.querySelectorAll('[data-list="official"] .pk-row').length, pre: document.querySelectorAll('[data-list="prelaunch"] .pk-row').length, tiles: document.querySelectorAll('[data-tiles="all"] .pk-tile').length, audit: !!document.querySelector('details#technical-audit:not([open])') }));
    let L = await layout(p);
    check(d.off === 2 && d.tiles === 4 && /1–1/.test(d.text), `[${w}] track record: official rows + tiles (${d.off})`);
    check(d.pre >= 30 && /Prelaunch research record/i.test(d.text) && /historical · not official/i.test(d.text), `[${w}] track record: prelaunch kept separate (${d.pre})`);
    check(!/Fixture Player W|Konstantinopoulos/.test(d.text), `[${w}] track record: no pending official selection public`);
    check(d.audit && !L.pageScroll && !L.nested.length && !L.wide.length, `[${w}] track record layout ${JSON.stringify(L)}`);
    // tour filter + expanded sections still fit
    await p.click('[data-tour-f="WTA"]');
    const f = await p.evaluate(() => ({ visible: [...document.querySelectorAll('[data-list="official"] .pk-row')].filter((r) => !r.hidden).length, tiles: !document.querySelector('[data-tiles="WTA"]').hidden }));
    check(f.visible === 0 && f.tiles, `[${w}] filter WTA hides ATP rows (${f.visible})`);
    await p.click('[data-tour-f="all"]');
    await p.evaluate(() => { for (const x of document.querySelectorAll('details')) x.open = true; });
    await p.waitForTimeout(150);
    L = await layout(p);
    check(!L.pageScroll && !L.nested.length && !L.wide.length, `[${w}] track record expanded layout ${JSON.stringify(L)}`);
    check(!errs.length, `[${w}] track record console: ${errs.join(' | ')}`);
    if (w === 390 || w === 1440) await p.screenshot({ path: `${OUT}/track-record-${w}.png`, fullPage: true });
    row.track = { off: d.off, pre: d.pre, ...L }; await ctx.close(); }
  // 5. failed read: error + retry, never stuck
  if (w === 390 || w === 1440) { const { ctx, p } = await open('/track-record', w, { failTr: true });
    const d = await p.evaluate(() => ({ err: /could not load/i.test(document.querySelector('[data-body]')?.innerText || ''), retry: !!document.querySelector('[data-retry]') }));
    check(d.err && d.retry, `[${w}] failure -> error + retry`);
    await ctx.close(); }
  summary.push(row);
}
await b.close();
console.log(JSON.stringify({ base: BASE, preview: PREVIEW, cutover: PICKS_ACTIVATED_AT, membership: 'SIMULATED (not a production access test)', summary, fails }, null, 1));
process.exit(fails.length ? 1 : 0);
