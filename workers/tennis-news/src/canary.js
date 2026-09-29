// Offline model canary (V4): the SAME frozen packet, system instructions, schema, article plan, output cap, reasoning
// effort and deterministic gates for every model under test. NEVER publishes and NEVER writes: reads only (the stored
// article's frozen evidence packet), then returns each model's draft with objective metrics for a blind A/B review.
//   POST /v1/news/canary?event_id=<id>&models=gpt-5.6-sol,gpt-6-astra   (admin token; one packet per request)

import { compose } from './compose.js';
import { buildPlan } from './plan.js';
import { runGates } from './gates.js';
import { callModel, adopt, buildInput, redactSecrets } from './editorial.js';
import { aiConfig, poolOf, nominalStandardCost, addPoolTokens, LANES } from './ai-router.js';

export const CANARY_VERSION = 'tennis-ai-canary/1.0.0';

const prose = (a) => (a.sections || []).filter((s) => s.id !== 'method').flatMap((s) => s.paragraphs || []);
const words = (ps) => ps.join(' ').split(/\s+/).filter(Boolean).length;
const NUM = /\d+(?:\.\d+)?%?/g;

/** Heuristic evidence-family use: a family counts when prose contains one of its distinctive values (W-L records,
 *  percentages, numbers >= 10 with the packet's own formatting). Reported as a heuristic, never as a gate. */
export function familiesUsed(article, packet) {
  const text = prose(article).join(' ');
  const out = [];
  const sig = (v, acc) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach((x) => sig(x, acc)); return; }
    if (typeof v === 'object') {
      if (Number.isInteger(v.W) && Number.isInteger(v.L)) acc.add(`${v.W}-${v.L}`);
      for (const x of Object.values(v)) sig(x, acc);
      return;
    }
    if (typeof v === 'number' && (Math.abs(v) >= 10 || !Number.isInteger(v))) { acc.add(String(v)); if (!Number.isInteger(v)) acc.add(v.toFixed(1)); }
  };
  for (const fam of ['match', 'stats', 'match_dna', 'dna', 'h2h', 'draw_path', 'next', 'ranking_history', 'form', 'rankings', 'sides', 'tournament']) {
    if (!packet[fam]) continue;
    const acc = new Set();
    sig(packet[fam], acc);
    const hits = [...acc].filter((x) => x.length >= 2 && text.includes(x));
    if (hits.length) out.push(fam);
  }
  return out;
}

/** Repetition + stat-recitation diagnostics (deterministic). */
export function diagnostics(article) {
  const ps = prose(article);
  const grams = new Map();
  for (const p of ps) {
    const w = p.toLowerCase().replace(/[^a-z0-9%.\- ]/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i + 5 <= w.length; i += 1) { const g = w.slice(i, i + 5).join(' '); grams.set(g, (grams.get(g) || 0) + 1); }
  }
  const repeated5 = [...grams.values()].reduce((t, n) => t + (n > 1 ? n - 1 : 0), 0);
  const bySection = (article.sections || []).filter((s) => s.id !== 'method').map((s) => new Set((s.paragraphs || []).join(' ').match(NUM) || []));
  const seen = new Map();
  for (const set of bySection) for (const n of set) seen.set(n, (seen.get(n) || 0) + 1);
  const numbersInManySections = [...seen.entries()].filter(([n, c]) => c > 1 && n.length >= 2).map(([n]) => n);
  const perPara = ps.map((p) => (p.match(NUM) || []).length);
  return { repeated_5grams: repeated5, numbers_repeated_across_sections: numbersInManySections.length, max_numbers_in_a_paragraph: Math.max(0, ...perPara), paragraphs_with_4plus_numbers: perPara.filter((n) => n >= 4).length, paragraphs: ps.length };
}

async function runOne(env, cfg, { model, packet, baseline, plan, input, maxOutput, fetchImpl }) {
  const routing = { lane: model === cfg.flagshipModel ? LANES.FLAGSHIP : LANES.STANDARD, model, pool: poolOf(model, cfg), reason: 'offline canary (identical inputs)', max_output_tokens: maxOutput, reasoning_effort: cfg.standardEffort };
  try {
    const r = await callModel(env.OPENAI_API_KEY, { routing, input, fetchImpl });
    const draft = adopt(r.text, baseline);
    const g = runGates(draft, packet, { plan });
    const ps = prose(draft);
    return {
      model, model_reported: r.model, ok: true, pool: routing.pool, usage: r.usage, response_id: r.response_id, latency_ms: r.latency_ms,
      gate: { pass: g.pass, failures: g.failures.slice(0, 20) }, headline: draft.headline, dek: draft.dek,
      sections: draft.sections.filter((s) => s.id !== 'method').map((s) => ({ id: s.id, heading: s.heading, paragraphs: s.paragraphs })),
      words: words(ps), section_count: draft.sections.filter((s) => s.id !== 'method').length,
      evidence_families_used: familiesUsed(draft, packet), diagnostics: diagnostics(draft),
      nominal_standard_cost: nominalStandardCost(model, r.usage, cfg)
    };
  } catch (e) {
    return { model, ok: false, pool: routing.pool, error: redactSecrets(e.message).slice(0, 300), usage: e.usage || {}, latency_ms: e.latency_ms ?? null };
  }
}

/** One frozen packet through every model under test. Reads only. */
export async function runCanary(env, store, { eventId, models = [], maxOutput = null, fetchImpl = fetch } = {}) {
  if (!eventId) return { error: 'event_id required' };
  if (!env.OPENAI_API_KEY) return { error: 'OPENAI_API_KEY not configured on this Worker' };
  const cfg = aiConfig(env);
  const list = models.length ? models : [cfg.standardModel, cfg.flagshipModel];
  const a = (await store.select('tennis_articles', `select=article_id,slug,story_class,desk,story_type,tennis_article_evidence(packet,frozen_at)&event_id=eq.${encodeURIComponent(eventId)}`))[0];
  if (!a) return { error: 'no stored article (frozen packet) for this event' };
  const ev = Array.isArray(a.tennis_article_evidence) ? a.tennis_article_evidence[0] : a.tennis_article_evidence;
  const packet = ev?.packet;
  if (!packet) return { error: 'no frozen packet stored for this article' };
  const storyClass = a.story_class || 'full';
  // the deterministic frame every model receives: baseline + plan rebuilt from the frozen packet (nothing written)
  const baseline = compose(packet, { storyClass });
  const plan = buildPlan(packet, baseline);
  const input = buildInput(packet, baseline, null);
  const cap = maxOutput || cfg.flagshipMaxOutput; // one ceiling for every model under test
  const results = await Promise.all(list.map((model) => runOne(env, cfg, { model, packet, baseline, plan, input, maxOutput: cap, fetchImpl })));
  // canary tokens come from the SHARED premium pool: counted in their own daily counter (visible in /v1/news/ai-usage) so an
  // A/B run never consumes the production soft cap and pushes live stories onto baseline prose
  for (const r of results) await addPoolTokens(env.TENNIS_STATE || null, `canary-${r.pool}`, (Number(r.usage?.input_tokens) || 0) + (Number(r.usage?.output_tokens) || 0)).catch(() => null);
  const baseGate = runGates(baseline, packet, { plan });
  return {
    canary_version: CANARY_VERSION, event_id: eventId, slug: a.slug, story_class: storyClass, desk: a.desk, story_type: a.story_type, frozen_at: ev.frozen_at || null,
    packet_version: packet.version || null, families_in_packet: Object.keys(packet).filter((k) => packet[k] != null),
    identical: { instructions: 'editorial SYSTEM', schema: 'tennis_article', max_output_tokens: cap, reasoning_effort: cfg.standardEffort, attempts: 1, input_chars: input.length },
    baseline: { headline: baseline.headline, words: words(prose(baseline)), gate_pass: baseGate.pass }, results
  };
}
