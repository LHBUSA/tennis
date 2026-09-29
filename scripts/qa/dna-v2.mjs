#!/usr/bin/env node
// Production QA for Tennis DNA v2 (Match DNA + PBE Rating). -> docs/evidence/dna-v2-qa-latest.json
// Data: history present, no duplicate canonical matches, rank-at-match never after the match, tours never mixed,
// no technical metric from results, confidence/gates coherent. UI: overview + DNA tab at 1440 and 390.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const API = 'https://tennis-api.propbetedge.ai';
const BASE = process.env.BASE || 'https://tennis.propbetedge.ai';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PLAYERS = (process.env.PLAYERS || 'carlos-alcaraz,jannik-sinner,novak-djokovic,alexander-zverev,iga-swiatek,aryna-sabalenka,gustavo-heide,roger-federer,david-ferrer').split(',');
const pbecastSeen = new Set();
const TECH = new Set(['ace_rate', 'double_fault_rate', 'first_serve_in', 'first_serve_won', 'second_serve_won', 'service_points_won', 'hold_rate', 'break_points_saved', 'return_points_won', 'first_return_won', 'second_return_won', 'return_games_won', 'break_points_converted']);
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 64 << 20 }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0); if (!at.length) return []; const v = JSON.parse(out.slice(Math.min(...at))); return Array.isArray(v) ? v : [v]; };
const checks = [];
const add = (name, pass, detail = {}) => { checks.push({ name, result: pass ? 'PASS' : 'FAIL', ...detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail).slice(0, 220)}`); };

// global data checks
const [dup] = sql(`with k as (select m.edition_id, m.event_type, case when m.round like 'Q-%' then 'q' when m.round='RR' then 'rr' else 'm' end st, least(a.participant_key,b.participant_key) x, greatest(a.participant_key,b.participant_key) y from tennis_matches m join tennis_match_participants a on a.match_id=m.match_id and a.side='A' join tennis_match_participants b on b.match_id=m.match_id and b.side='B' where m.event_type in ('MS','WS')) select count(*) groups from (select 1 from k group by edition_id, event_type, st, x, y having count(*) > 1) d`);
add('no duplicate canonical singles matches (edition + event + stage + pair)', Number(dup.groups) === 0, { duplicate_groups: Number(dup.groups) });
const [mix] = sql(`select count(*) n from tennis_dna_snapshots s join tennis_players p using (pbe_player_id) where s.definition_version=2 and ((p.gender='M' and s.metrics->>'_tour'<>'ATP') or (p.gender='F' and s.metrics->>'_tour'<>'WTA'))`);
add('v2 snapshots: tour always the player\'s own (ATP/WTA never mixed)', Number(mix.n) === 0, { mismatched: Number(mix.n) });
const [v1] = sql(`select count(*) n, max(as_of) as_of from tennis_dna_snapshots where definition_version=1`);
add('v1 technical snapshots preserved', Number(v1.n) > 0, { v1_rows: Number(v1.n), latest: v1.as_of });

for (const slug of PLAYERS) {
  const j = await (await fetch(`${API}/v1/players/${slug}/dna?qa=${Date.now()}`)).json();
  const md = j.data?.match_dna;
  if (!md) { add(`${slug}: match DNA present`, false); continue; }
  add(`${slug}: meaningful match history`, md.sample.matches >= 20 && md.recent.length > 0, { matches: md.sample.matches, span: `${md.sample.first_day}..${md.sample.last_day}`, sources: md.sample.sources });
  const leak = md.recent.filter((r) => r.opponent_rank?.list_date && r.opponent_rank.list_date > r.day);
  add(`${slug}: opponent rank never from a later list`, leak.length === 0, { checked: md.recent.filter((r) => r.opponent_rank).length, leaks: leak.length });
  const keys = md.families.flatMap((f) => f.metrics.map((m) => m.key));
  add(`${slug}: no technical metric in Match DNA`, keys.every((k) => !TECH.has(k)), { metrics: keys.length });
  const bad = md.families.flatMap((f) => f.metrics).filter((m) => (m.percentile != null && (!['medium', 'high'].includes(m.confidence) || !m.comparative_published)) || (m.value == null && m.confidence !== 'insufficient'));
  add(`${slug}: confidence/percentile coherent`, bad.length === 0, { incoherent: bad.map((m) => m.key) });
  const expectTour = j.data.player?.gender === 'F' ? 'WTA' : 'ATP';
  add(`${slug}: tour`, md.tour === expectTour, { tour: md.tour, rating: md.rating?.value ?? null, rating_status: md.rating?.status ?? null });
  const ids = md.recent.map((r) => r.match_id);
  add(`${slug}: no duplicate match in history`, new Set(ids).size === ids.length);
  // surface Match DNA (2026-09-28): sourced surfaces only, subsets of the overall record, gates coherent
  const S = md.by_surface || [];
  const sBad = S.filter((x) => !['hard', 'clay', 'grass'].includes(x.surface) || x.sample.matches < 5 || x.sample.matches > md.sample.matches || x.metrics.some((m) => m.percentile != null && (!['medium', 'high'].includes(m.confidence))) || (x.rating && x.rating.status === 'published' && md.rating?.status === 'not_validated'));
  add(`${slug}: surface Match DNA coherent`, sBad.length === 0, { surfaces: S.map((x) => `${x.surface}:${x.sample.matches}`), sum: S.reduce((t, x) => t + x.sample.matches, 0), overall: md.sample.matches, bad: sBad.map((x) => x.surface) });
  // profile (form, surface record, opponents): long careers must not overflow the request (postgrest 400 until 2026-09-29)
  const pf = await (await fetch(`${API}/v1/players/${slug}/profile?qa=${Date.now()}`)).json();
  add(`${slug}: profile loads`, pf.ok === true && Array.isArray(pf.data?.top_opponents), { error: pf.meta?.degraded?.[0] || null, opponents: pf.data?.top_opponents?.length ?? null });
  // PBEcast DNA contract (pbecast-dna/2): Match DNA v2 for both players of the most recent singles match, technical v1 separate
  const mid = md.recent.find((r) => r.opponent && !pbecastSeen.has(r.match_id))?.match_id;
  if (mid) {
    pbecastSeen.add(mid);
    const pc = await (await fetch(`${API}/v1/pbecast/${mid}?qa=${Date.now()}`)).json();
    const d = pc.data?.dna;
    const sides = ['A', 'B'].map((s) => d?.match_dna?.[s]);
    add(`${slug}: PBEcast Match DNA v2 (${mid})`, d?.contract === 'pbecast-dna/2' && sides.some((x) => x?.definition_version === 2) && sides.filter(Boolean).every((x) => x.tour === expectTour), { tours: sides.map((x) => x?.tour ?? null), technical: ['A', 'B'].map((s) => d?.technical_dna?.[s]?.status ?? null) });
    add(`${slug}: PBEcast rating gate (no value when not validated)`, sides.filter(Boolean).every((x) => !x.rating || x.rating.status !== 'not_validated' || x.rating.value === undefined));
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
for (const [w, h] of [[1440, 900], [390, 844]]) {
  for (const route of [...PLAYERS.flatMap((s) => [`/players/${s}`, `/players/${s}/dna`]), '/dna', '/dna?metric=match_win_rate&tour=atp', '/dna?metric=pbe_rating&tour=atp', '/dna?metric=match_win_rate&tour=wta']) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 20000 }).catch(() => {});
    const r = await page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > window.innerWidth + 1, broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).length }));
    const fails = [];
    if (r.overflow) fails.push('horizontal_overflow');
    if (r.broken) fails.push(`broken_images:${r.broken}`);
    if (errors.length) fails.push(`console:${errors[0]}`);
    if (/could not be loaded|Could not load/i.test(r.text)) fails.push('error_state');
    if (/\/dna$/.test(route) && !/MATCH DNA — LIVE/i.test(r.text)) fails.push('match_dna_missing');
    if (/\/dna$/.test(route) && !/by surface/i.test(r.text)) fails.push('surface_table_missing');
    if (/\/players\/[^/]+$/.test(route) && !/Match DNA/i.test(r.text)) fails.push('overview_match_dna_missing');
    if (/^\/dna/.test(route) && !/qualified players/.test(r.text)) fails.push('leaderboard_missing');
    if (route === '/dna' && !(/\bATP\b/.test(r.text) && /\bWTA\b/.test(r.text))) fails.push('hub_not_both_tours');
    if (/No Tennis DNA|No stored Tennis DNA/i.test(r.text)) fails.push('empty_dna_shell');
    add(`UI ${w} ${route}`, !fails.length, { fails });
    await page.close();
  }
}
await browser.close();
const OUT = process.env.OUT || 'docs/evidence/dna-v2-qa-latest.json';
const doc = { checked_at: new Date().toISOString(), result: checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL', checks };
fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`dna v2 QA: ${doc.result} (${checks.filter((c) => c.result === 'PASS').length}/${checks.length})`);
if (doc.result !== 'PASS') process.exitCode = 1;
