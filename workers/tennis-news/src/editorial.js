// AI-assisted prose layer — tennis-editorial/1.0.0 (same architecture as LHBUSA/UFC ufc-news-enrich).
//
// DETECTION, EVIDENCE, CHARTS and FACT-CHECKING are deterministic; only PROSE is model-written. The model
// (GPT-5.6 Sol via the OpenAI Responses API, secret OPENAI_API_KEY on the Worker) receives the frozen
// packet, the allowed section plan and the deterministic fact-safe baseline, and returns headline, dek and
// section prose as strict JSON. It never emits chart data, HTML, or any fact absent from the packet: the
// same gates the baseline passes are run on its output. Failure -> deterministic baseline (if it passes)
// or HOLD. Gates are never relaxed for model prose.

import { evidenceDimensions } from './classify.js';
import { storyAngle, availableVisuals, VISUAL_GUIDE } from './angle.js';
import { buildPlan } from './plan.js';

export const EDITORIAL_VERSION = 'tennis-editorial/5.0.0';
const API = 'https://api.openai.com/v1/responses';
const CALL_TIMEOUT_MS = 120_000;
export const USD_PER_MTOK = { input: 1.25, output: 10 }; // nominal standard rate for gpt-5.6-sol (same constant UFC records)

export const SYSTEM = `You are the tennis desk of PropBetEdge, a sports intelligence network. You write tennis journalism: stories a reader enjoys and understands from the text alone. Charts sit beside your story and PROVE what you write; they never replace it. House rule: "Prose leads. Data supports." The test for every story: if all the charts disappeared, would this still be an excellent tennis article?

HARD FACT RULES — a violation means the story is held:
- Use ONLY facts in the SOURCE PACKET. Every number you write (scores, rankings, percentages, counts, durations, dates, seeds) must appear in the packet exactly as given. Do not compute new numbers (no differences, sums, ratios or new percentages). Small counts may be spelled as words ("two qualifying wins") only when the count itself is in the packet.
- Rankings are the list in force at the START of the tournament; say so once when you use them. Describe the list exactly as packet.ranking_provenance.phrase does: call it "official" ONLY when packet.ranking_provenance.classification is "official" (a secondary-source list, e.g. the ATP singles list in the PropBetEdge archive, is never an official ranking). A player missing from a list that holds only the top N is "outside the top N", never "unranked". Never call a ranking "current", "career-high" or "best".
- Call a result or statistic "official" only when its packet.provenance.upstream entry has classification "official".
- Never state or imply a cause for a retirement or withdrawal, an injury, illness, fatigue, emotion, confidence, motivation, nerves or mindset. Say only what the result records.
- No quotes. No odds, prices, betting language, favourites/underdogs, predictions or probabilities (in previews too: frame what decides a match as questions, never a pick).
- No "first", "maiden", "record", "historic", "career-best" claims — the archive cannot prove them. (A W-L record from our archive is fine: "a 4-20 record against top-10 opponents in our archive".)
- Head-to-head counts are from our archive only; say "in our records" when you use them.
- Match DNA (packet.match_dna) is each player's own results record in our archive before the match: use W-L records and win rates to explain; never write percentiles, tour comparisons or the rating model's probabilities.
- The winner is participants[match.winner_side]. Never reverse it.

NO INVENTED TENNIS — narrative is not invention:
- Our sources hold NO shot-level or positional data. Never write about forehands, backhands, the net, volleys, drop shots, slices, rallies, the baseline, court position, movement, serve placement or speed, or what a player "targeted"/"attacked". Never describe how a point was played.
- How a match developed comes ONLY from the stored set scores and tiebreak scores, packet.match_development (observed games: breaks in order, longest run) and packet.stats_by_set. Never reconstruct breaks, runs or game sequences from a final score. With set scores only, tell the match set by set (who took each set, how close it was, where a tiebreak decided it, where the match swung from one player to the other) — that IS the chronology.
- Serve/return vocabulary (aces, break points, service games, first/second serve, return points, holds, broke) only when packet.stats exists. "Never dropped serve" / "saved every break point" only when the numbers show it exactly. The word "momentum" is never allowed, and the phrase "turning point" only when packet.match_development exists (otherwise say where the match swung, using the sets). The LOSING player's name is never followed by a winning verb (beat, beats, defeated, edged, won the match, advanced, reached, outlasted, knocked out) anywhere in the story — not about a set, not about another match this season: write "the opener went to Fritz in a 9-7 tiebreak", "Tiafoe's run continued to the semifinal".
- Tennis language — first-strike tennis, return pressure, second-serve vulnerability, break-point pressure, service holds, deciding set, tiebreak pressure — is welcome ONLY where the cited numbers support it.

HOW TO WRITE (an editorial gate rejects stories that break these):
- Write to the STORY ANGLE you are given: its thesis is the spine of the story and must be clear in the first two paragraphs. Lead with what matters — never "X defeated Y" plus the scoreline, never a metric ("X had a Match DNA ..."). The score belongs in the dek and the scoreboard; the lead says why this match is worth reading about.
- Structure for a match story: a LEAD (first section, empty heading), then a chronological account of how it unfolded (set by set, using the real turning points), then why it happened (translate the evidence into tennis: the sentence first, the number as proof), then what it means (tournament position, next opponent, form, ranking, what to watch). Previews: lead with the question the match answers; how each player got here; the case for each side; what decides it. Vary the structure and headings to fit the story; never use stock headings such as "What happened", "Why it mattered", "What comes next".
- Synthesise. Never chain database sentences ("X recorded 5. Metric Y was 62%."). HARD LIMITS the gate counts: at most 6 numbers in any paragraph (a scoreline or a W-L record counts as one), at most 3 values from the same chart in one paragraph (for the Match DNA comparison: one pair of values per paragraph, e.g. both players' match-win rates — then explain it in words), and never both players' form windows (last 10 / last 20) in one paragraph — pick the one figure that proves the point. At most two or three numbers per sentence and no more than about one number per 15 words overall; every number must be doing work in an argument, joined to it with "because", "which", "while", "but", "so". Each paragraph makes one point and moves the story forward. No paragraph restates the headline or another paragraph; the last paragraph looks forward and does not repeat the opening.
- No clichés ("a testament to", "only time will tell", "make no mistake", "statement win"), no hype, no filler, no generic sentences that could sit in any tennis story.
- Write as a journalist, not as a system describing its inputs: never mention "the packet", "the supplied record", "the source record", "the data provided", "statistics in the source", "stored path" or what is missing from the evidence (no "with no point-by-point data, ..." sentences). If something is not in the evidence, simply do not write about it. (Provenance wording for rankings and our archive stays as required above.)

VISUAL SUPPORT — decide the story first, then attach evidence:
- A section may attach ONE visual from AVAILABLE VISUALS (field "visual"; "" for none) — the one that proves that section's point — plus "visual_note": 2-3 sentences (25-70 words) telling the reader what they are looking at, what is unusual in it, and how it shaped this match. The note may cite at most two values from the visual; it follows every fact rule.
- Two to four visuals, never the same one twice, and at least 90 words of your prose before each attached visual (the lead never carries one; the scoreboard is placed automatically after the lead). Visuals you do not attach go to a data appendix automatically.

OUTPUT: JSON only, matching the schema. The first section is the lead: id "lead", heading "", visual "". Section ids: short snake_case from ALLOWED SECTION IDS. Do not write the "method" section — it is supplied by code. Length: the WORD TARGET counts narrative paragraphs only (not headings or visual notes); meet it with substance from the packet, never with filler. The headline tells the story (the angle), not just the result; the dek carries the score, round, tournament and context.`;

export const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['headline', 'dek', 'sections'],
  properties: {
    headline: { type: 'string' },
    dek: { type: 'string' },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'heading', 'paragraphs', 'visual', 'visual_note'], properties: { id: { type: 'string' }, heading: { type: 'string' }, paragraphs: { type: 'array', items: { type: 'string' } }, visual: { type: 'string' }, visual_note: { type: 'string' } } } }
  }
};

export function redactSecrets(text) {
  return String(text || '')
    .replace(/(sk|pk|rk)[-_](live|test|proj|ant|or)?[-_]?[A-Za-z0-9*_-]{8,}/gi, '<redacted-credential>')
    .replace(/Bearer\s+[A-Za-z0-9._\-*]{12,}/gi, 'Bearer <redacted>')
    .replace(/Incorrect API key provided:[^.]*/gi, 'Incorrect API key provided: <redacted>');
}

function extractText(json) {
  const refusals = [];
  const text = [];
  for (const item of json?.output || []) for (const part of item?.content || []) {
    if (part?.type === 'refusal' && part.refusal) refusals.push(String(part.refusal));
    if (part?.type === 'output_text' && part.text) text.push(String(part.text));
  }
  if (refusals.length) throw new Error(`openai refusal: ${refusals.join(' ').slice(0, 240)}`);
  const joined = text.join('').trim();
  if (!joined) throw new Error('openai returned an empty response');
  return joined;
}

/** Usage as the Responses API reports it (cached input and reasoning tokens when returned). */
export function usageOf(json) {
  const u = json?.usage || {};
  return {
    input_tokens: Number(u.input_tokens) || 0,
    cached_input_tokens: Number(u.input_tokens_details?.cached_tokens) || 0,
    output_tokens: Number(u.output_tokens) || 0,
    reasoning_tokens: Number(u.output_tokens_details?.reasoning_tokens) || 0
  };
}

/**
 * One model call for a routing decision ({ model, max_output_tokens, reasoning_effort }): the SAME instructions, schema
 * and packet framing for every model. Returns { text, model, usage, response_id, latency_ms }.
 */
export async function callModel(apiKey, { routing, input, timeoutMs = CALL_TIMEOUT_MS, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const body = { model: routing.model, store: false, instructions: SYSTEM, input, max_output_tokens: routing.max_output_tokens || 6000, text: { format: { type: 'json_schema', name: 'tennis_article', strict: true, schema: SCHEMA } } };
    if (routing.reasoning_effort) body.reasoning = { effort: routing.reasoning_effort };
    const res = await fetchImpl(API, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    const usage = usageOf(json);
    const meta = { model: json.model || routing.model, usage, response_id: json.id || null, latency_ms: Date.now() - t0 };
    if (!res.ok) throw Object.assign(new Error(redactSecrets(`openai ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)), meta);
    if (json.status === 'incomplete') throw Object.assign(new Error(`openai incomplete: ${json.incomplete_details?.reason || 'unknown'}`), meta);
    if (json.status === 'failed') throw Object.assign(new Error(redactSecrets(`openai failed: ${JSON.stringify(json.error || {}).slice(0, 240)}`)), meta);
    return { text: extractText(json), ...meta };
  } catch (e) {
    if (controller.signal.aborted) throw Object.assign(new Error(`openai timeout after ${timeoutMs}ms`), { model: routing.model, usage: {}, latency_ms: Date.now() - t0 });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Back-compat: the V3 call shape (standard lane, effort medium). */
export const callSol = (apiKey, { model, input, timeoutMs, fetchImpl }) => callModel(apiKey, { routing: { model, max_output_tokens: 6000, reasoning_effort: 'medium' }, input, timeoutMs, fetchImpl });

/** The packet as the model sees it: facts only (no URLs, media paths or internal ids beyond player ids). */
export function modelPacket(packet) {
  return JSON.parse(JSON.stringify(packet, (k, v) => (/^(square|wide|square_jpg|source_page|credit|license|author|photo|data_url|built_at|detector|edition_id)$/.test(k) ? undefined : v)));
}

// Approved section ids per PACKET evidence family (tennis-editorial 4.1.0). The baseline deciding not to render a
// standalone section for a family (e.g. a brief) must not hide that family from the editor: the packet stays the only
// fact source and the gates stay authoritative, but the editor may synthesise every family the packet proves.
const FAMILY_SECTIONS = Object.freeze({
  set_detail: ['match_development'], match_development: ['match_development'], point_level: ['match_development'],
  match_statistics: ['match_data'], match_dna: ['player_read'], technical_dna: ['player_read'], recent_form: ['player_read'],
  surface_context: ['surface'], h2h: ['h2h'], draw_path: ['path'], next_opponent: ['next'], tournament_context: ['why_it_mattered'],
  ranking_history: ['trajectory']
});
// Narrative section ids (editorial 5.0.0): the story's own movements. Their headings are written per story.
export const NARRATIVE_IDS = Object.freeze(['lead', 'unfolded', 'turning_point', 'deciding_set', 'why', 'serve_return', 'pressure', 'records', 'form', 'the_run', 'means', 'watch', 'case_a', 'case_b', 'question', 'context']);
const MATCH_ONLY = ['match_development', 'match_data', 'surface', 'h2h', 'path', 'unfolded', 'turning_point', 'deciding_set', 'serve_return', 'pressure'];
/** Allowed section ids = the baseline's sections ∪ ids the packet's evidence dimensions support ∪ narrative ids (never 'method'). */
export function allowedSectionIds(packet, baseline) {
  const ids = new Set(['what_happened', 'why_it_mattered', 'analysis', ...NARRATIVE_IDS, ...(baseline?.sections || []).map((s) => s.id)]);
  for (const d of evidenceDimensions(packet)) for (const id of FAMILY_SECTIONS[d] || []) ids.add(id);
  if (!packet?.match) for (const id of MATCH_ONLY) ids.delete(id);
  ids.delete('method');
  return [...ids];
}

/** Compact, number-exact facts for interpreting each available visual (copied from the plan, never computed). */
function visualCatalog(angle, plan) {
  const get = (id) => (plan?.modules || []).find((m) => m.id === id)?.data;
  const charts = get('charts')?.charts || [];
  return angle.visuals.available.map((id) => {
    const chart = charts.find((c) => c.id === id);
    let shows = VISUAL_GUIDE[id] || id;
    if (chart) shows += ` | rows: ${chart.series.map((r) => `${r[chart.label_key]} ${chart.value_keys.map((k) => r[k]).join(' vs ')}`).join('; ')}`;
    return `- ${id}: ${shows}`;
  }).join('\n');
}

/**
 * The editor's brief. ctx = { plan, angle, storyClass, avoid } — the STORY ANGLE is decided from the evidence before
 * any prose (angle.js); the editor writes to it and attaches visuals to the points they prove. The deterministic
 * baseline is no longer shown to the model (its fixed frame produced templated stories).
 */
export function buildInput(packet, baseline, correction = null, ctx = {}) {
  const plan = ctx.plan || buildPlan(packet, baseline);
  const storyClass = baseline?.story_class || ctx.storyClass || 'full';
  const angle = ctx.angle || storyAngle(packet, plan, storyClass);
  const allowed = allowedSectionIds(packet, baseline);
  const t = angle.target;
  const avoid = (ctx.avoid || []).slice(0, 20);
  return [
    `Write the PropBetEdge Tennis ${angle.type === 'preview' ? 'PREVIEW' : angle.type === 'recap' ? 'match story' : 'ranking story'} for this ${String(packet.event?.kind || angle.type).replace(/_/g, ' ')} event.`,
    `WORD TARGET: ${t.min}-${t.max} words of narrative prose (a ${t.label}). Fewer is a rejection; padding is a rejection.`,
    `STORY ANGLE (decided from the evidence before writing):\nThesis: ${angle.angle?.thesis || 'the result and what it means'}${angle.secondary.length ? `\nSecondary threads: ${angle.secondary.map((a) => a.thesis).join(' | ')}` : ''}\nBeats, in order: ${angle.beats.join(' -> ')}`,
    angle.sets.length ? `SETS (winner first, from the stored scores): ${angle.sets.map((s) => `set ${s.set} ${s.score}${s.tiebreak ? ` [tiebreak ${s.tiebreak}]` : ''} -> ${s.winner === 'W' ? 'winner' : 'loser'}${s.deciding ? ' (deciding set)' : ''}`).join('; ')}` : '',
    angle.turning_points.length ? `WHERE THE MATCH SWUNG, FROM THE EVIDENCE (use these, invent no others; do not call them "turning points" unless packet.match_development exists):\n${angle.turning_points.map((x) => `- ${x.at}: ${x.what} (${x.basis})`).join('\n')}` : '',
    `AVAILABLE VISUALS (attach where they prove your point; suggested for this angle: ${angle.visuals.suggested.join(', ') || 'none'}):\n${visualCatalog(angle, plan) || '- none'}`,
    `ALLOWED SECTION IDS: ${allowed.join(', ')}`,
    avoid.length ? `STOCK PHRASES ALREADY OVERUSED IN OUR NEWSROOM (X = a name, N = a number) — do not use these frames:\n${avoid.map((x) => `- ${x}`).join('\n')}` : '',
    correction ? `YOUR PREVIOUS DRAFT WAS REJECTED for exactly these reasons:\n${correction}\n${ctx.previousDraft ? `Return THE SAME DRAFT with only the sentences that cause these problems rewritten (keep everything else word for word and keep the length). Previous draft:\n${JSON.stringify(ctx.previousDraft)}` : 'Fix these problems; keep every fact rule.'}` : '',
    `SOURCE PACKET:\n${JSON.stringify(modelPacket(packet))}`
  ].filter(Boolean).join('\n\n');
}

const SID = /^[a-z][a-z_]{1,29}$/;
/** Parse + shape model output onto the baseline frame (method section, ids, metadata stay code-owned). */
export function adopt(modelJson, baseline, packet = null, { plan = null } = {}) {
  const o = typeof modelJson === 'string' ? JSON.parse(modelJson) : modelJson;
  const allowed = new Set(packet ? allowedSectionIds(packet, baseline) : [...baseline.sections.map((s) => s.id), 'analysis']);
  const vis = plan ? availableVisuals(plan) : null;
  const sections = (o.sections || [])
    .filter((s) => s && SID.test(String(s.id)) && allowed.has(s.id) && s.id !== 'method' && Array.isArray(s.paragraphs) && s.paragraphs.some((p) => String(p).trim()))
    .map((s) => {
      const out = { id: s.id, heading: String(s.heading || '').trim().slice(0, 80), paragraphs: s.paragraphs.map((p) => String(p).trim()).filter(Boolean) };
      const v = String(s.visual || '').trim();
      if (v && v !== 'scoreboard' && v !== 'preview_card' && (!vis || vis.has(v))) { out.visual = v; out.visual_note = String(s.visual_note || '').trim(); }
      return out;
    });
  const method = baseline.sections.find((s) => s.id === 'method');
  const narrative = sections.some((s) => 'visual' in s) || sections[0]?.id === 'lead';
  return { ...baseline, headline: String(o.headline || '').trim(), dek: String(o.dek || '').trim(), sections: method ? [...sections, method] : sections, prose_origin: 'model', ...(narrative ? { layout: 'narrative/1' } : {}) };
}

/**
 * Prose for one story under a routing decision. Automatic newsroom runs use attempts = 1 (one model call; a failed draft
 * falls back to the fact-safe baseline); an explicit admin / canary repair may pass attempts = 2. Every call is reported
 * through onCall({ attempt, model, usage, response_id, latency_ms, gate_pass, error }) for telemetry. Returns
 * { article, origin: 'model' | 'baseline' | null, gate, attempts: [...], usage, routing } — origin null means HOLD.
 */
export async function editorialize({ packet, baseline, gate, apiKey, routing = null, model = null, attempts = 1, fetchImpl = fetch, onCall = null, ctx: ctx0 = {} }) {
  let ctx = ctx0;
  const log = [];
  const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  const r0 = routing || (model ? { lane: 'STANDARD_EDITORIAL', model, pool: 'premium', reason: 'explicit model', max_output_tokens: 6000, reasoning_effort: 'medium' } : null);
  const add = (u = {}) => { for (const k of Object.keys(usage)) usage[k] += Number(u[k]) || 0; };
  if (r0 && r0.lane !== 'DETERMINISTIC' && r0.model && apiKey) {
    let correction = null;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const r = await callModel(apiKey, { routing: r0, input: buildInput(packet, baseline, correction, ctx), fetchImpl });
        add(r.usage);
        const draft = adopt(r.text, baseline, packet, { plan: ctx.plan || null });
        const g = gate(draft);
        log.push({ attempt: i + 1, model: r.model, pass: g.pass, failures: g.failures.slice(0, 12), ...(ctx.keepDraft && !g.pass ? { draft: { headline: draft.headline, dek: draft.dek, sections: draft.sections.filter((s) => s.id !== 'method') } } : {}) });
        if (onCall) await onCall({ attempt: i + 1, model: r.model, usage: r.usage, response_id: r.response_id, latency_ms: r.latency_ms, gate_pass: g.pass });
        if (g.pass) return { article: { ...draft, model: r.model }, origin: 'model', gate: g, attempts: log, usage, routing: r0 };
        correction = g.failures.map((f) => `- ${f.gate}: ${f.detail}`).join('\n');
        ctx = { ...ctx, previousDraft: { headline: draft.headline, dek: draft.dek, sections: draft.sections.filter((x) => x.id !== 'method').map(({ id, heading, paragraphs, visual = '', visual_note = '' }) => ({ id, heading, paragraphs, visual, visual_note })) } };
      } catch (e) {
        add(e.usage);
        log.push({ attempt: i + 1, error: redactSecrets(e.message).slice(0, 300) });
        if (onCall) await onCall({ attempt: i + 1, model: e.model || r0.model, usage: e.usage || {}, response_id: e.response_id || null, latency_ms: e.latency_ms ?? null, error: redactSecrets(e.message).slice(0, 200) });
        if (/401|403|invalid_api_key|Incorrect API key/i.test(e.message)) break;
      }
    }
  } else log.push({ skipped: !apiKey ? 'OPENAI_API_KEY not configured on this Worker' : `deterministic lane: ${r0?.reason || 'no routing'}` });
  const g = gate(baseline);
  if (g.pass) return { article: { ...baseline, prose_origin: 'baseline' }, origin: 'baseline', gate: g, attempts: log, usage, routing: r0 };
  return { article: baseline, origin: null, gate: g, attempts: log, usage, routing: r0 };
}

/** NOMINAL standard-rate cost of gpt-5.6-sol usage (the org may receive complimentary tokens: never an actual bill). */
export const costUsd = (u) => Math.round((((Number(u.input_tokens) || 0) * USD_PER_MTOK.input + (Number(u.output_tokens) || 0) * USD_PER_MTOK.output) / 1e6) * 10000) / 10000;
