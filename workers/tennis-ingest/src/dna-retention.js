// Tennis DNA snapshot retention (owner-approved 2026-09-28): per definition version, keep every snapshot dated within
// the last DAILY_DAYS days, the EARLIEST snapshot of every calendar month (the monthly snapshot; the historical lanes
// already build first-of-month dates) and always the newest date; delete the other dates' rows. Readers only use the
// newest date (API) or the latest date before a story's date (newsroom packet), so a pruned daily never breaks a read.
// Bounded per run (MAX_DATES_PER_RUN) and skipped while the database guard has bulk work paused.

export const DAILY_DAYS = 14;
export const MAX_DATES_PER_RUN = 3;
const SURFACES = ['all', 'hard', 'clay', 'grass'];

/** Pure plan: { keep: [{ as_of, why }], remove: [as_of] } for one definition version's distinct dates. */
export function retentionPlan(dates, today, { days = DAILY_DAYS } = {}) {
  const sorted = [...new Set(dates)].sort();
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400e3).toISOString().slice(0, 10);
  const monthly = new Map();
  for (const d of sorted) if (!monthly.has(d.slice(0, 7))) monthly.set(d.slice(0, 7), d);
  const newest = sorted.at(-1);
  const keep = [];
  const remove = [];
  for (const d of sorted) {
    const why = d > cutoff ? 'daily' : monthly.get(d.slice(0, 7)) === d ? 'monthly' : d === newest ? 'newest' : null;
    if (why) keep.push({ as_of: d, why }); else remove.push(d);
  }
  return { cutoff, keep, remove };
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
  const report = { today, daily_days: DAILY_DAYS, versions: {} };
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
    report.versions[dv] = { cutoff: plan.cutoff, kept: plan.keep, to_remove: plan.remove, deleted, remaining_after_run: plan.remove.length - deleted.length };
  }
  if (write) await ctx.kv.put('dna:retention:last', JSON.stringify({ ...report, at: new Date().toISOString() }));
  return report;
}
