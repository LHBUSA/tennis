// Shared photo-pipeline steps (docs/MEDIA.md): Commons license lookup, face detection (MediaPipe BlazeFace, local
// model, headless Chrome), single-dominant-face rule, crops/derivatives and the admin upload. Used by photos.mjs (the
// Wikidata-P18 sweep) and queue.mjs (the newsroom/coverage media queue) — ONE implementation of the rules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const UA = 'PropBetEdge-Tennis-Media/0.1 (+https://tennis.propbetedge.ai/credits)';
export const INGEST = 'https://tennis-ingest.sales-fd3.workers.dev';
export const API = 'https://tennis-api.propbetedge.ai';
export const OK_LICENSE = /^(cc0|public domain|pd|cc by(-sa)?( \d(\.\d)?)?)$/i;
/** Licence accepted for publication: CC0 / PD / CC BY / CC BY-SA, never NC/ND. */
export const licenseOk = (l) => OK_LICENSE.test(l || '') && !/\bnc\b|\bnd\b|non-?commercial|no-?deriv/i.test(l || '');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ADMIN = null;
const admin = () => (ADMIN ??= fs.readFileSync('D:/Workers/secrets/tennis-ingest-admin-token', 'utf8').trim());

// ---- Commons license, 50 titles per request ---------------------------------------------------------
export async function licenses(files) {
  const out = new Map();
  for (let i = 0; i < files.length; i += 50) {
    const titles = files.slice(i, i + 50).map((f) => `File:${f}`).join('|');
    const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=2400&iiextmetadatafilter=LicenseShortName|Artist|LicenseUrl|Credit&titles=${encodeURIComponent(titles)}`;
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
export async function detector() {
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

export function chooseFace(res) {
  const faces = res.faces.filter((f) => f.score >= 0.6).sort((a, b) => b.w * b.h - a.w * a.h);
  if (!faces.length) return { ok: false, reason: 'no_face' };
  const [f, next] = faces;
  if (next && f.w * f.h < 2.5 * next.w * next.h) return { ok: false, reason: 'multiple_faces' };
  if (f.score < 0.75) return { ok: false, reason: 'low_confidence' };
  if (f.w < res.w * 0.05) return { ok: false, reason: 'face_too_small' };
  return { ok: true, face: f };
}

export async function tiledDetect(det, jpg, meta) {
  const W = meta.width;
  const H = meta.height;
  const size = Math.round(Math.min(W, H) * 0.5);
  const faces = [];
  for (const fy of [0, 0.2, 0.4]) {
    for (const fx of [0, 0.25, 0.5]) {
      const left = Math.round((W - size) * (fx / 0.5));
      const top = Math.round(Math.min(H - size, H * fy));
      if (left < 0 || top < 0 || left + size > W || top + size > H) continue;
      const tile = await sharp(jpg).extract({ left, top, width: size, height: size }).resize(1024, 1024).jpeg({ quality: 92 }).toBuffer();
      const r = await det.detect(tile);
      const k = size / 1024;
      for (const f of r.faces) faces.push({ x: left + f.x * k, y: top + f.y * k, w: f.w * k, h: f.h * k, score: f.score });
    }
  }
  // de-duplicate the same face seen in overlapping tiles (IoU > 0.3), keeping the most confident
  const uniq = [];
  for (const f of faces.sort((a, b) => b.score - a.score)) {
    const iou = (a) => { const ix = Math.max(0, Math.min(a.x + a.w, f.x + f.w) - Math.max(a.x, f.x)); const iy = Math.max(0, Math.min(a.y + a.h, f.y + f.h) - Math.max(a.y, f.y)); const inter = ix * iy; return inter / (a.w * a.h + f.w * f.h - inter); };
    if (!uniq.some((u) => iou(u) > 0.3)) uniq.push(f);
  }
  return { w: W, h: H, faces: uniq };
}

// crop box around the face: faceFrac = face height / crop height; face center placed at `yAt` of crop
export function cropBox(W, H, f, aspect, faceFrac, yAt) {
  let ch = Math.min(f.h / faceFrac, H);
  let cw = ch * aspect;
  if (cw > W) { cw = W; ch = cw / aspect; }
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  let left = Math.round(cx - cw / 2);
  let top = Math.round(cy - ch * yAt);
  left = Math.max(0, Math.min(left, W - cw));
  top = Math.max(0, Math.min(top, H - ch));
  // clamp AFTER rounding: a box may never extend past the image edge (sharp extract_area error)
  const L = Math.max(0, Math.round(left));
  const T = Math.max(0, Math.round(top));
  return { left: L, top: T, width: Math.min(Math.round(cw), W - L), height: Math.min(Math.round(ch), H - T) };
}

export const VARIANTS = [
  { name: 'portrait', w: 600, h: 750, faceFrac: 0.3, yAt: 0.36, fmt: 'webp' },
  { name: 'square', w: 400, h: 400, faceFrac: 0.38, yAt: 0.42, fmt: 'webp' },
  { name: 'thumb', w: 128, h: 128, faceFrac: 0.5, yAt: 0.45, fmt: 'webp' },
  { name: 'wide', w: 1200, h: 675, faceFrac: 0.4, yAt: 0.42, fmt: 'webp' },
  { name: 'square', w: 400, h: 400, faceFrac: 0.38, yAt: 0.42, fmt: 'jpg' }
];

export async function derivatives(buf, meta, face) {
  const out = [];
  for (const v of VARIANTS) {
    const box = cropBox(meta.width, meta.height, face, v.w / v.h, v.faceFrac, v.yAt);
    const scale = v.w / box.width;
    // circles need square + thumb; portrait and wide are optional (the UI falls back to square). No upscaling
    // past 1.3x for anything we publish.
    if (scale > 1.3 && v.name !== 'thumb') { if (v.name === 'wide' || v.name === 'portrait') continue; return { ok: false, reason: `too_small_for_${v.name}` }; }
    let img = sharp(buf).rotate().extract(box).resize(v.w, v.h, { fit: 'cover' });
    img = v.fmt === 'jpg' ? img.jpeg({ quality: 84, mozjpeg: true }) : img.webp({ quality: 80 });
    out.push({ ...v, box, data: await img.toBuffer() });
  }
  return { ok: true, files: out };
}

export async function put(key, data) {
  const r = await fetch(`${INGEST}/v1/media?key=${encodeURIComponent(key)}`, { method: 'PUT', headers: { authorization: `Bearer ${admin()}`, 'content-type': 'application/octet-stream' }, body: data });
  if (!r.ok) throw new Error(`upload ${key} -> ${r.status}`);
}

