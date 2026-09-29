#!/usr/bin/env node
// Parity for mapOfficialEdition where the OLD PostgREST query cannot finish (57014): the old query's semantics computed
// directly in SQL (admin path, no 8 s limit) vs the NEW code's tally from the read-only espn_map_probe on a given
// tennis-ingest version. Read-only.  node scripts/ops/espn-map-parity.mjs <versionPreviewBase> <editionId,...>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [base, edArg] = process.argv.slice(2);
const SP = process.env.TMPDIR_PARITY || 'D:/Temp/claude/C--Users-goodl/33c40b93-c0dd-425b-986f-373dcebe2a66/scratchpad';
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 64 << 20 }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((i) => i >= 0); if (!at.length) return []; const v = JSON.parse(out.slice(Math.min(...at))); return Array.isArray(v) ? v : [v]; };
for (const ed of edArg.split(',')) {
  // OLD semantics: WS matches of that year involving the incoming keys (participant rows with an incoming key, grouped per
  // match), then the tally rules (not espn, dated, overlapping +-3 d, both participants incoming and a known pair)
  const old = sql(`with ev as (select * from tennis_tournament_editions where edition_id = '${ed}'),
    pm as (select m.match_id, array_agg(p.participant_key order by p.participant_key) k from tennis_matches m join tennis_match_participants p using (match_id) where m.edition_id = '${ed}' and m.event_type = 'WS' group by 1 having count(*) = 2),
    pairs as (select distinct array_to_string(k, '~') pk from pm),
    keys as (select distinct unnest(k) key from pm),
    cand as (select p.match_id, m.edition_id, array_agg(p.participant_key order by p.participant_key) k from tennis_match_participants p join tennis_matches m using (match_id) join tennis_tournament_editions e on e.edition_id = m.edition_id where p.participant_key in (select key from keys) and m.event_type = 'WS' and e.year = (select year from ev) group by 1, 2)
    select c.edition_id, count(*)::int hit from cand c join tennis_tournament_editions e on e.edition_id = c.edition_id, ev
    where e.source_family is distinct from 'espn' and e.start_date is not null and e.end_date is not null and e.start_date <= ev.end_date + 3 and e.end_date >= ev.start_date - 3
      and array_length(c.k, 1) = 2 and array_to_string(c.k, '~') in (select pk from pairs) group by 1 order by 1`).map((r) => [r.edition_id, Number(r.hit)]);
  const f = path.join(SP, `parity-${ed}.json`);
  if (fs.existsSync(f)) fs.rmSync(f);
  execFileSync('node', ['scripts/ops/lane.mjs', 'espn_map_probe', '--base', base, '--max-runs', '6', '--once', '--timeout', '600', '--q', `editions=${ed}`, '--q', 'legacy=0'], { env: { ...process.env, LANE_JSON: f }, stdio: 'ignore' });
  const c = JSON.parse(fs.readFileSync(f, 'utf8')).data.result.cases[0];
  const same = JSON.stringify(old) === JSON.stringify(c.tally);
  console.log(`${(c.name || ed).slice(0, 28).padEnd(29)} old(sql) ${JSON.stringify(old).slice(0, 80)} | new ${c.new_ms}ms ${JSON.stringify(c.tally).slice(0, 80)} | EQUAL ${same}`);
}
