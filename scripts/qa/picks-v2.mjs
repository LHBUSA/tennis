// Tennis Picks V2 UI gate (2026-10-09). One-shot; no entitled session exists, so membership is MOCKED (never forged
// against production). The /v1/picks payload = the REAL production resolved records (public /v1/picks/track-record)
// + fixture pending records built through the real ledger code (picker.js / picker-v2-atp.js / picks-api.js) in memory.
// ENTITLED /pbe-picks?preview=picker: policy, ATP+WTA record (versions, bands, lock integrity), RIGHT/MISSED/PENDING,
//   why list, PBEcast + Match links, ATP section labelled SHADOW; no overflow, no console errors.
// FREE: the gate ("Unlock PBE Picks") and no pick values. NO PREVIEW FLAG: the "not launched" page (PICKS_LIVE=false).
//   BASE=http://localhost:5197 node scripts/qa/picks-v2.mjs
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { freezeOne } from '../../workers/tennis-api/src/matchup-freeze.js';
import { decideMatch } from '../../workers/tennis-api/src/picker-ledger.js';
import { decideShadowMatch } from '../../workers/tennis-api/src/picker-v2-atp.js';
import { picksRoute } from '../../workers/tennis-api/src/picks-api.js';

const BASE = (process.env.BASE || 'http://localhost:5197').replace(/\/+$/, '');
const API = 'https://tennis-api.propbetedge.ai';
const WIDTHS = (process.env.WIDTHS || '390,768,1440').split(',').map(Number);
const OUT = process.env.OUT || 'D:/Temp/claude/C--Users-goodl/dccf58e3-2c74-4539-8af1-9b5924de6297/scratchpad/qa-picks-v2';
fs.mkdirSync(OUT, { recursive: true });

function memBucket() {
  const m = new Map();
  return { async list({ prefix }) { return { objects: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false }; },
    async head(k) { return m.has(k) ? {} : null; }, async get(k) { return m.has(k) ? { text: async () => m.get(k) } : null; },
    async put(k, v, o = {}) { if (m.has(k) && o.onlyIf) return null; m.set(k, v); return {}; } };
}
const bench = async () => ({ ok: true, json: async () => ({ at_forecast: [{ venue: 'kalshi', semantic_class: 'EXACT_MATCH', comparable: true, benchmark: { observed_at: '2026-10-10T06:58:00Z', sides: [] }, selection_market_p_bp: 6600, market_favorite_team_id: 'pa' }] }) });
const P = (id, name, slug) => ({ players: [{ id, name, slug }] });
async function fixture() {
  const b = memBucket();
  const mk = (id, ev, level, start) => ({ id, event_type: ev, status: 'scheduled', round: 'R16', scheduled_at: start, schedule_day: null, tournament: { slug: 'fixture-open', level }, sides: { A: P('pa', 'Fixture Player A', null), B: P('pb', 'Fixture Player B', null) } });
  const dos = (m, pA) => ({ as_of: '2026-10-09', tour: m.event_type === 'MS' ? 'ATP' : 'WTA', matchup_version: '1.1.0', fixture: 'upcoming', match: m, why: ['Fixture Player A is rated 140 PBE Rating points above Fixture Player B (1910 vs 1770).', 'That gives Fixture Player A a 72% win probability (overall rating alone: 72%).'], model: { status: 'published', probability: { A: pA, B: 1 - pA }, overall_probability: { A: pA, B: 1 - pA }, basis: 'overall', ratings: { A: { value: 1910, rated_matches: 90 }, B: { value: 1770, rated_matches: 70 } } } });
  const atp = mk('00000000-0000-5000-8000-0000000000a1', 'MS', null, '2026-10-10T08:00:00+00:00');
  const wta = mk('00000000-0000-5000-8000-0000000000b1', 'WS', 'WTA 1000', '2026-10-10T08:00:00+00:00');
  for (const [m, p] of [[atp, 0.72], [wta, 0.72]]) await freezeOne(b, dos(m, p), { now: '2026-10-10T05:00:00.000Z' });
  await decideShadowMatch({ bucket: b, match: atp, now: '2026-10-10T07:05:00.000Z', fetchImpl: bench });
  await decideMatch({ bucket: b, match: wta, now: '2026-10-10T07:05:00.000Z', fetchImpl: bench });
  return picksRoute("/v1/picks", null, { TENNIS_SOURCE: b });
}
const local = await fixture();
const real = await (await fetch(`${API}/v1/picks/track-record`)).json();
const payload = { ...local, data: { ...local.data, picks: [...local.data.picks, ...real.data.resolved], record: { ...real.data.record, atp_shadow: local.data.record.atp_shadow } } };
fs.writeFileSync(`${OUT}/mock-picks.json`, JSON.stringify(payload));

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
async function open(path, w, entitled) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.route(`${API}/**`, async (r) => {
    const u = new URL(r.request().url());
    const cors = { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' };
    if (u.pathname === '/v1/membership') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, membership: entitled ? { sport: 'tennis', state: 'all_access', entitled: true, access_source: 'qa_mock' } : { sport: 'tennis', state: 'free', entitled: false } }) });
    if (u.pathname === '/v1/picks') return entitled ? r.fulfill({ status: 200, headers: cors, body: JSON.stringify(payload) }) : r.fulfill({ status: 401, headers: cors, body: JSON.stringify({ ok: false, error: 'membership_required' }) });
    try { const x = await r.fetch(); return await r.fulfill({ response: x, headers: { ...x.headers(), ...cors } }); } catch { /* closed */ }
  });
  await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  return { ctx, p, errs };
}
const summary = [];
for (const w of WIDTHS) {
  const e = await open('/pbe-picks?preview=picker', w, true);
  await e.p.waitForSelector('.pk-table', { timeout: 20000 }).catch(() => fails.push(`${w}: record table missing`));
  const t = await e.p.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, cards: document.querySelectorAll('[data-pick]').length, shadowCards: document.querySelectorAll('[data-scope="atp_shadow"]').length, why: document.querySelectorAll('.pk-whylist li').length, pbecast: document.querySelectorAll('.pk-links a[href^="/pbecast/"]').length, inlineStyle: document.querySelectorAll('.pk-page [style]').length, disclosures: [...document.querySelectorAll('[data-disclosure]')].map((x) => x.dataset.disclosure) }));
  const T = t.text.toUpperCase();
  check(t.overflow <= 0, `${w}: horizontal overflow ${t.overflow}`);
  check(T.includes('ATP (SHADOW RESEARCH'), `${w}: ATP shadow row in record`);
  check(T.includes('SHADOW · ATP RESEARCH — NOT AN OFFICIAL PICK'), `${w}: ATP card label`);
  check(T.includes('PENDING'), `${w}: PENDING`);
  check(T.includes('RIGHT') && T.includes('MISSED'), `${w}: RIGHT/MISSED from real graded records`);
  check(T.includes('PROSPECTIVE · NOT OFFICIAL'), `${w}: not official label`);
  check(t.shadowCards >= 1 && t.why >= 2 && t.pbecast >= 1, `${w}: shadow card/why/pbecast (${t.shadowCards}/${t.why}/${t.pbecast})`);
  for (const c of ['RESEARCH_ONLY', 'UNDERDOG_WATCH', 'OVERCONFIDENCE', 'MARKETS_BENCHMARK_ONLY', 'SMALL_SAMPLES', 'SEPARATE_RECORDS']) check(t.disclosures.includes(c), `${w}: disclosure ${c} visible`);
  check(/UPSET HUNTER/.test(T) && T.includes('NOT A PICK AND NOT VALUE') && T.includes('NO HISTORICAL MARKET COMPARISON'), `${w}: disclosure wording`);
  check(!T.includes('OFFICIAL CANDIDATE'), `${w}: no official-candidate wording`);
  check(t.inlineStyle === 0, `${w}: inline style attributes`);
  check(!e.errs.length, `${w}: console errors ${e.errs.slice(0, 3).join(' | ')}`);
  if (w === 390 || w === 1440) await e.p.screenshot({ path: `${OUT}/entitled-${w}.png`, fullPage: false });
  summary.push({ w, entitled: { cards: t.cards, shadowCards: t.shadowCards, why: t.why, overflow: t.overflow, errors: e.errs.length } });
  await e.ctx.close();
  const f = await open('/pbe-picks?preview=picker', w, false);
  await f.p.waitForSelector('#progate-title', { timeout: 20000 }).catch(() => fails.push(`${w}: free gate missing`));
  const ft = await f.p.evaluate(() => ({ text: document.body.innerText, cards: document.querySelectorAll('[data-pick]').length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check(/UNLOCK PBE PICKS/i.test(ft.text) && ft.cards === 0 && !/\b\d{2}(\.\d)?%/.test(ft.text.split(/GET ALL ACCESS/i)[0] || ''), `${w}: free teaser shows a value or no gate`);
  check(ft.overflow <= 0, `${w}: free overflow`);
  await f.ctx.close();
  const n = await open('/pbe-picks', w, true);
  await n.p.waitForTimeout(2500);
  const nt = await n.p.evaluate(() => ({ text: document.body.innerText, cards: document.querySelectorAll('[data-pick]').length }));
  check(/not launched/i.test(nt.text) && nt.cards === 0, `${w}: without the preview flag the page must stay "not launched"`);
  await n.ctx.close();
}
await b.close();
const res = { at: new Date().toISOString(), base: BASE, mock: 'membership mocked; picks = real resolved production records + in-memory fixtures', summary, fails, verdict: fails.length ? 'FAIL' : 'PASS' };
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
process.exit(fails.length ? 1 : 0);
