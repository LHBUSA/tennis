// Shadow canary for the newsroom — READ-ONLY against the sports project.
//   node scripts/news/shadow.mjs [--hours 72] [--limit 12] [--out docs/evidence/news-shadow-latest.json]
// Detects candidate events from real data, builds frozen packets, the fact-safe baseline article, the
// deterministic content plan and runs every gate. Nothing is written to the database.
import fs from 'node:fs';
import { storeFromEnv } from '../../workers/shared/store/postgrest.js';
import { detect } from '../../workers/tennis-news/src/index.js';
import { buildPacket } from '../../workers/tennis-news/src/packet.js';
import { compose } from '../../workers/tennis-news/src/compose.js';
import { buildPlan } from '../../workers/tennis-news/src/plan.js';
import { runGates } from '../../workers/tennis-news/src/gates.js';
import { eventId } from '../../workers/tennis-news/src/detect.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const envText = fs.readFileSync('D:/Workers/secrets/ufc-propbetedge.env', 'utf8').replace(/^\uFEFF/, '');
const g = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(envText) || [])[1]?.trim().replace(/^"|"$/g, '');
const env = { TENNIS_MODEL_SUPABASE_URL: g('SUPABASE_URL'), TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY: g('SUPABASE_SERVICE_ROLE_KEY') };
const store = storeFromEnv(env);
const hours = Number(arg('hours', 72));
const limit = Number(arg('limit', 12));
const now = new Date();

// look further back than production (the updated_at prefilter is widened so a quiet week still yields a canary set)
const origSelect = store.select.bind(store);
store.select = (t, q) => origSelect(t, t === 'tennis_matches' ? q.replace(/updated_at=gte\.[^&]+/, `updated_at=gte.${new Date(now - hours * 3600e3).toISOString()}`) : q);
const d = await detect(env, store, { now, dry: true });
const cands = (d.candidates || []).filter((c) => c.state !== 'duplicate').sort((a, b) => b.materiality - a.materiality).slice(0, limit);
const results = [];
for (const c of cands) {
  const ev = { ...c, event_id: await eventId(c.kind, [c.match_id || c.facts?.name || 'x'], c.match_id || c.facts?.list_date), entity_ids: c.entity_ids || [] };
  const packet = await buildPacket(store, ev);
  if (!packet) { results.push({ kind: c.kind, error: 'packet_unavailable' }); continue; }
  const article = compose(packet);
  const plan = buildPlan(packet, article);
  const gate = runGates(article, packet);
  results.push({ kind: c.kind, materiality: c.materiality, state: c.state, headline: article.headline, dek: article.dek, words: gate.words, families: Object.keys(packet), modules: plan.module_ids, charts: plan.modules.find((m) => m.id === 'charts')?.data.charts.map((x) => x.id) || [], omitted: plan.omitted, gates: gate.pass ? 'PASS' : gate.failures, article });
}
const out = { generated_at: now.toISOString(), mode: 'shadow-readonly', window_h: hours, scanned: d.scanned, fresh: d.fresh, candidates_total: (d.candidates || []).length, evaluated: results.length, pass: results.filter((r) => r.gates === 'PASS').length, results };
fs.writeFileSync(arg('out', 'docs/evidence/news-shadow-latest.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ ...out, results: results.map((r) => ({ kind: r.kind, m: r.materiality, headline: r.headline, words: r.words, charts: r.charts, gates: r.gates === 'PASS' ? 'PASS' : r.gates.map((f) => `${f.gate}: ${f.detail}`).slice(0, 4) })) }, null, 1));
