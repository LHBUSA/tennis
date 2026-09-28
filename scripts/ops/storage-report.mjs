#!/usr/bin/env node
// Weekly Tennis storage report (observe only; no cleanup policy). Read-only SQL through scripts/db/run_sql.ps1.
//   node scripts/ops/storage-report.mjs            -> docs/evidence/storage/<date>.json + growth vs the capture ~7 days earlier
// Per table: total / table / index size (bytes), estimated live + dead rows (pg_stat, no full scan), autovacuum times.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TABLES = ['tennis_dna_snapshots', 'tennis_surface_ratings', 'tennis_matches', 'tennis_rankings', 'tennis_match_external_ids', 'tennis_match_participants', 'tennis_sets', 'tennis_match_events'];
const DIR = path.resolve('docs/evidence/storage');
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 16 << 20 }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((i) => i >= 0); if (!at.length) throw new Error(out.slice(0, 300)); const v = JSON.parse(out.slice(Math.min(...at))); return Array.isArray(v) ? v : [v]; };

const rows = sql(`select c.relname tbl, pg_total_relation_size(c.oid) total_bytes, pg_table_size(c.oid) table_bytes, pg_indexes_size(c.oid) index_bytes,
  greatest(s.n_live_tup, c.reltuples::bigint) live_rows, s.n_dead_tup dead_rows, s.last_autovacuum, s.last_autoanalyze, s.autovacuum_count
  from pg_class c join pg_stat_user_tables s on s.relid = c.oid where c.relname in (${TABLES.map((t) => `'${t}'`).join(',')}) order by c.relname`);
const [db] = sql('select pg_database_size(current_database()) db_bytes');
const date = new Date().toISOString().slice(0, 10);
const report = { date, captured_at: new Date().toISOString(), database_bytes: Number(db.db_bytes), tables: Object.fromEntries(rows.map((r) => [r.tbl, { total_bytes: Number(r.total_bytes), table_bytes: Number(r.table_bytes), index_bytes: Number(r.index_bytes), live_rows: Number(r.live_rows), dead_rows: Number(r.dead_rows), last_autovacuum: r.last_autovacuum, last_autoanalyze: r.last_autoanalyze, autovacuum_count: Number(r.autovacuum_count) }])) };

// growth against the newest earlier capture at least 6 days old (else the oldest available, labelled with its span)
fs.mkdirSync(DIR, { recursive: true });
const prior = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < `${date}.json`).sort();
const weekAgo = new Date(Date.parse(`${date}T00:00:00Z`) - 6 * 86400e3).toISOString().slice(0, 10);
const base = [...prior].reverse().find((f) => f.slice(0, 10) <= weekAgo) || prior[0];
if (base) {
  const b = JSON.parse(fs.readFileSync(path.join(DIR, base), 'utf8'));
  report.growth = { since: b.date, days: Math.round((Date.parse(date) - Date.parse(b.date)) / 86400e3), database_bytes: report.database_bytes - b.database_bytes, tables: {} };
  for (const [t, x] of Object.entries(report.tables)) { const y = b.tables[t]; if (y) report.growth.tables[t] = { total_bytes: x.total_bytes - y.total_bytes, index_bytes: x.index_bytes - y.index_bytes, live_rows: x.live_rows - y.live_rows }; }
}
fs.writeFileSync(path.join(DIR, `${date}.json`), `${JSON.stringify(report, null, 1)}\n`);
const mb = (b) => `${(b / 1048576).toFixed(0)} MB`;
console.log(`storage ${date}: database ${mb(report.database_bytes)}${report.growth ? ` (${report.growth.database_bytes >= 0 ? '+' : ''}${mb(report.growth.database_bytes)} over ${report.growth.days} d)` : ' (baseline)'}`);
for (const [t, x] of Object.entries(report.tables)) { const g = report.growth?.tables[t]; console.log(`  ${t.padEnd(28)} total ${mb(x.total_bytes).padStart(7)}  index ${mb(x.index_bytes).padStart(7)}  rows~${String(x.live_rows).padStart(9)}  dead ${String(x.dead_rows).padStart(7)}${g ? `  7d ${g.total_bytes >= 0 ? '+' : ''}${mb(g.total_bytes)} / ${g.live_rows >= 0 ? '+' : ''}${g.live_rows} rows` : ''}`); }
