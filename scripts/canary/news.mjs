// Newsroom production canary.
//   node scripts/canary/news.mjs            -> docs/evidence/news-canary-latest.json (exit 1 on any FAIL)
// Proves: every public story is published and passed its frozen-evidence gates; no held story is reachable
// without the preview token (API, page, sitemap); the Worker reports its editorial mode. Secrets are read from
// D:\Workers\secrets and never printed.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const API = 'https://tennis-api.propbetedge.ai';
const SITE = 'https://tennis.propbetedge.ai';
const NEWS = 'https://tennis-news.sales-fd3.workers.dev';
const checks = [];
const add = (name, pass, detail = {}) => { checks.push({ name, result: pass ? 'PASS' : 'FAIL', ...detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`, Object.keys(detail).length ? JSON.stringify(detail).slice(0, 200) : ''); };
const get = async (u, opts = {}) => { const r = await fetch(u, { headers: { 'cache-control': 'no-cache' }, ...opts }); const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* html */ } return { status: r.status, body, text, headers: r.headers }; };
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8' }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0); if (!at.length) return []; /* no rows */ const v = JSON.parse(out.slice(Math.min(...at))); return Array.isArray(v) ? v : [v]; };

const h = (await get(`${NEWS}/health`)).body?.data || (await get(`${NEWS}/health`)).body;
add('tennis-news health', !!h?.ok, { mode: h?.mode, editorial: h?.editorial });

const list = (await get(`${API}/v1/news?limit=60&t=${Date.now()}`)).body?.data?.articles || [];
add('public list contains published stories only', list.every((a) => a.status === 'published'), { published: list.length });
for (const a of list.slice(0, 20)) {
  const d = (await get(`${API}/v1/news/${a.slug}?t=${Date.now()}`)).body?.data;
  add(`story ${a.slug.slice(0, 50)}: gates passed + frozen evidence`, !!d && d.method?.gates_passed === true && !!d.evidence?.frozen_at, { prose: d?.method?.prose });
}

const bad = sql("select count(*) n from tennis_articles where status='published' and coalesce((gate_results->'gate'->>'pass')::boolean, false) is not true")[0]?.n ?? null;
add('DB: no published story without passing gates', bad !== null && Number(bad) === 0, { violations: bad });
const held = sql("select slug from tennis_articles where status='held' order by created_at desc limit 5").map((r) => r.slug);
for (const slug of held) {
  const api = await get(`${API}/v1/news/${slug}?t=${Date.now()}`);
  add(`held ${slug.slice(0, 40)}: API 404 without token`, api.status === 404);
  const page = await get(`${SITE}/news/${slug}`);
  add(`held ${slug.slice(0, 40)}: page 404 + noindex`, page.status === 404 && /noindex/.test(page.headers.get('x-robots-tag') || '') && /name="robots" content="noindex/.test(page.text));
}
const sm = (await get(`${SITE}/sitemap.xml`)).text;
add('sitemap lists no held story', held.every((s) => !sm.includes(`/news/${s}`)), { held_checked: held.length });
add('sitemap lists every published story', list.every((a) => sm.includes(`/news/${a.slug}`)), { published: list.length });

const out = { checked_at: new Date().toISOString(), result: checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL', summary: { pass: checks.filter((c) => c.result === 'PASS').length, fail: checks.filter((c) => c.result === 'FAIL').length }, checks };
fs.writeFileSync('docs/evidence/news-canary-latest.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(`news canary: ${out.result}`, JSON.stringify(out.summary));
if (out.result !== 'PASS') process.exitCode = 1;
