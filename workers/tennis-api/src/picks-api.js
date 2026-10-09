// PBE PICKS read API (Picker V1 ledger, picker-ledger.js + Picks V2 ATP shadow ledger, picker-v2-atp.js). Owner decisions 2026-10-04:
//   /v1/picks                 ALL ACCESS — every recorded decision incl. pending pre-match CALL sides (index.js PREMIUM)
//   /v1/picks/track-record    PUBLIC — RESOLVED proof only: graded CALLs (side revealed only after the result) + counts.
//                             A pending CALL's side never appears here.
// Until the owner activates the policy every record is PROSPECTIVE · NOT OFFICIAL (official = activated_at != null &&
// decided_at >= activated_at). ATP shadow records (scope atp_shadow) are RESEARCH and never official. Market numbers
// are benchmarks frozen at the lock from OUR observations, shown per venue and compared with PBE only where the
// semantic gate says comparable. Opportunity labels (tennis-opportunity/1) are derived at read time from the frozen
// record only and never change it (docs/research/PICKS_V2_PROTOCOL.md §3).
import { envelope } from '../../shared/envelope.js';
import { PICKER_POLICY, REASONS } from './picker.js';
import { readLedger, getJson, mapLimit, READ_CONCURRENCY } from './picker-ledger.js';
import { readShadowLedger, ATP_SHADOW_POLICY, SHADOW_REASONS } from './picker-v2-atp.js';
import { readVerification, SUMMARY_KEY } from './picks-verify.js';

const wilson = (k, n, z = 1.96) => { if (!n) return null; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [r4((c - m) / d), r4((c + m) / d)]; };
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const mean = (a) => (a.length ? r4(a.reduce((s, x) => s + x, 0) / a.length) : null);
export const OPPORTUNITY_VERSION = 'tennis-opportunity/1';
const MARKET_DIFF = 0.05;
const SURFACE_DIFF = 0.05;

/** Production probability of side A as frozen in a record (V1: the side's / A's probability; shadow: raw input). */
function rawA(r) {
  if (r.probability_raw_a != null) return r.probability_raw_a;
  if (r.probability == null) return null;
  return r.decision.side === 'B' ? 1 - r.probability : r.probability;
}
/** The PBE favourite's player id at the lock (from the probability the decision used). */
function favouriteId(r) {
  if (r.contract?.selection_id) return r.contract.selection_id;
  const p = r.probability_a ?? rawA(r);
  if (p == null) return null;
  return p >= 0.5 ? r.event?.a?.id ?? null : r.event?.b?.id ?? null;
}

/** Pure: tennis-opportunity/1 labels of one frozen record. Never "value", never a profit claim. */
export function opportunities(r) {
  const out = [];
  if (r.decision.state === 'CALL') out.push({ code: 'MATCH_WINNER' });
  const pr = r.probability_raw_a, ov = r.overall_probability_a;
  if (r.model?.basis === 'surface_blend' && pr != null && ov != null && (Math.abs(pr - ov) >= SURFACE_DIFF || (pr >= 0.5) !== (ov >= 0.5))) out.push({ code: 'SURFACE_MATCHUP', surface: r.event?.surface ?? null, overall_a: ov, surface_blend_a: pr });
  const fav = favouriteId(r);
  for (const v of r.at_forecast || []) {
    if (!v || v.benchmark === 'NO_OBSERVATION_AT_PBE_FORECAST' || !v.market_favorite_team_id || !fav) continue;
    if (v.market_favorite_team_id !== fav && !out.some((o) => o.code === 'UNDERDOG_WATCH')) out.push({ code: 'UNDERDOG_WATCH', venue: v.venue, comparable: !!v.comparable });
  }
  if (r.decision.state === 'CALL' && r.probability != null) {
    for (const v of r.at_forecast || []) {
      if (!v?.comparable || v.selection_market_p_bp == null) continue;
      const d = r4(r.probability - v.selection_market_p_bp / 1e4);
      if (d >= MARKET_DIFF) out.push({ code: 'PBE_ABOVE_MARKET', venue: v.venue, diff: d });
      else if (d <= -MARKET_DIFF) out.push({ code: 'PBE_BELOW_MARKET', venue: v.venue, diff: d });
    }
  }
  return out;
}

const labelOf = (r) => (r.scope === 'atp_shadow' ? 'SHADOW · ATP RESEARCH' : r.decision.official ? 'OFFICIAL' : r.scope === 'shadow_wta125' ? 'SHADOW · WTA 125' : 'PROSPECTIVE · NOT OFFICIAL');
const reasonText = (code) => REASONS[code] || SHADOW_REASONS[code] || code;

/** Pure: the public/premium shape of one ledger row. `reveal` = may the CALL side be shown. */
export function shapePick({ record: r, grade: g, corrections = [], excluded = false, why = null }, { reveal }) {
  const resolved = !!g;
  const show = reveal || resolved;
  const shadow = r.scope === 'atp_shadow';
  return {
    match_id: r.canonical_event_id, scope: r.scope, event: r.event,
    state: r.decision.state, reasons: r.decision.reasons.map((code) => ({ code, text: reasonText(code) })),
    side: show ? r.decision.side : null, selection: show ? r.contract : null,
    probability: show && r.decision.state === 'CALL' ? r.probability : null, threshold: r.decision.threshold,
    probability_uncalibrated: show && shadow && r.decision.state === 'CALL' ? r.decision.p_fav_raw : null,
    uncertainty: show ? r.uncertainty ?? null : null,
    why: show ? (r.why || why || null) : null,
    opportunities: show ? opportunities(r) : [],
    official: !!r.decision.official, label: labelOf(r),
    model: { version: r.model?.version ?? null, basis: r.model?.basis ?? null, challenger: r.model?.challenger ?? null },
    lock: { rule: r.lock.lock_rule, lock_at: r.lock.lock_at, decided_at: r.lock.decided_at, day: r.lock.day, utc_offset: r.lock.utc_offset },
    evidence: r.evidence ? { schema: r.evidence.schema, sha256: r.evidence.sha256, frozen_at: r.evidence.frozen_at } : null,
    policy: { version: r.decision.policy, status: r.decision.policy_status, activated_at: r.decision.activated_at },
    markets_at_lock: show ? (r.at_forecast || null) : null, markets_status: r.benchmarks_status,
    corrections: corrections.map((c) => ({ reason: c.reason, excluded: c.excluded, note: c.note, at: c.at })), excluded,
    grade: g ? { result: g.grade.result, reason: g.grade.reason, scores: g.grade.scores, graded_at: g.graded_at, score: g.result.score, winner_side: g.result.winner_side, started_at: g.result.started_at ?? null } : null,
  };
}

const BANDS = [[0.55, 0.65], [0.65, 0.75], [0.75, 0.85], [0.85, 1.01]];
const bandKey = (p) => { const b = BANDS.find(([lo, hi]) => p >= lo && p < hi); return b ? `${Math.round(b[0] * 100)}-${Math.min(100, Math.round(b[1] * 100))}` : 'below-55'; };

/** Pure: track-record aggregates over ledger rows (graded W/L only enter hit rate / calibration; VOIDs counted apart). */
export function trackRecord(rows) {
  const by = {};
  for (const { record: r, grade: g, excluded } of rows) {
    if (excluded) continue;
    const s = (by[r.scope] ||= { version: r.decision.policy, decisions: 0, CALL: 0, PASS: 0, HOLD: 0, reasons: {}, graded: 0, W: 0, L: 0, VOID: 0, pending: 0, p: [], brier: [], log_loss: [], log_loss_raw: [], editions: new Set(), lock: { checked: 0, ok: 0 }, bands: {}, labels: {}, vs_market: { compared: 0, agree: 0, pbe_brier: [], market_brier: [], no_observation: 0, not_comparable: 0 } });
    s.decisions += 1; s[r.decision.state] += 1;
    for (const c of r.decision.reasons) s.reasons[c] = (s.reasons[c] || 0) + 1;
    if (r.decision.state !== 'CALL') {
      for (const o of opportunities(r)) { const l = (s.labels[o.code] ||= { n: 0, W: 0, L: 0, VOID: 0, pending: 0 }); l.n += 1; }
      continue;
    }
    const res = g ? g.grade.result : 'pending';
    for (const o of opportunities(r)) { const l = (s.labels[o.code] ||= { n: 0, W: 0, L: 0, VOID: 0, pending: 0 }); l.n += 1; l[res] += 1; }
    if (!g) { s.pending += 1; continue; }
    s[res] += 1;
    if (g.result?.started_at && r.lock?.decided_at) { s.lock.checked += 1; if (Date.parse(r.lock.decided_at) < Date.parse(g.result.started_at)) s.lock.ok += 1; }
    if (res === 'VOID') continue;
    s.graded += 1; s.p.push(r.decision.p_fav); s.brier.push(g.grade.scores.brier); s.log_loss.push(g.grade.scores.log_loss);
    if (g.grade.scores_raw) s.log_loss_raw.push(g.grade.scores_raw.log_loss);
    if (r.event?.tournament) s.editions.add(`${r.event.tournament}|${String(r.event.day || r.event.scheduled_at || r.lock.lock_at || '').slice(0, 4)}`);
    const bk = bandKey(r.decision.p_fav);
    const b = (s.bands[bk] ||= { graded: 0, W: 0, p: [] }); b.graded += 1; if (res === 'W') b.W += 1; b.p.push(r.decision.p_fav);
    const y = res === 'W' ? 1 : 0;
    for (const v of r.at_forecast || []) {
      if (!v.comparable) { s.vs_market.not_comparable += 1; continue; }
      if (v.benchmark === 'NO_OBSERVATION_AT_PBE_FORECAST' || v.selection_market_p_bp == null) { s.vs_market.no_observation += 1; continue; }
      const mp = v.selection_market_p_bp / 1e4;
      s.vs_market.compared += 1;
      if (v.market_favorite_team_id === r.contract.selection_id) s.vs_market.agree += 1;
      s.vs_market.pbe_brier.push((r.decision.p_fav - y) ** 2); s.vs_market.market_brier.push((mp - y) ** 2);
    }
  }
  return Object.fromEntries(Object.entries(by).map(([scope, s]) => [scope, {
    version: s.version, decisions: s.decisions, CALL: s.CALL, PASS: s.PASS, HOLD: s.HOLD, reasons: s.reasons, pending: s.pending,
    graded: s.graded, W: s.W, L: s.L, VOID: s.VOID,
    hit_rate: s.graded ? r4(s.W / s.graded) : null, wilson95: wilson(s.W, s.graded), mean_p: mean(s.p),
    calibration_gap: s.graded ? r4(s.W / s.graded - mean(s.p)) : null, brier: mean(s.brier), log_loss: mean(s.log_loss),
    log_loss_uncalibrated: s.log_loss_raw.length ? mean(s.log_loss_raw) : null,
    editions: s.editions.size, lock_integrity: { checked: s.lock.checked, before_start: s.lock.ok },
    by_probability: Object.fromEntries(Object.entries(s.bands).sort().map(([k, b]) => [k, { graded: b.graded, W: b.W, hit_rate: r4(b.W / b.graded), mean_p: mean(b.p) }])),
    opportunities: s.labels,
    vs_market: { compared: s.vs_market.compared, agree_on_favourite: s.vs_market.agree, pbe_brier: mean(s.vs_market.pbe_brier), market_brier: mean(s.vs_market.market_brier), no_observation_at_lock: s.vs_market.no_observation, not_comparable: s.vs_market.not_comparable },
  }]));
}

export const ACTIVATION_GATES = Object.freeze({
  status: 'PROPOSED only — owner decision 2026-10-09: Tennis stays RESEARCH ONLY; nothing activates',
  protocol: 'docs/research/PICKS_V2_PROTOCOL.md §4',
  wta_main: 'Prospective only: >= 250 graded CALLs from >= 25 editions, 100% lock integrity, Wilson 95% low >= 60%, hit − mean p >= −3 pts, log loss < ln 2; PBE vs same-contract market Brier disclosed',
  atp_shadow: 'Prospective only: same, with >= 300 graded CALLs from >= 30 editions, and the recalibrated probability beating the uncalibrated one on the same calls (edition-bootstrap CI below 0)',
});

// Shown on every picks surface (owner 2026-10-09: Tennis stays RESEARCH ONLY). Numbers are from committed evidence
// (docs/research/PICKS_V2_RESULTS.md); none of them is part of the prospective record.
export const DISCLOSURES = Object.freeze([
  { code: 'RESEARCH_ONLY', text: 'Research only. No Tennis pick is official: the WTA ledger is prospective proof and ATP is shadow research. Official picks need a separate owner decision.' },
  { code: 'UNDERDOG_WATCH', text: 'Underdog watch is a watch item, not a pick and not value. When the PBE favourite was the ranking underdog it won less often than PBE said: ATP 56.5% vs 62.4% (867 calls, 2019–2022), WTA 57.9% vs 63.7% (708 calls, 2023–2024).' },
  { code: 'OVERCONFIDENCE', text: 'The ATP PBE Rating ran about 4 points over-confident historically; the ATP shadow uses a frozen recalibration and is not validated until its prospective record passes the gate.' },
  { code: 'MARKETS_BENCHMARK_ONLY', text: 'Kalshi and Polymarket prices are benchmarks frozen at the lock from our own observations. They are never a model input, are compared only where the venue’s rules match the same contract, and no historical market comparison exists for the model’s development data.' },
  { code: 'SMALL_SAMPLES', text: 'The prospective samples are small: hit rates and market comparisons can swing widely until hundreds of calls are graded.' },
  { code: 'SEPARATE_RECORDS', text: 'Each line of the record is its own ledger and version: WTA main tour, WTA 125 shadow and ATP shadow are never pooled; historical development numbers are never part of the record; other PropBetEdge engines (such as Upset Hunter) are not counted here.' },
]);

const POLICY_META = () => ({ candidate: PICKER_POLICY.candidate, version: PICKER_POLICY.version, status: PICKER_POLICY.status, tau: PICKER_POLICY.tau, frozen_at: PICKER_POLICY.frozen_at, activated_at: PICKER_POLICY.activated_at, protocol: PICKER_POLICY.protocol, evidence: PICKER_POLICY.evidence,
  scope: { wta_main: 'WTA main-tour singles (Grand Slam, WTA 1000/500/250, Finals): prospective research record (no official picks)', shadow_wta125: 'WTA 125 singles: prospective shadow, never official', atp: 'ATP (Picker V1): PASS · MODEL_NOT_VALIDATED', atp_shadow: 'ATP singles: SHADOW research with the recalibrated probability (atp-recal/2), never official' },
  validation: { WTA: { holdout_calls: 45314, hit_rate: 0.756, wilson95: [0.752, 0.76], calibration_gap: 0.015, log_loss: 0.505, tour_level_descriptive: { graded_calls: 5928, hit_rate: 0.706, wilson95: [0.695, 0.718], calibration_gap: -0.007 } }, ATP: { result: 'FAILED calibration at every tau (about -4 pts); holdout untouched' } },
  atp_shadow: { candidate: ATP_SHADOW_POLICY.candidate, version: ATP_SHADOW_POLICY.version, challenger: ATP_SHADOW_POLICY.challenger, status: ATP_SHADOW_POLICY.status, tau: ATP_SHADOW_POLICY.tau, frozen_at: ATP_SHADOW_POLICY.frozen_at, protocol: ATP_SHADOW_POLICY.protocol, evidence: ATP_SHADOW_POLICY.evidence,
    development: { window: '2019-2022 forward-chained (fit on earlier years only)', matches: 8110, log_loss: 0.6257, log_loss_uncalibrated: 0.6301, ece: 0.013, ece_uncalibrated: 0.0404, calls_at_tau: 6455, hit_rate: 0.671, calibration_gap: -0.0118 },
    holdout: 'prospective shadow ledger only — not validated' },
  activation_gates: ACTIVATION_GATES,
  disclosures: DISCLOSURES,
  opportunities: { version: OPPORTUNITY_VERSION, MATCH_WINNER: 'a CALL', SURFACE_MATCHUP: 'the surface blend moved the probability >= 5 pts from the overall rating (or flipped the favourite)', UNDERDOG_WATCH: 'a venue’s market favourite at the lock is not the PBE favourite — a watch item, not a pick (historically PBE favourites that are ranking underdogs win less often than PBE says)', PBE_ABOVE_MARKET: 'same-contract venue only: PBE >= 5 pts above the market at the lock — a probability difference, not a profit claim', PBE_BELOW_MARKET: 'same-contract venue only: PBE >= 5 pts below the market at the lock' },
  lock_rule: 'sourced exact start -> T-60 min; else source-proven day + source-proven UTC offset -> 00:00 tournament local; else HOLD. One designated decision per match, never replaced.',
  grading: 'completed -> W / L; walkover, retirement, default, abandonment, cancellation -> VOID (counted, never in hit rate)' });

/** Public lock proofs for ATP shadow decisions: WHEN each record was locked and the sha256 of its stored bytes and of
 *  its frozen evidence — never its state, side or probability before the result (a hash commitment, not a reveal). */
export function lockProofs(rows) {
  return rows.filter((x) => x.record.scope === 'atp_shadow').slice(0, 300).map((x) => ({
    record_id: x.record.record_id, match_id: x.record.canonical_event_id, scope: x.record.scope, policy: x.record.decision.policy,
    decided_at: x.record.lock.decided_at, lock_at: x.record.lock.lock_at, lock_rule: x.record.lock.lock_rule,
    scheduled_at_known_at_lock: x.record.lock.scheduled_at_known_at_lock, first_seen_scheduled_at: x.record.lock.first_seen_scheduled_at ?? null,
    record_sha256: x.record_sha256 ?? null, evidence_sha256: x.record.evidence?.sha256 ?? null, evidence_frozen_at: x.record.evidence?.frozen_at ?? null,
    resolved: !!x.grade, excluded: !!x.excluded,
  }));
}

const PICK_MAIN = new Set(['Grand Slam', 'WTA 1000', 'WTA 500', 'WTA 250', 'WTA Finals', 'WTA 125']);
/**
 * Public WAITING facts (no sides / probabilities): which in-scope singles matches will be decided next and when, from
 * the canonical schedule — the same lock rule the ledgers use (sourced start - 60 min; else a source-proven day +
 * offset -> 00:00 local; else the match will be a HOLD). Two selects, no embeds, bounded.
 */
export async function upcomingLocks(store, now = new Date().toISOString()) {
  if (!store) return null;
  const t = Date.parse(now);
  const iso = (ms) => new Date(ms).toISOString();
  const base = 'select=match_id,event_type,scheduled_at,edition_id&event_type=in.(MS,WS)&status=eq.scheduled';
  const rows = [...await store.select('tennis_matches', `${base}&scheduled_at=gte.${iso(t)}&scheduled_at=lte.${iso(t + 48 * 3600e3)}&limit=300`)];
  let dayRows = [];
  try { dayRows = await store.select('tennis_matches', `select=match_id,event_type,scheduled_day,schedule_utc_offset,schedule_day_source,edition_id&event_type=eq.WS&status=eq.scheduled&scheduled_at=is.null&scheduled_day=gte.${iso(t - 86400e3).slice(0, 10)}&scheduled_day=lte.${iso(t + 86400e3).slice(0, 10)}&limit=300`); } catch { dayRows = []; }
  const eds = [...new Set([...rows, ...dayRows].map((r) => r.edition_id).filter(Boolean))];
  const level = new Map();
  for (let i = 0; i < eds.length; i += 80) for (const e of await store.select('tennis_tournament_editions', `select=edition_id,level&edition_id=in.(${eds.slice(i, i + 80).join(',')})`)) level.set(e.edition_id, e.level);
  const out = { as_of: now, window_hours: 48, atp_shadow: [], wta: [], wta_without_lock_source: 0, rule: 'sourced start - 60 min; else source-proven day + UTC offset -> 00:00 tournament local; else HOLD (never an invented start)' };
  for (const r of rows) {
    const lv = level.get(r.edition_id) || null;
    if (/^ITF/i.test(lv || '')) continue;
    const item = { match_id: r.match_id, scheduled_at: r.scheduled_at, lock_at: iso(Date.parse(r.scheduled_at) - 3600e3), rule: 'T_MINUS_60' };
    if (r.event_type === 'MS') out.atp_shadow.push(item); else if (PICK_MAIN.has(lv)) out.wta.push({ ...item, level: lv });
  }
  for (const r of dayRows) {
    const lv = level.get(r.edition_id) || null;
    if (!PICK_MAIN.has(lv)) continue;
    if (r.scheduled_day && r.schedule_utc_offset && r.schedule_day_source) out.wta.push({ match_id: r.match_id, scheduled_at: null, day: r.scheduled_day, lock_at: iso(Date.parse(`${r.scheduled_day}T00:00:00${r.schedule_utc_offset}`)), rule: 'DAY_START_LOCK', level: lv });
    else out.wta_without_lock_source += 1;
  }
  const fin = (a) => { const s = a.filter((x) => Date.parse(x.lock_at) > t - 6 * 3600e3).sort((x, y) => x.lock_at.localeCompare(y.lock_at)); return { candidates: s.length, next_lock_at: s.find((x) => Date.parse(x.lock_at) >= t)?.lock_at ?? null, next: s.slice(0, 8) }; };
  return { ...out, atp_shadow: fin(out.atp_shadow), wta: fin(out.wta) };
}

/** Public aggregate of the verification ledger (counts only; no sides / probabilities). */
export async function verificationSummary(env) {
  const v = env?.TENNIS_STATE ? await env.TENNIS_STATE.get(SUMMARY_KEY, 'json').catch(() => null) : null;
  return v ? { schema: v.schema, since: v.since, last_run_at: v.last_run_at, counts: v.counts, check_version: v.check_version ?? null, pending_lock_checks: v.pending_lock_checks ?? null, corrections: v.corrections || [], last_fail: v.last_fail ? { at: v.last_fail.at, scope: v.last_fail.scope, stage: v.last_fail.stage } : null } : null;
}

async function allRows(bucket) {
  const [v1, shadow] = await Promise.all([readLedger(bucket, { limit: 1000 }), readShadowLedger(bucket, { limit: 400 }).catch(() => [])]);
  return [...v1, ...shadow].sort((a, b) => String(b.record.lock.lock_at || b.record.lock.decided_at).localeCompare(String(a.record.lock.lock_at || a.record.lock.decided_at)));
}
/** "Why" for V1 CALLs (V1 records predate stored why): read from the frozen snapshot the decision cites. Bounded. */
async function attachWhy(bucket, rows, max = 30) {
  const needWhy = rows.filter((x) => !x.record.why && x.record.decision.state === 'CALL' && x.record.evidence?.snapshot_ref).slice(0, max);
  await mapLimit(needWhy, READ_CONCURRENCY, async (x) => {
    try { const s = await getJson(bucket, x.record.evidence.snapshot_ref); x.why = Array.isArray(s?.payload?.why) ? s.payload.why.slice(0, 6) : null; } catch { x.why = null; }
  });
}

export async function picksRoute(path, url, env, store = null) {
  if (path !== '/v1/picks' && path !== '/v1/picks/track-record' && path !== '/v1/picks/verification' && !/^\/v1\/picks\/[0-9a-f-]{36}$/.test(path)) return undefined;
  const bucket = env?.TENNIS_SOURCE;
  if (!bucket) return envelope(null, { freshness: 'NOT_CONFIGURED', semantics: 'pick ledger storage not bound' });
  // OWNER ONLY (index.js requires membership state 'owner' before this route runs): the full verification entries
  if (path === '/v1/picks/verification') {
    const entries = await readVerification(bucket, { limit: 300 });
    const summary = env.TENNIS_STATE ? await env.TENNIS_STATE.get(SUMMARY_KEY, 'json').catch(() => null) : null;
    return envelope({ summary, entries }, { source: ['pbe_derived'], source_updated_at: summary?.last_run_at || null, freshness: summary?.last_run_at ? 'CURRENT' : 'UNAVAILABLE', semantics: 'Picks lock verification ledger (pbe-lock-verification/1): read-only re-checks of stored decisions; owner only' });
  }
  const rows = await allRows(bucket);
  const updated = rows.reduce((t, x) => { const a = x.grade?.graded_at || x.record.lock.decided_at; return a > t ? a : t; }, '') || null;
  const meta = (semantics) => ({ source: ['pbe_derived'], source_updated_at: updated, freshness: updated ? 'CURRENT' : 'UNAVAILABLE', semantics });
  if (path === '/v1/picks/track-record') {
    const resolved = rows.filter((x) => x.grade);
    return envelope({ policy: POLICY_META(), record: trackRecord(rows), resolved: resolved.slice(0, 200).map((x) => shapePick(x, { reveal: false })), lock_proofs: lockProofs(rows), verification: await verificationSummary(env), upcoming_locks: await upcomingLocks(store).catch(() => ({ error: 'UPSTREAM_UNAVAILABLE' })) },
      meta('PBE Picks resolved track record: graded decisions only (pending pre-match sides are All Access). PROSPECTIVE · NOT OFFICIAL until owner activation; ATP is SHADOW research; activation never makes an earlier decision official.'));
  }
  const m = /^\/v1\/picks\/([0-9a-f-]{36})$/.exec(path);
  if (m) {
    const mine = rows.filter((x) => x.record.canonical_event_id === m[1]);
    const row = mine.find((x) => x.record.scope !== 'atp_shadow' && x.record.decision.state !== 'PASS') || mine.find((x) => x.record.scope === 'atp_shadow') || mine[0] || null;
    if (row) await attachWhy(bucket, [row], 1);
    return envelope(row ? { policy: POLICY_META(), pick: shapePick(row, { reveal: true }) } : null, { ...meta(row ? 'PBE designated decision for this match' : 'no designated decision recorded for this match yet'), freshness: row ? 'CURRENT' : 'UNAVAILABLE' });
  }
  const shown = rows.slice(0, 400);
  await attachWhy(bucket, shown.filter((x) => !x.grade));
  return envelope({ policy: POLICY_META(), picks: shown.map((x) => shapePick(x, { reveal: true })), record: trackRecord(rows), upcoming_locks: await upcomingLocks(store).catch(() => ({ error: 'UPSTREAM_UNAVAILABLE' })) },
    meta('PBE Picks ledger (All Access): every designated decision — CALL / PASS / HOLD — frozen at its lock; ATP rows are SHADOW research'));
}
