// TENNIS PBE PICKER V1 (owner decisions 2026-10-04; docs/research/PICKER_V1_PROTOCOL.md @ b27aeec, results e65eaad).
// A SELECTION POLICY over the production PBE Rating probability exactly as frozen in the pre-match snapshot
// (matchup-freeze/1). It is not a model. Markets are NEVER an input: the decision input is allowlisted and throws on any
// market key. Record shape: pbe-decision-record/1 (propbetedge-workers docs/DECISION_RECORD_PROPOSAL.md, approved).
//
//   scope       WTA main-tour singles (Slams, WTA 1000/500/250, Finals) -> the official candidate;
//               WTA 125 singles -> prospective SHADOW (never official); ATP -> PASS · MODEL_NOT_VALIDATED;
//               ITF / doubles / anything else -> not recorded (out of customer-facing V1).
//   lock        one designated decision per match (counting unit PRE_MATCH_LOCK):
//                 sourced exact start          -> T_MINUS_60   (start - 60 min)
//                 source-proven day AND offset -> DAY_START_LOCK (00:00 tournament local = day + offset)
//                 otherwise                    -> HOLD (MISSING_DAY_OR_TIMEZONE)
//               Once recorded, a decision is never replaced (a DAY_START_LOCK stays even if an exact start appears).
//   HOLD vs PASS  HOLD = could not evaluate (data, lock, snapshot, history). PASS = evaluated and declined
//               (MODEL_NOT_VALIDATED, WITHIN_UNCERTAINTY_BAND).
//   official    activated_at != null && decided_at >= activated_at — activation never makes an earlier decision
//               official. Shadow scope is never official.
//   grading     completed -> W / L; walkover, retirement, default, abandonment, cancellation -> VOID.

export const RECORD_SCHEMA = 'pbe-decision-record/1';
export const COUNTING_UNIT = 'PRE_MATCH_LOCK';
export const GRADING_RULE = 'tennis-picker-grading/1';

export const PICKER_POLICY = Object.freeze({
  candidate: 'tennis-picker-v1',
  version: 'tennis-picker-v1@b27aeec',
  status: 'FROZEN_PROSPECTIVE',
  frozen_at: '2026-10-04T15:00:00Z',
  activated_at: null, // owner activation sets this; decisions before it are never official
  tau: 0.55,
  model: { id: 'pbe-rating', name: 'PBE Rating', method_version: 1 },
  t_minus_min: 60,
  protocol: 'docs/research/PICKER_V1_PROTOCOL.md@b27aeec',
  evidence: 'docs/research/PICKER_V1_RESULTS.md@e65eaad',
});

export const REASONS = Object.freeze({
  MODEL_NOT_VALIDATED: 'PASS: this tour failed the pre-registered validation (ATP calls were over-confident)',
  WITHIN_UNCERTAINTY_BAND: 'PASS: the favourite is below the frozen threshold',
  MISSING_DAY_OR_TIMEZONE: 'HOLD: no sourced exact start and no source-proven day + timezone, so no lock time exists',
  NO_PRE_MATCH_SNAPSHOT_AT_LOCK: 'HOLD: no pre-match snapshot was frozen at or before the lock',
  INSUFFICIENT_HISTORY: 'HOLD: a player has fewer than 10 rated matches',
  INSUFFICIENT_SOURCE_DATA: 'HOLD: the frozen snapshot carries no published probability',
  LOCK_MISSED: 'HOLD: the match had already started when the lock was processed',
});

const MAIN_TOUR = new Set(['Grand Slam', 'WTA 1000', 'WTA 500', 'WTA 250', 'WTA Finals', 'grand_slam', 'wta_1000', 'wta_500', 'wta_250', 'wta_finals']);
const ISO_OFFSET = /^[+-](0\d|1[0-4]):[0-5]\d$/;
const FULL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Scope of one canonical match for Picker V1, from the canonical event type (MS / WS) and the edition level — never
 * from a market. Levels as stored: 'Grand Slam', 'WTA 1000|500|250', 'WTA Finals', 'WTA 125', ATP editions (level null
 * or ATP-named), ITF ('ITF …').
 */
export function scopeOf(m) {
  const singles = m?.sides?.A?.players?.length === 1 && m?.sides?.B?.players?.length === 1;
  if (!singles || !['MS', 'WS'].includes(m.event_type)) return 'out_of_scope';
  const level = m.tournament?.level || null;
  if (/^ITF/i.test(level || '')) return 'out_of_scope';
  if (m.event_type === 'MS') return 'atp';
  if (level === 'WTA 125') return 'shadow_wta125';
  if (MAIN_TOUR.has(level)) return 'wta_main';
  return 'out_of_scope';
}

/**
 * The designated lock for a match from what the canonical row carries at decision time.
 * schedule_day = { day: 'YYYY-MM-DD', utc_offset: '+08:00', source } — present only when the ingest proved both.
 */
export function lockFor(m) {
  if (m?.scheduled_at && FULL_ISO.test(m.scheduled_at)) {
    const t = Date.parse(m.scheduled_at);
    return { rule: 'T_MINUS_60', lock_at: new Date(t - PICKER_POLICY.t_minus_min * 60e3).toISOString(), scheduled_at: new Date(t).toISOString() };
  }
  const sd = m?.schedule_day;
  if (sd?.day && /^\d{4}-\d{2}-\d{2}$/.test(sd.day) && sd.utc_offset && ISO_OFFSET.test(sd.utc_offset) && sd.source) {
    return { rule: 'DAY_START_LOCK', lock_at: new Date(Date.parse(`${sd.day}T00:00:00${sd.utc_offset}`)).toISOString(), scheduled_at: null, day: sd.day, utc_offset: sd.utc_offset, day_source: sd.source };
  }
  return { rule: null, lock_at: null, scheduled_at: null };
}

// The ONLY keys a decision may see. Anything else — above all any market / venue / price field — throws.
export const DECISION_INPUT_KEYS = Object.freeze(['scope', 'lock', 'probability_a', 'rated_a', 'rated_b', 'model_status', 'snapshot_status', 'started']);
const MARKETISH = /kalshi|polymarket|market|venue|price|odds|bid|ask|mid/i;
export function assertDecisionInput(x) {
  for (const k of Object.keys(x || {})) {
    if (MARKETISH.test(k)) throw new Error(`market data may never enter the decision (${k})`);
    if (!DECISION_INPUT_KEYS.includes(k)) throw new Error(`unknown decision input key ${k}`);
  }
}

/** Pure decision: { state, side, reasons[], threshold, p_fav } — side is 'A' | 'B' (the favourite) for a CALL. */
export function decide(x, policy = PICKER_POLICY) {
  assertDecisionInput(x);
  const out = (state, side, reasons, extra = {}) => ({ state, side, reasons, threshold: policy.tau, ...extra });
  if (x.scope === 'atp') return out('PASS', null, ['MODEL_NOT_VALIDATED']);
  if (!x.lock?.lock_at) return out('HOLD', null, ['MISSING_DAY_OR_TIMEZONE']);
  if (x.started) return out('HOLD', null, ['LOCK_MISSED']);
  if (x.snapshot_status !== 'frozen') return out('HOLD', null, ['NO_PRE_MATCH_SNAPSHOT_AT_LOCK']);
  if (x.model_status === 'insufficient_history' || (Number.isFinite(x.rated_a) && x.rated_a < 10) || (Number.isFinite(x.rated_b) && x.rated_b < 10)) return out('HOLD', null, ['INSUFFICIENT_HISTORY']);
  if (x.model_status !== 'published' || !Number.isFinite(x.probability_a)) return out('HOLD', null, ['INSUFFICIENT_SOURCE_DATA']);
  const pA = x.probability_a;
  const side = pA >= 0.5 ? 'A' : 'B';
  const pFav = Math.max(pA, 1 - pA);
  if (pFav < policy.tau) return out('PASS', null, ['WITHIN_UNCERTAINTY_BAND'], { p_fav: pFav });
  return out('CALL', side, [], { p_fav: pFav });
}

/** official = activated_at != null && decided_at >= activated_at; shadow scope never official. */
export function isOfficial(record, policy = PICKER_POLICY) {
  if (record.scope !== 'wta_main' || record.decision?.state !== 'CALL') return false;
  if (!policy.activated_at) return false;
  return Date.parse(record.lock.decided_at) >= Date.parse(policy.activated_at);
}

/** Grade a decision from OUR canonical result. null while the match is not final. */
export function grade(record, m) {
  if (!record || record.decision?.state !== 'CALL') return null;
  const st = m?.status;
  if (['walkover', 'retired', 'defaulted', 'abandoned', 'cancelled'].includes(st) || ['retired', 'walkover', 'defaulted', 'default'].includes(m?.end_reason)) return { result: 'VOID', reason: st, rule_version: GRADING_RULE };
  if (st !== 'completed' || !m.winner_side) return null;
  return { result: m.winner_side === record.decision.side ? 'W' : 'L', reason: 'completed', rule_version: GRADING_RULE };
}

/** Brier / log loss of the CALLED side's probability vs the outcome (graded W / L only). */
export function scores(record, g) {
  if (!g || (g.result !== 'W' && g.result !== 'L')) return null;
  const p = record.decision.p_fav, y = g.result === 'W' ? 1 : 0;
  return { brier: Math.round(((p - y) ** 2) * 1e6) / 1e6, log_loss: Math.round(-Math.log(y ? p : 1 - p) * 1e6) / 1e6 };
}

/**
 * Build the immutable pbe-decision-record/1 for one match at its lock. `snapshot` = the pre-match snapshot frozen at or
 * before lock_at (or null), `benchmarks` = the shared benchmarksAt response for pbe_at = lock_at (or null when the
 * markets service was unreachable — recorded as such, never filled later).
 */
export function buildRecord({ match, scope, lock, snapshot, benchmarks, now, policy = PICKER_POLICY }) {
  const model = snapshot?.payload?.model || null;
  const pA = model?.status === 'published' && model.probability ? Number(model.probability.A) : null;
  const started = match.status !== 'scheduled';
  const input = { scope, lock, probability_a: pA, rated_a: model?.ratings?.A?.rated_matches ?? null, rated_b: model?.ratings?.B?.rated_matches ?? null, model_status: model?.status ?? null, snapshot_status: snapshot ? 'frozen' : 'none', started };
  const d = decide(input, policy);
  const pl = (s) => match.sides?.[s]?.players?.[0] || null;
  const sel = d.side ? pl(d.side) : null;
  const record = {
    schema: RECORD_SCHEMA,
    record_id: `tennis:${match.id}:${COUNTING_UNIT}`,
    domain: 'sports', sport: 'tennis', canonical_event_id: match.id, scope,
    event: { tour: match.event_type === 'MS' ? 'ATP' : match.tournament?.level === 'WTA 125' ? 'WTA 125' : 'WTA', level: match.tournament?.level || null, tournament: match.tournament?.slug || null, round: match.round || null, a: pl('A') ? { id: pl('A').id, name: pl('A').name, slug: pl('A').slug ?? null } : null, b: pl('B') ? { id: pl('B').id, name: pl('B').name, slug: pl('B').slug ?? null } : null, scheduled_at: match.scheduled_at ?? null, day: match.schedule_day?.day ?? null },
    contract: { canonical_contract_id: sel ? `sports_winner|tennis:${match.id}|team:${sel.id}` : null, selection_role: d.side ? d.side.toLowerCase() : null, selection_id: sel?.id ?? null, selection_name: sel?.name ?? null },
    evidence: snapshot ? { schema: snapshot.freeze_version, sha256: snapshot.content_hash, data_cutoff_at: snapshot.dna_as_of, snapshot_ref: snapshot.key, frozen_at: snapshot.frozen_at } : null,
    model: { id: policy.model.id, version: snapshot?.model_version ?? `${policy.model.name} method v${policy.model.method_version}`, state: model?.status ?? null, basis: model?.basis ?? null },
    probability: d.side ? (d.side === 'A' ? pA : 1 - pA) : pA,
    decision: { state: d.state, side: d.side, reasons: d.reasons, threshold: d.threshold, p_fav: d.p_fav ?? null, policy: policy.version, policy_status: policy.status, candidate: policy.candidate, frozen_at: policy.frozen_at, activated_at: policy.activated_at },
    lock: { decided_at: now, lock_at: lock.lock_at, lock_rule: lock.rule, scheduled_at_known_at_lock: lock.scheduled_at, day: lock.day ?? null, utc_offset: lock.utc_offset ?? null, day_source: lock.day_source ?? null, counting_unit: COUNTING_UNIT },
    at_forecast: benchmarks?.at_forecast ?? null,
    benchmarks_status: benchmarks ? 'frozen' : 'UNAVAILABLE_AT_DECISION',
    path: null, result: null, grade: null,
  };
  record.decision.official = isOfficial(record, policy);
  return record;
}
