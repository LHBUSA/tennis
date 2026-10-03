// Production proof: an OPEN PBEcast tab updates itself during a real live match (no reload). One-shot, read-only.
//   MATCH=<id optional> MIN=6 [BASE=https://tennis.propbetedge.ai] node scripts/qa/live-update-proof.mjs
// Records every /v1/pbecast response the page itself fetches (newest stored observation) and every visible change of
// the scoreboard / court / game rail, then pairs them: source observation (observed_at) -> API (first served) ->
// browser (first rendered) -> latency. PASS needs >= 2 natural changes rendered without any reload or navigation.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const API = 'https://tennis-api.propbetedge.ai';
const BASE = (process.env.BASE || 'https://tennis.propbetedge.ai').replace(/\/+$/, '');
const MIN = Number(process.env.MIN || 6);
const OUT = process.env.OUT || `qa-artifacts/live-update-proof/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`;
fs.mkdirSync(OUT, { recursive: true });
const live = (await (await fetch(`${API}/v1/live?cb=${Date.now()}`, { headers: { origin: BASE } })).json()).data || [];
const target = process.env.MATCH ? live.find((m) => m.id === process.env.MATCH) || { id: process.env.MATCH } : live.find((m) => m.source === 'espn') || live[0];
if (!target) { console.log('NO_LIVE_MATCH_AVAILABLE'); process.exit(0); }
const id = target.id;
console.log(`match ${id} source=${target.source} ${target.event_type} score=${target.score} · watching ${MIN} min`);

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
let navigations = 0;
p.on('framenavigated', (f) => { if (f === p.mainFrame()) navigations += 1; });
const api = []; // { at, events, last_obs, last_key }
p.on('response', async (r) => {
  if (!r.url().startsWith(`${API}/v1/pbecast/${id}`)) return;
  try {
    const j = await r.json();
    const ev = j.data?.events || [];
    const last = ev.at(-1);
    api.push({ at: Date.now(), status: r.status(), cache: r.headers()['cache-control'] || null, events: ev.length, last_obs: last?.observed_at || null, last_key: last ? `${(last.state?.sets || []).map((s) => `${s.A}-${s.B}`).join(' ')}|${last.state?.point ? `${last.state.point.A}-${last.state.point.B}` : ''}|${last.state?.server || ''}` : null });
  } catch { /* aborted */ }
});
await p.goto(`${BASE}/pbecast/${id}`, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.court-wrap', { timeout: 30000 });
navigations = 0; // the initial load is not a reload
const snap = () => p.evaluate(() => ({
  score: [...document.querySelectorAll('.v3-score .v3s-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
  banner: document.querySelector('.court-banner')?.textContent.trim() || null,
  rail: document.querySelector('.gr .gr-i:not(.gr-now)')?.textContent.replace(/\s+/g, ' ').trim() || null,
  now: document.querySelector('.gr-now')?.textContent.replace(/\s+/g, ' ').trim() || null,
  pos: document.querySelector('.v3-pos')?.textContent || null,
  stale: (() => { const s = document.querySelector('[data-stale]'); return s && !s.hidden ? s.textContent : null; })()
}));
const dom = [];
let prev = await snap();
dom.push({ at: Date.now(), ...prev, initial: true });
await p.screenshot({ path: `${OUT}/t0.png` });
const t0 = Date.now();
while (Date.now() - t0 < MIN * 60e3) {
  await p.waitForTimeout(1000);
  const s = await snap();
  if (s.score !== prev.score || s.pos !== prev.pos) { dom.push({ at: Date.now(), ...s }); if (dom.length <= 4) await p.screenshot({ path: `${OUT}/change-${dom.length - 1}.png` }); }
  prev = s;
}
await b.close();

// pair each rendered change with the first API response that carried a new stored observation
const changes = dom.slice(1).map((d) => {
  const resp = [...api].reverse().find((a) => a.at <= d.at && a.last_obs) || null;
  const firstServed = resp ? api.find((a) => a.last_obs === resp.last_obs) : null;
  return { rendered_at: new Date(d.at).toISOString(), score: d.score, banner: d.banner, pos: d.pos, observed_at: resp?.last_obs || null, api_first_served_at: firstServed ? new Date(firstServed.at).toISOString() : null,
    latency_s: resp?.last_obs ? Math.round((d.at - Date.parse(resp.last_obs)) / 100) / 10 : null, api_to_render_s: firstServed ? Math.round((d.at - firstServed.at) / 100) / 10 : null };
});
const polls = api.length;
const report = { match: id, source: target.source, minutes: MIN, polls, poll_interval_s: polls > 1 ? Math.round(((api.at(-1).at - api[0].at) / (polls - 1)) / 100) / 10 : null, cache_headers: [...new Set(api.map((a) => a.cache))], reloads: navigations, initial: dom[0], changes, stale_seen: dom.some((d) => d.stale) };
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
for (const c of changes) console.log(`change rendered ${c.rendered_at} ← observed ${c.observed_at} (latency ${c.latency_s}s; API→render ${c.api_to_render_s}s) ${c.score} ${c.banner || ''}`);
console.log(`polls ${polls} (~${report.poll_interval_s}s), cache ${report.cache_headers.join(',')}, reloads ${navigations}`);
console.log(changes.length >= 2 && navigations === 0 ? 'PASS' : changes.length ? 'PARTIAL' : 'NO_CHANGE_OBSERVED');
console.log(`report: ${OUT}/report.json`);
