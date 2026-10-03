// Matchup Model V2 observer — pure invariant checks over a prove-shadow.mjs proof (read-only; no model logic).
// The freeze deadline is the SAME one the grader uses (shadow-gate.mjs pickGradeable): started_at, else scheduled_at.
// observer/1 compared against started_at only and failed on ESPN-lane ATP rows, which carry no actual start time
// (2026-10-03 06:37Z, d54c6504: started_at null). observer/2 fixes the observer only; grading is unchanged.

export const OBSERVER_VERSION = 'mm2-observer/2';

/** The time a shadow record must be frozen before: identical to pickGradeable's `start`. */
export function freezeDeadline(m) {
  if (m?.started_at) return { at: m.started_at, basis: 'started_at' };
  if (m?.scheduled_at) return { at: m.scheduled_at, basis: 'scheduled_at' };
  return { at: null, basis: null };
}

/** Every invariant a natural grade must satisfy, from the proof file prove-shadow.mjs writes. */
export function gradeInvariants(proof) {
  const g = proof?.grade || {};
  const dl = freezeDeadline({ started_at: proof?.started_at ?? g.started_at ?? null, scheduled_at: proof?.scheduled_at ?? null });
  const checks = {
    first_natural_write: proof?.first_natural_write?.passed === true,
    immutability: proof?.immutability?.passed === true,
    graded: g.kind === 'graded',
    recomputed_after_match_false: g.recomputed_after_match === false,
    frozen_before_match_started: !!dl.at && !!g.graded_record_frozen_at && Date.parse(g.graded_record_frozen_at) < Date.parse(dl.at)
  };
  return {
    passed: Object.values(checks).every(Boolean),
    failed: Object.entries(checks).filter(([, v]) => !v).map(([k]) => k),
    checks,
    frozen_at: g.graded_record_frozen_at ?? null,
    deadline: dl.at,
    deadline_basis: dl.basis
  };
}
