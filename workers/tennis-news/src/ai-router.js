// Tennis AI router (V4, owner brief 2026-09-29): model selection is an explicit, deterministic POLICY decision recorded on
// every model call — never a model hardcoded through the newsroom, and never a model asked whether to use a model.
//
//   DETERMINISTIC        no model call (wire items, no key, soft cap reached): the fact-safe baseline prose is used
//   VOLUME               an approved mini/nano-pool model for genuinely low-value, high-volume work. No tennis task needs
//                        one today (detection, classification, wire copy and charts are deterministic code); the lane is
//                        defined so a future task has a policy home, but route() never selects it for article prose.
//   STANDARD_EDITORIAL   the default premium newsroom model (gpt-5.6-sol)
//   FLAGSHIP_EDITORIAL   candidate premium flagship (gpt-6-astra) — only for deterministic flagship-eligible stories AND only
//                        when TENNIS_AI_FLAGSHIP_ENABLED = "true" (off until the offline canary earns it)
//
// Pools, model names, caps, efforts and nominal rates are configuration (env), not permanent truth: the OpenAI
// complimentary daily pools are SHARED across the organisation (WNBA, Soccer, ...), so Tennis applies its own soft cap.

export const ROUTER_VERSION = 'tennis-ai-router/1.1.0';

/** A story is NEW when no stored predecessor article exists for its canonical story (mirrors WNBA paidEligibility). */
export const isNewCanonicalStory = (existing) => !existing;
export const LANES = Object.freeze({ DETERMINISTIC: 'DETERMINISTIC', VOLUME: 'VOLUME', STANDARD: 'STANDARD_EDITORIAL', FLAGSHIP: 'FLAGSHIP_EDITORIAL' });

// model -> shared pool. gpt-6-luna is PREMIUM (not mini/nano). Override with TENNIS_AI_POOLS (JSON).
export const DEFAULT_POOLS = Object.freeze({
  'gpt-6-astra': 'premium', 'gpt-6-sol': 'premium', 'gpt-6-luna': 'premium', 'gpt-5.6-sol': 'premium',
  'gpt-5.4-mini': 'volume', 'gpt-5.4-nano': 'volume'
});

// Nominal STANDARD list rates (USD per 1M tokens) used only to report nominal_standard_cost; the account may receive
// complimentary tokens, so this is never an actual billed cost. Only the rate already recorded for gpt-5.6-sol is a
// default; other models report null until TENNIS_AI_RATES (JSON { model: { input, cached_input, output } }) is set.
export const DEFAULT_RATES = Object.freeze({ 'gpt-5.6-sol': { input: 1.25, cached_input: 0.125, output: 10 } });

const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d);
const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };

export function aiConfig(env = {}) {
  return {
    standardModel: env.TENNIS_AI_STANDARD_MODEL || env.TENNIS_EDITORIAL_OPENAI_MODEL || 'gpt-5.6-sol',
    flagshipModel: env.TENNIS_AI_FLAGSHIP_MODEL || 'gpt-6-astra',
    flagshipEnabled: String(env.TENNIS_AI_FLAGSHIP_ENABLED || 'false') === 'true',
    // per-class release (Stage E): only the eligibility ids listed here may use the flagship model, even when enabled;
    // empty = none. Ids: commissioned, deep_class, major_final_semifinal, major_upset_deep, major_ranking, rich_packet
    flagshipClasses: new Set(String(env.TENNIS_AI_FLAGSHIP_CLASSES || '').split(',').map((x) => x.trim()).filter(Boolean)),
    volumeModel: env.TENNIS_AI_VOLUME_MODEL || 'gpt-5.4-mini',
    standardMaxOutput: num(env.TENNIS_AI_STANDARD_MAX_OUTPUT, 6000),
    flagshipMaxOutput: num(env.TENNIS_AI_FLAGSHIP_MAX_OUTPUT, 8000),
    volumeMaxOutput: num(env.TENNIS_AI_VOLUME_MAX_OUTPUT, 2000),
    standardEffort: env.TENNIS_AI_STANDARD_EFFORT || 'medium',
    flagshipEffort: env.TENNIS_AI_FLAGSHIP_EFFORT || 'medium',
    premiumSoftCap: num(env.TENNIS_PREMIUM_DAILY_SOFT_CAP, 300000),
    premiumWarn: num(env.TENNIS_PREMIUM_DAILY_WARN, 250000),
    volumeSoftCap: num(env.TENNIS_VOLUME_DAILY_SOFT_CAP, 3000000),
    richDims: num(env.TENNIS_AI_FLAGSHIP_RICH_DIMS, 8),
    // network-wide eligibility rule: only these triggers may reach a model transport at all (configurable default)
    eligibleTriggers: String(env.TENNIS_AI_ELIGIBLE_TRIGGERS || 'new,admin_reedit,canary').split(',').map((x) => x.trim()).filter(Boolean),
    pools: { ...DEFAULT_POOLS, ...json(env.TENNIS_AI_POOLS, {}) },
    rates: { ...DEFAULT_RATES, ...json(env.TENNIS_AI_RATES, {}) }
  };
}

export const poolOf = (model, cfg) => cfg.pools[model] || 'premium'; // unknown models are treated as premium (the stricter guard)

const MAJOR_LEVELS = /^(grand slam|atp masters 1000|wta 1000|atp finals|wta finals)$/i;
const MAJOR_KEYS = new Set(['grand_slam', 'atp_finals', 'wta_finals']);
const roundOf = (r) => String(r || '').replace(/^M-/, '').toUpperCase();

/**
 * Deterministic flagship eligibility from stored facts and story class only. Returns { eligible, reason }.
 * major = Grand Slam, 1000, Tour Finals (official level, reviewed ATP tier, or competition key).
 */
export function flagshipEligibility({ storyClass, event = {}, packet = {}, dims = [], trigger = 'new', cfg }) {
  const f = event.facts || packet.event?.facts || {};
  const kind = event.kind || packet.event?.kind || '';
  const t = packet.tournament || {};
  const level = f.level || f.edition_tier || t.level || t.atp_tier || null;
  const major = (level && MAJOR_LEVELS.test(level)) || MAJOR_KEYS.has(t.competition_key) || MAJOR_KEYS.has(f.competition_key);
  const round = roundOf(f.round || packet.match?.round);
  const nDims = Array.isArray(dims) ? dims.filter((d) => d !== 'result').length : 0;
  if (trigger === 'commission') return { eligible: true, id: 'commissioned', reason: 'commissioned editorial feature' };
  if (storyClass === 'deep') return { eligible: true, id: 'deep_class', reason: 'deep story class (major event + >= 7 evidence dimensions)' };
  if (major && ['F', 'S'].includes(round) && (kind === 'title' || kind === 'upset' || kind === 'seed_upset' || /final/.test(kind))) return { eligible: true, id: 'major_final_semifinal', reason: `major ${round === 'F' ? 'final' : 'semifinal'} (${level || t.competition_key})` };
  if (major && /upset/.test(kind) && nDims >= 6) return { eligible: true, id: 'major_upset_deep', reason: `major-tournament upset with a deep packet (${nDims} dimensions)` };
  if ((kind === 'new_no1' || /^enters_top10$/.test(kind)) && nDims >= 4) return { eligible: true, id: 'major_ranking', reason: `major ranking movement with context (${kind}, ${nDims} dimensions)` };
  if (nDims >= cfg.richDims) return { eligible: true, id: 'rich_packet', reason: `unusually rich packet (${nDims} >= ${cfg.richDims} evidence dimensions)` };
  return { eligible: false, reason: 'routine story: standard editorial' };
}

/**
 * route({ storyClass, publishArticle, event, packet, dims, trigger, env, usage }) -> routing decision.
 * usage = { premium_today, volume_today } — Tennis's share of today's shared pools (KV counters).
 */
export function route({ storyClass, publishArticle = true, event = {}, packet = {}, dims = [], trigger = 'new', env = {}, usage = {}, hasKey = true } = {}) {
  const cfg = aiConfig(env);
  const base = (lane, model, reason, extra = {}) => ({
    lane, model, pool: model ? poolOf(model, cfg) : 'none', reason,
    max_output_tokens: lane === LANES.FLAGSHIP ? cfg.flagshipMaxOutput : lane === LANES.STANDARD ? cfg.standardMaxOutput : lane === LANES.VOLUME ? cfg.volumeMaxOutput : 0,
    reasoning_effort: lane === LANES.FLAGSHIP ? cfg.flagshipEffort : lane === LANES.STANDARD ? cfg.standardEffort : null,
    router_version: ROUTER_VERSION, ...extra
  });
  if (!publishArticle || storyClass === 'wire') return base(LANES.DETERMINISTIC, null, 'wire item: deterministic fact card, no model');
  // TRIGGER ALLOW-LIST (enforced here, not by callers): upgrades, revisions, legacy repairs, version changes and corrections
  // never reach a premium or volume transport automatically
  if (!cfg.eligibleTriggers.includes(trigger)) return base(LANES.DETERMINISTIC, null, `trigger_not_eligible:${trigger}`, { trigger });
  if (!hasKey) return base(LANES.DETERMINISTIC, null, 'no OPENAI_API_KEY on this Worker: deterministic baseline prose');
  const premium = Number(usage.premium_today) || 0;
  const warn = premium >= cfg.premiumWarn;
  if (premium >= cfg.premiumSoftCap) {
    // standard is also premium-pool: at the Tennis premium soft cap, prose falls back to the deterministic baseline
    return base(LANES.DETERMINISTIC, null, `tennis premium soft cap reached (${premium} >= ${cfg.premiumSoftCap}): deterministic baseline prose`, { soft_cap: 'reached' });
  }
  const fl = flagshipEligibility({ storyClass, event, packet, dims, trigger, cfg });
  if (fl.eligible && cfg.flagshipEnabled && cfg.flagshipClasses.has(fl.id)) return base(LANES.FLAGSHIP, cfg.flagshipModel, `flagship: ${fl.reason}`, { flagship_eligible: true, soft_cap: warn ? 'warn' : 'ok' });
  const why = !fl.eligible ? `standard: ${fl.reason}` : !cfg.flagshipEnabled ? `standard: flagship-eligible (${fl.reason}) but TENNIS_AI_FLAGSHIP_ENABLED is off` : `standard: flagship-eligible (${fl.reason}) but class '${fl.id}' is not released in TENNIS_AI_FLAGSHIP_CLASSES`;
  return base(LANES.STANDARD, cfg.standardModel, why, { flagship_eligible: fl.eligible, soft_cap: warn ? 'warn' : 'ok' });
}

/** Nominal standard-rate cost (USD) of one call; null when the model's rate is not configured. Never an actual bill. */
export function nominalStandardCost(model, u = {}, cfg = aiConfig()) {
  const r = cfg.rates[model];
  if (!r) return null;
  const cached = Number(u.cached_input_tokens) || 0;
  const input = Math.max(0, (Number(u.input_tokens) || 0) - cached);
  const usd = (input * r.input + cached * (r.cached_input ?? r.input) + (Number(u.output_tokens) || 0) * r.output) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

// ---- Tennis's daily share of the shared pools (KV) -------------------------------------------------------------------
const day = (d = new Date()) => d.toISOString().slice(0, 10);
export const poolKey = (pool, d = new Date()) => `tennis:ai:tokens:${pool}:${day(d)}`;

export async function poolUsage(kv, d = new Date()) {
  if (!kv) return { premium_today: 0, volume_today: 0 };
  const [p, v] = await Promise.all([kv.get(poolKey('premium', d)), kv.get(poolKey('volume', d))]);
  return { premium_today: Number(p) || 0, volume_today: Number(v) || 0 };
}

/** Add one call's tokens to Tennis's daily pool counter (read-modify-write: a sport-level guard, not a billing ledger). */
export async function addPoolTokens(kv, pool, tokens, d = new Date()) {
  if (!kv || !pool || pool === 'none' || !(tokens > 0)) return null;
  const k = poolKey(pool, d);
  const next = (Number(await kv.get(k)) || 0) + tokens;
  await kv.put(k, String(next), { expirationTtl: 3 * 86400 });
  return next;
}

/** One telemetry row (tennis_news_pipeline_events stage 'cost') for one model call. */
export function callTelemetry({ eventId, articleId = null, storyClass, routing, trigger, call, cfg = aiConfig(), now = new Date().toISOString() }) {
  const u = call.usage || {};
  return {
    event_id: eventId, article_id: articleId, stage: 'cost', status: call.error ? 'fail' : 'ok', latency_ms: call.latency_ms ?? null,
    detail: {
      kind: 'model_call', sport: 'tennis', story_class: storyClass, routing_lane: routing.lane, routing_reason: routing.reason, model: call.model || routing.model, pool: routing.pool, latency_ms: call.latency_ms ?? null,
      trigger, attempt: call.attempt, input_tokens: u.input_tokens || 0, cached_input_tokens: u.cached_input_tokens || 0, output_tokens: u.output_tokens || 0,
      reasoning_tokens: u.reasoning_tokens || 0, total_tokens: (u.input_tokens || 0) + (u.output_tokens || 0), response_id: call.response_id || null,
      nominal_standard_cost: nominalStandardCost(call.model || routing.model, u, cfg), max_output_tokens: routing.max_output_tokens, reasoning_effort: routing.reasoning_effort,
      at: now, status: call.error ? `error: ${String(call.error).slice(0, 160)}` : call.gate_pass === false ? 'gate_failed' : 'ok', router_version: ROUTER_VERSION
    }
  };
}
