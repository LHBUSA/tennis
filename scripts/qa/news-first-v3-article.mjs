#!/usr/bin/env node
// One-shot proof that a NATURALLY eligible post-cutover event went through the whole V3 article pipeline in production.
//   node scripts/qa/news-first-v3-article.mjs            -> PASS | HOLD_NO_ELIGIBLE_EVENT | FAIL (last line)
// QA_MECHANICS_ANY=1 only exercises this script on any published story (expect the live-path checks to FAIL there).
// Never manufactures an event, never promotes a below-class event, never touches thresholds. Read-only SQL via
// scripts/db/run_sql.ps1 (the Supabase service key is never read locally) + a real browser at 390 / 1440.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const CUTOVER = '2026-09-29T16:50:00Z';
const WEB = process.env.QA_BASE || 'https://tennis.propbetedge.ai';
const API = process.env.API_BASE || 'https://tennis-api.propbetedge.ai';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 32 << 20 }); const at = ["[", "{"].map((c) => out.indexOf(c)).filter((x) => x >= 0); if (!at.length) return []; const v = JSON.parse(out.slice(Math.min(...at))); if (v && !Array.isArray(v) && v.message) throw new Error(v.message); return Array.isArray(v) ? v : [v]; };
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

async function main() {
  const rows = sql(`select a.slug, a.desk, a.story_class, a.prose_origin, a.gate_results->'gate'->>'pass' gate_pass, a.content_plan->'evidence_dimensions' dims, a.tournament, a.player_ids,
      to_char(a.first_published_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"') published_at, e.event_id, e.kind, e.editorial_class, e.class_history,
      to_char(e.detected_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"') detected_at, m.match_id, m.event_type, m.source_family,
      to_char((select min(c.observed_at) from tennis_source_changes c where c.entity_type='match' and c.entity_id=m.match_id::text and c.field='status' and (c.to_value #>> '{}') in ('completed','retired','walkover')) at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"') final_seen,
      to_char(ev.frozen_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"') frozen_at, ev.packet ? 'match_dna' has_match_dna, ev.packet->'match_dna' match_dna, ev.packet ? 'expectation' has_expectation,
      (select json_agg(json_build_object('stage', p.stage, 'status', p.status, 'at', p.at) order by p.at) from tennis_news_pipeline_events p where p.event_id = e.event_id) pipeline
    from tennis_articles a join tennis_news_events e on e.event_id = a.event_id left join tennis_matches m on m.match_id = e.match_id left join tennis_article_evidence ev on ev.article_id = a.article_id
    where a.status = 'published' and ${process.env.QA_MECHANICS_ANY ? 'true' : `e.detected_at >= '${CUTOVER}' and not exists (select 1 from jsonb_array_elements(e.class_history) x where x->>'stage' = 'reclassify_v3')`}
    order by a.first_published_at asc limit 1`);
  if (!rows.length) { console.log(`no naturally eligible event detected at/after ${CUTOVER} has been published yet`); return 'HOLD_NO_ELIGIBLE_EVENT'; }
  const r = rows[0];
  const hist = Array.isArray(r.class_history) ? r.class_history : [];
  console.log(JSON.stringify({ event: r.event_id, kind: r.kind, tour: r.event_type, source_family: r.source_family, class: r.editorial_class, story_class: r.story_class, source_terminal_observed: r.final_seen, detected: r.detected_at, packet_frozen: r.frozen_at, published: r.published_at, url: `${WEB}/news/${r.slug}`, prose: r.prose_origin, gate_pass: r.gate_pass, evidence_dimensions: r.dims, class_history: hist.map((h) => `${h.stage}:${h.class}`), pipeline: (r.pipeline || []).map((p) => `${p.stage}:${p.status}`) }, null, 1));
  const ms = (a, b) => (a && b ? Date.parse(b) - Date.parse(a) : NaN);
  check('chain order: terminal source observation <= detection <= packet frozen <= published', (!r.final_seen || Date.parse(r.final_seen) <= Date.parse(r.detected_at)) && Date.parse(r.detected_at) <= Date.parse(r.frozen_at) && Date.parse(r.frozen_at) <= Date.parse(r.published_at) + 1000, `${r.final_seen} -> ${r.detected_at} -> ${r.frozen_at} -> ${r.published_at}`);
  check('classified at detection and at enrichment (brief/full/deep)', hist.some((h) => h.stage === 'detect') && hist.some((h) => h.stage === 'enrich') && ['brief', 'full', 'deep'].includes(r.story_class));
  check('evidence dimensions recorded', Array.isArray(r.dims) && r.dims.length >= 2, JSON.stringify(r.dims));
  check('gates passed', r.gate_pass === 'true');
  check('model prose or fact-safe baseline recorded', ['model', 'baseline'].includes(r.prose_origin), r.prose_origin);
  if (['MS', 'WS'].includes(r.event_type)) {
    const md = r.match_dna || {};
    const ok = Object.values(md).every((x) => x.as_of && x.as_of < r.detected_at.slice(0, 10) && (x.rating ? x.rating_validated_at_the_time === true : true));
    check('Match DNA historical cutoff truthful (as_of before the match; ratings only if validated at the time)', r.has_match_dna === true && ok);
  }
  const d2p = ms(r.detected_at, r.published_at) / 60000;
  check('detection -> public < 2 minutes', d2p < 2, `${d2p.toFixed(2)} min`);
  const api = (await (await fetch(`${API}/v1/news/${r.slug}`)).json()).data;
  check('freshness: a live-path story (not backfill)', api?.freshness && api.freshness.is_backfill === false);
  check('at-a-glance: 2-5 non-empty cells', Array.isArray(api?.glance) && api.glance.length >= 2 && api.glance.every((c) => c.label && String(c.value || '').trim()));

  const browser = await chromium.launch({ executablePath: CHROME });
  for (const w of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width: w, height: 1000 } });
    const errs = [];
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 120)));
    for (const [route, label] of [['/news', 'front'], [`/news/${r.desk}`, 'desk']]) {
      await page.goto(`${WEB}${route}`, { waitUntil: 'load' }); await page.waitForTimeout(6000);
      const found = await page.evaluate((slug) => { const a = document.querySelector(`#main a[href="/news/${slug}"]`); const t = a?.closest('article, li')?.querySelector('time')?.textContent.trim() || ''; return { present: !!a, clock: t }; }, r.slug);
      check(`@${w} ${label} ${route}: story present with a fresh (not "Match …") clock`, found.present && !/^Match /.test(found.clock), found.clock);
    }
    await page.goto(`${WEB}/news/${r.slug}`, { waitUntil: 'load' }); await page.waitForTimeout(7000);
    const art = await page.evaluate(() => ({
      h1: document.querySelector('#main h1')?.textContent.trim() || '',
      meta: document.querySelector('.nwm-meta time')?.textContent.trim() || '',
      hero: (() => { const i = document.querySelector('#main .nwm-hero img, #main figure img'); return i ? { ok: i.complete && i.naturalWidth > 0, src: i.currentSrc || i.src } : { ok: !!document.querySelector('#main .nf-band-hero'), src: 'branded fallback (.nf-band-hero)' }; })(),
      glance: document.querySelectorAll('#main .nw-glance > div, #main [class*="glance"] li, #main [class*="glance"] > div').length,
      source: !!document.querySelector('#main details'),
      links: [...document.querySelectorAll('#main a[href^="/players/"], #main a[href^="/tournaments/"]')].length
    }));
    check(`@${w} article renders (H1, fresh clock, image or legitimate fallback, glance, collapsed Source & Method, graph links)`, art.h1 && !/^Match /.test(art.meta) && art.hero.ok && art.glance > 0 && art.source && art.links > 0, JSON.stringify({ meta: art.meta, hero: art.hero.src?.slice(0, 80), glance: art.glance, links: art.links }));
    if (r.tournament?.slug && r.tournament?.year) {
      await page.goto(`${WEB}/tournaments/${r.tournament.slug}/${r.tournament.year}`, { waitUntil: 'load' }); await page.waitForTimeout(6000);
      check(`@${w} tournament page links the story`, await page.evaluate((slug) => !!document.querySelector(`#main a[href="/news/${slug}"]`), r.slug));
    }
    check(`@${w} no console errors`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }
  await browser.close();
  fs.mkdirSync('docs/evidence', { recursive: true });
  fs.writeFileSync('docs/evidence/news-first-v3-article-latest.json', JSON.stringify({ at: new Date().toISOString(), row: { ...r, match_dna: undefined }, checks }, null, 2) + '\n');
  return checks.every((c) => c.ok) ? 'PASS' : 'FAIL';
}

const outcome = await main();
console.log(outcome);
process.exitCode = outcome === 'FAIL' ? 1 : 0;
