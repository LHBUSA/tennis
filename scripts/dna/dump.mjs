#!/usr/bin/env node
// Frozen DNA v2 regression input: the exact rows buildDnaV2 reads, dumped once (SQL, read-only) to a local
// directory, so the full build and any faster build can be compared on identical inputs (scripts/dna/regress.mjs).
//   node scripts/dna/dump.mjs <dir>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = process.argv[2] || 'D:/Temp/tennis-dna-regress';
fs.mkdirSync(dir, { recursive: true });
const sql = (q) => {
  const f = path.join(dir, 'q.sql');
  fs.writeFileSync(f, q);
  const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-File', f], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const at = out.indexOf('[');
  if (at < 0) throw new Error(out.slice(0, 300));
  return JSON.parse(out.slice(at));
};
const save = (name, rows) => { fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(rows)); console.log(name, rows.length); };
save('players', sql('select pbe_player_id, gender from tennis_players where status = \'active\' order by pbe_player_id'));
save('editions', sql('select edition_id, start_date, end_date, competition_key, level, year from tennis_tournament_editions order by edition_id'));
save('snapshots', sql("select snapshot_id, list_key, ranking_date, row_count, source_family from tennis_ranking_snapshots where list_key in ('atp_singles','wta_singles') and row_count > 0 order by ranking_date"));
save('rankings', sql("select r.snapshot_id, r.pbe_player_id, r.rank from tennis_rankings r join tennis_ranking_snapshots s using (snapshot_id) where s.list_key in ('atp_singles','wta_singles') and s.row_count > 0 and r.pbe_player_id is not null"));
const matches = [];
for (const h of '0123456789abcdef') {
  const rows = sql(`select m.match_id, m.edition_id, m.event_type, m.round, m.format_key, m.status, m.winner_side, m.scheduled_at, m.started_at, m.surface, m.source_family, m.updated_at,
    coalesce((select json_agg(json_build_object('set_no', s.set_no, 'games_a', s.games_a, 'games_b', s.games_b, 'tb_a', s.tb_a, 'tb_b', s.tb_b) order by s.set_no) from tennis_sets s where s.match_id = m.match_id), '[]') tennis_sets,
    coalesce((select json_agg(json_build_object('side', p.side, 'participant_key', p.participant_key) order by p.side) from tennis_match_participants p where p.match_id = m.match_id), '[]') tennis_match_participants
    from tennis_matches m where m.event_type in ('MS','WS') and m.status in ('completed','retired') and m.match_id::text like '${h}%'`);
  matches.push(...rows);
  process.stdout.write(`${h}:${rows.length} `);
}
save('matches', matches);
// merge log (rows deleted by the writer / edition consolidation) so an incremental build can be replayed
save('changes', sql("select id, entity_id, observed_at from tennis_source_changes where entity_type = 'match' and kind = 'duplicate_merged' and observed_at >= now() - interval '3 days' order by id"));
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ dumped_at: new Date().toISOString(), matches: matches.length }));
