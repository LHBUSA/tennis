// AI-assisted prose layer — tennis-editorial/1.0.0 (same architecture as LHBUSA/UFC ufc-news-enrich).
//
// DETECTION, EVIDENCE, CHARTS and FACT-CHECKING are deterministic; only PROSE is model-written. The model
// (GPT-5.6 Sol via the OpenAI Responses API, secret OPENAI_API_KEY on the Worker) receives the frozen
// packet, the allowed section plan and the deterministic fact-safe baseline, and returns headline, dek and
// section prose as strict JSON. It never emits chart data, HTML, or any fact absent from the packet: the
// same gates the baseline passes are run on its output. Failure -> deterministic baseline (if it passes)
// or HOLD. Gates are never relaxed for model prose.

export const EDITORIAL_VERSION = 'tennis-editorial/4.0.0';
const API = 'https://api.openai.com/v1/responses';
const CALL_TIMEOUT_MS = 90_000;
export const USD_PER_MTOK = { input: 1.25, output: 10 }; // nominal standard rate for gpt-5.6-sol (same constant UFC records)

export const SYSTEM = `You are the tennis desk of PropBetEdge, a sports intelligence network. You write match and ranking stories that read like strong sports journalism and then stop to show the reader the data.

HARD FACT RULES — a violation means the story is held:
- Use ONLY facts in the SOURCE PACKET. Every number you write (scores, rankings, percentages, counts, durations, dates, seeds) must appear in the packet exactly as given. Do not compute new numbers (no differences, sums or new percentages).
- Rankings are the list in force at the START of the tournament; say so when you use them. Describe the list exactly as packet.ranking_provenance.phrase does: call it "official" ONLY when packet.ranking_provenance.classification is "official" (a secondary-source list, e.g. the ATP singles list in the PropBetEdge archive, is never an official ranking). A player missing from a list that holds only the top N is "outside the top N", never "unranked". Never call a ranking "current", "career-high" or "best".
- Call a result or statistic "official" only when its packet.provenance.upstream entry has classification "official".
- Never state or imply a cause for a retirement or withdrawal, an injury, illness, fatigue, emotion, confidence, motivation, nerves or mindset. Say only what the result records.
- No quotes. No odds, prices, betting language, favourites/underdogs, predictions or probabilities.
- No "first", "maiden", "record", "historic", "career-best" claims — the archive cannot prove them.
- Head-to-head counts are from our archive only; say "in our records" when you use them.
- "What's next" only when packet.next exists.
- The winner is participants[match.winner_side]. Never reverse it.

STYLE: clear, specific, confident, no clichés ("a testament to", "only time will tell", "make no mistake"...), no hype, no filler. Lead with what happened, then why it mattered, then the serve/return story the statistics actually show, then context (form, draw path, H2H, Tennis DNA) only where the packet has it. Charts and scoreboards are rendered separately by code next to your sections — refer to them naturally ("the serve numbers show...") but never restate long tables.

TENNIS INTELLIGENCE (V4) — synthesis, not recitation, and only from the families the packet holds:
- MATCH DEVELOPMENT (packet.match_development, packet.stats_by_set): describe how the score developed — where the first break came, how many breaks each side made, the longest run of games — ONLY from these observed families. Never reconstruct breaks or runs from the final score, and never write "N straight games" unless it equals match_development.longest_run.games. The word "momentum" is never allowed; "turning point" only when match_development shows the breaks.
- SERVE STORY (packet.stats: service_games_held, first/second serve, aces, double faults, break points saved): explain what decided the service games (e.g. second-serve vulnerability, holding under break-point pressure), not a list of percentages. "Never dropped serve" / "saved every break point" only when the numbers show it exactly.
- RETURN STORY (packet.stats: return points, break points earned/converted, return games won): explain where the pressure came from and whether it was converted.
- No serve/return vocabulary at all (aces, break points, service games…) when packet.stats is absent. No winners/unforced-error counts unless the packet holds them.
- PLAYER CONTEXT and CONSEQUENCE (ranking at the start of the tournament, surface record, recent form, archived H2H, draw path, packet.next): use them to say what the result means for the player and what comes next — no speculation about the future beyond packet.next.
- Tennis-specific analysis: surface, format (best-of-3/5, deciding tiebreak), round and seeding matter; mind-reading, fatigue or injury explanations never do.

ADD VALUE (held if broken): a chart already shows its numbers — explain the relationship the evidence supports instead of reading figures out (never 4+ figures from one chart in a paragraph). No section may restate the headline and dek. No two sections may make the same analytical point. Match DNA (packet.match_dna) is each player's own record in our archive before the match: use the records (W-L) to explain what the result says about the player; never write percentiles, tour comparisons or the rating model's probabilities (those are shown in code-rendered modules).

OUTPUT: JSON only, matching the schema. sections[].id must be one of the ALLOWED SECTION IDS, in a sensible order; omit sections the packet cannot support. Do not write the "method" section — it is supplied by code.`;

export const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['headline', 'dek', 'sections'],
  properties: {
    headline: { type: 'string' },
    dek: { type: 'string' },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'heading', 'paragraphs'], properties: { id: { type: 'string' }, heading: { type: 'string' }, paragraphs: { type: 'array', items: { type: 'string' } } } } }
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

const WORDS = { brief: ['220-600', '150-400'], full: ['450-900', '250-600'], deep: ['700-1300', '350-800'] };
export function buildInput(packet, baseline, correction = null) {
  const allowed = baseline.sections.map((s) => s.id).filter((id) => id !== 'method');
  const extra = ['analysis'];
  return [
    `Write the PropBetEdge Tennis story for this ${packet.event.kind.replace(/_/g, ' ')} event.`,
    `STORY CLASS: ${baseline.story_class || 'full'}. ACCEPTANCE: ${WORDS[baseline.story_class || 'full'][packet.match ? 0 : 1]} words across your sections; at least ${packet.match ? (baseline.story_class === 'brief' ? 2 : 3) : 1} sections; every number from the packet. A brief is a tight news story: what happened and why it matters, nothing padded.`,
    `ALLOWED SECTION IDS: ${[...allowed, ...extra].join(', ')}`,
    correction ? `YOUR PREVIOUS DRAFT WAS REJECTED for exactly these reasons:\n${correction}\nFix only these problems.` : '',
    `FACT-SAFE BASELINE (every fact here is verified; you may reorganise and deepen the writing, but you may not add facts beyond the packet):\n${JSON.stringify({ headline: baseline.headline, dek: baseline.dek, sections: baseline.sections.filter((s) => s.id !== 'method') })}`,
    `SOURCE PACKET:\n${JSON.stringify(modelPacket(packet))}`
  ].filter(Boolean).join('\n\n');
}

/** Parse + shape model output onto the baseline frame (method section, ids, metadata stay code-owned). */
export function adopt(modelJson, baseline) {
  const o = typeof modelJson === 'string' ? JSON.parse(modelJson) : modelJson;
  const allowed = new Set([...baseline.sections.map((s) => s.id), 'analysis']);
  const sections = (o.sections || []).filter((s) => allowed.has(s.id) && s.id !== 'method' && Array.isArray(s.paragraphs) && s.paragraphs.some((p) => String(p).trim())).map((s) => ({ id: s.id, heading: String(s.heading).slice(0, 80), paragraphs: s.paragraphs.map((p) => String(p).trim()).filter(Boolean) }));
  const method = baseline.sections.find((s) => s.id === 'method');
  return { ...baseline, headline: String(o.headline || '').trim(), dek: String(o.dek || '').trim(), sections: method ? [...sections, method] : sections, prose_origin: 'model' };
}

/**
 * Prose for one story under a routing decision. Automatic newsroom runs use attempts = 1 (one model call; a failed draft
 * falls back to the fact-safe baseline); an explicit admin / canary repair may pass attempts = 2. Every call is reported
 * through onCall({ attempt, model, usage, response_id, latency_ms, gate_pass, error }) for telemetry. Returns
 * { article, origin: 'model' | 'baseline' | null, gate, attempts: [...], usage, routing } — origin null means HOLD.
 */
export async function editorialize({ packet, baseline, gate, apiKey, routing = null, model = null, attempts = 1, fetchImpl = fetch, onCall = null }) {
  const log = [];
  const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  const r0 = routing || (model ? { lane: 'STANDARD_EDITORIAL', model, pool: 'premium', reason: 'explicit model', max_output_tokens: 6000, reasoning_effort: 'medium' } : null);
  const add = (u = {}) => { for (const k of Object.keys(usage)) usage[k] += Number(u[k]) || 0; };
  if (r0 && r0.lane !== 'DETERMINISTIC' && r0.model && apiKey) {
    let correction = null;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const r = await callModel(apiKey, { routing: r0, input: buildInput(packet, baseline, correction), fetchImpl });
        add(r.usage);
        const draft = adopt(r.text, baseline);
        const g = gate(draft);
        log.push({ attempt: i + 1, model: r.model, pass: g.pass, failures: g.failures.slice(0, 12) });
        if (onCall) await onCall({ attempt: i + 1, model: r.model, usage: r.usage, response_id: r.response_id, latency_ms: r.latency_ms, gate_pass: g.pass });
        if (g.pass) return { article: { ...draft, model: r.model }, origin: 'model', gate: g, attempts: log, usage, routing: r0 };
        correction = g.failures.map((f) => `- ${f.gate}: ${f.detail}`).join('\n');
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
