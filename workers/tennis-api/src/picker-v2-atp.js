// TENNIS PICKS V2 — ATP SHADOW LEDGER (docs/research/PICKS_V2_PROTOCOL.md §2; challenger docs/evidence/atp-recal/frozen.json).
// The prospective holdout of the ATP recalibration challenger atp-recal/2:temperature. RESEARCH ONLY: every record is
// "SHADOW · ATP RESEARCH — not an official pick" and can never become official (no activation applies to it).
//   ledger/picker-v2-atp-shadow/decisions/<match_id>.json   ONE designated decision per match
//   ledger/picker-v2-atp-shadow/seen/<match_id>.json        first observation while SCHEDULED (no post-hoc records)
//   ledger/picker-v2-atp-shadow/calls/<match_id>.json       index of CALLs
//   ledger/picker-v2-atp-shadow/grades/<match_id>.json      ONE grade per CALL (tennis-picker-grading/1)
//   ledger/picker-v2-atp-shadow/corrections/<id>/<ts>.json   append-only corrections
// Writes are create-only (head check + conditional put If-None-Match: *); nothing is ever overwritten.
// The input is the production probability frozen in the pre-match snapshot (the same input as Picker V1), mapped
// through the frozen monotone recalibration (recal.js). Markets are never an input; benchmarks are frozen beside it.
import { scopeOf, lockFor, grade, GRADING_RULE, COUNTING_UNIT, PICKS_ACTIVATED_AT } from './picker.js';
import { snapshotAtOrBefore } from './matchup-freeze.js';
import { fetchBenchmarks, mapLimit, READ_CONCURRENCY } from './picker-ledger.js';
import { MATCH, shapeMatch } from './shape.js';
import { applyRecal } from './recal.js';

export const SHADOW_PREFIX = 'ledger/picker-v2-atp-shadow/';
export const ATP_SHADOW_POLICY = Object.freeze({
  candidate: 'tennis-picker-v2-atp-shadow',
  version: 'tennis-picker-v2-atp-shadow@5ee70eb',
  challenger: 'atp-recal/2:temperature',
  status: 'FROZEN_PROSPECTIVE_SHADOW',
  official: false, // never: a shadow record is research by definition, under any activation
  recal: Object.freeze({ method: 'temperature', params: Object.freeze({ T: 1.24867 }) }),
  tau: 0.55,
  min_prior: 10,
  frozen_at: '2026-10-09T11:10:44.515Z',
  protocol: 'docs/research/PICKS_V2_PROTOCOL.md@ff35487',
  evidence: 'docs/evidence/atp-recal/frozen.json@5ee70eb',
});
// development OOS reliability of the frozen method (dev-study.json pooled_oos.temperature.reliability): the honest
// uncertainty statement attached to each probability — "of past calls in this band, the favourite won X of N"
export const DEV_RELIABILITY = Object.freeze([
  { from: 0.5, to: 0.6, n: 3179, mean_p: 0.5485, won: 0.531 },
  { from: 0.6, to: 0.7, n: 2444, mean_p: 0.6474, won: 0.6346 },
  { from: 0.7, to: 0.8, n: 1625, mean_p: 0.7455, won: 0.736 },
  { from: 0.8, to: 0.9, n: 713, mean_p: 0.8413, won: 0.8387 },
]);
export const SHADOW_REASONS = Object.freeze({
  MISSING_DAY_OR_TIMEZONE: 'HOLD: no sourced exact start and no source-proven day + timezone, so no lock time exists',
  LOCK_MISSED: 'HOLD: the match had already started when the lock was processed',
  NO_PRE_MATCH_SNAPSHOT_AT_LOCK: 'HOLD: no pre-match snapshot was frozen at or before the lock',
  INSUFFICIENT_HISTORY: 'HOLD: a player has fewer than 10 rated matches',
  INSUFFICIENT_SOURCE_DATA: 'HOLD: the frozen snapshot carries no published probability',
  WITHIN_UNCERTAINTY_BAND: 'PASS: the recalibrated favourite probability is below the frozen threshold',
});
const DAY_WINDOW_MS = 6 * 3600e3;
const BENCHMARK_DEFER_MS = 30 * 60e3;
const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);

export const keysFor = (prefix) => ({
  decision: (id) => `${prefix}decisions/${id}.json`,
  seen: (id) => `${prefix}seen/${id}.json`,
  call: (id) => `${prefix}calls/${id}.json`,
  grade: (id) => `${prefix}grades/${id}.json`,
  correction: (id, at) => `${prefix}corrections/${id}/${at.replace(/[:.]/g, '-')}.json`,
});
export const key = keysFor(SHADOW_PREFIX);

// ATP OFFICIAL-PICKS DECISION STREAM (owner decision 2026-10-09, LHBUSA/tennis#14). A NEW, forward-only ledger — not a relabel of the
// shadow: its own prefix, policy version, record ids and grades. The decision rule is the frozen atp-recal/2 challenger
// unchanged (same recalibration, threshold and history floor). It decides only once the cutover has passed and only matches
// whose lock falls at or after it, so no decision that existed before the launch can enter it. The shadow ledger keeps
// running unchanged as the prelaunch research record.
export const OFFICIAL_ATP_PREFIX = 'ledger/picks-official-v1/atp/';
export const ATP_OFFICIAL_POLICY = Object.freeze({
  candidate: 'tennis-picks-official-v1-atp',
  version: 'tennis-picks-official-v1-atp@tennis#14',
  challenger: ATP_SHADOW_POLICY.challenger,
  status: 'OFFICIAL',
  official: true,
  recal: ATP_SHADOW_POLICY.recal,
  tau: ATP_SHADOW_POLICY.tau,
  min_prior: ATP_SHADOW_POLICY.min_prior,
  frozen_at: ATP_SHADOW_POLICY.frozen_at,
  activated_at: PICKS_ACTIVATED_AT,
  protocol: 'docs/picks/OFFICIAL_V1.md',
  evidence: ATP_SHADOW_POLICY.evidence,
});
export const SHADOW_STREAM = Object.freeze({ prefix: SHADOW_PREFIX, policy: ATP_SHADOW_POLICY, scope: 'atp_shadow', idSuffix: ':atp-shadow', kv: 'picker:v2:atp-shadow:last', activatedAt: null });
export const OFFICIAL_STREAM = Object.freeze({ prefix: OFFICIAL_ATP_PREFIX, policy: ATP_OFFICIAL_POLICY, scope: 'atp_official', idSuffix: ':atp-official', kv: 'picks:official:atp:last', activatedAt: PICKS_ACTIVATED_AT });
const keysOf = (stream) => (stream.prefix === SHADOW_PREFIX ? key : keysFor(stream.prefix));

/** Create-only put: head check, then a conditional put that the store refuses when the key exists. true = written. */
export async function createOnly(bucket, k, obj) {
  if (await bucket.head(k)) return false;
  const res = await bucket.put(k, JSON.stringify(obj), { httpMetadata: { contentType: 'application/json' }, onlyIf: new Headers({ 'if-none-match': '*' }) });
  return res != null;
}
const getJson = async (bucket, k) => { const o = await bucket.get(k); return o ? JSON.parse(await o.text()) : null; };

// Decision input allowlist (same doctrine as Picker V1): any market-ish key throws.
const INPUT_KEYS = ['lock', 'probability_a', 'rated_a', 'rated_b', 'model_status', 'snapshot_status', 'started'];
const MARKETISH = /kalshi|polymarket|market|venue|price|odds|bid|ask|mid/i;
export function decideShadow(x, policy = ATP_SHADOW_POLICY) {
  for (const k of Object.keys(x || {})) {
    if (MARKETISH.test(k)) throw new Error(`market data may never enter the decision (${k})`);
    if (!INPUT_KEYS.includes(k)) throw new Error(`unknown decision input key ${k}`);
  }
  const out = (state, side, reasons, extra = {}) => ({ state, side, reasons, threshold: policy.tau, ...extra });
  if (!x.lock?.lock_at) return out('HOLD', null, ['MISSING_DAY_OR_TIMEZONE']);
  if (x.started) return out('HOLD', null, ['LOCK_MISSED']);
  if (x.snapshot_status !== 'frozen') return out('HOLD', null, ['NO_PRE_MATCH_SNAPSHOT_AT_LOCK']);
  if (x.model_status === 'insufficient_history' || (Number.isFinite(x.rated_a) && x.rated_a < policy.min_prior) || (Number.isFinite(x.rated_b) && x.rated_b < policy.min_prior)) return out('HOLD', null, ['INSUFFICIENT_HISTORY']);
  if (x.model_status !== 'published' || !Number.isFinite(x.probability_a)) return out('HOLD', null, ['INSUFFICIENT_SOURCE_DATA']);
  const pA = applyRecal(policy.recal, x.probability_a);
  const side = pA >= 0.5 ? 'A' : 'B';
  const pFav = Math.max(pA, 1 - pA);
  const raw = side === 'A' ? x.probability_a : 1 - x.probability_a;
  if (pFav < policy.tau) return out('PASS', null, ['WITHIN_UNCERTAINTY_BAND'], { p_fav: r4(pFav), p_fav_raw: r4(raw) });
  return out('CALL', side, [], { p_fav: r4(pFav), p_fav_raw: r4(raw) });
}

export const bandOf = (pFav) => DEV_RELIABILITY.find((b) => pFav >= b.from && pFav < b.to) || null;

export function buildShadowRecord({ match, lock, snapshot, benchmarks, now, started, stream = SHADOW_STREAM, policy = stream.policy }) {
  const official = !!policy.official && Number.isFinite(Date.parse(policy.activated_at)) && Date.parse(now) >= Date.parse(policy.activated_at);
  const payload = snapshot?.payload || {};
  const model = payload.model || null;
  const pA = model?.status === 'published' && model.probability ? Number(model.probability.A) : null;
  const d = decideShadow({ lock, probability_a: pA, rated_a: model?.ratings?.A?.rated_matches ?? null, rated_b: model?.ratings?.B?.rated_matches ?? null, model_status: model?.status ?? null, snapshot_status: snapshot ? 'frozen' : 'none', started }, policy);
  const pl = (s) => match.sides?.[s]?.players?.[0] || null;
  const sel = d.side ? pl(d.side) : null;
  const ov = model?.overall_probability ? Number(model.overall_probability.A) : null;
  const band = d.p_fav != null ? bandOf(d.p_fav) : null;
  return {
    schema: 'pbe-decision-record/1', record_id: `tennis:${match.id}:${COUNTING_UNIT}${stream.idSuffix}`,
    domain: 'sports', sport: 'tennis', canonical_event_id: match.id, scope: stream.scope,
    event: { tour: 'ATP', level: match.tournament?.level || null, tournament: match.tournament?.slug || null, round: match.round || null, a: pl('A') ? { id: pl('A').id, name: pl('A').name, slug: pl('A').slug ?? null } : null, b: pl('B') ? { id: pl('B').id, name: pl('B').name, slug: pl('B').slug ?? null } : null, scheduled_at: match.scheduled_at ?? null, day: match.schedule_day?.day ?? null, surface: match.tournament?.surface ?? null },
    contract: { canonical_contract_id: sel ? `sports_winner|tennis:${match.id}|team:${sel.id}` : null, selection_role: d.side ? d.side.toLowerCase() : null, selection_id: sel?.id ?? null, selection_name: sel?.name ?? null },
    evidence: snapshot ? { schema: snapshot.freeze_version, sha256: snapshot.content_hash, data_cutoff_at: snapshot.dna_as_of, snapshot_ref: snapshot.key, frozen_at: snapshot.frozen_at } : null,
    model: { id: 'pbe-rating', version: snapshot?.model_version ?? 'PBE Rating method v1', state: model?.status ?? null, basis: model?.basis ?? null, challenger: policy.challenger, recalibration: policy.recal },
    // stored features only: the production probability (raw), its overall-only twin, the recalibrated probability
    probability_raw_a: pA, overall_probability_a: ov, probability_a: pA == null ? null : r4(applyRecal(policy.recal, pA)),
    probability: d.side ? d.p_fav : null,
    uncertainty: band ? { method: 'development reliability band (2019-2022 OOS)', band: [band.from, band.to], past_calls: band.n, favourite_won: band.won } : null,
    why: Array.isArray(payload.why) ? payload.why.slice(0, 6) : null,
    decision: { state: d.state, side: d.side, reasons: d.reasons, threshold: d.threshold, p_fav: d.p_fav ?? null, p_fav_raw: d.p_fav_raw ?? null, policy: policy.version, policy_status: policy.status, candidate: policy.candidate, frozen_at: policy.frozen_at, activated_at: policy.activated_at ?? null, official: official && d.state === 'CALL' },
    lock: { decided_at: now, lock_at: lock.lock_at, lock_rule: lock.rule, scheduled_at_known_at_lock: lock.scheduled_at, day: lock.day ?? null, utc_offset: lock.utc_offset ?? null, day_source: lock.day_source ?? null, counting_unit: COUNTING_UNIT },
    at_forecast: benchmarks?.at_forecast ?? null, benchmarks_status: benchmarks ? 'frozen' : 'UNAVAILABLE_AT_DECISION',
    grading_rule: GRADING_RULE,
  };
}

/** Decide one ATP match (pure enough to test with fakes). */
export async function decideShadowMatch({ bucket, match, now, fetchImpl, benchBase, decided = null, seen = null, stream = SHADOW_STREAM }) {
  const key = keysOf(stream);
  if (scopeOf(match) !== 'atp') return { id: match.id, skipped: 'out_of_scope' };
  // forward-only official stream: nothing before the cutover, and never a match whose lock fell before it
  if (stream.activatedAt != null && !(Date.parse(now) >= Date.parse(stream.activatedAt))) return { id: match.id, skipped: 'before_activation' };
  if (decided ? decided.has(match.id) : await bucket.head(key.decision(match.id))) return { id: match.id, skipped: 'already_decided' };
  const lock = lockFor(match);
  if (stream.activatedAt != null && lock.lock_at && Date.parse(lock.lock_at) < Date.parse(stream.activatedAt)) return { id: match.id, skipped: 'locked_before_activation' };
  const windowEnd = lock.rule === 'T_MINUS_60' ? Date.parse(lock.scheduled_at) : lock.rule === 'DAY_START_LOCK' ? Date.parse(lock.lock_at) + DAY_WINDOW_MS : Infinity;
  const started = match.status !== 'scheduled' || Date.parse(now) >= windowEnd;
  const wasSeen = seen ? seen.has(match.id) : !!(await bucket.head(key.seen(match.id)));
  if (started && !wasSeen) return { id: match.id, skipped: 'not_observed_before_start' };
  if (!started && !wasSeen) await createOnly(bucket, key.seen(match.id), { match_id: match.id, first_seen_at: now, scheduled_at: match.scheduled_at ?? null });
  if (!lock.lock_at && !started) return { id: match.id, skipped: 'no_lock_yet' };
  if (lock.lock_at && Date.parse(lock.lock_at) > Date.parse(now) && !started) return { id: match.id, skipped: 'before_lock', lock_at: lock.lock_at };
  const snapshot = lock.lock_at && !started ? await snapshotAtOrBefore(bucket, match.id, lock.lock_at) : null;
  const preview = buildShadowRecord({ match, lock, snapshot, benchmarks: null, now, started, stream });
  let benchmarks = null;
  if (lock.lock_at && !started) {
    benchmarks = await fetchBenchmarks(fetchImpl, { id: match.id, pbeAt: lock.lock_at, selection: preview.contract.selection_id }, benchBase);
    if (!benchmarks && Date.parse(now) - Date.parse(lock.lock_at) < BENCHMARK_DEFER_MS) return { id: match.id, skipped: 'benchmarks_deferred' };
  }
  const record = buildShadowRecord({ match, lock, snapshot, benchmarks, now, started, stream });
  record.lock.first_seen_scheduled_at = wasSeen ? ((await getJson(bucket, key.seen(match.id)))?.first_seen_at ?? null) : now;
  const written = await createOnly(bucket, key.decision(match.id), record);
  if (written && record.decision.state === 'CALL') await createOnly(bucket, key.call(match.id), { match_id: match.id, decided_at: now });
  return { id: match.id, written, state: record.decision.state, reasons: record.decision.reasons };
}

/** Grade one shadow CALL from our canonical result; scores both the recalibrated and the raw probability (paired). */
export async function gradeShadowMatch({ bucket, record, match, now, fetchImpl, benchBase, stream = SHADOW_STREAM }) {
  const key = keysOf(stream);
  if (record.decision.state !== 'CALL') return { skipped: 'not_a_call' };
  const g = grade(record, match);
  if (!g) return { skipped: 'not_final' };
  const sc = (p) => (g.result === 'W' || g.result === 'L' ? (() => { const y = g.result === 'W' ? 1 : 0; return { brier: r4((p - y) ** 2), log_loss: Math.round(-Math.log(y ? p : 1 - p) * 1e6) / 1e6 }; })() : null);
  const startAt = match.started_at || null;
  const preStart = startAt ? await fetchBenchmarks(fetchImpl, { id: record.canonical_event_id, pbeAt: startAt, selection: record.contract.selection_id }, benchBase) : null;
  const out = {
    schema: 'pbe-decision-grade/1', record_id: record.record_id, canonical_event_id: record.canonical_event_id, graded_at: now,
    result: { status: match.status, winner_side: match.winner_side ?? null, end_reason: match.end_reason ?? null, started_at: startAt, score: match.score ?? null, source: 'canonical tennis_matches' },
    lock_integrity: startAt ? Date.parse(record.lock.decided_at) < Date.parse(startAt) : null,
    grade: { ...g, graded_at: now, scores: sc(record.decision.p_fav), scores_raw: sc(record.decision.p_fav_raw) },
    path: { pre_start: preStart ? { pbe_at: startAt, at_forecast: preStart.at_forecast } : null },
  };
  return { written: await createOnly(bucket, key.grade(record.canonical_event_id), out), result: g.result };
}

async function listIds(bucket, sub, prefix = SHADOW_PREFIX) {
  const p = `${prefix}${sub}/`;
  const ids = new Set();
  let cursor;
  do { const r = await bucket.list({ prefix: p, cursor, limit: 1000 }); for (const o of r.objects) ids.add(o.key.slice(p.length).replace(/\.json$/, '').split('/')[0]); cursor = r.truncated ? r.cursor : undefined; } while (cursor);
  return ids;
}

/** CRON step (tennis-api every 10 min, after Picker V1). Bounded: <= `limit` decisions and <= 15 grades per tick. */
export async function runAtpShadow(store, env, { now = new Date().toISOString(), fetchImpl = null, limit = 8, stream = SHADOW_STREAM } = {}) {
  const key = keysOf(stream);
  fetchImpl = fetchImpl || (env?.MARKETS ? (u, init) => env.MARKETS.fetch(u, init) : fetch);
  const bucket = env?.TENNIS_SOURCE;
  if (!bucket || !store) return { error: 'not_configured' };
  const t = Date.parse(now);
  const iso = (ms) => new Date(ms).toISOString();
  const sum = { at: now, policy: stream.policy.version, candidates: 0, decided: [], graded: [], skipped: {} };
  // the official stream does nothing at all before the cutover (no reads, no writes)
  if (stream.activatedAt != null && !(Date.parse(now) >= Date.parse(stream.activatedAt))) { sum.skipped.before_activation = 1; return sum; }
  const [decided, seen, calls, graded] = await Promise.all(['decisions', 'seen', 'calls', 'grades'].map((s) => listIds(bucket, s, stream.prefix)));
  const ids = new Set();
  for (const r of await store.select('tennis_matches', `select=match_id&event_type=eq.MS&status=eq.scheduled&scheduled_at=gte.${iso(t - 6 * 3600e3)}&scheduled_at=lte.${iso(t + 36 * 3600e3)}&limit=300`)) ids.add(r.match_id);
  for (const id of seen) ids.add(id);
  const undecided = [...ids].filter((id) => !decided.has(id));
  sum.candidates = undecided.length;
  const rows = [];
  for (let i = 0; i < undecided.length; i += 80) rows.push(...await store.select('tennis_matches', `select=${MATCH}&match_id=in.(${undecided.slice(i, i + 80).join(',')})`));
  let work = 0;
  for (const row of rows) {
    if (work >= limit) break;
    try {
      const res = await decideShadowMatch({ bucket, match: shapeMatch(row), now, fetchImpl, decided, seen, stream });
      if (res.skipped) sum.skipped[res.skipped] = (sum.skipped[res.skipped] || 0) + 1; else { sum.decided.push(res); work += 1; }
    } catch { sum.skipped.error = (sum.skipped.error || 0) + 1; }
  }
  const open = [...calls].filter((id) => !graded.has(id)).slice(0, 15);
  if (open.length) {
    const res = await store.select('tennis_matches', `select=match_id,status,winner_side,end_reason,started_at,score_text&match_id=in.(${open.join(',')})`);
    for (const m of res) {
      if (['scheduled', 'in_progress', 'suspended'].includes(m.status)) continue;
      const record = await getJson(bucket, key.decision(m.match_id));
      if (!record) continue;
      const g = await gradeShadowMatch({ bucket, record, match: { status: m.status, winner_side: m.winner_side, end_reason: m.end_reason, started_at: m.started_at, score: m.score_text }, now, fetchImpl, stream });
      if (g.written) sum.graded.push({ id: m.match_id, result: g.result });
    }
  }
  if (env.TENNIS_STATE) await env.TENNIS_STATE.put(stream.kv, JSON.stringify({ ...sum, decided: sum.decided.slice(0, 25) }));
  return sum;
}

/** All shadow decisions (+ grades + corrections), newest first. */
export async function readShadowLedger(bucket, { limit = 400, stream = SHADOW_STREAM } = {}) {
  const key = keysOf(stream);
  const ids = [...await listIds(bucket, 'decisions', stream.prefix)];
  const corrIds = await listIds(bucket, 'corrections', stream.prefix);
  // bounded-parallel reads (2026-10-09 P0: see readLedger)
  const rows = (await mapLimit(ids.slice(-limit), READ_CONCURRENCY, async (id) => {
    const obj = await bucket.get(key.decision(id));
    if (!obj) return null;
    const text = await obj.text();
    const rec = JSON.parse(text);
    // sha256 of the stored bytes: a public commitment to the full record (side included) before the result
    const recordSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    let corrections = [];
    if (corrIds.has(id)) {
      const l = await bucket.list({ prefix: `${stream.prefix}corrections/${id}/` });
      corrections = (await Promise.all(l.objects.map((o) => getJson(bucket, o.key)))).filter(Boolean);
    }
    return { record: rec, record_sha256: recordSha256, grade: rec.decision.state === 'CALL' ? await getJson(bucket, key.grade(id)) : null, corrections, excluded: corrections.some((c) => c.excluded) };
  })).filter(Boolean);
  return rows.sort((a, b) => String(b.record.lock.lock_at || b.record.lock.decided_at).localeCompare(String(a.record.lock.lock_at || a.record.lock.decided_at)));
}
