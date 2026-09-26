// node scripts/coverage/mens.mjs -> docs/evidence/mens-coverage-latest.json (runs scripts/coverage/mens.sql on tkmln)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-File', 'scripts/coverage/mens.sql'], { encoding: 'utf8', maxBuffer: 1 << 26 });
const parsed = JSON.parse(out.slice(out.indexOf('[') >= 0 && out.indexOf('[') < out.indexOf('{') ? out.indexOf('[') : out.indexOf('{')));
const report = (Array.isArray(parsed) ? parsed[0] : parsed).report;
fs.writeFileSync('docs/evidence/mens-coverage-latest.json', `${JSON.stringify(report, null, 2)}\n`);
const { by_year, ...totals } = report;
console.log(JSON.stringify(totals, null, 1));
