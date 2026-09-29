// AI-assisted prose layer — tennis-editorial/1.0.0 (same architecture as LHBUSA/UFC ufc-news-enrich).
//
// DETECTION, EVIDENCE, CHARTS and FACT-CHECKING are deterministic; only PROSE is model-written. The model
// (GPT-5.6 Sol via the OpenAI Responses API, secret OPENAI_API_KEY on the Worker) receives the frozen
// packet, the allowed section plan and the deterministic fact-safe baseline, and returns headline, dek and
// section prose as strict JSON. It never emits chart data, HTML, or any fact absent from the packet: the
// same gates the baseline passes are run on its output. Failure -> deterministic baseline (if it passes)
// or HOLD. Gates are never relaxed for model prose.

export const EDITORIAL_VERSION = 'tennis-editorial/3.0.0';
const API = 'https://api.openai.com/v1/responses';
const CALL_TIMEOUT_MS = 90_000;
export const USD_PER_MTOK = { input: 1.25, output: 10 }; // same account pricing constant UFC records

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

export async function callSol(apiKey, { model, input, timeoutMs = CALL_TIMEOUT_MS, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model, store: false, reasoning: { effort: 'medium' }, instructions: SYSTEM, input, max_output_tokens: 20000, text: { format: { type: 'json_schema', name: 'tennis_article', strict: true, schema: SCHEMA } } })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(redactSecrets(`openai ${res.status}: ${JSON.stringify(json).slice(0, 300)}`));
    if (json.status === 'incomplete') throw new Error(`openai incomplete: ${json.incomplete_details?.reason || 'unknown'}`);
    if (json.status === 'failed') throw new Error(redactSecrets(`openai failed: ${JSON.stringify(json.error || {}).slice(0, 240)}`));
    return { text: extractText(json), model: json.model || model, usage: { input_tokens: Number(json.usage?.input_tokens) || 0, output_tokens: Number(json.usage?.output_tokens) || 0 } };
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`openai timeout after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

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
 * Try the model up to `attempts` times; each draft must pass `gate(article)`. Returns
 * { article, origin: 'model' | 'baseline' | null, attempts:[…], usage } — origin null means HOLD.
 */
export async function editorialize({ packet, baseline, gate, apiKey, model, attempts = 2, fetchImpl = fetch }) {
  const log = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  if (apiKey) {
    let correction = null;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const r = await callSol(apiKey, { model, input: buildInput(packet, baseline, correction), fetchImpl });
        usage.input_tokens += r.usage.input_tokens;
        usage.output_tokens += r.usage.output_tokens;
        const draft = adopt(r.text, baseline);
        const g = gate(draft);
        log.push({ attempt: i + 1, model: r.model, pass: g.pass, failures: g.failures.slice(0, 12) });
        if (g.pass) return { article: { ...draft, model: r.model }, origin: 'model', gate: g, attempts: log, usage };
        correction = g.failures.map((f) => `- ${f.gate}: ${f.detail}`).join('\n');
      } catch (e) {
        log.push({ attempt: i + 1, error: redactSecrets(e.message).slice(0, 300) });
        if (/401|403|invalid_api_key|Incorrect API key/i.test(e.message)) break;
      }
    }
  } else log.push({ skipped: 'OPENAI_API_KEY not configured on this Worker' });
  const g = gate(baseline);
  if (g.pass) return { article: { ...baseline, prose_origin: 'baseline' }, origin: 'baseline', gate: g, attempts: log, usage };
  return { article: baseline, origin: null, gate: g, attempts: log, usage };
}

export const costUsd = (u) => Math.round(((u.input_tokens * USD_PER_MTOK.input + u.output_tokens * USD_PER_MTOK.output) / 1e6) * 10000) / 10000;
