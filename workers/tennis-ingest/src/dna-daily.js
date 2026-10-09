// Daily Tennis DNA v2 build, split into bounded units (one unit per cron tick) with a persisted plan.
//
// Why (2026-10-09): the whole v2 build (both tours, today + one historical month-start, surfaces) ran inside one */2
// tick: ~290 s CPU and ~800 s wall for a single success. The tick lock goes stale after 170 s, so every later tick
// started another full build in the same isolate; the 128 MB isolate died (exceededMemory, reported as internalError,
// plus exceededResources at the 300 s CPU limit) and the build restarted from zero on every tick from 00:00 to ~01:10
// UTC, every day. Now each tick runs at most ONE unit of the day's plan, under a lease that outlives a unit, and the
// next tick resumes at the first unit not done. Units are idempotent: each one upserts on the snapshot / rating
// unique keys, so a unit killed mid-way is simply re-run; the plan only records units that returned.
//
// Outputs are the monolithic build's (tests/dna-daily.test.js proves rows + KV summary/watch equal on one ledger):
// the per-as_of passes, ratings, surface pass and Players to Watch are computed by the same buildDnaV2 code, only
// scheduled across ticks; finalize assembles the same dna:v2:summary and lists from the units' summaries.

import { buildDnaV2, writeSummary, TOURS } from './dna-v2-job.js';

export const PLAN_KEY = 'dna2:plan';
export const LEASE_KEY = 'dna:build:lease';
// longer than any unit's wall time (a whole-build success took ~800 s; a unit is a fraction of it). A unit killed by
// the runtime leaves its lease, which then simply delays the retry until it expires (no tick-by-tick restarts).
export const LEASE_MS = 12 * 60 * 1000;

/** The day's units, in order: per tour the primary-date overall pass, the surface pass, the historical date; then finalize. */
export function planUnits(asOfs) {
  const units = [];
  for (const tour of TOURS) {
    units.push(`${tour}:overall`, `${tour}:surfaces`);
    if (asOfs.length > 1) units.push(`${tour}:hist`);
  }
  units.push('finalize');
  return units;
}

/** Build options for one unit (buildDnaV2 partial-build flags). */
export function unitOptions(unit, plan) {
  const [tour, part] = unit.split(':');
  const base = { tours: [tour], mode: plan.mode, finalize: false };
  if (part === 'overall') return { ...base, asOfs: [plan.as_ofs[0]], primary: true, overall: true, surfaces: false };
  if (part === 'surfaces') return { ...base, asOfs: [plan.as_ofs[0]], primary: true, overall: false, surfaces: true };
  if (part === 'hist') return { ...base, asOfs: [plan.as_ofs[1]], primary: false, overall: true, surfaces: false };
  throw new Error(`unknown dna v2 unit ${unit}`);
}

export async function acquireLease(kv, now = Date.now()) {
  const held = await kv.get(LEASE_KEY);
  if (held && now - Date.parse(held) < LEASE_MS) return null;
  const stamp = new Date(now).toISOString();
  await kv.put(LEASE_KEY, stamp, { expirationTtl: Math.ceil(LEASE_MS / 1000) });
  return stamp;
}

export async function releaseLease(kv, stamp) {
  // only our own lease (a later holder's lease is never removed)
  if (stamp && (await kv.get(LEASE_KEY)) === stamp) await kv.delete(LEASE_KEY);
}

/** The day's plan: created once per UTC day from the same KV cursors the monolithic step read. */
export async function loadPlan(kv, day) {
  const plan = await kv.get(PLAN_KEY, 'json');
  if (plan && plan.day === day) return plan;
  const hist = (await kv.get('dna2:hist')) || `${day.slice(0, 7)}-01`;
  const asOfs = [day, ...(hist >= '2008-01-01' && hist !== day ? [hist] : [])];
  // input mode: 'full' until the incremental loader has been proven equal (KV dna2:mode = 'auto' switches)
  const mode = (await kv.get('dna2:mode')) === 'auto' ? 'auto' : 'full';
  const next = { day, as_ofs: asOfs, mode, units: planUnits(asOfs), done: {}, created_at: new Date().toISOString() };
  await kv.put(PLAN_KEY, JSON.stringify(next));
  return next;
}

/** The monolithic build's summary, assembled from the units' partial summaries (same keys, same order). */
export function assembleSummary(plan) {
  const d = plan.done;
  const summary = { builder: null, definition_version: null, rating_method_version: null, as_of: plan.as_ofs, ledger: 0, tours: {} };
  let snapshots = 0;
  let ratings = 0;
  for (const tour of TOURS) {
    const ov = d[`${tour}:overall`];
    const sf = d[`${tour}:surfaces`];
    if (!ov || !sf) throw new Error(`dna v2 finalize: ${tour} units incomplete`);
    summary.builder = ov.builder;
    summary.definition_version = ov.definition_version;
    summary.rating_method_version = ov.rating_method_version;
    summary.ledger += ov.ledger;
    const { watch, ...rest } = ov.tour;
    summary.tours[tour] = { ...rest, ...(sf.tour.surfaces ? { surfaces: sf.tour.surfaces } : {}), ...(watch !== undefined ? { watch } : {}) };
  }
  for (const unit of plan.units) if (unit !== 'finalize') { snapshots += d[unit]?.snapshots || 0; ratings += d[unit]?.ratings || 0; }
  summary.snapshots = snapshots;
  summary.ratings = ratings;
  return summary;
}

/**
 * Run the next unit of the day's v2 plan. Returns { unit, ... } | 'unit_in_progress' | { complete: true, ... }.
 * `build` / `writeOut` are injectable for tests.
 */
export async function runDnaV2Unit(ctx, { day, build = buildDnaV2, writeOut = writeSummary, now = () => Date.now() } = {}) {
  const kv = ctx.kv;
  const lease = await acquireLease(kv, now());
  if (!lease) return 'unit_in_progress';
  try {
    const plan = await loadPlan(kv, day);
    const unit = plan.units.find((u) => !plan.done[u]);
    const t0 = now();
    if (unit === 'finalize') {
      const summary = assembleSummary(plan);
      const out = { as_of: summary.as_of, snapshots: summary.snapshots, ratings: summary.ratings, published: Object.fromEntries(Object.entries(summary.tours).map(([t, x]) => [t, x.published])) };
      await writeOut(kv, summary, plan.as_ofs[0]);
      await kv.put('dna2:last', day);
      if (plan.as_ofs.length > 1) { const d = new Date(`${plan.as_ofs[1]}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); await kv.put('dna2:hist', d.toISOString().slice(0, 10)); }
      plan.done.finalize = { at: new Date(now()).toISOString(), ms: now() - t0 };
      await kv.put(PLAN_KEY, JSON.stringify(plan));
      return { unit, complete: true, ...out };
    }
    const r = await build(ctx, unitOptions(unit, plan));
    const tour = unit.split(':')[0];
    plan.done[unit] = {
      at: new Date(now()).toISOString(), ms: r.ms, phase_ms: r.phase_ms, inputs: r.inputs,
      builder: r.builder, definition_version: r.definition_version, rating_method_version: r.rating_method_version,
      ledger: r.ledger, snapshots: r.snapshots, ratings: r.ratings,
      tour: unit.endsWith(':hist') ? null : r.tours[tour]
    };
    await kv.put(PLAN_KEY, JSON.stringify(plan));
    return { unit, remaining: plan.units.filter((u) => !plan.done[u]).length, ms: r.ms, snapshots: r.snapshots, ratings: r.ratings, phase_ms: r.phase_ms };
  } finally {
    await releaseLease(kv, lease);
  }
}
