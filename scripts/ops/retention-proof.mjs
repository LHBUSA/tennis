#!/usr/bin/env node
// Retention proof (Phase 6 closeout, first real delete ~2026-10-12). Read-only except nothing: the delete itself is the
// normal bounded job (`node scripts/ops/lane.mjs dna_retention --write 1 --max-runs 1`, max 3 dates per run).
//   node scripts/ops/retention-proof.mjs plan     -> eligible / protected dates per definition version, rows, estimated bytes
//   node scripts/ops/retention-proof.mjs verify   -> dates left, row counts, sizes, dead tuples + autovacuum state
// Output: docs/evidence/retention/<mode>-<ts>.json. The plan uses the SAME pure function the job uses (retentionPlan).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { retentionPlan, MAX_DATES_PER_RUN } from '../../workers/tennis-ingest/src/dna-retention.js';

const mode = process.argv[2];
const today = process.env.TODAY || new Date().toISOString().slice(0, 10);
const DIR = path.resolve('docs/evidence/retention');
fs.mkdirSync(DIR, { recursive: true });
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 16 << 20 }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((i) => i >= 0); if (!at.length) return []; const v = JSON.parse(out.slice(Math.min(...at))); return Array.isArray(v) ? v : [v]; };

const dates = sql('select definition_version dv, as_of::text as_of, count(*) n, sum(pg_column_size(s.*))::bigint bytes from tennis_dna_snapshots s group by 1,2 order by 1,2');
const sizes = () => ({ ...sql(`select pg_total_relation_size('tennis_dna_snapshots') total_bytes, pg_table_size('tennis_dna_snapshots') table_bytes, pg_database_size(current_database()) db_bytes`)[0],
  ...sql(`select n_live_tup live, n_dead_tup dead, last_autovacuum, last_vacuum, autovacuum_count from pg_stat_user_tables where relname = 'tennis_dna_snapshots'`)[0] });
const out = { mode, today, run_at: new Date().toISOString(), max_dates_per_run: MAX_DATES_PER_RUN, versions: {}, sizes: sizes() };
for (const dv of [1, 2]) {
  const rows = dates.filter((d) => Number(d.dv) === dv);
  const plan = retentionPlan(rows.map((d) => d.as_of), today);
  const by = new Map(rows.map((d) => [d.as_of, d]));
  const firstRun = plan.remove.slice(0, MAX_DATES_PER_RUN);
  out.versions[dv] = { cutoff: plan.cutoff, protected: plan.keep, eligible: plan.remove.map((d) => ({ as_of: d, rows: Number(by.get(d).n), est_bytes: Number(by.get(d).bytes) })),
    eligible_rows: plan.remove.reduce((t, d) => t + Number(by.get(d).n), 0), eligible_est_bytes: plan.remove.reduce((t, d) => t + Number(by.get(d).bytes), 0),
    first_run_dates: firstRun, all_dates: rows.map((d) => ({ as_of: d.as_of, rows: Number(d.n) })) };
}
// protection invariants (hold before AND after every run)
const inv = [];
for (const [dv, v] of Object.entries(out.versions)) {
  const all = v.all_dates.map((d) => d.as_of);
  const newest = all.at(-1);
  inv.push({ dv, name: 'latest protected', pass: !!newest && !v.eligible.some((e) => e.as_of === newest) });
  inv.push({ dv, name: 'every date within 14 days protected', pass: !v.eligible.some((e) => e.as_of > v.cutoff) });
  const months = new Map(); for (const d of all) if (!months.has(d.slice(0, 7))) months.set(d.slice(0, 7), d);
  inv.push({ dv, name: 'earliest date of every month protected (month-start archive)', pass: [...months.values()].every((d) => !v.eligible.some((e) => e.as_of === d)) });
}
out.invariants = inv;
fs.writeFileSync(path.join(DIR, `${mode}-${out.run_at.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(out, null, 1)}\n`);
for (const [dv, v] of Object.entries(out.versions)) console.log(`v${dv}: dates ${v.all_dates.length}, protected ${v.protected.length}, eligible ${v.eligible.length} (${v.eligible_rows} rows, ~${(v.eligible_est_bytes / 1048576).toFixed(1)} MB), first run would delete ${JSON.stringify(v.first_run_dates)}`);
console.log(`sizes: table ${(out.sizes.total_bytes / 1048576).toFixed(0)} MB, db ${(out.sizes.db_bytes / 1048576).toFixed(0)} MB, live ${out.sizes.live}, dead ${out.sizes.dead}, last autovacuum ${out.sizes.last_autovacuum}`);
console.log(`invariants: ${inv.filter((x) => x.pass).length}/${inv.length} PASS`);
if (mode === 'verify' && inv.some((x) => !x.pass)) process.exitCode = 1;
