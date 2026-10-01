#!/usr/bin/env node
// Tennis DNA VISIBLE parity gate — inspects page CONTENT, not page health.
//   node scripts/qa/dna-page-parity.mjs            (QA_BASE / API_BASE to point elsewhere)
// 1. Direct routes: /players/{slug}/dna for two ATP and two WTA players at 390 and 1440 px must render the SAME module
//    architecture (every core results-based module when match_dna exists). Legitimate holds must render an explicit
//    visible state (never a silently missing module or a blank cell). 2. Click navigation from the Overview: the visible
//    "Tennis DNA" tab must change the route, move aria-current and render the full page; "Overview" must bring the
//    summary back. Full-page screenshots + a heading report (docs/evidence/dna-page-parity-latest.md).
// AUTH (2026-09-30): /players/:slug/dna and /v1/players/:slug/dna are All Access-gated. The gate is NEVER bypassed here:
// the run uses a real network session — the `pbe_session` cookie of an entitled (All Access or owner) account — from
// QA_PBE_SESSION or the file QA_PBE_SESSION_FILE (default D:/Workers/secrets/tennis-qa-pbe-session; the value is never
// printed). Before any check the session must make GET /v1/membership report entitled:true. No credential, or a
// credential that is not entitled -> exit 2 HOLD (never a PASS). To capture one: sign in at tennis.propbetedge.ai with the
// QA/owner account, copy the pbe_session cookie value (DevTools > Application > Cookies) into that file.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.QA_BASE || 'https://tennis.propbetedge.ai';
const API = process.env.API_BASE || 'https://tennis-api.propbetedge.ai';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PLAYERS = [['carlos-alcaraz', 'ATP'], ['jannik-sinner', 'ATP'], ['elena-rybakina', 'WTA'], ['iga-swiatek', 'WTA']];
const WIDTHS = [390, 1440];
const SHOTS = 'qa-artifacts/dna-parity';
// the shared full-DNA architecture (h2 prefixes); a module is required whenever match_dna exists
const CORE = ['Match DNA fingerprint', 'PBE Rating', 'Form windows', 'Opponent archetypes', 'Tournament level & round', 'Form', 'Result strength', 'Pressure', 'Opponent quality', 'By surface', 'Technical DNA'];
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const report = [];
const check = (scope, name, ok, detail = '') => { results.push({ scope, name, ok: !!ok, detail }); if (!ok) console.log(`FAIL ${scope}: ${name} ${detail}`); };
const SESSION_FILE = process.env.QA_PBE_SESSION_FILE || 'D:/Workers/secrets/tennis-qa-pbe-session';
const SESSION = (process.env.QA_PBE_SESSION || (fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8') : '')).trim().replace(/^pbe_session=/, '');
if (!SESSION) { console.log(`DNA PAGE PARITY: HOLD_NO_SESSION — set QA_PBE_SESSION or write ${SESSION_FILE} (gated pages are never tested anonymously)`); process.exit(2); }
const authHeaders = { Cookie: `pbe_session=${SESSION}`, Origin: 'https://tennis.propbetedge.ai', accept: 'application/json' };
const member = await (await fetch(`${API}/v1/membership`, { headers: authHeaders, cache: 'no-store' })).json().catch(() => null);
if (!member?.membership?.entitled) { console.log(`DNA PAGE PARITY: HOLD_NOT_ENTITLED — the session resolves to state=${member?.membership?.state || 'unknown'}; an All Access or owner session is required`); process.exit(2); }
console.log(`session: entitled (${member.membership.state})`);
const browser = await chromium.launch({ executablePath: CHROME });
const api = async (slug) => {
  const r = await fetch(`${API}/v1/players/${slug}/dna`, { headers: authHeaders });
  if (r.status !== 200) throw new Error(`/v1/players/${slug}/dna -> ${r.status} with an entitled session`);
  return (await r.json()).data;
};
const newPage = async (viewport) => {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: 'pbe_session', value: SESSION, domain: '.propbetedge.ai', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  page.on('close', () => ctx.close().catch(() => {}));
  return page;
};

async function readPage(page) {
  await page.waitForFunction(() => /Technical DNA|Tennis DNA unavailable|MATCH DNA/.test(document.querySelector('#main')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const main = document.querySelector('#main');
    const txt = (el) => el.textContent.trim().replace(/\s+/g, ' ');
    const surfRow = [...main.querySelectorAll('.surf-tbl tr')].find((tr) => /Surface PBE Rating/.test(tr.querySelector('th')?.textContent || ''));
    return {
      path: location.pathname,
      current: [...main.querySelectorAll('nav.tabs a[aria-current="page"]')].map(txt),
      h2: [...main.querySelectorAll('h2')].map(txt),
      h3: [...main.querySelectorAll('h3')].map(txt),
      text: main.innerText,
      methodology: !!main.querySelector('a[href="/methodology"]'),
      surfRatingCells: surfRow ? [...surfRow.querySelectorAll('td')].map(txt) : [],
      charts: [...main.querySelectorAll('.surf-chart h3')].map(txt),
      broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
      gate: !!document.querySelector('.progate, [data-progate]') || /ALL ACCESS — SIGN IN|Email me a sign-in link/i.test(main.innerText),
      fp: (() => { const f = main.querySelector('[data-dna-fingerprint]'); const b = f?.querySelector('svg.radar')?.getBoundingClientRect(); const t = main.querySelector('.dna-tbl'); return f ? { tour: f.dataset.dnaFingerprint, state: f.dataset.fpState, dims: f.dataset.fpDims, w: b?.width || 0, top: f.getBoundingClientRect().top, tableTop: t ? t.getBoundingClientRect().top : null, text: f.innerText } : null; })()
    };
  });
}

function assertFull(scope, r, d, tour) {
  const md = d.match_dna;
  const has = (h) => r.h2.some((x) => x.startsWith(h));
  check(scope, 'entitled session sees the page (no membership gate)', !r.gate);
  // Match DNA fingerprint: radar from published Match DNA percentiles, same-tour wording, above the tables — independent
  // of the Technical DNA gate (asserted below: the technical state is checked separately)
  if (md) {
    check(scope, 'Match DNA fingerprint radar drawn', r.fp?.state === 'published' && r.fp.w > 200, JSON.stringify({ state: r.fp?.state, w: r.fp?.w, dims: r.fp?.dims }));
    check(scope, `fingerprint compares only with ${tour}`, r.fp?.tour === tour && new RegExp(`compared only with ${tour} players`, 'i').test(r.fp?.text || '') && !new RegExp(`${tour === 'ATP' ? 'WTA' : 'ATP'} players`, 'i').test(r.fp?.text || ''));
    check(scope, 'fingerprint above the long tables', r.fp && r.fp.tableTop != null && r.fp.top < r.fp.tableTop);
  }
  check(scope, 'MATCH DNA — LIVE status', !md || /MATCH DNA — LIVE/.test(r.text));
  if (md) for (const h of CORE) check(scope, `module: ${h}`, has(h), `h2=${JSON.stringify(r.h2)}`);
  check(scope, 'methodology link', r.methodology);
  check(scope, `tour population = ${tour}`, new RegExp(`${tour} population`).test(r.text) && new RegExp(`${tour} percentile`, 'i').test(r.text));
  check(scope, 'no WTA/ATP cross-labels', tour === 'ATP' ? !/WTA percentile|WTA population/.test(r.text) : !/ATP percentile|ATP population/.test(r.text));
  if (md?.rating && md.rating.status !== 'not_validated') {
    check(scope, 'PBE Rating value shown', r.text.includes(String(md.rating.value)));
    if (md.profile?.rating_history) check(scope, 'overall rating history chart (stored)', r.h3.includes('Rating history') && /Peak/.test(r.text));
  }
  // every stored tournament-level key is rendered with a real label (no raw keys like "wta 1000")
  check(scope, 'tournament levels carry real labels (no raw keys)', !/\b(wta|atp|itf) (1000|500|250|125|women)\b/.test(r.text));
  const lv = Object.keys(md?.profile?.by_level || {});
  if (lv.some((k) => /^atp_(1000|500|250)$/.test(k))) check(scope, 'ATP tiers from the reviewed registry rendered', /ATP Masters 1000|ATP 500|ATP 250/.test(r.text));
  // By surface: no blank Surface PBE Rating cell; the hold is visible when the model is not validated
  const S = md?.by_surface || [];
  if (S.length) {
    check(scope, 'Surface PBE Rating: every cell has a value or an explicit state', r.surfRatingCells.length === S.length && r.surfRatingCells.every((c) => c && c !== '—'), JSON.stringify(r.surfRatingCells));
    if (S.some((s) => s.rating?.status === 'not_validated')) check(scope, 'surface model hold is explained', /Not published — the .* surface model has not passed its out-of-sample validation gate/.test(r.text));
    const charted = S.filter((s) => s.rating && s.rating.status !== 'not_validated' && s.profile?.rating_history).map((s) => s.surface);
    check(scope, 'surface rating history: a chart for every validated stored history', charted.every((sf) => r.charts.some((c) => c.toLowerCase() === sf)), `${charted} vs ${r.charts}`);
    check(scope, 'surface rating history: every other rated surface explains why', S.filter((s) => s.rating && !charted.includes(s.surface)).every((s) => new RegExp(`${s.surface[0].toUpperCase()}${s.surface.slice(1)}:`).test(r.text)));
    check(scope, 'unsourced-surface disclosure when results lack a surface', !md.form?.career || /have no sourced surface|Only matches whose tournament edition has a sourced surface/.test(r.text));
  }
  // Technical DNA: a real module in both states
  const cmp = d.dna?.comparative;
  if (d.dna) {
    check(scope, `Technical DNA state = ${cmp?.published ? 'published' : 'coverage building'}`, cmp?.published ? /Technical DNA — published/i.test(r.text) : /TECHNICAL DNA — COVERAGE BUILDING/.test(r.text) && r.text.includes(`${cmp.qualified} of ${cmp.threshold}`));
    check(scope, 'Technical DNA measurements visible', /Metric\s+Value\s+Sample\s+Confidence/i.test(r.text.replace(/\t/g, ' ')) || /METRIC\s+VALUE/i.test(r.text));
  }
  check(scope, 'no broken images', r.broken.length === 0, r.broken.join(' '));
}

const data = Object.fromEntries(await Promise.all(PLAYERS.map(async ([s]) => [s, await api(s)])));

// 1. direct routes, same route class for both tours
for (const w of WIDTHS) {
  const page = await newPage({ width: w, height: 1000 });
  const errs = [];
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 120)));
  for (const [slug, tour] of PLAYERS) {
    await page.goto(`${BASE}/players/${slug}/dna`, { waitUntil: 'load' });
    let r = await readPage(page);
    // one reload when nothing rendered within the wait (a slow cold API read), recorded — never silently skipped
    if (!r.h2.length) { console.log(`note: ${slug} @${w} rendered nothing in 30 s; reloading once`); await page.reload({ waitUntil: 'load' }); r = await readPage(page); r.reloaded = true; }
    const shot = `${SHOTS}/${slug}-dna-${w}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    assertFull(`${slug} /dna @${w}`, r, data[slug], tour);
    report.push({ title: `${slug} — full Tennis DNA @${w}px${r.reloaded ? ' (after one reload)' : ''}`, shot, path: r.path, current: r.current, h2: r.h2, h3: r.h3 });
  }
  check(`console @${w}`, 'no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// 2. click navigation (what a visitor actually does)
for (const [slug, tour] of [['carlos-alcaraz', 'ATP'], ['elena-rybakina', 'WTA']]) {
  for (const w of WIDTHS) {
    const page = await newPage({ width: w, height: 1000 });
    await page.goto(`${BASE}/players/${slug}`, { waitUntil: 'load' });
    await page.waitForFunction(() => /Match DNA/.test(document.querySelector('#main')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
    const ov = await page.evaluate(() => ({ path: location.pathname, h2: [...document.querySelectorAll('#main h2')].map((h) => h.textContent.trim().replace(/\s+/g, ' ')), h3: [...document.querySelectorAll('#main h3')].map((h) => h.textContent.trim()), cta: !!document.querySelector('#main .dna-more a[href$="/dna"]'), current: [...document.querySelectorAll('#main nav.tabs a[aria-current="page"]')].map((a) => a.textContent.trim()) }));
    const oshot = `${SHOTS}/${slug}-overview-${w}.png`;
    await page.screenshot({ path: oshot, fullPage: true });
    report.push({ title: `${slug} — Overview @${w}px`, shot: oshot, path: ov.path, current: ov.current, h2: ov.h2, h3: ov.h3 });
    check(`${slug} overview @${w}`, 'Overview is current and the summary says it is a summary', ov.current.includes('Overview') && ov.cta && ov.h2.some((h) => /^Match DNA/.test(h)));
    await page.locator('#main nav.tabs a', { hasText: /^Tennis DNA$/ }).first().click();
    await page.waitForFunction((s) => location.pathname === `/players/${s}/dna`, slug, { timeout: 15000 }).catch(() => {});
    const r = await readPage(page);
    check(`${slug} click @${w}`, 'clicking Tennis DNA changes the route', r.path === `/players/${slug}/dna`, r.path);
    check(`${slug} click @${w}`, 'Tennis DNA tab aria-current=page', r.current.includes('Tennis DNA'), JSON.stringify(r.current));
    assertFull(`${slug} click @${w}`, r, data[slug], tour);
    report.push({ title: `${slug} — after clicking Tennis DNA @${w}px`, shot: '(same as direct route)', path: r.path, current: r.current, h2: r.h2, h3: r.h3 });
    await page.locator('#main nav.tabs a', { hasText: /^Overview$/ }).first().click();
    await page.waitForFunction((s) => location.pathname === `/players/${s}`, slug, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const back = await page.evaluate(() => ({ path: location.pathname, summary: !!document.querySelector('#main .mdna-summary'), current: [...document.querySelectorAll('#main nav.tabs a[aria-current="page"]')].map((a) => a.textContent.trim()) }));
    check(`${slug} click @${w}`, 'clicking Overview returns to the summary', back.path === `/players/${slug}` && back.summary && back.current.includes('Overview'), JSON.stringify(back));
    await page.close();
  }
}
await browser.close();

// 3. same architecture across tours (h2 sequence of the full page, 1440)
const seq = (slug) => report.find((x) => x.title.startsWith(`${slug} — full Tennis DNA @1440px`)).h2.filter((h) => CORE.some((c) => h.startsWith(c))).map((h) => CORE.find((c) => h.startsWith(c)));
const ref = seq('elena-rybakina');
for (const [slug] of PLAYERS) check(`${slug}`, 'same module sequence as Rybakina', JSON.stringify(seq(slug)) === JSON.stringify(ref), `${seq(slug)} vs ${ref}`);

const failed = results.filter((r) => !r.ok);
const md = [`# Tennis DNA visible parity — ${new Date().toISOString()}`, '', `Base: ${BASE}. Checks: ${results.length - failed.length}/${results.length} passed.`, '',
  ...report.flatMap((x) => [`## ${x.title}`, `- URL: ${x.path} · current tab: ${x.current.join(', ') || '—'} · screenshot: ${x.shot}`, `- H2: ${x.h2.join(' | ')}`, `- H3: ${x.h3.join(' | ') || '—'}`, '']),
  failed.length ? `## Failures\n${failed.map((f) => `- ${f.scope}: ${f.name} ${f.detail}`).join('\n')}` : '## Failures\nnone'];
fs.mkdirSync('docs/evidence', { recursive: true });
fs.writeFileSync('docs/evidence/dna-page-parity-latest.md', md.join('\n') + '\n');
console.log(`DNA PAGE PARITY: ${failed.length ? `FAIL (${failed.length})` : 'PASS'} (${results.length - failed.length}/${results.length})`);
process.exitCode = failed.length ? 1 : 0;
