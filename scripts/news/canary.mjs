#!/usr/bin/env node
// Offline Astra-vs-Sol canary driver (V4). NEVER publishes: the Worker endpoint reads a stored frozen packet and returns
// drafts + metrics; nothing is written to the database.
//   node scripts/news/canary.mjs --plan                  -> choose the 10 packets and print them (no model calls)
//   node scripts/news/canary.mjs [--base <worker url>] [--models gpt-5.6-sol,gpt-6-astra] [--only <event_id>]
// Output: docs/evidence/ai-canary/raw/<n>-<event>.json, docs/evidence/ai-canary/blind-review.md (VERSION A / B in seeded
// random order per packet), docs/evidence/ai-canary/key.json (the mapping — do not open while scoring),
// docs/evidence/ai-canary/metrics.json (per-model aggregates).
// The admin token is read from D:/Workers/secrets/tennis-news-admin-token INTO MEMORY; never printed or passed in argv.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = (arg('base', 'https://tennis-news.sales-fd3.workers.dev')).replace(/\/$/, '');
const MODELS = arg('models', 'gpt-5.6-sol,gpt-6-astra').split(',');
const OUT = 'docs/evidence/ai-canary';
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 32 << 20 }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0); if (!at.length) return []; const v = JSON.parse(out.slice(Math.min(...at))); if (v && !Array.isArray(v) && v.message) throw new Error(v.message); return Array.isArray(v) ? v : [v]; };

/** Candidate packets: every published article with a frozen packet, with the facts the categories need. */
function candidates() {
  return sql(`select a.event_id, a.slug, a.desk, a.story_type, a.story_class, coalesce(jsonb_array_length(a.content_plan->'evidence_dimensions'), 0) dims,
      coalesce(e.packet->'tournament'->>'level', e.packet->'event'->'facts'->>'edition_tier', '') level, coalesce(e.packet->'event'->'facts'->>'round', e.packet->'match'->>'round', '') round,
      e.packet->'match'->>'event_type' event_type, length(e.packet::text) packet_chars, (e.packet ? 'match_dna') has_match_dna, (e.packet ? 'stats') has_stats
    from tennis_articles a join tennis_article_evidence e on e.article_id = a.article_id where a.status = 'published' order by a.first_published_at`);
}

const MAJOR = /grand slam|1000|500|finals/i;
/** The 10 categories of the brief; an absent category is substituted with the closest honest one and SAID so. */
export function choose(rows) {
  const used = new Set();
  const pick = (cat, pred, sub, subPred, sort = () => 0) => {
    const pool = rows.filter((r) => !used.has(r.event_id));
    let r = [...pool].sort(sort).find(pred);
    let note = null;
    if (!r && subPred) { r = [...pool].sort(sort).find(subPred); note = r ? `no stored packet for "${cat}": substituted ${sub}` : `no stored packet for "${cat}" and no substitute`; }
    if (r) used.add(r.event_id);
    return { category: cat, row: r || null, note };
  };
  const dims = (a, b) => Number(b.dims) - Number(a.dims);
  return [
    pick('major match', (r) => MAJOR.test(r.level) && /^(M-)?[FS]$/.test(r.round) && ['WS', 'MS'].includes(r.event_type), 'the deepest singles final/semifinal available', (r) => /^(M-)?[FS]$/.test(r.round) && ['WS', 'MS'].includes(r.event_type), (a, b) => (b.story_class === 'full') - (a.story_class === 'full') || dims(a, b)),
    pick('upset', (r) => /upset/.test(r.story_type || ''), null, null, dims),
    pick('routine match', (r) => /comeback|deciding_tiebreak|marathon|dominant/.test(r.story_type || '') && r.story_class === 'brief', null, null, dims),
    pick('player form', (r) => r.has_match_dna === true && Number(r.dims) >= 5, 'a match story whose packet carries the deepest pre-match Match DNA form context (no dedicated form-feature packet exists)', (r) => r.has_match_dna === true, dims),
    pick('ranking movement', (r) => /^enters_top|new_no1/.test(r.story_type || ''), 'the remaining ATP story (no ranking article has ever been published, so no ranking packet exists)', (r) => r.desk === 'atp', dims),
    pick('tournament intelligence', (r) => false, 'a tournament-concluding title story (no tournament-intelligence feature packet exists)', (r) => /title/.test(r.story_type || ''), dims),
    pick('ATP', (r) => r.desk === 'atp', null, null, dims),
    pick('WTA', (r) => r.desk === 'wta', null, null, dims),
    pick('rich packet', (r) => Number(r.dims) >= 7, 'the richest remaining packet', (r) => true, dims),
    pick('thin but publishable', (r) => Number(r.dims) <= 3, 'the thinnest remaining packet', (r) => true, (a, b) => Number(a.dims) - Number(b.dims))
  ];
}

const rng = (seed) => { let h = crypto.createHash('sha256').update(seed).digest(); let i = 0; return () => { if (i >= h.length) { h = crypto.createHash('sha256').update(h).digest(); i = 0; } return h[i++] / 256; }; };
const esc = (t) => String(t || '').replace(/\r?\n/g, ' ');

async function main() {
  const picks = choose(candidates());
  console.log(picks.map((p, i) => `${i + 1}. ${p.category}: ${p.row ? `${p.row.slug} (${p.row.desk}, ${p.row.story_class}, ${p.row.dims} dims)` : '—'}${p.note ? `  [${p.note}]` : ''}`).join('\n'));
  if (process.argv.includes('--plan')) return;
  const TOKEN = fs.readFileSync('D:/Workers/secrets/tennis-news-admin-token', 'utf8').trim();
  fs.mkdirSync(`${OUT}/raw`, { recursive: true });
  const only = arg('only', null);
  const runs = [];
  for (const [i, p] of picks.entries()) {
    if (!p.row || (only && p.row.event_id !== only)) continue;
    const url = `${BASE}/v1/news/canary?event_id=${encodeURIComponent(p.row.event_id)}&models=${encodeURIComponent(MODELS.join(','))}`;
    const t0 = Date.now();
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
    const body = (await res.text()).replaceAll(TOKEN, '***');
    let data;
    try { data = JSON.parse(body).data; } catch { data = { error: `http ${res.status}: ${body.slice(0, 200)}` }; }
    const file = `${OUT}/raw/${String(i + 1).padStart(2, '0')}-${p.row.event_id.replace(/[^a-z0-9_-]/gi, '_')}.json`;
    fs.writeFileSync(file, JSON.stringify({ category: p.category, substitution: p.note, wall_ms: Date.now() - t0, ...data }, null, 2) + '\n');
    runs.push({ i: i + 1, category: p.category, note: p.note, data });
    console.log(`${i + 1}. ${p.category}: ${data?.error || (data?.results || []).map((r) => `${r.model} ${r.ok ? `gate ${r.gate.pass ? 'PASS' : 'FAIL'} ${r.words}w ${r.usage.output_tokens}out ${r.latency_ms}ms` : `ERROR ${r.error}`}`).join(' | ')}`);
  }
  // blind review: VERSION A / VERSION B per packet in seeded random order; mapping only in key.json
  const key = {};
  const md = ['# Tennis AI canary — blind review', '', 'Two versions per frozen packet, identical instructions, schema, plan, output cap and gates. Model names are hidden: score first, then open key.json.', '',
    '## Scoring (1-5 each; gate pass is objective)', '1. factual gate pass · 2. depth / evidence coverage · 3. synthesis vs stat recitation · 4. headline · 5. section quality · 6. repetition (5 = none) · 7. tennis-specific analysis · 8. readability · 9. tokens (from metrics) · 10. latency (from metrics)', ''];
  for (const r of runs) {
    const res = (r.data?.results || []).filter((x) => x.ok);
    if (res.length < 2) { md.push(`## ${r.i}. ${r.category}`, '', `_not comparable: ${r.data?.error || (r.data?.results || []).map((x) => x.error).filter(Boolean).join('; ')}_`, ''); continue; }
    const rand = rng(`tennis-ai-canary:${r.data.event_id}`);
    const order = rand() < 0.5 ? [res[0], res[1]] : [res[1], res[0]];
    key[r.data.event_id] = { A: order[0].model, B: order[1].model, category: r.category };
    md.push(`## ${r.i}. ${r.category} — ${r.data.story_class} · ${r.data.desk}${r.note ? ` _(${r.note})_` : ''}`, '');
    for (const [lab, v] of [['VERSION A', order[0]], ['VERSION B', order[1]]]) {
      md.push(`### ${lab}`, `- gate: ${v.gate.pass ? 'PASS' : `FAIL (${v.gate.failures.map((f) => f.gate).join(', ')})`} · ${v.words} words · ${v.section_count} sections · families: ${v.evidence_families_used.join(', ') || '—'} · repeated 5-grams ${v.diagnostics.repeated_5grams} · paragraphs with 4+ numbers ${v.diagnostics.paragraphs_with_4plus_numbers}`, '', `**${esc(v.headline)}**`, '', `_${esc(v.dek)}_`, '');
      for (const s of v.sections) md.push(`#### ${esc(s.heading)}`, ...s.paragraphs.map(esc).flatMap((p) => [p, '']));
    }
    md.push('| criterion | A | B |', '|---|---|---|', ...['1 gate', '2 depth', '3 synthesis', '4 headline', '5 sections', '6 repetition', '7 tennis analysis', '8 readability'].map((c) => `| ${c} | | |`), '');
  }
  fs.writeFileSync(`${OUT}/blind-review.md`, md.join('\n') + '\n');
  fs.writeFileSync(`${OUT}/key.json`, JSON.stringify(key, null, 2) + '\n');
  // per-model aggregates (objective)
  const agg = {};
  for (const r of runs) for (const x of r.data?.results || []) {
    const a = (agg[x.model] ||= { packets: 0, ok: 0, gate_pass: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, latency_ms: [], words: [], nominal_standard_cost: 0, cost_known: true });
    a.packets += 1;
    if (!x.ok) continue;
    a.ok += 1; if (x.gate.pass) a.gate_pass += 1;
    a.input_tokens += x.usage.input_tokens || 0; a.output_tokens += x.usage.output_tokens || 0; a.reasoning_tokens += x.usage.reasoning_tokens || 0;
    a.latency_ms.push(x.latency_ms); a.words.push(x.words);
    if (x.nominal_standard_cost == null) a.cost_known = false; else a.nominal_standard_cost += x.nominal_standard_cost;
  }
  const med = (xs) => { const s = [...xs].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const metrics = Object.fromEntries(Object.entries(agg).map(([m, a]) => [m, { packets: a.packets, completed: a.ok, gate_pass: a.gate_pass, avg_input_tokens: a.ok ? Math.round(a.input_tokens / a.ok) : null, avg_output_tokens: a.ok ? Math.round(a.output_tokens / a.ok) : null, avg_reasoning_tokens: a.ok ? Math.round(a.reasoning_tokens / a.ok) : null, median_latency_ms: med(a.latency_ms), median_words: med(a.words), nominal_standard_cost_usd: a.cost_known ? Math.round(a.nominal_standard_cost * 1e4) / 1e4 : 'rate not configured (TENNIS_AI_RATES)' }]));
  fs.writeFileSync(`${OUT}/metrics.json`, JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, models: MODELS, metrics }, null, 2) + '\n');
  console.log(JSON.stringify(metrics, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('canary.mjs')) await main();
