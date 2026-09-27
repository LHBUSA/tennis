#!/usr/bin/env node
// ATP draw-sheet registry (Phase 5, docs/TENNIS_DATA_MODEL.md "Context layer").
//
//   node scripts/context/drawsheets.mjs            -> data/context/atp-drawsheets.json (registry; no DB writes)
//
// For every ESPN ATP edition (2014+, singles matches stored) find the OFFICIAL draw sheet (ProTennisLive,
// https://www.protennislive.com/posting/{year}/{atpId}/mds.pdf) and prove it is the same edition:
//   - candidate ATP ids come from data/context/atp-candidates.json (Wikipedia links; candidates only) and are
//     only TRIED in name-similarity order — a name never decides anything;
//   - the proof is the draw itself: >= 4 first-round pairs (positions 2k-1, 2k) resolved within the edition's
//     own stored players, >= 90% of them stored matches of that edition, >= 75% of the draw resolved, no player
//     twice (scripts/context/drawsheet-parse.mjs proveDraw);
//   - a tournament mapping (ESPN tid -> ATP id) needs >= 2 proven editions and no conflicting id.
// Sheets are fetched through tennis-ingest /v1/drawsheet (polite client, byte-exact R2 archive + capture row);
// the registry records url, capture id and sha256 of every sheet used. Header surface is read only from a
// proven sheet; a sheet that prints two surfaces, or none, leaves surface null.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseHeader, parseSlots, proveDraw, fold } from './drawsheet-parse.mjs';

const CACHE = process.env.DRAW_CACHE || 'D:/Temp/tennis-drawsheets';
const OUT = 'data/context/atp-drawsheets.json';
const B = 'https://tennis-ingest.sales-fd3.workers.dev';
const TOKEN = fs.readFileSync('D:/Workers/secrets/tennis-ingest-admin-token', 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sql = (q) => {
  const f = path.join(CACHE, 'q.sql');
  fs.writeFileSync(f, q);
  const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-File', f], { encoding: 'utf8', maxBuffer: 256 << 20 });
  const at = out.indexOf('[');
  if (at < 0) throw new Error(out.slice(0, 400));
  return JSON.parse(out.slice(at));
};

let lastFetch = 0;
async function sheet(year, atpId) {
  const dir = path.join(CACHE, 'ptl', String(year));
  const pdf = path.join(dir, `${atpId}-mds.pdf`);
  const meta = path.join(dir, `${atpId}-mds.json`);
  if (fs.existsSync(meta)) {
    const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
    return m.status === 200 ? { ...m, text: execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8' }) } : m;
  }
  fs.mkdirSync(dir, { recursive: true });
  const wait = lastFetch + 1600 - Date.now();
  if (wait > 0) await sleep(wait);
  lastFetch = Date.now();
  const res = await fetch(`${B}/v1/drawsheet?source=ptl&year=${year}&tid=${atpId}&doc=mds`, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (res.status === 502) throw new Error(`drawsheet fetch failed ${year}/${atpId}: ${await res.text()}`);
  if (res.status !== 200) { const m = { status: res.status }; fs.writeFileSync(meta, JSON.stringify(m)); return m; }
  fs.writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
  const m = { status: 200, url: res.headers.get('x-source-url'), capture_id: res.headers.get('x-capture-id'), sha256: res.headers.get('x-sha256'), captured_at: res.headers.get('x-captured-at') };
  fs.writeFileSync(meta, JSON.stringify(m));
  return { ...m, text: execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8' }) };
}

const STOP = new Set(['atp', 'tour', 'open', 'championships', 'championship', 'the', 'de', 'di', 'tennis', 'international', 'internationals', 'presented', 'by', 'cup', 'trophy', 'world', 'men', 'mens', 'classic', 'grand', 'prix', 'du', 'la', 'le', 'des', 'and', 'challenger', 'series', 'finals', 'masters', 'singles', 'doubles', '1000', '500', '250']);
const words = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d{4}$/.test(w));

function inWindow(dates, ed) {
  if (!dates.length || !ed.start_date) return null;
  const lo = Date.parse(ed.start_date) - 4 * 86400e3;
  const hi = Date.parse(ed.end_date || ed.start_date) + 4 * 86400e3;
  return dates.some((d) => { const t = Date.parse(d); return t >= lo && t <= hi; });
}

async function tryEdition(ed, atpId, people, matches) {
  const s = await sheet(ed.year, atpId);
  if (s.status !== 200) return { atp_id: atpId, status: s.status === 404 ? 'no_sheet' : `http_${s.status}` };
  const header = parseHeader(s.text);
  const parsed = parseSlots(s.text);
  const proof = proveDraw(parsed, people, matches);
  return { atp_id: atpId, status: proof.proven ? 'proven' : 'not_proven', url: s.url, capture_id: s.capture_id, sha256: s.sha256, captured_at: s.captured_at, header, date_ok: inWindow(header.dates, ed), parse_ok: parsed.ok, draw_size: parsed.size, proof: { checked: proof.checked, confirmed: proof.confirmed, resolved: proof.resolved, players: proof.players, unique: proof.unique }, slots: proof.proven ? proof.slots.map((x) => ({ position: x.position, bye: x.bye, seed: x.seed, entry: x.entry, nat: x.nat, participant_key: x.participant_key, printed: x.bye ? 'Bye' : `${x.last}, ${x.first || ''}`.trim() })) : undefined };
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const cands = JSON.parse(fs.readFileSync('data/context/atp-candidates.json', 'utf8')).candidates;
  const eds = sql(`select x.external_id espn, e.edition_id, e.year, e.name, e.city, e.start_date, e.end_date from tennis_edition_external_ids x join tennis_tournament_editions e using (edition_id) join tennis_tournaments t using (tournament_id)
    where x.provider='espn' and e.source_family='espn' and e.year>=2014 and t.slug not in ('australian-open','roland-garros','wimbledon','us-open')
    and exists (select 1 from tennis_matches m where m.edition_id=e.edition_id and m.event_type='MS') order by x.external_id`);
  const ms = sql(`select m.edition_id, array_agg(p.participant_key order by p.side) keys, json_agg(json_build_object('key', p.participant_key, 'last', pl.last_name, 'first', pl.first_name)) people
    from tennis_matches m join tennis_match_participants p using (match_id) join tennis_participant_members mm on mm.participant_key=p.participant_key join tennis_players pl on pl.pbe_player_id=mm.pbe_player_id
    join tennis_tournament_editions e on e.edition_id=m.edition_id where m.event_type='MS' and e.source_family='espn' and e.year>=2014 group by m.edition_id, m.match_id`);
  const byEd = new Map();
  for (const r of ms) {
    const e = byEd.get(r.edition_id) || { people: [], matches: [] };
    e.people.push(...r.people);
    if (r.keys.length === 2) e.matches.push({ keys: r.keys });
    byEd.set(r.edition_id, e);
  }
  const byTid = new Map();
  for (const e of eds) { const tid = e.espn.split('-')[0]; if (!byTid.has(tid)) byTid.set(tid, []); byTid.get(tid).push(e); }
  const results = [];
  const tournaments = [];
  let n = 0;
  for (const [tid, list] of byTid) {
    n += 1;
    const toks = new Set(list.flatMap((e) => [...words(e.name), ...words(e.city)]));
    const ranked = cands.map((c) => ({ c, score: [...new Set([...c.slugs.flatMap((s) => words(s.replace(/-/g, ' '))), ...c.sample_pages.flatMap(words)])].filter((w) => toks.has(w)).length }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score || Number(a.c.atp_id) - Number(b.c.atp_id)).slice(0, 5).map((x) => x.c.atp_id);
    const sorted = [...list].sort((a, b) => b.year - a.year);
    const probe = sorted.filter((e) => (byEd.get(e.edition_id)?.matches.length || 0) >= 8).slice(0, 2);
    let chosen = null;
    const attempts = [];
    for (const atpId of ranked) {
      if (!probe.length) break;
      const r = await tryEdition(probe[0], atpId, byEd.get(probe[0].edition_id).people, byEd.get(probe[0].edition_id).matches);
      attempts.push({ espn: probe[0].espn, atp_id: atpId, status: r.status, proof: r.proof || null });
      if (r.status === 'proven') { chosen = atpId; break; }
    }
    // every edition of this ESPN tournament: the chosen id first, then the other candidates for a relocated event
    const editionRows = [];
    for (const e of sorted) {
      const data = byEd.get(e.edition_id);
      if (!data || data.matches.length < 4) { editionRows.push({ espn: e.espn, edition_id: e.edition_id, year: e.year, status: 'too_few_matches' }); continue; }
      let best = null;
      for (const atpId of chosen ? [chosen, ...ranked.filter((x) => x !== chosen)] : ranked.slice(0, 2)) {
        const r = await tryEdition(e, atpId, data.people, data.matches);
        if (!best || r.status === 'proven') best = r;
        if (r.status === 'proven') break;
      }
      editionRows.push({ espn: e.espn, edition_id: e.edition_id, year: e.year, name: e.name, city: e.city, start_date: e.start_date, end_date: e.end_date, ...(best || { status: 'no_candidate' }) });
    }
    const proven = editionRows.filter((r) => r.status === 'proven');
    const ids = [...new Set(proven.map((r) => r.atp_id))];
    tournaments.push({ espn_tid: tid, names: [...new Set(list.map((e) => e.name))].slice(0, 4), candidates_tried: ranked, probe_attempts: attempts, atp_ids: ids, editions: list.length, editions_proven: proven.length,
      status: ids.length === 1 && proven.length >= 2 ? 'mapped' : ids.length > 1 ? 'ambiguous' : proven.length === 1 ? 'single_edition' : 'unresolved' });
    results.push(...editionRows);
    process.stdout.write(`${n}/${byTid.size} tid ${tid} ${list[0].name}: ${proven.length}/${list.length} proven ids=${ids.join(',') || '-'}\n`);
    if (n % 10 === 0) write(results, tournaments);
  }
  write(results, tournaments);
}

function write(results, tournaments) {
  const summary = { editions: results.length, proven: results.filter((r) => r.status === 'proven').length, with_surface: results.filter((r) => r.status === 'proven' && r.header?.surface).length, tournaments: tournaments.length, tournaments_mapped: tournaments.filter((t) => t.status === 'mapped').length };
  fs.mkdirSync('data/context', { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify({ generated_at: new Date().toISOString(), rule: 'edition proven by its own official draw sheet: >=4 first-round pairs resolved in the edition, >=90% stored matches, >=75% of the draw resolved, no player twice; tournament mapped with >=2 proven editions and one ATP id', source: 'www.protennislive.com/posting/{year}/{atpId}/mds.pdf via tennis-ingest /v1/drawsheet (R2-archived)', summary, tournaments, editions: results }, null, 1)}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
