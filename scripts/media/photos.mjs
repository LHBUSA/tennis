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
import { chromium } from 'playwright-core';
import { storeFromEnv, inList } from '../../workers/shared/store/postgrest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UA = 'PropBetEdge-Tennis-Media/0.1 (+https://tennis.propbetedge.ai/credits)';
const INGEST = 'https://tennis-ingest.sales-fd3.workers.dev';
const API = 'https://tennis-api.propbetedge.ai';
const OK_LICENSE = /^(cc0|public domain|pd|cc by(-sa)?( \d(\.\d)?)?)$/i;
const args = process.argv.slice(2);
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 200;
const DRY = args.includes('--dry');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const envText = fs.readFileSync('D:/Workers/secrets/ufc-propbetedge.env', 'utf8').replace(/^\uFEFF/, '');
const g = (k) => (envText.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const store = storeFromEnv({ TENNIS_MODEL_SUPABASE_URL: g('SUPABASE_URL'), TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY: g('SUPABASE_SERVICE_ROLE_KEY') });
const ADMIN = fs.readFileSync('D:/Workers/secrets/tennis-ingest-admin-token', 'utf8').trim();

// ---- candidates, priority: current WTA singles rank, then everyone else --------------------------------
async function candidates() {
  const imgs = [];
  for (let off = 0; ; off += 1000) {
    const r = await store.select('tennis_player_external_ids', `select=pbe_player_id,external_id&provider=eq.commons_image&limit=1000&offset=${off}`);
    imgs.push(...r);
    if (r.length < 1000) break;
  }
  const done = new Set((await store.select('tennis_player_media', 'select=pbe_player_id&limit=5000')).map((r) => r.pbe_player_id));
  const byPlayer = new Map();
  for (const r of imgs) if (!done.has(r.pbe_player_id) && !byPlayer.has(r.pbe_player_id)) byPlayer.set(r.pbe_player_id, r.external_id);
  const snap = (await store.select('tennis_ranking_snapshots', 'select=snapshot_id&list_key=eq.wta_singles&row_count=gt.0&order=ranking_date.desc&limit=1'))[0];
  const rank = new Map();
  if (snap) for (let off = 0; off < 2000; off += 1000) for (const r of await store.select('tennis_rankings', `select=pbe_player_id,rank&snapshot_id=eq.${snap.snapshot_id}&limit=1000&offset=${off}`)) rank.set(r.pbe_player_id, r.rank);
  const ids = [...byPlayer.keys()];
  const qid = new Map();
  for (let i = 0; i < ids.length; i += 150) for (const r of await store.select('tennis_player_external_ids', `select=pbe_player_id,external_id,evidence&provider=eq.wikidata&pbe_player_id=${inList(ids.slice(i, i + 150))}`)) qid.set(r.pbe_player_id, r);
  return ids.map((id) => ({ id, file: byPlayer.get(id), qid: qid.get(id), rank: rank.get(id) ?? 99999 })).filter((c) => c.qid).sort((a, b) => a.rank - b.rank).slice(0, LIMIT);
}

// ---- Commons license, 50 titles per request ---------------------------------------------------------
async function licenses(files) {
  const out = new Map();
  for (let i = 0; i < files.length; i += 50) {
    const titles = files.slice(i, i + 50).map((f) => `File:${f}`).join('|');
    const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1200&iiextmetadatafilter=LicenseShortName|Artist|LicenseUrl|Credit&titles=${encodeURIComponent(titles)}`;
    const j = await (await fetch(u, { headers: { 'user-agent': UA } })).json();
    const norm = new Map((j.query?.normalized || []).map((n) => [n.to, n.from]));
    for (const p of Object.values(j.query?.pages || {})) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const md = ii.extmetadata || {};
      const from = (norm.get(p.title) || p.title).replace(/^File:/, '');
      out.set(from, { title: p.title, page: ii.descriptionurl, original: ii.url, thumb: ii.thumburl || ii.url, width: ii.width, height: ii.height, license: strip(md.LicenseShortName?.value), license_url: strip(md.LicenseUrl?.value) || null, author: strip(md.Artist?.value) || null, credit: strip(md.Credit?.value) || null });
    }
    await sleep(1000);
  }
  return out;
}

// ---- face detection in headless Chrome ---------------------------------------------------------------
async function detector() {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  const mp = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision');
  await page.route('http://local/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/index.html') return route.fulfill({ status: 200, body: '<!doctype html><title>fd</title>', headers: { 'content-type': 'text/html' } });
    const file = u.pathname === '/model.tflite' ? path.join(ROOT, 'scripts', 'media', 'models', 'blaze_face_short_range.tflite') : path.join(mp, u.pathname.replace(/^\/mp\//, ''));
    const type = file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
    route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'content-type': type } });
  });
  await page.goto('http://local/index.html');
  await page.evaluate(async () => {
    const { FilesetResolver, FaceDetector } = await import('http://local/mp/vision_bundle.mjs');
    const fs = await FilesetResolver.forVisionTasks('http://local/mp/wasm');
    window.fd = await FaceDetector.createFromOptions(fs, { baseOptions: { modelAssetPath: 'http://local/model.tflite' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 });
  });
  const detect = async (buf) => page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    const r = window.fd.detect(img);
    return { w: img.naturalWidth, h: img.naturalHeight, faces: r.detections.map((d) => ({ x: d.boundingBox.originX, y: d.boundingBox.originY, w: d.boundingBox.width, h: d.boundingBox.height, score: d.categories[0].score })) };
  }, buf.toString('base64'));
  return { detect, close: () => browser.close() };
}

function chooseFace(res) {
  const faces = res.faces.filter((f) => f.score >= 0.6).sort((a, b) => b.w * b.h - a.w * a.h);
  if (!faces.length) return { ok: false, reason: 'no_face' };
  const [f, next] = faces;
  if (next && f.w * f.h < 2.5 * next.w * next.h) return { ok: false, reason: 'multiple_faces' };
  if (f.score < 0.75) return { ok: false, reason: 'low_confidence' };
  if (f.w < res.w * 0.05) return { ok: false, reason: 'face_too_small' };
  return { ok: true, face: f };
}

// crop box around the face: faceFrac = face height / crop height; face center placed at `yAt` of crop
function cropBox(W, H, f, aspect, faceFrac, yAt) {
  let ch = Math.min(f.h / faceFrac, H);
  let cw = ch * aspect;
  if (cw > W) { cw = W; ch = cw / aspect; }
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  let left = Math.round(cx - cw / 2);
  let top = Math.round(cy - ch * yAt);
  left = Math.max(0, Math.min(left, W - cw));
  top = Math.max(0, Math.min(top, H - ch));
  return { left: Math.round(left), top: Math.round(top), width: Math.round(cw), height: Math.round(ch) };
}

const VARIANTS = [
  { name: 'portrait', w: 600, h: 750, faceFrac: 0.3, yAt: 0.36, fmt: 'webp' },
  { name: 'square', w: 400, h: 400, faceFrac: 0.38, yAt: 0.42, fmt: 'webp' },
  { name: 'thumb', w: 128, h: 128, faceFrac: 0.5, yAt: 0.45, fmt: 'webp' },
  { name: 'wide', w: 1200, h: 675, faceFrac: 0.4, yAt: 0.42, fmt: 'webp' },
  { name: 'square', w: 400, h: 400, faceFrac: 0.38, yAt: 0.42, fmt: 'jpg' }
];

async function derivatives(buf, meta, face) {
  const out = [];
  for (const v of VARIANTS) {
    const box = cropBox(meta.width, meta.height, face, v.w / v.h, v.faceFrac, v.yAt);
    const scale = v.w / box.width;
    if (scale > 1.3 && v.name !== 'thumb') { if (v.name === 'wide') continue; return { ok: false, reason: `too_small_for_${v.name}` }; }
    let img = sharp(buf).rotate().extract(box).resize(v.w, v.h, { fit: 'cover' });
    img = v.fmt === 'jpg' ? img.jpeg({ quality: 84, mozjpeg: true }) : img.webp({ quality: 80 });
    out.push({ ...v, box, data: await img.toBuffer() });
  }
  return { ok: true, files: out };
}

async function put(key, data) {
  const r = await fetch(`${INGEST}/v1/media?key=${encodeURIComponent(key)}`, { method: 'PUT', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/octet-stream' }, body: data });
  if (!r.ok) throw new Error(`upload ${key} -> ${r.status}`);
}

const report = { run_at: new Date().toISOString(), considered: 0, approved: 0, rejected: {}, license_rejected: 0 };
const cands = await candidates();
report.considered = cands.length;
console.log(`candidates: ${cands.length}`);
const lic = await licenses(cands.map((c) => c.file));
const det = await detector();
try {
  for (const c of cands) {
    const rej = (why) => { report.rejected[why] = (report.rejected[why] || 0) + 1; };
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
    const d = await det.detect(jpg);
    const pick = chooseFace(d);
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
        width: L.width, height: L.height, focal: { face: pick.face, detector: 'mediapipe blaze_face_short_range', rendition_width: meta.width, rendition_height: meta.height },
        identity_evidence: { method: 'wikidata_p18_on_exact_tour_id_match', wikidata: c.qid.external_id, evidence: c.qid.evidence, commons_file: c.file },
        approval: 'approved', verified_at: new Date().toISOString(), derivatives: { ...urls, license_url: L.license_url, version: ver }
      }]);
    }
    report.approved += 1;
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
