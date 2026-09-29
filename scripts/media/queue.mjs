#!/usr/bin/env node
// Newsroom media queue (docs/MEDIA.md, Newsroom V3 §21).
//   node scripts/media/queue.mjs plan                 audit coverage, enqueue gaps (news / current events / top 100),
//                                                     write docs/evidence/media-coverage-latest.md
//   node scripts/media/queue.mjs process [--limit 25] [--dry]
//                                                     process due entries with the EXISTING pipeline rules
// Reads/writes the canonical store through scripts/db/run_sql.ps1 (the Supabase service key is never read locally);
// derivatives go through tennis-ingest's admin PUT /v1/media (token read into memory, never printed). Queue state: KV
// TENNIS_STATE `media:queue` (workers/shared/media-queue.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { UA, API, licenseOk, sleep, licenses, detector, chooseFace, tiledDetect, derivatives, put } from './pipeline-lib.mjs';
import { QUEUE_KEY, mergeQueue, due, markResult, identityFromWikidata } from '../../workers/shared/media-queue.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NS = 'a117d7b3846c4a39a27ee74c49574c99'; // TENNIS_STATE
const cmd = process.argv[2] || 'plan';
const opt = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry');

// ---- store (management SQL) + KV ----------------------------------------------------------------------
function sql(q) {
  const out = execFileSync('pwsh', ['-NoProfile', '-File', path.join(ROOT, 'scripts/db/run_sql.ps1'), '-Query', q], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (/FAILED ->/.test(out)) throw new Error(out.slice(0, 600));
  const at = ['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0);
  if (!at.length) return [];
  const v = JSON.parse(out.slice(Math.min(...at)));
  return Array.isArray(v) ? v : [v];
}
const wrangler = (args, input) => execFileSync('npx', ['wrangler', ...args], { cwd: path.join(ROOT, 'workers/tennis-ingest'), encoding: 'utf8', input, shell: true, env: { ...process.env, NODE_OPTIONS: '--require D:/Workers/exfat-readlink.cjs' }, maxBuffer: 64 << 20 });
function kvGet() {
  try { const t = wrangler(['kv', 'key', 'get', '--namespace-id', NS, QUEUE_KEY, '--remote']); return JSON.parse(t.slice(t.indexOf('{'))); } catch { return {}; }
}
function kvPut(q) {
  const f = path.join(ROOT, 'qa-artifacts', 'media-queue.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(q));
  wrangler(['kv', 'key', 'put', '--namespace-id', NS, QUEUE_KEY, '--path', f, '--remote']);
}
const lit = (s) => { const tag = `$m${crypto.randomBytes(3).toString('hex')}$`; return `${tag}${String(s)}${tag}`; };

// ---- coverage audit -----------------------------------------------------------------------------------
const GROUPS = `
with lists as (select distinct on (list_key) snapshot_id, list_key from tennis_ranking_snapshots where list_key in ('atp_singles','wta_singles') and row_count > 0 and ranking_date <= current_date order by list_key, ranking_date desc),
top as (select l.list_key grp, r.pbe_player_id, r.rank from tennis_rankings r join lists l using (snapshot_id) where r.rank <= 100),
cur_eds as (select edition_id from tennis_tournament_editions where start_date <= current_date + 1 and end_date >= current_date - 1),
cur as (select distinct 'current_events' grp, pm.pbe_player_id, null::int rank from tennis_matches m join cur_eds using (edition_id) join tennis_match_participants mp on mp.match_id = m.match_id join tennis_participant_members pm on pm.participant_key = mp.participant_key where m.event_type in ('MS','WS')),
news as (select distinct 'news_14d' grp, (jsonb_array_elements_text(e.entities))::uuid pbe_player_id, null::int rank from tennis_news_events e where e.detected_at > now() - interval '14 days'),
allp as (select a.* from (select * from top union all select * from cur union all select * from news) a join tennis_players p using (pbe_player_id)),
ok as (select pbe_player_id from tennis_player_media where approval = 'approved' and derivatives ? 'square')`;
const LABEL = { atp_singles: 'ATP top 100', wta_singles: 'WTA top 100', current_events: 'Current-event singles players', news_14d: 'Players in news events (14 d)' };
const REASON = { news_14d: 'news', current_events: 'current_event', atp_singles: 'top100', wta_singles: 'top100' };

function coverage() {
  const g = sql(`${GROUPS} select grp, count(distinct pbe_player_id) players, count(distinct pbe_player_id) filter (where pbe_player_id in (select pbe_player_id from ok)) with_photo from allp group by grp order by grp`);
  const missing = sql(`${GROUPS} select a.pbe_player_id::text id, p.full_name name, p.founding_external_key fk, string_agg(distinct a.grp, ',') grps, min(a.rank) rank from allp a join tennis_players p using (pbe_player_id) where a.pbe_player_id not in (select pbe_player_id from ok) group by a.pbe_player_id, p.full_name, p.founding_external_key order by min(a.rank) nulls last, p.full_name`);
  return { groups: g.map((r) => ({ grp: r.grp, label: LABEL[r.grp], players: Number(r.players), with_photo: Number(r.with_photo), pct: Math.round((1000 * Number(r.with_photo)) / Math.max(1, Number(r.players))) / 10 })), missing };
}

function writeReport(before, after, added, results, queue = {}) {
  const t = (c) => c.groups.map((g) => `| ${g.label} | ${g.with_photo} / ${g.players} | ${g.pct}% |`).join('\n');
  const reasonOf = new Map([...Object.entries(queue).filter(([, v]) => v.last_result).map(([id, v]) => [id, v.last_result]), ...results.map((r) => [r.id, r.result])]);
  const md = [
    `# Player photo coverage — ${new Date().toISOString()}`, '',
    'Approved = `tennis_player_media.approval = approved` with derivatives (identity-proven, CC0/PD/CC BY/CC BY-SA, reviewed focal box).', '',
    '## Before', '| Group | With approved photo | Coverage |', '|---|---|---|', t(before), '',
    ...(after ? ['## After', '| Group | With approved photo | Coverage |', '|---|---|---|', t(after), ''] : []),
    `## Photos added (${added.length})`, '', ...(added.length ? ['| Player | Licence | Author | Source page |', '|---|---|---|---|', ...added.map((a) => `| ${a.name} | ${a.license} | ${a.author} | ${a.page} |`)] : ['none']), '',
    `## Still missing (${(after || before).missing.length})`, '', '| Player | Groups | Rank | Why |', '|---|---|---|---|',
    ...(after || before).missing.map((m) => `| ${m.name} (${m.fk}) | ${m.grps} | ${m.rank ?? '—'} | ${reasonOf.get(m.id) || 'queued, not processed in this run'} |`), ''
  ];
  fs.writeFileSync(path.join(ROOT, 'docs', 'evidence', 'media-coverage-latest.md'), md.join('\n'));
}

// ---- Wikidata identity (exact tour id) -------------------------------------------------------------------
async function wikidata(keys) {
  const atp = keys.filter((k) => k.startsWith('atp:')).map((k) => k.slice(4));
  const wta = keys.filter((k) => k.startsWith('wta:')).map((k) => k.slice(4));
  const vals = (xs) => [...new Set(xs.flatMap((x) => [x, x.toUpperCase(), x.toLowerCase()]))].map((x) => JSON.stringify(x)).join(' ');
  const parts = [];
  if (atp.length) parts.push(`{ VALUES ?atp { ${vals(atp)} } ?item wdt:P536 ?atp . }`);
  if (wta.length) parts.push(`{ VALUES ?wta { ${vals(wta)} } ?item wdt:P597 ?wta . }`);
  if (!parts.length) return [];
  const q = `SELECT ?item ?atp ?wta ?img WHERE { ${parts.join(' UNION ')} OPTIONAL { ?item wdt:P18 ?img } }`;
  const r = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA, accept: 'application/sparql-results+json' } });
  if (!r.ok) throw new Error(`wikidata ${r.status}`);
  const j = await r.json();
  await sleep(2000);
  return j.results.bindings.map((b) => ({ item: b.item.value.split('/').pop(), atp: b.atp?.value || null, wta: b.wta?.value || null, img: b.img ? decodeURIComponent(b.img.value.split('/').pop()).replace(/_/g, ' ') : null }));
}

// ---- process ----------------------------------------------------------------------------------------
async function processQueue(limit) {
  let q = kvGet();
  const batch = due(q, Date.now(), limit);
  console.log(`queue ${Object.keys(q).length}, processing ${batch.length}${DRY ? ' (dry)' : ''}`);
  if (!batch.length) return { results: [], added: [] };
  const info = new Map(sql(`select p.pbe_player_id::text id, p.full_name name, p.founding_external_key fk, (select approval from tennis_player_media m where m.pbe_player_id = p.pbe_player_id and m.approval = 'approved' limit 1) approved from tennis_players p where p.pbe_player_id in (${batch.map((b) => `'${b.id}'`).join(',')})`).map((r) => [r.id, r]));
  const rows = await wikidata(batch.map((b) => info.get(b.id)?.fk).filter(Boolean));
  const ids = batch.map((b) => ({ ...b, ...info.get(b.id), idn: identityFromWikidata(rows, info.get(b.id)?.fk) }));
  const files = [...new Set(ids.filter((x) => x.idn.ok).flatMap((x) => x.idn.files))];
  const lic = files.length ? await licenses(files) : new Map();
  const det = await detector();
  const results = [];
  const added = [];
  try {
    for (const c of ids) {
      let result;
      try {
        if (c.approved) result = 'already_approved';
        else if (!c.idn.ok) result = c.idn.reason;
        else {
          result = 'no_image:no_usable_file';
          for (const file of c.idn.files) {
            const L = lic.get(file);
            if (!L) { result = 'no_image:commons_missing'; continue; }
            if (!licenseOk(L.license)) { result = `license:${L.license || 'unknown'}`; continue; }
            if (Math.min(L.width, L.height) < 400) { result = 'rejected:original_too_small'; continue; }
            const res = await fetch(L.thumb, { headers: { 'user-agent': UA } });
            await sleep(1000);
            if (!res.ok) { result = `error:download_${res.status}`; continue; }
            const jpg = await sharp(Buffer.from(await res.arrayBuffer()), { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toBuffer();
            const meta = await sharp(jpg).metadata();
            let pick = chooseFace(await det.detect(jpg));
            if (!pick.ok && (pick.reason === 'no_face' || pick.reason === 'low_confidence')) { pick = chooseFace(await tiledDetect(det, jpg, meta)); if (pick.ok) pick.face.tiled = true; }
            if (!pick.ok) { result = `rejected:${pick.reason}`; continue; }
            const der = await derivatives(jpg, meta, pick.face);
            if (!der.ok) { result = `rejected:${der.reason}`; continue; }
            const ver = crypto.createHash('sha256').update(jpg).digest('hex').slice(0, 10);
            const urls = {};
            for (const f of der.files) {
              const key = `players/${c.id}/${f.name}.${f.fmt}`;
              if (!DRY) await put(key, f.data);
              urls[`${f.name}${f.fmt === 'jpg' ? '_jpg' : ''}`] = { url: `${API}/media/${key}?v=${ver}`, w: f.w, h: f.h };
            }
            const author = (L.author || 'Unknown author').slice(0, 300);
            const focal = { face: pick.face, detector: pick.face.tiled ? 'mediapipe blaze_face_short_range (tiled)' : 'mediapipe blaze_face_short_range', rendition_width: meta.width, rendition_height: meta.height };
            const identity = { method: 'wikidata_p18_on_exact_tour_id_match', wikidata: c.idn.item, evidence: c.idn.evidence, commons_file: file, via: 'media_queue' };
            if (!DRY) {
              sql(`insert into tennis_player_media (pbe_player_id, source_page_url, original_url, author, license, attribution, width, height, focal, identity_evidence, approval, verified_at, derivatives)
                values ('${c.id}', ${lit(L.page)}, ${lit(L.original)}, ${lit(author)}, ${lit(L.license)}, ${lit(`${author.slice(0, 200)} / ${L.license} / Wikimedia Commons`)}, ${L.width}, ${L.height}, ${lit(JSON.stringify(focal))}::jsonb, ${lit(JSON.stringify(identity))}::jsonb, 'approved', now(), ${lit(JSON.stringify({ ...urls, license_url: L.license_url, version: ver }))}::jsonb)
                on conflict do nothing returning id`);
              sql(`insert into tennis_player_external_ids (provider, external_id, pbe_player_id, method, evidence) values ('wikidata', ${lit(c.idn.item)}, '${c.id}', 'external_id', ${lit(JSON.stringify(c.idn.evidence))}::jsonb), ('commons_image', ${lit(file)}, '${c.id}', 'external_id', ${lit(JSON.stringify(c.idn.evidence))}::jsonb) on conflict do nothing`);
            }
            added.push({ id: c.id, name: c.name, license: L.license, author, page: L.page });
            result = 'approved';
            break;
          }
        }
      } catch (e) { result = `error:${String(e.message).slice(0, 60)}`; }
      results.push({ id: c.id, name: c.name, result });
      console.log(`${c.name}: ${result}`);
      if (!DRY) q = markResult(q, c.id, result);
    }
  } finally { await det.close(); }
  if (!DRY) kvPut(q);
  return { results, added };
}

// ---- main -----------------------------------------------------------------------------------------------
if (cmd === 'plan') {
  const cov = coverage();
  const items = cov.missing.flatMap((m) => String(m.grps).split(',').map((g) => ({ id: m.id, reason: REASON[g], name: m.name })));
  const q = mergeQueue(kvGet(), items);
  if (!DRY) kvPut(q);
  writeReport(cov, null, [], [], q);
  console.log(JSON.stringify({ groups: cov.groups, missing: cov.missing.length, queue: Object.keys(q).length }, null, 1));
} else if (cmd === 'process') {
  const before = coverage();
  const { results, added } = await processQueue(Number(opt('limit', 25)));
  const after = DRY ? null : coverage();
  writeReport(before, after, added, results, DRY ? {} : kvGet());
  const tally = results.reduce((a, r) => { const k = r.result.split(':')[0]; a[k] = (a[k] || 0) + 1; return a; }, {});
  console.log(JSON.stringify({ processed: results.length, added: added.length, tally, before: before.groups, after: after?.groups || null }, null, 1));
} else {
  console.error('usage: queue.mjs plan | process [--limit N] [--dry]');
  process.exitCode = 2;
}
