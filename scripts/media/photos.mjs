#!/usr/bin/env node
// Player photo pipeline (docs/MEDIA.md). Identity first, coverage second.
//
//   node scripts/media/photos.mjs [--limit 200] [--dry]
//
// 1. candidates: players whose Wikidata item (matched by EXACT tour id) lists a Commons image (P18)
// 2. Commons license API (50 titles/request): accept only CC0 / Public Domain / CC BY / CC BY-SA
// 3. download a 1200px rendition (honest UA, 1 req/s)
// 4. face detection (MediaPipe BlazeFace, local model, headless Chrome): accept exactly one clear face,
//    or one face that dominates (largest >= 2.5x the next); anything else -> monogram fallback
// 5. crops computed from the face box (no forehead crops, no upscaling past 1.3x): portrait 4:5, square,
//    thumb, wide 16:9 (webp) + square jpg (for social-card compositing)
// 6. upload to R2 tennis-media via tennis-ingest (admin), record provenance in tennis_player_media
// Run locally (workstation): image processing needs sharp + a browser; no provider call from the site.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { storeFromEnv, inList } from '../../workers/shared/store/postgrest.js';
import { UA, INGEST, API, OK_LICENSE, sleep, licenses, detector, chooseFace, tiledDetect, derivatives, put } from './pipeline-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 200;
const DRY = args.includes('--dry');

const envText = fs.readFileSync('D:/Workers/secrets/ufc-propbetedge.env', 'utf8').replace(/^\uFEFF/, '');
const g = (k) => (envText.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const store = storeFromEnv({ TENNIS_MODEL_SUPABASE_URL: g('SUPABASE_URL'), TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY: g('SUPABASE_SERVICE_ROLE_KEY') });

// ---- candidates, priority: current WTA singles rank, then everyone else --------------------------------
async function candidates() {
  const imgs = [];
  for (let off = 0; ; off += 1000) {
    // stable order: offset paging without ORDER BY can skip and repeat rows between pages
    const r = await store.select('tennis_player_external_ids', `select=pbe_player_id,external_id&provider=eq.commons_image&order=pbe_player_id.asc,external_id.asc&limit=1000&offset=${off}`);
    imgs.push(...r);
    if (r.length < 1000) break;
  }
  const done = new Set((await store.select('tennis_player_media', 'select=pbe_player_id&limit=5000')).map((r) => r.pbe_player_id));
  const byPlayer = new Map();
  for (const r of imgs) if (!done.has(r.pbe_player_id) && !byPlayer.has(r.pbe_player_id)) byPlayer.set(r.pbe_player_id, r.external_id);
  const snap = (await store.select('tennis_ranking_snapshots', 'select=snapshot_id&list_key=eq.wta_singles&row_count=gt.0&order=ranking_date.desc&limit=1'))[0];
  const rank = new Map();
  if (snap) for (let off = 0; off < 2000; off += 1000) for (const r of await store.select('tennis_rankings', `select=pbe_player_id,rank&snapshot_id=eq.${snap.snapshot_id}&limit=1000&offset=${off}`)) rank.set(r.pbe_player_id, r.rank);
  const tier = await priorityTiers(rank);
  const ids = [...byPlayer.keys()];
  const qid = new Map();
  for (let i = 0; i < ids.length; i += 150) for (const r of await store.select('tennis_player_external_ids', `select=pbe_player_id,external_id,evidence&provider=eq.wikidata&pbe_player_id=${inList(ids.slice(i, i + 150))}`)) qid.set(r.pbe_player_id, r);
  return ids.map((id) => ({ id, file: byPlayer.get(id), qid: qid.get(id), rank: rank.get(id) ?? 99999, tier: tier.get(id) ?? 7 })).filter((c) => c.qid).sort((a, b) => a.tier - b.tier || a.rank - b.rank).slice(0, LIMIT);
}

// Media policy order (docs/MEDIA.md): 1 live · 2 scheduled today · 3 current tournament fields · 4 WTA top 100
// · 5 WTA top 200 · 6 recent PBEcast replay participants (last 14 days) · 7 everyone else.
async function priorityTiers(rank) {
  const tier = new Map();
  const set = (ids, t) => { for (const id of ids) if (!tier.has(id) || tier.get(id) > t) tier.set(id, t); };
  const membersOf = async (matches) => {
    const keys = [...new Set(matches.flatMap((m) => (m.tennis_match_participants || []).map((p) => p.participant_key)))];
    const out = [];
    for (let i = 0; i < keys.length; i += 100) out.push(...(await store.select('tennis_participant_members', `select=pbe_player_id&participant_key=${inList(keys.slice(i, i + 100))}`)).map((r) => r.pbe_player_id));
    return out;
  };
  const today = new Date().toISOString().slice(0, 10);
  const ago = (d) => new Date(Date.now() - d * 86400e3).toISOString().slice(0, 10);
  set(await membersOf(await store.select('tennis_matches', 'select=match_id,tennis_match_participants(participant_key)&status=eq.in_progress&limit=200')), 1);
  // newsroom subjects (published stories and candidates): a story's hero and cards need their real photos
  set((await store.select('tennis_articles', 'select=player_ids&order=created_at.desc&limit=200')).flatMap((a) => a.player_ids || []), 2);
  const eds = await store.select('tennis_tournament_editions', `select=edition_id&start_date=lte.${today}&end_date=gte.${ago(1)}&limit=200`);
  if (eds.length) {
    const ms = await store.select('tennis_matches', `select=match_id,status,tennis_match_participants(participant_key)&edition_id=${inList(eds.map((e) => e.edition_id))}&limit=2000`);
    set(await membersOf(ms.filter((m) => m.status === 'scheduled')), 2);
    set(await membersOf(ms), 3);
  }
  for (const [id, r] of rank) set([id], r <= 100 ? 4 : r <= 200 ? 5 : 99);
  const recent = await store.select('tennis_match_events', `select=match_id&observed_at=gte.${ago(14)}&limit=2000`).catch(() => []);
  const rids = [...new Set(recent.map((r) => r.match_id))];
  if (rids.length) set(await membersOf(await store.select('tennis_matches', `select=match_id,tennis_match_participants(participant_key)&match_id=${inList(rids.slice(0, 300))}`)), 6);
  for (const [id, t] of tier) if (t === 99) tier.set(id, 7);
  return tier;
}

const report = { run_at: new Date().toISOString(), considered: 0, approved: 0, rejected: {}, license_rejected: 0 };
const cands = await candidates();
report.considered = cands.length;
console.log(`candidates: ${cands.length}`);
const lic = await licenses(cands.map((c) => c.file));
const det = await detector();
try {
  for (const c of cands) {
    const rej = (why) => { report.rejected[why] = (report.rejected[why] || 0) + 1; (report.players ||= []).push({ id: c.id, tier: c.tier, rank: c.rank === 99999 ? null : c.rank, result: why }); };
    try {
    const L = lic.get(c.file);
    if (!L) { rej('commons_missing'); continue; }
    if (!OK_LICENSE.test(L.license || '') || /\bnc\b|\bnd\b|non-?commercial|no-?deriv/i.test(L.license)) { report.license_rejected += 1; rej('license'); continue; }
    if (Math.min(L.width, L.height) < 400) { rej('original_too_small'); continue; }
    const res = await fetch(L.thumb, { headers: { 'user-agent': UA } });
    await sleep(1000);
    if (!res.ok) { rej(`download_${res.status}`); continue; }
    const raw = Buffer.from(await res.arrayBuffer());
    const jpg = await sharp(raw, { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toBuffer();
    const meta = await sharp(jpg).metadata();
    let d = await det.detect(jpg);
    let pick = chooseFace(d);
    if (!pick.ok && (pick.reason === 'no_face' || pick.reason === 'low_confidence')) {
      // full-body action shots: faces are small for the short-range model. Re-detect on overlapping tiles of the
      // upper frame (same model, same thresholds), merge every detection back into full-frame coordinates and
      // apply the SAME single-dominant-face rule across the whole image.
      d = await tiledDetect(det, jpg, meta);
      pick = chooseFace(d);
      if (pick.ok) pick.face.tiled = true;
    }
    if (!pick.ok) { rej(pick.reason); continue; }
    const der = await derivatives(jpg, meta, pick.face);
    if (!der.ok) { rej(der.reason); continue; }
    const ver = crypto.createHash('sha256').update(jpg).digest('hex').slice(0, 10);
    const urls = {};
    for (const f of der.files) {
      const key = `players/${c.id}/${f.name}.${f.fmt}`;
      if (!DRY) await put(key, f.data);
      else if (process.env.PHOTO_OUT) { fs.mkdirSync(process.env.PHOTO_OUT, { recursive: true }); fs.writeFileSync(path.join(process.env.PHOTO_OUT, `${c.rank}-${c.id.slice(0, 6)}-${f.name}.${f.fmt}`), f.data); }
      urls[`${f.name}${f.fmt === 'jpg' ? '_jpg' : ''}`] = { url: `${API}/media/${key}?v=${ver}`, w: f.w, h: f.h };
    }
    if (!DRY) {
      await store.upsert('tennis_player_media', [{
        pbe_player_id: c.id, source_page_url: L.page, original_url: L.original, author: (L.author || 'Unknown author').slice(0, 300),
        license: L.license.replace(/^Public domain$/i, 'Public domain'), attribution: `${(L.author || 'Unknown author').slice(0, 200)} / ${L.license} / Wikimedia Commons`,
        width: L.width, height: L.height, focal: { face: pick.face, detector: pick.face.tiled ? 'mediapipe blaze_face_short_range (tiled)' : 'mediapipe blaze_face_short_range', rendition_width: meta.width, rendition_height: meta.height },
        identity_evidence: { method: 'wikidata_p18_on_exact_tour_id_match', wikidata: c.qid.external_id, evidence: c.qid.evidence, commons_file: c.file },
        approval: 'approved', verified_at: new Date().toISOString(), derivatives: { ...urls, license_url: L.license_url, version: ver }
      }]);
    }
    report.approved += 1;
    (report.players ||= []).push({ id: c.id, tier: c.tier, rank: c.rank === 99999 ? null : c.rank, result: 'approved', tiled: !!pick.face.tiled, portrait: der.files.some((f) => f.name === 'portrait') });
    if (report.approved % 20 === 0) console.log(`approved ${report.approved}…`);
    } catch (e) {
      rej(`error:${String(e.message).slice(0, 40)}`);
    }
  }
} finally {
  await det.close();
}
fs.mkdirSync(path.join(ROOT, 'docs', 'evidence'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'evidence', 'photo-pipeline-latest.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
