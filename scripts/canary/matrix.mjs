#!/usr/bin/env node
// Regenerates the generated sections of docs/TENNIS_SOURCE_MATRIX.md from
// data/source-registry/sources.json + docs/evidence/source-canary-latest.json.
// Hand-written prose lives outside the <!-- generated --> markers and is preserved.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOC = path.join(ROOT, 'docs', 'TENNIS_SOURCE_MATRIX.md');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'source-registry', 'sources.json'), 'utf8'));
const can = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'evidence', 'source-canary-latest.json'), 'utf8'));
const res = new Map((can.results || []).map((r) => [r.key, r]));
const fam = Object.fromEntries(reg.families.map((f) => [f.key, f.label]));
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

const lines = [];
lines.push(`Registry ${reg.updated_at} · canary run ${can.run_at} (${can.runner}) · UA \`${can.user_agent}\``, '');
lines.push('| Source | Verdict | Capabilities | Canary (latest) | Terms | Production status |', '|---|---|---|---|---|---|');
for (const f of reg.families) {
  const rows = reg.sources.filter((s) => s.family === f.key);
  if (!rows.length) continue;
  lines.push(`| **${cell(fam[f.key])}** | | | | | |`);
  for (const s of rows) {
    const r = s.evidence?.canary_key ? res.get(s.evidence.canary_key) : null;
    const c = r ? `${r.state} · HTTP ${r.http_status ?? '-'}${r.record_count != null ? ` · ${r.record_count} rec` : ''}${r.bytes != null ? ` · ${r.bytes} B` : ''}` : (s.evidence?.file || s.evidence?.r2_key ? 'audit request (private archive)' : '—');
    lines.push(`| \`${s.key}\` ${cell(s.name)} | ${s.verdict} | ${cell((s.capabilities || []).join(', '))} | ${cell(c)} | ${cell(s.terms?.status || '—')} | ${cell(s.production_status)} |`);
  }
}
lines.push('', '### Endpoint templates and notes', '');
for (const s of reg.sources.filter((x) => x.verdict !== 'COMMERCIAL_REFERENCE_ONLY')) {
  lines.push(`- **\`${s.key}\`** — ${s.url ? `\`${s.url}\`` : '_no working endpoint yet_'}${Object.keys(s.native_ids || {}).length ? ` · ids: ${Object.entries(s.native_ids).map(([k, v]) => `${k} = ${v}`).join('; ')}` : ''}${s.notes ? `  \n  ${s.notes}` : ''}${s.robots ? `  \n  robots: ${String(s.robots).slice(0, 220)}` : ''}`);
}
lines.push('', '### Terms of use — verbatim', '');
const seen = new Set();
for (const s of reg.sources) {
  const q = s.terms?.quote;
  if (!q || seen.has(q)) continue;
  seen.add(q);
  lines.push(`- **${fam[s.family] || s.family}** (${s.terms.url || 'n/a'}): “${q}”`);
}

const block = `<!-- generated:start (npm run matrix) -->\n${lines.join('\n')}\n<!-- generated:end -->`;
const doc = fs.readFileSync(DOC, 'utf8');
if (!doc.includes('<!-- generated:start')) throw new Error('matrix markers missing');
fs.writeFileSync(DOC, doc.replace(/<!-- generated:start[\s\S]*?<!-- generated:end -->/, block));
console.log(`matrix: ${reg.sources.length} sources written to docs/TENNIS_SOURCE_MATRIX.md`);
