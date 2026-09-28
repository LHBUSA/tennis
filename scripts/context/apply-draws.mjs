#!/usr/bin/env node
// Apply PROVEN official draw sheets from a reviewed registry to tennis_draw_slots (idempotent: a source's slots
// for an edition are replaced as a whole). Unproven sheets are never applied.
//   node scripts/context/apply-draws.mjs data/context/wta-drawsheets.json wta-draws WS main
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [file, source, eventType = 'WS', draw = 'main'] = process.argv.slice(2);
if (!file || !source) throw new Error('usage: apply-draws.mjs <registry.json> <source> [event] [draw]');
const reg = JSON.parse(fs.readFileSync(file, 'utf8'));
const proven = reg.editions.filter((e) => e.status === 'proven' && e.slots?.length);
const lit = (v) => (v == null ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const tmp = path.join(process.env.TEMP || '.', `apply-draws-${Date.now()}.sql`);
const run = (q) => { fs.writeFileSync(tmp, q); return execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-File', tmp], { encoding: 'utf8', maxBuffer: 64 << 20 }); };
let slots = 0;
for (let i = 0; i < proven.length; i += 25) {
  const part = proven.slice(i, i + 25);
  const values = part.flatMap((e) => e.slots.map((s) => `(${lit(e.edition_id)}::uuid, ${lit(eventType)}, ${lit(draw)}, ${s.position}, ${lit(s.participant_key)}, ${s.bye}, ${lit(s.seed)}, ${lit(s.entry)}, ${lit(source)}, ${lit(e.url)}, ${lit(e.capture_id)}, now())`));
  slots += values.length;
  run(`begin;
delete from tennis_draw_slots where source = ${lit(source)} and event_type = ${lit(eventType)} and draw = ${lit(draw)} and edition_id in (${part.map((e) => `${lit(e.edition_id)}::uuid`).join(',')});
insert into tennis_draw_slots (edition_id, event_type, draw, position, participant_key, bye, seed, entry_type, source, source_ref, capture_id, observed_at) values
${values.join(',\n')};
commit;`);
}
// surface stated by a proven sheet: recorded as a draw_sheet attribute (the effective edition surface is filled by
// scripts/context/reconcile.sql only where the edition has none; a different stored value is logged there)
const withSurface = proven.filter((e) => e.header?.surface);
for (let i = 0; i < withSurface.length; i += 100) {
  const part = withSurface.slice(i, i + 100);
  run(`insert into tennis_edition_attributes (edition_id, attribute, value, source, method, source_ref, capture_id, evidence, observed_at) values
${part.map((e) => `(${lit(e.edition_id)}::uuid, 'surface', ${lit(e.header.surface)}, ${lit(source)}, 'draw_sheet', ${lit(e.url)}, ${lit(e.capture_id)}, ${lit(JSON.stringify({ printed: e.header.surface_raw, proof: e.proof }))}::jsonb, now())`).join(',\n')}
on conflict (edition_id, attribute, source) do update set value = excluded.value, source_ref = excluded.source_ref, capture_id = excluded.capture_id, evidence = excluded.evidence, observed_at = excluded.observed_at;`);
}
fs.rmSync(tmp, { force: true });
console.log(JSON.stringify({ source, editions: proven.length, slots, surfaces_recorded: withSurface.length }));
