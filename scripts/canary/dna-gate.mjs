#!/usr/bin/env node
// Tennis DNA Level-3 gate canary (production).
//   node scripts/canary/dna-gate.mjs   -> docs/evidence/dna-gate-latest.json (exit 1 on any FAIL)
// For each tour, independently recount qualified players (service_points_won medium/high) on THAT tour's latest
// snapshot date straight from the store, and require the public API to agree: same as_of, same count,
// published === (count >= 30) on the leaderboard and on a player's comparative status. Proves the gate unlocks
// (and falls closed) from data alone — no deploy involved.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const API = 'https://tennis-api.propbetedge.ai';
const THRESHOLD = 30;
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8' }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0); if (!at.length) return []; const v = JSON.parse(out.slice(Math.min(...at))); return Array.isArray(v) ? v : [v]; };
const get = async (p) => (await fetch(`${API}${p}${p.includes('?') ? '&' : '?'}t=${Date.now()}`)).json();
const checks = [];
const add = (name, pass, detail) => { checks.push({ name, result: pass ? 'PASS' : 'FAIL', ...detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`, JSON.stringify(detail)); };
for (const [tour, g] of [['atp', 'M'], ['wta', 'F']]) {
  const [db] = sql(`with l as (select max(s.as_of) d from tennis_dna_snapshots s join tennis_players p using (pbe_player_id) where p.gender='${g}' and s.definition_version=1) select (select d from l) as_of, count(*) filter (where s.metrics->'service_points_won'->>'confidence' in ('medium','high')) qualified from tennis_dna_snapshots s join tennis_players p using (pbe_player_id) where p.gender='${g}' and s.surface='all' and s.definition_version=1 and s.as_of=(select d from l)`);
  const lb = (await get(`/v1/dna/leaders?tour=${tour}&limit=1`)).data;
  const expected = Number(db.qualified) >= THRESHOLD;
  add(`${tour} leaderboard gate matches the store`, lb && lb.as_of === db.as_of && (lb.published !== false) === expected && (lb.published === false ? Number(lb.qualified) === Number(db.qualified) : true), { db_as_of: db.as_of, db_qualified: Number(db.qualified), api_as_of: lb?.as_of, api_published: lb?.published !== false, api_qualified: lb?.qualified, threshold: THRESHOLD });
  const [pl] = sql(`select p.slug from tennis_dna_snapshots s join tennis_players p using (pbe_player_id) where p.gender='${g}' and s.surface='all' and s.definition_version=1 and s.as_of='${db.as_of}' and s.metrics->'service_points_won'->>'confidence' in ('medium','high') limit 1`);
  if (pl) {
    const c = (await get(`/v1/players/${pl.slug}/dna`)).data?.dna?.comparative;
    add(`${tour} player comparative status matches the gate`, c && c.published === expected && c.as_of === db.as_of, { player: pl.slug, api: c });
  }
}
const out = { checked_at: new Date().toISOString(), threshold: THRESHOLD, result: checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL', checks };
fs.writeFileSync('docs/evidence/dna-gate-latest.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(`dna gate canary: ${out.result}`);
if (out.result !== 'PASS') process.exitCode = 1;
