// Live observation cadence audit (2026-10-02). One-shot, read-only, NO extra source requests (only our own API and the
// tennis-live run record). While a real match is live, samples for MIN minutes:
//   every 5 s : tennis-live /v1/live/runs (cron run start/finish, rounds = source fetches per edition, changes)
//               /v1/live (cache-busted: the stored row incl. the source's own LastUpdated = source_updated_at)
//               /v1/pbecast/:id cache-busted (stored observations) AND as users get it (edge-cached)
//   every 1 s : the score PBEcast actually shows in a browser
// Then per stored observation: source updated -> stored (observed_at) -> API (first seen) -> browser (first shown),
// fetches per minute, and a verdict: A fetch ~18 s but source changes ~60 s · B fetch ~60 s · C fetch fast but
// persistence/cache collapses · D other.
//   MATCH=<id optional> MIN=10 node scripts/qa/live-cadence.mjs
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const API = 'https://tennis-api.propbetedge.ai';
const RUNS = 'https://tennis-live.sales-fd3.workers.dev/v1/live/runs';
const SITE = 'https://tennis.propbetedge.ai';
const MIN = Number(process.env.MIN || 10);
const OUT = process.env.OUT || `qa-artifacts/live-cadence/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`;
const H = { headers: { origin: SITE } };
fs.mkdirSync(OUT, { recursive: true });
const j = (u) => fetch(u, H).then((r) => r.json()).catch(() => null);
const bust = () => `cb=${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

const live0 = (await j(`${API}/v1/live?${bust()}`))?.data || [];
const target = process.env.MATCH ? live0.find((m) => m.id === process.env.MATCH) : live0.find((m) => m.source === 'wta') || live0[0];
if (!target) { console.log('HOLD_NO_LIVE_MATCH'); process.exit(0); }
const id = target.id;
console.log(`match ${id} source=${target.source} ${target.event_type} · sampling ${MIN} min`);

const t0 = Date.now();
const runs = new Map(); // started_at -> run summary
const rows = [];        // /v1/live samples for the match
const stored = new Map(); // event_id -> { observed_at, first_api_busted, first_api_cached }
const dom = [];          // browser score changes
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${SITE}/pbecast/${id}`, { waitUntil: 'domcontentloaded' });
let lastDom = null;
const domTimer = setInterval(async () => {
  const s = await page.evaluate(() => document.querySelector('[data-score]')?.textContent.replace(/\s+/g, ' ').trim() || null).catch(() => null);
  if (s && s !== lastDom) { dom.push({ at: Date.now(), score: s }); lastDom = s; }
}, 1000);

while (Date.now() - t0 < MIN * 60e3) {
  const now = Date.now();
  const [run, lv, pbB, pbC] = await Promise.all([j(RUNS), j(`${API}/v1/live?${bust()}`), j(`${API}/v1/pbecast/${id}?${bust()}`), j(`${API}/v1/pbecast/${id}`)]);
  const r = run?.data;
  if (r?.started_at && !runs.has(r.started_at)) runs.set(r.started_at, { started_at: r.started_at, finished_at: r.finished_at, upstream: r.upstream_requests, rounds: (r.rounds || []).map((x) => ({ round: x.round, source: x.source, event: x.event, changes: x.changes, live: x.live })) });
  const m = (lv?.data || []).find((x) => x.id === id);
  if (m) rows.push({ at: now, source_updated_at: m.source_updated_at, point: m.live?.point || null, sets: (m.sets || []).map((s) => `${s.A}-${s.B}`).join(' '), status: m.status });
  for (const e of pbB?.data?.events || []) { if (!stored.has(e.event_id)) stored.set(e.event_id, { event_id: e.event_id, type: e.event_type, observed_at: e.observed_at, first_api_busted: now, first_api_cached: null, to: e.event_detail?.to || null }); }
  for (const e of pbC?.data?.events || []) { const s = stored.get(e.event_id); if (s && !s.first_api_cached) s.first_api_cached = now; }
  if (m && m.status !== 'in_progress') break;
  await new Promise((ok) => setTimeout(ok, 5000));
}
clearInterval(domTimer);
await b.close();

// source LastUpdated history (distinct values seen) and its spacing
const lu = [...new Set(rows.map((x) => x.source_updated_at).filter(Boolean))].map((x) => Date.parse(x)).sort((a, b2) => a - b2);
const gaps = (arr) => arr.slice(1).map((v, i) => Math.round((v - arr[i]) / 1000));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const newObs = [...stored.values()].filter((s) => Date.parse(s.observed_at) >= t0 - 5000).sort((a, c) => Date.parse(a.observed_at) - Date.parse(c.observed_at));
const chain = newObs.map((s) => {
  const obsAt = Date.parse(s.observed_at);
  const dm = dom.find((d) => d.at >= obsAt);
  return { event_id: s.event_id, type: s.type, observed_at: s.observed_at, to: s.to, api_busted_lag_s: Math.round((s.first_api_busted - obsAt) / 1000), api_cached_lag_s: s.first_api_cached ? Math.round((s.first_api_cached - obsAt) / 1000) : null, browser_lag_s: dm ? Math.round((dm.at - obsAt) / 1000) : null };
});
const runList = [...runs.values()].sort((a, c) => a.started_at.localeCompare(c.started_at));
const roundsPerRun = runList.map((r) => new Set(r.rounds.filter((x) => x.source === target.source).map((x) => x.round)).size);
const fetchesPerMin = runList.length ? roundsPerRun.reduce((a, c) => a + c, 0) / runList.length : null;
const luGap = med(gaps(lu));
const obsGap = med(gaps(newObs.map((s) => Date.parse(s.observed_at))));
let verdict = 'D';
if (fetchesPerMin != null) {
  if (fetchesPerMin <= 1.2) verdict = 'B';
  else if (fetchesPerMin >= 2.5 && luGap && luGap >= 45) verdict = 'A';
  else if (fetchesPerMin >= 1.5 && obsGap && obsGap > 60 / fetchesPerMin * 1.6 && luGap && luGap < obsGap) verdict = 'C';
  else if (fetchesPerMin >= 1.5) verdict = luGap && luGap >= 45 ? 'A' : 'B/partial';
}
const report = { match: id, source: target.source, sampled_min: MIN, runs: runList.length, rounds_per_run: roundsPerRun, fetches_per_min: fetchesPerMin, source_lastupdated_distinct: lu.length, source_lastupdated_median_gap_s: luGap, stored_observations: newObs.length, stored_median_gap_s: obsGap, chain, runs_detail: runList, live_samples: rows.length, dom_changes: dom.length, verdict };
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, chain: chain.slice(-8), runs_detail: undefined }, null, 1));
