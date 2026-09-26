// INTERNAL reference / gap check against ESPN's public tennis core API (owner approval 2026-09-26).
//   node scripts/reference/espn-gap-check.mjs
// Rules: never canonical, never a production dependency, never republished or customer-facing; one honest
// request at a time (>= 1 s apart), no alternate user agents, stop on any block. Output holds only counts and
// event names for gap detection: docs/evidence/espn-gap-latest.json.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const UA = 'PropBetEdge-Tennis-Reference/0.1 (+https://tennis.propbetedge.ai/sources)';
const CORE = 'https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requests = 0;
async function get(url) {
  if (requests >= 40) throw new Error('request budget reached');
  requests += 1;
  await sleep(1100);
  const r = await fetch(url.replace(/^http:/, 'https:'), { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (r.status === 403 || r.status === 429) throw new Error(`blocked ${r.status} ${url}`);
  if (!r.ok) return null;
  return r.json();
}
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8' }); return JSON.parse(out.slice(out.indexOf('['))); };

// our men's counts per Slam edition
const ours = sql("select t.slug, e.year, count(*) filter (where m.event_type='MS' and m.round not like 'Q-%') ms_main, count(*) filter (where m.event_type='MS' and m.round like 'Q-%') ms_q, count(*) filter (where m.event_type='MD') md from tennis_matches m join tennis_tournament_editions e using (edition_id) join tennis_tournaments t on t.tournament_id = e.tournament_id where e.level='Grand Slam' and m.event_type in ('MS','MD') group by 1,2");
const slams = [['australian-open', 2026, '154-2026'], ['wimbledon', 2025, '188-2025'], ['roland-garros', 2025, '172-2025']];
const compare = [];
for (const [name, year, id] of slams) {
  const ev = await get(`${CORE}/events/${id}`);
  const comps = ev?.competitions || [];
  let items = comps;
  if (comps.$ref || (!Array.isArray(comps) && comps.count != null)) items = comps.items || [];
  const types = {};
  for (const c of items) { const t = c.type?.text || c.type?.slug || 'unknown'; types[t] = (types[t] || 0) + 1; }
  const mine = ours.find((o) => o.slug === name && Number(o.year) === year) || {};
  compare.push({ edition: `${name} ${year}`, espn_event: id, espn_total_competitions: Array.isArray(items) ? items.length : null, espn_by_type: types, ours: { ms_main: mine.ms_main ?? 0, ms_qualifying: mine.ms_q ?? 0, md: mine.md ?? 0 } });
}
// 2026 ATP events ESPN lists (names + dates only) vs editions we hold
const list = await get(`${CORE}/events?dates=2026&limit=200`);
const refs = (list?.items || []).map((x) => x.$ref).slice(0, 25);
const events = [];
for (const ref of refs) { const e = await get(ref); if (e) events.push({ name: e.name || e.shortName, date: (e.date || '').slice(0, 10) }); }
const held = new Set(sql("select lower(name) n from tennis_tournament_editions where year=2026").map((r) => r.n));
const missing = events.filter((e) => ![...held].some((h) => h.includes(String(e.name || '').toLowerCase().split(' ')[0])));
const out = { generated_at: new Date().toISOString(), role: 'INTERNAL REFERENCE / GAP CHECK ONLY — never canonical, never customer-facing', requests, slam_comparison: compare, espn_2026_events_sampled: events.length, espn_events_without_a_matching_edition: missing };
fs.writeFileSync('docs/evidence/espn-gap-latest.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ requests, slam_comparison: compare.map((c) => ({ edition: c.edition, espn: c.espn_by_type, ours: c.ours })), missing: missing.length }, null, 1));
