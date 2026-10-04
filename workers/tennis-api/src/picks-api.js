// PBE PICKS read API (Picker V1 ledger, picker-ledger.js). Owner decisions 2026-10-04:
//   /v1/picks                 ALL ACCESS — every recorded decision incl. pending pre-match CALL sides (index.js PREMIUM)
//   /v1/picks/track-record    PUBLIC — RESOLVED proof only: graded CALLs (side revealed only after the result) + counts.
//                             A pending CALL's side never appears here.
// Until the owner activates the policy every record is PROSPECTIVE · NOT OFFICIAL (official = activated_at != null &&
// decided_at >= activated_at). Market numbers are benchmarks frozen at the lock from OUR observations, shown per venue
// and compared with PBE only where the semantic gate says comparable.
import { envelope } from '../../shared/envelope.js';
import { PICKER_POLICY, REASONS } from './picker.js';
import { readLedger } from './picker-ledger.js';

const wilson = (k, n, z = 1.96) => { if (!n) return null; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [r4((c - m) / d), r4((c + m) / d)]; };
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const mean = (a) => (a.length ? r4(a.reduce((s, x) => s + x, 0) / a.length) : null);

/** Pure: the public/premium shape of one ledger row. `reveal` = may the CALL side be shown. */
export function shapePick({ record: r, grade: g, corrections = [], excluded = false }, { reveal }) {
  const resolved = !!g;
  const show = reveal || resolved;
  return {
    match_id: r.canonical_event_id, scope: r.scope, event: r.event,
    state: r.decision.state, reasons: r.decision.reasons.map((code) => ({ code, text: REASONS[code] || code })),
    side: show ? r.decision.side : null, selection: show ? r.contract : null,
    probability: show && r.decision.state === 'CALL' ? r.probability : null, threshold: r.decision.threshold,
    official: !!r.decision.official, label: r.decision.official ? 'OFFICIAL' : r.scope === 'shadow_wta125' ? 'SHADOW · WTA 125' : 'PROSPECTIVE · NOT OFFICIAL',
    lock: { rule: r.lock.lock_rule, lock_at: r.lock.lock_at, decided_at: r.lock.decided_at, day: r.lock.day, utc_offset: r.lock.utc_offset },
    evidence: r.evidence ? { schema: r.evidence.schema, sha256: r.evidence.sha256, frozen_at: r.evidence.frozen_at } : null,
    policy: { version: r.decision.policy, status: r.decision.policy_status, activated_at: r.decision.activated_at },
    markets_at_lock: show ? (r.at_forecast || null) : null, markets_status: r.benchmarks_status,
    corrections: corrections.map((c) => ({ reason: c.reason, excluded: c.excluded, note: c.note, at: c.at })), excluded,
    grade: g ? { result: g.grade.result, reason: g.grade.reason, scores: g.grade.scores, graded_at: g.graded_at, score: g.result.score, winner_side: g.result.winner_side } : null,
  };
}

/** Pure: track-record aggregates over ledger rows (graded W/L only enter hit rate / calibration; VOIDs counted apart). */
export function trackRecord(rows) {
  const by = {};
  for (const { record: r, grade: g, excluded } of rows) {
    if (excluded) continue;
    const s = (by[r.scope] ||= { decisions: 0, CALL: 0, PASS: 0, HOLD: 0, reasons: {}, graded: 0, W: 0, L: 0, VOID: 0, pending: 0, p: [], brier: [], log_loss: [], vs_market: { compared: 0, agree: 0, pbe_brier: [], market_brier: [], no_observation: 0, not_comparable: 0 } });
    s.decisions += 1; s[r.decision.state] += 1;
    for (const c of r.decision.reasons) s.reasons[c] = (s.reasons[c] || 0) + 1;
    if (r.decision.state !== 'CALL') continue;
    if (!g) { s.pending += 1; continue; }
    const res = g.grade.result;
    s[res] += 1;
    if (res === 'VOID') continue;
    s.graded += 1; s.p.push(r.decision.p_fav); s.brier.push(g.grade.scores.brier); s.log_loss.push(g.grade.scores.log_loss);
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
    decisions: s.decisions, CALL: s.CALL, PASS: s.PASS, HOLD: s.HOLD, reasons: s.reasons, pending: s.pending,
    graded: s.graded, W: s.W, L: s.L, VOID: s.VOID,
    hit_rate: s.graded ? r4(s.W / s.graded) : null, wilson95: wilson(s.W, s.graded), mean_p: mean(s.p),
    calibration_gap: s.graded ? r4(s.W / s.graded - mean(s.p)) : null, brier: mean(s.brier), log_loss: mean(s.log_loss),
    vs_market: { compared: s.vs_market.compared, agree_on_favourite: s.vs_market.agree, pbe_brier: mean(s.vs_market.pbe_brier), market_brier: mean(s.vs_market.market_brier), no_observation_at_lock: s.vs_market.no_observation, not_comparable: s.vs_market.not_comparable },
  }]));
}

const POLICY_META = () => ({ candidate: PICKER_POLICY.candidate, version: PICKER_POLICY.version, status: PICKER_POLICY.status, tau: PICKER_POLICY.tau, frozen_at: PICKER_POLICY.frozen_at, activated_at: PICKER_POLICY.activated_at, protocol: PICKER_POLICY.protocol, evidence: PICKER_POLICY.evidence,
  scope: { wta_main: 'WTA main-tour singles (Grand Slam, WTA 1000/500/250, Finals): the official candidate', shadow_wta125: 'WTA 125 singles: prospective shadow, never official', atp: 'ATP: PASS · MODEL_NOT_VALIDATED' },
  validation: { WTA: { holdout_calls: 45314, hit_rate: 0.756, wilson95: [0.752, 0.76], calibration_gap: 0.015, log_loss: 0.505, tour_level_descriptive: { graded_calls: 5928, hit_rate: 0.706, wilson95: [0.695, 0.718], calibration_gap: -0.007 } }, ATP: { result: 'FAILED calibration at every tau (about -4 pts); holdout untouched' } },
  lock_rule: 'sourced exact start -> T-60 min; else source-proven day + source-proven UTC offset -> 00:00 tournament local; else HOLD. One designated decision per match, never replaced.',
  grading: 'completed -> W / L; walkover, retirement, default, abandonment, cancellation -> VOID (counted, never in hit rate)' });

export async function picksRoute(path, url, env) {
  if (path !== '/v1/picks' && path !== '/v1/picks/track-record' && !/^\/v1\/picks\/[0-9a-f-]{36}$/.test(path)) return undefined;
  const bucket = env?.TENNIS_SOURCE;
  if (!bucket) return envelope(null, { freshness: 'NOT_CONFIGURED', semantics: 'pick ledger storage not bound' });
  const rows = await readLedger(bucket, { limit: 1000 });
  const updated = rows.reduce((t, x) => { const a = x.grade?.graded_at || x.record.lock.decided_at; return a > t ? a : t; }, '') || null;
  const meta = (semantics) => ({ source: ['pbe_derived'], source_updated_at: updated, freshness: updated ? 'CURRENT' : 'UNAVAILABLE', semantics });
  if (path === '/v1/picks/track-record') {
    const resolved = rows.filter((x) => x.grade);
    return envelope({ policy: POLICY_META(), record: trackRecord(rows), resolved: resolved.slice(0, 200).map((x) => shapePick(x, { reveal: false })) },
      meta('PBE Picker V1 resolved track record: graded decisions only (pending pre-match sides are All Access). PROSPECTIVE · NOT OFFICIAL until owner activation; activation never makes an earlier decision official.'));
  }
  const m = /^\/v1\/picks\/([0-9a-f-]{36})$/.exec(path);
  if (m) {
    const row = rows.find((x) => x.record.canonical_event_id === m[1]);
    return envelope(row ? { policy: POLICY_META(), pick: shapePick(row, { reveal: true }) } : null, { ...meta(row ? 'PBE Picker V1 designated decision for this match' : 'no designated decision recorded for this match yet'), freshness: row ? 'CURRENT' : 'UNAVAILABLE' });
  }
  return envelope({ policy: POLICY_META(), picks: rows.slice(0, 300).map((x) => shapePick(x, { reveal: true })), record: trackRecord(rows) },
    meta('PBE Picker V1 ledger (All Access): every designated decision — CALL / PASS / HOLD — frozen at its lock'));
}
