#!/usr/bin/env node
// One-shot ATP live acceptance against PRODUCTION (no loop, no background watcher).
//   node scripts/qa/atp-live-production.mjs [--wait 240] [--shots]
// Outcome (last line): PASS | HOLD_NO_LIVE_ATP | FAIL. Exit 0 for PASS and HOLD, 1 for FAIL.
//
// ATP live state comes from the SECONDARY ESPN feed at game level (tennis-live router provider 'espn'): set/game score
// only. It must never carry a point score, a server, point events, serve speeds or coordinates.
// Each run also closes earlier observations: matches recorded in qa-artifacts/atp-live-state.json that are no longer in
// /v1/live must be final in /v1/matches/:id (they left live state correctly).
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const API = process.env.API_BASE || 'https://tennis-api.propbetedge.ai';
const WEB = process.env.QA_BASE || 'https://tennis.propbetedge.ai';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const WAIT_S = Number(arg('wait', 240)); // several tennis-live cycles (~20 s each); games change every few minutes
const STATE = 'qa-artifacts/atp-live-state.json';
const FINAL = ['completed', 'retired', 'walkover'];
const checks = [];
const check = (name, ok, detail = {}) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); };
const get = async (p) => { const r = await fetch(`${API}${p}`, { headers: { 'cache-control': 'no-cache' } }); return r.json(); };
const games = (m) => (m.sets || []).map((s) => (s.match_tiebreak && s.tb ? `[${s.tb.A}-${s.tb.B}]` : `${s.A}-${s.B}`)).join(' ');
const pairKey = (m) => `${m.event_type}|${[m.sides.A.participant_key, m.sides.B.participant_key].sort().join('~')}`;
fs.mkdirSync('qa-artifacts', { recursive: true });

async function main() {
const prev = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { observed: [] };

const live1 = await get('/v1/live');
const rows = live1.data || [];

// 0. earlier observations that have left /v1/live must be final (the match left live state correctly)
for (const o of prev.observed || []) {
  if (rows.some((m) => m.id === o.id)) continue;
  const m = (await get(`/v1/matches/${o.id}`)).data?.match || (await get(`/v1/matches/${o.id}`)).data;
  check(`left live state: ${o.label}`, m && FINAL.includes(m.status), { id: o.id, status: m?.status, score: m?.score });
  if (m && FINAL.includes(m.status)) o.completed = { status: m.status, score: m.score, at: new Date().toISOString() };
}

// QA_LIVE_SOURCE / QA_LIVE_EVENT exist only to exercise this script's mechanics on another live row (expect the
// game-level assertions to FAIL there); acceptance always runs with the defaults (espn, MS)
const SRC = process.env.QA_LIVE_SOURCE || 'espn';
const ET = process.env.QA_LIVE_EVENT || 'MS';
const atp = rows.filter((m) => m.source === SRC && m.event_type === ET);
if (!atp.length) {
  fs.writeFileSync(STATE, JSON.stringify(prev, null, 1));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`live rows: ${rows.length} (${[...new Set(rows.map((m) => `${m.source}:${m.event_type}`))].join(', ') || 'none'}); ESPN ATP men's singles live: 0`);
  console.log(failed ? 'FAIL' : 'HOLD_NO_LIVE_ATP');
  return (failed ? 1 : 0);
}

// 1. identity + no duplicates / tombstones
const m0 = atp[0];
const label = `${m0.sides.A.players.map((p) => p.name).join('/')} v ${m0.sides.B.players.map((p) => p.name).join('/')} (${m0.tournament?.name})`;
console.log(`observing ${label} ${m0.id}`);
check('identity: two named players with canonical ids, a tournament, men\'s singles, ESPN source', m0.sides.A.players.length === 1 && m0.sides.B.players.length === 1 && [...m0.sides.A.players, ...m0.sides.B.players].every((p) => p.id && p.name) && m0.tournament?.name && m0.event_type === ET && m0.source === SRC, { label, source: m0.source });
check('status in_progress (never superseded)', m0.status === 'in_progress', { status: m0.status });
const keys = rows.map(pairKey);
check('no duplicate live rows for one fixture', keys.length === new Set(keys).size && new Set(rows.map((m) => m.id)).size === rows.length, { rows: rows.length });
check('ATP live row carries no point score and no server', !m0.live?.point && !m0.live?.server, { live: m0.live });
check('ATP live row is game-level', m0.live?.granularity === 'game', { granularity: m0.live?.granularity });

// 2. PBEcast payload
const pb1 = (await get(`/v1/pbecast/${m0.id}`)).data;
const noPointEvents = (pb1.events || []).every((e) => e.quality !== 'point_event');
const noFakes = (pb1.events || []).every((e) => !e.state?.point && !e.state?.server && e.serve_speed_kmh == null && !e.coordinates);
check('PBEcast mode observed_live (no genuine point data from ESPN)', pb1.mode === 'observed_live', { mode: pb1.mode, quality: pb1.quality });
check('PBEcast: no point events, point scores, servers, serve speeds or coordinates', noPointEvents && noFakes && !pb1.match.live?.point && !pb1.match.live?.server, { events: (pb1.events || []).length });
check('PBEcast cadence note states the secondary, game-level source', /secondary source \(ESPN/.test(pb1.cadence_note || ''), { note: (pb1.cadence_note || '').slice(0, 80) });
const s1 = { at: new Date().toISOString(), score: games(m0), updated: m0.source_updated_at, events: (pb1.events || []).length };
console.log(`initial: ${s1.score} (observed ${s1.updated}, ${s1.events} observations)`);

// 3. several production polling cycles later
await new Promise((r) => setTimeout(r, WAIT_S * 1000));
const live2 = (await get('/v1/live')).data || [];
const m1 = live2.find((m) => m.id === m0.id);
if (m1) {
  const pb2 = (await get(`/v1/pbecast/${m0.id}`)).data;
  const s2 = { score: games(m1), updated: m1.source_updated_at, events: (pb2.events || []).length };
  console.log(`after ${WAIT_S}s: ${s2.score} (observed ${s2.updated}, ${s2.events} observations)`);
  check('re-observed by tennis-live (observation time advanced)', Date.parse(s2.updated) > Date.parse(s1.updated), { from: s1.updated, to: s2.updated });
  // the score must progress only when the source changed; an unchanged score across the window is reported, not failed
  check('score progression recorded as observations', s2.score === s1.score || s2.events > s1.events, { from: s1.score, to: s2.score, events: `${s1.events}->${s2.events}` });
  if (s2.score === s1.score) console.log('note: the source score did not change inside the window (a long game) — progression not exercised this run');
} else {
  const m = (await get(`/v1/matches/${m0.id}`)).data?.match || (await get(`/v1/matches/${m0.id}`)).data;
  check('match ended inside the window and left live state as final', m && FINAL.includes(m.status), { status: m?.status, score: m?.score });
}

// 4. real browser: the same live UX path WTA uses
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = [];
page.on('console', (x) => x.type() === 'error' && errs.push(x.text().slice(0, 160)));
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.goto(`${WEB}/pbecast/${m0.id}`, { waitUntil: 'load' });
await page.waitForTimeout(8000);
const ui = await page.evaluate(() => {
  const main = document.querySelector('#main') || document.body;
  const t = main.innerText;
  return {
    text: t.slice(0, 4000),
    serving: [...main.querySelectorAll('.srv, .is-srv, .court-key, .court-pt')].length + (/\bserving\b|SERVER FIRST/i.test(t.split('RECENT MOMENTS')[0].replace(/LIVE MATCHES[\s\S]*?PBEcast/, '')) ? 1 : 0),
    pointCells: [...main.querySelectorAll('.v3s-pt')].map((x) => x.textContent.trim()).filter(Boolean),
    broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src)
  };
});
const last = (p) => p.name.split(' ').pop();
const up = ui.text.toUpperCase();
check('browser: both players shown', [...m0.sides.A.players, ...m0.sides.B.players].every((p) => up.includes(last(p).toUpperCase())), {});
check('browser: tournament shown', up.includes(String(m0.tournament.name).toUpperCase()), { tournament: m0.tournament.name });
check('browser: LIVE state shown', /OBSERVED LIVE|\bLIVE\b/.test(up), {});
check('browser: no server / point UI for a game-level feed', ui.serving === 0 && ui.pointCells.length === 0, { serving: ui.serving, pointCells: ui.pointCells });
check('browser: no console errors', errs.length === 0, { errs: errs.slice(0, 3) });
check('browser: no broken images', ui.broken.length === 0, { broken: ui.broken.slice(0, 3) });
if (process.argv.includes('--shots')) await page.screenshot({ path: `qa-artifacts/atp-live-${m0.id.slice(0, 8)}.png` });
await browser.close();

prev.observed = [...(prev.observed || []).filter((o) => o.id !== m0.id), { id: m0.id, label, first_seen: s1.at, score: s1.score }];
fs.writeFileSync(STATE, JSON.stringify(prev, null, 1));
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length}/${checks.length} checks. Re-run after the match ends to prove it leaves live state.`);
console.log(failed.length ? 'FAIL' : 'PASS');
return (failed.length ? 1 : 0);
}

// exitCode, never process.exit(): Node on Windows aborts on exit while fetch handles close
process.exitCode = await main();
