// Tennis DNA snapshot retention (owner-approved 2026-09-28, corrected 2026-09-28): retention preserves the latest 14
// successful daily DNA snapshots independently for each DNA version, plus the designated monthly archive snapshots and the
// latest snapshot. Missing build days do not reduce the number of daily snapshots retained (a COUNT of stored snapshot
// dates, never a calendar window). Monthly archive = the earliest stored date of every calendar month (the historical
// lanes build first-of-month dates); it is additional protection and does not count against the 14. Readers only use
// the newest date (API) or the latest date before a story's date (newsroom packet), so a pruned daily never breaks a read.
// Bounded per run (MAX_DATES_PER_RUN dates, shared across versions) and skipped while the database guard has bulk work
// paused.

export const DAILY_KEEP = 14;
export const MAX_DATES_PER_RUN = 3;
const SURFACES = ['all', 'hard', 'clay', 'grass'];

/**
 * Pure plan for ONE definition version's distinct stored snapshot dates:
 * { daily: [the latest DAILY_KEEP dates], keep: [{ as_of, why }], remove: [as_of] }.
 * why: 'daily' (one of the latest 14) | 'newest' | 'monthly' (earliest date of its month). `today` is informational
 * only: the rule never measures calendar distance.
 */
export function retentionPlan(dates, today = null, { keep = DAILY_KEEP } = {}) {
  const sorted = [...new Set(dates)].sort();
  const daily = new Set(sorted.slice(-keep));
  const monthly = new Map();
  for (const d of sorted) if (!monthly.has(d.slice(0, 7))) monthly.set(d.slice(0, 7), d);
  const newest = sorted.at(-1);
  const kept = [];
  const remove = [];
  for (const d of sorted) {
    const why = d === newest ? 'newest' : daily.has(d) ? 'daily' : monthly.get(d.slice(0, 7)) === d ? 'monthly' : null;
    if (why) kept.push({ as_of: d, why }); else remove.push(d);
  }
  return { today, daily: [...daily].sort().reverse(), oldest_daily: sorted.slice(-keep)[0] ?? null, keep: kept, remove };
}

/** Distinct as_of dates of one definition version (skip-scan: one indexed-order read per date). */
async function distinctDates(store, dv) {
  const out = [];
  let below = null;
  for (let i = 0; i < 1000; i += 1) {
    const [r] = await store.select('tennis_dna_snapshots', `select=as_of&definition_version=eq.${dv}${below ? `&as_of=lt.${below}` : ''}&order=as_of.desc&limit=1`);
    if (!r) break;
    out.push(r.as_of);
    below = r.as_of;
  }
  return out;
}

export async function runRetention(ctx, { today, write = true } = {}) {
  const report = { today, daily_keep: DAILY_KEEP, policy: 'latest 14 successful snapshots per version + monthly archive + newest', versions: {} };
  let budget = MAX_DATES_PER_RUN;
  for (const dv of [1, 2]) {
    const plan = retentionPlan(await distinctDates(ctx.store, dv), today);
    const deleted = [];
    for (const d of plan.remove) {
      if (!write || budget <= 0) break;
      let rows = 0;
      for (const sf of SURFACES) {
        const q = `definition_version=eq.${dv}&as_of=eq.${d}&surface=eq.${sf}`;
        const n = await ctx.store.count('tennis_dna_snapshots', q);
        if (n) { await ctx.store.req('DELETE', `tennis_dna_snapshots?${q}`); rows += n; }
      }
      deleted.push({ as_of: d, rows });
      budget -= 1;
    }
    report.versions[dv] = { daily_protected: plan.daily, kept: plan.keep, to_remove: plan.remove, deleted, remaining_after_run: plan.remove.length - deleted.length };
  }
  if (write) await ctx.kv.put('dna:retention:last', JSON.stringify({ ...report, at: new Date().toISOString() }));
  return report;
}
