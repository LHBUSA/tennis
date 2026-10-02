// Matchup Model V2 — FROZEN prospective promotion gate (fixed 2026-10-02, before any shadow result existed).
// Changing any value below is a NEW gate version (mm2-shadow-gate/2) recorded in the research doc, never an edit of /1;
// tests/mm2-research.test.js pins this object. Meeting the gate makes a challenger ELIGIBLE for an owner decision; it never
// promotes anything by itself.
export const PROMOTION_GATE = Object.freeze({
  gate_version: 'mm2-shadow-gate/1',
  model_version: 'mm2-B-context/1',
  coef_hash: 'ca5795a4dc2d7578d8798d778c1c6dec9a6fb06d05676a235c8742e3ae3541a5',
  per_tour: Object.freeze({ min_graded: 2000, min_edition_clusters: 40, min_surfaces_with_100_graded: 2 }),
  identical_rows: true,
  log_loss: 'challenger < champion AND paired cluster-bootstrap 95% CI of (challenger - champion) entirely below 0',
  brier: 'challenger <= champion',
  calibration: 'challenger ECE <= champion ECE',
  segments: 'no material segment failure: no surface / level / favourite band with n >= 200 whose paired 95% CI is entirely above 0',
  bootstrap: Object.freeze({ reps: 1000, seed: 20261002, cluster: 'tournament edition' })
});

/** Evaluate the frozen gate for one tour's graded summary (from grade-shadow.mjs). */
export function gateStatus(t) {
  const g = PROMOTION_GATE;
  if (!t || !t.n) return { met: false, checks: { graded: false }, note: 'no graded predictions yet' };
  const p = typeof t.paired === 'object' ? t.paired : null;
  const checks = {
    graded: t.n >= g.per_tour.min_graded,
    edition_clusters: (t.clusters || 0) >= g.per_tour.min_edition_clusters,
    surfaces: (t.surfaces_with_100 || 0) >= g.per_tour.min_surfaces_with_100_graded,
    log_loss_lower: t.challenger.log_loss < t.champion.log_loss,
    log_loss_ci_below_zero: !!p && p.ci95_log_loss[1] < 0,
    brier_no_worse: t.challenger.brier <= t.champion.brier,
    calibration_no_worse: t.challenger.ece <= t.champion.ece,
    no_material_segment_failure: (t.segment_failures || []).length === 0
  };
  return { met: Object.values(checks).every(Boolean), checks };
}

/**
 * Which shadow record of a match is graded, and how (pure). list: the match's shadow records; m: the stored match
 * { status, winner_side, started_at, scheduled_at }. Returns { kind: 'graded' | 'pending' | 'excluded' | 'unscored', record, reason }.
 * Graded = completed with a winner, using the LAST record frozen before play; retirements, walkovers and cancellations
 * are excluded; nothing is recomputed after the match.
 */
export function pickGradeable(list, m) {
  const start = m?.started_at || m?.scheduled_at || null;
  const pre = (list || []).filter((r) => !start || Date.parse(r.frozen_at) < Date.parse(start)).sort((x, y) => (x.frozen_at < y.frozen_at ? -1 : 1));
  const record = pre.at(-1) || null;
  if (!record) return { kind: 'excluded', reason: 'no_record_before_start', record: null };
  if (!record.challenger) return { kind: 'unscored', reason: record.reason, record };
  if (!m || ['scheduled', 'in_progress', 'suspended'].includes(m.status)) return { kind: 'pending', reason: m?.status || 'unknown', record };
  if (m.status !== 'completed' || !['A', 'B'].includes(m.winner_side)) return { kind: 'excluded', reason: m.status, record };
  return { kind: 'graded', record, y: m.winner_side === 'A' ? 1 : 0 };
}
