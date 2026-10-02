// Matchup Model V2 research — fetch the EXACT production DNA v2 build inputs, read-only (2026-10-02).
//   R2 tennis-source derived/dna-v2/ledger/<tour>/<p>.json  (the build's raw-row ledger cache, 16 chunks per tour)
//   R2 tennis-source derived/dna-v2/ranks/<list>.json        (the build's kept ranking lists)
//   tkmln (SELECT via scripts/db/run_sql.ps1): editions (dates, level, competition_key), active player genders
// No service key, no writes. Output: $MM2_DATA/inputs (default D:/Workers/research-data/tennis-mm2/inputs) + manifest
// with a sha256 per file, so a dataset build can state exactly which source state it read.
//   node scripts/research/mm2/fetch-inputs.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = process.env.MM2_DATA || 'D:/Workers/research-data/tennis-mm2';
const OUT = path.join(ROOT, 'inputs');
const API_DIR = path.resolve('workers/tennis-api');
fs.mkdirSync(OUT, { recursive: true });
const env = { ...process.env, NODE_OPTIONS: '--require D:/Workers/exfat-readlink.cjs' };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const MAN = path.join(OUT, 'manifest.json');
const manifest = process.argv.includes('--sql-only') && fs.existsSync(MAN) ? JSON.parse(fs.readFileSync(MAN, 'utf8')) : { fetched_at: new Date().toISOString(), files: {} };

function r2(key, file) {
  const dest = path.join(OUT, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync('npx', ['wrangler', 'r2', 'object', 'get', `tennis-source/${key}`, '--remote', '--file', dest], { cwd: API_DIR, env, stdio: 'pipe', shell: process.platform === 'win32' });
  const b = fs.readFileSync(dest);
  JSON.parse(b.toString('utf8')); // must be JSON
  manifest.files[file] = { source: `r2:tennis-source/${key}`, bytes: b.length, sha256: sha(b) };
}
function sql(file, query) {
  const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', query], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const rows = JSON.parse(out.trim());
  const data = Array.isArray(rows) ? rows[0]?.j ?? rows : rows.j;
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  const b = Buffer.from(JSON.stringify(parsed));
  fs.writeFileSync(path.join(OUT, file), b);
  manifest.files[file] = { source: `tkmln sql: ${query.slice(0, 160)}`, rows: parsed.length, bytes: b.length, sha256: sha(b) };
}

if (!process.argv.includes('--sql-only')) for (const tour of ['ATP', 'WTA']) for (const p of '0123456789abcdef') { r2(`derived/dna-v2/ledger/${tour}/${p}.json`, `ledger/${tour}/${p}.json`); process.stdout.write('.'); }
if (!process.argv.includes('--sql-only')) for (const list of ['atp_singles', 'wta_singles']) r2(`derived/dna-v2/ranks/${list}.json`, `ranks/${list}.json`);
// ordered for deterministic hashing; the text payload avoids the tool's object re-serialisation
sql('editions.json', "select json_agg(json_build_object('edition_id',edition_id,'start_date',start_date,'end_date',end_date,'competition_key',competition_key,'level',level,'year',year) order by edition_id)::text j from tennis_tournament_editions");
sql('players.json', "select json_agg(json_build_object('pbe_player_id',pbe_player_id,'gender',gender) order by pbe_player_id)::text j from tennis_players where status='active'");
// match statistics (Challenger C): latest capture per match side, singles only, compact array per side:
// [service_points, first_serves_in, first_serve_points_won, second_serve_points_won, break_points_faced, break_points_saved, aces, double_faults]
sql('match-stats.json', "select json_agg(json_build_array(match_id, side, captured_at, (stats->>'service_points')::int, (stats->>'first_serves_in')::int, (stats->>'first_serve_points_won')::int, (stats->>'second_serve_points_won')::int, (stats->>'break_points_faced')::int, (stats->>'break_points_saved')::int, (stats->>'aces')::int, (stats->>'double_faults')::int) order by match_id, side)::text j from (select distinct on (s.match_id, s.side) s.* from tennis_match_stats s join tennis_matches m on m.match_id = s.match_id where m.event_type in ('MS','WS') order by s.match_id, s.side, s.captured_at desc) x");
// stored market prices: none exist (tennis_odds_snapshots is empty on 2026-10-02); recorded so the evidence can say so
sql('odds-count.json', "select json_agg(json_build_object('rows', n))::text j from (select count(*) n from tennis_odds_snapshots) x");
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`\n${Object.keys(manifest.files).length} files -> ${OUT}`);
