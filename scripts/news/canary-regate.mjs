#!/usr/bin/env node
// Re-gate the stored Astra/Sol canary outputs with the CURRENT deterministic gates — no model call, identical inputs for
// both versions (the canary's own recipe: baseline + plan rebuilt from the frozen packet, model prose over the baseline).
//   node scripts/news/canary-regate.mjs   -> docs/evidence/ai-canary/regate.json + console table
// Read-only SQL via scripts/db/run_sql.ps1 (the Supabase service key is never read locally).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { compose } from '../../workers/tennis-news/src/compose.js';
import { buildPlan } from '../../workers/tennis-news/src/plan.js';
import { runGates, GATES_VERSION } from '../../workers/tennis-news/src/gates.js';

const DIR = 'docs/evidence/ai-canary/raw';
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 64 << 20 }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0); if (!at.length) return []; const v = JSON.parse(out.slice(Math.min(...at))); return Array.isArray(v) ? v : [v]; };
const rows = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  const raw = JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf8'));
  // base64 over the PowerShell pipe: non-ASCII characters in the packet (e.g. an arrow in a label) otherwise arrive mangled
  const [row] = sql(`select encode(convert_to(ev.packet::text, 'UTF8'), 'base64') b64 from tennis_articles a join tennis_article_evidence ev on ev.article_id = a.article_id where a.slug = '${raw.slug.replace(/'/g, "''")}'`);
  const packet = row?.b64 ? JSON.parse(Buffer.from(row.b64.replace(/\s/g, ''), 'base64').toString('utf8')) : null;
  if (!packet) { rows.push({ file: f, error: 'no frozen packet' }); continue; }
  const baseline = compose(packet, { storyClass: raw.story_class || 'full' });
  const plan = buildPlan(packet, baseline);
  const method = baseline.sections.find((s) => s.id === 'method');
  for (const r of raw.results) {
    if (!r.sections) { rows.push({ file: f, model: r.model, error: 'no output' }); continue; }
    const sections = r.sections.some((s) => s.id === 'method') || !method ? r.sections : [...r.sections, method];
    const draft = { ...baseline, headline: r.headline, dek: r.dek, sections, prose_origin: 'model' };
    const g = runGates(draft, packet, { plan });
    rows.push({ file: f, category: raw.category, model: r.model, gate_at_run: r.gate?.pass ?? null, gate_now: g.pass, failures_now: g.failures.map((x) => `${x.gate}: ${String(x.detail).slice(0, 90)}`) });
  }
}
const by = {};
for (const r of rows.filter((x) => x.model)) { const m = (by[r.model] ||= { packets: 0, pass_at_run: 0, pass_now: 0 }); m.packets += 1; m.pass_at_run += r.gate_at_run ? 1 : 0; m.pass_now += r.gate_now ? 1 : 0; }
const out = { gates_version: GATES_VERSION, generated_at: new Date().toISOString(), summary: by, rows };
fs.writeFileSync('docs/evidence/ai-canary/regate.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(by, null, 1));
for (const r of rows) if (!r.gate_now) console.log(`${r.file.slice(0, 10)} ${r.model}: ${(r.failures_now || [r.error]).join(' | ')}`);
