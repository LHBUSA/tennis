#!/usr/bin/env node
// WTA draw-sheet registry (Phase 5 brackets): every official WTA tour edition (not ITF) from 2012 with stored
// singles matches -> its official main-draw singles sheet https://wtafiles.wtatennis.com/pdf/draws/{year}/{wtaId}/MDS.pdf
// (fetched through tennis-ingest /v1/drawsheet: polite client, byte-exact R2 archive + capture row).
// The WTA id is the edition's own official id, so there is no candidate search; the sheet is still PROVEN
// against the edition's stored matches before any slot is used (drawsheet-parse.mjs proveDraw).
//   node scripts/context/wta-drawsheets.mjs   -> data/context/wta-drawsheets.json (registry; no DB writes)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseHeader, parseSlots, proveDraw } from './drawsheet-parse.mjs';

const CACHE = process.env.DRAW_CACHE || 'D:/Temp/tennis-drawsheets';
const OUT = 'data/context/wta-drawsheets.json';
const B = 'https://tennis-ingest.sales-fd3.workers.dev';
const TOKEN = fs.readFileSync('D:/Workers/secrets/tennis-ingest-admin-token', 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => {
  const f = path.join(CACHE, 'qw.sql');
  fs.writeFileSync(f, q);
  const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-File', f], { encoding: 'utf8', maxBuffer: 512 << 20 });
  const at = out.indexOf('[');
  if (at < 0) throw new Error(out.slice(0, 400));
  return JSON.parse(out.slice(at));
};

let lastFetch = 0;
let blocked = 0;
async function sheet(year, wtaId) {
  const dir = path.join(CACHE, 'wta', String(year));
  const pdf = path.join(dir, `${wtaId}-MDS.pdf`);
  const meta = path.join(dir, `${wtaId}-MDS.json`);
  const text = () => execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8' });
  if (fs.existsSync(meta)) { const m = JSON.parse(fs.readFileSync(meta, 'utf8')); return m.status === 200 ? { ...m, text: text() } : m; }
  fs.mkdirSync(dir, { recursive: true });
  const wait = lastFetch + 1600 - Date.now();
  if (wait > 0) await sleep(wait);
  lastFetch = Date.now();
  const res = await fetch(`${B}/v1/drawsheet?source=wta&year=${year}&tid=${wtaId}&doc=MDS`, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (res.status === 502) { blocked += 1; const body = await res.text(); if (/blocked/.test(body) || blocked > 3) throw new Error(`blocked: ${body}`); return { status: 502 }; }
  if (res.status !== 200) { const m = { status: res.status }; fs.writeFileSync(meta, JSON.stringify(m)); return m; }
  fs.writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
  const m = { status: 200, url: res.headers.get('x-source-url'), capture_id: res.headers.get('x-capture-id'), sha256: res.headers.get('x-sha256'), captured_at: res.headers.get('x-captured-at') };
  fs.writeFileSync(meta, JSON.stringify(m));
  return { ...m, text: text() };
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const eds = sql(`select e.edition_id, e.year, e.name, e.level, e.start_date, e.end_date, x.external_id wta_tid
    from tennis_tournament_editions e join tennis_tournament_external_ids x on x.tournament_id=e.tournament_id and x.provider='wta'
    where e.source_family='wta' and e.year between 2012 and 2026 and coalesce(e.level,'') not in ('ITF','') and e.level not ilike 'itf%'
    and exists (select 1 from tennis_matches m where m.edition_id=e.edition_id and m.event_type='WS') order by e.year, x.external_id`);
  const ms = sql(`select m.edition_id, array_agg(p.participant_key order by p.side) keys, json_agg(json_build_object('key', p.participant_key, 'last', pl.last_name, 'first', pl.first_name)) people
    from tennis_matches m join tennis_match_participants p using (match_id) join tennis_participant_members mm on mm.participant_key=p.participant_key join tennis_players pl on pl.pbe_player_id=mm.pbe_player_id
    join tennis_tournament_editions e on e.edition_id=m.edition_id where m.event_type='WS' and e.source_family='wta' and e.year between 2012 and 2026 and m.round not like 'Q-%' group by m.edition_id, m.match_id`);
  const byEd = new Map();
  for (const r of ms) {
    const e = byEd.get(r.edition_id) || { people: [], matches: [] };
    e.people.push(...r.people);
    if (r.keys.length === 2) e.matches.push({ keys: r.keys });
    byEd.set(r.edition_id, e);
  }
  // one tournament can carry several WTA ids (a renumbered event): try each, keep the proven one
  const byEdition = new Map();
  for (const e of eds) { if (!byEdition.has(e.edition_id)) byEdition.set(e.edition_id, { ...e, tids: [] }); byEdition.get(e.edition_id).tids.push(e.wta_tid); }
  const results = [];
  let n = 0;
  for (const e of byEdition.values()) {
    n += 1;
    const data = byEd.get(e.edition_id);
    if (!data || data.matches.length < 4) { results.push({ edition_id: e.edition_id, year: e.year, name: e.name, status: 'too_few_matches' }); continue; }
    let best = null;
    for (const tid of e.tids) {
      const s = await sheet(e.year, tid);
      if (s.status !== 200) { best = best || { wta_tid: tid, status: s.status === 404 ? 'no_sheet' : `http_${s.status}` }; continue; }
      const header = parseHeader(s.text);
      const parsed = parseSlots(s.text);
      const proof = proveDraw(parsed, data.people, data.matches);
      const r = { wta_tid: tid, status: proof.proven ? 'proven' : parsed.ok ? 'not_proven' : 'unparsed', url: s.url, capture_id: s.capture_id, sha256: s.sha256, captured_at: s.captured_at, header: { surface: header.surface, indoor: header.indoor, surface_raw: header.surface_raw, dates_raw: header.dates_raw }, parse_ok: parsed.ok, draw_size: parsed.size, proof: { checked: proof.checked, confirmed: proof.confirmed, resolved: proof.resolved, players: proof.players, unique: proof.unique },
        slots: proof.proven ? proof.slots.map((x) => ({ position: x.position, bye: x.bye, seed: x.seed, entry: x.entry, nat: x.nat, participant_key: x.participant_key, printed: x.bye ? 'Bye' : `${x.last}, ${x.first || ''}`.trim() })) : undefined };
      if (!best || r.status === 'proven' || (best.status !== 'proven' && r.parse_ok)) best = r;
      if (r.status === 'proven') break;
    }
    results.push({ edition_id: e.edition_id, year: e.year, name: e.name, level: e.level, start_date: e.start_date, ...best });
    if (n % 25 === 0) { write(results); process.stdout.write(`${n}/${byEdition.size} proven ${results.filter((r) => r.status === 'proven').length}\n`); }
  }
  write(results);
  console.log(JSON.stringify(summary(results)));
}

const summary = (results) => {
  const by = {};
  for (const r of results) { const y = (by[r.year] ||= { editions: 0, proven: 0, unparsed: 0, not_proven: 0, no_sheet: 0 }); y.editions += 1; if (y[r.status] != null) y[r.status] += 1; }
  return { editions: results.length, proven: results.filter((r) => r.status === 'proven').length, slots: results.reduce((t, r) => t + (r.slots?.length || 0), 0), by_year: by };
};
function write(results) {
  fs.mkdirSync('data/context', { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify({ generated_at: new Date().toISOString(), rule: 'main-draw singles sheet of the edition\'s own WTA id, proven: >=4 first-round pairs resolved in the edition, >=90% stored matches, >=75% of the draw resolved, no player twice', source: 'wtafiles.wtatennis.com/pdf/draws/{year}/{wtaId}/MDS.pdf via tennis-ingest /v1/drawsheet (R2-archived)', summary: summary(results), editions: results }, null, 1)}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
