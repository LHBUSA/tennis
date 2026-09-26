#!/usr/bin/env node
// Brand asset generator — PropBetEdge Tennis (docs/BRAND.md).
//   node scripts/brand/build-assets.mjs
// Court geometry is real (ITF dimensions) projected through a pinhole camera; no tournament marks,
// no tour logos, no textures. Rendered in headless Chrome, derived with sharp. Outputs -> public/brand.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright-core';
import { C, heroSvg } from './court.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'public', 'brand');
const VERSION = '20260926';
fs.mkdirSync(OUT, { recursive: true });

function markSvg(size, { tile = true } = {}) {
  // Icon: court-green tile, white service-box geometry, gold PBE monogram bar
  const s = size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 64 64">
  ${tile ? `<rect width="64" height="64" rx="14" fill="${C.court}"/>` : ''}
  <g fill="none" stroke="${C.line}" stroke-width="2.4" opacity="0.95"><rect x="12" y="10" width="40" height="44" rx="1"/><line x1="12" y1="32" x2="52" y2="32"/><line x1="32" y1="21" x2="32" y2="43"/><line x1="12" y1="21" x2="52" y2="21"/><line x1="12" y1="43" x2="52" y2="43"/></g>
  <circle cx="44" cy="15" r="4.2" fill="${C.gold}"/>
</svg>`;
}

async function render(page, html, W, H) {
  await page.setViewportSize({ width: W, height: H });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style>${fontCss()}</head><body>${html}</body></html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: W, height: H } });
}

function fontCss() {
  const f = (file) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, 'public', 'fonts', file)).toString('base64')})`;
  return `<style>
  @font-face{font-family:BC;font-weight:800;src:${f('barlow-condensed-latin-2515494e8c.woff2')}}
  @font-face{font-family:BC;font-weight:600;src:${f('barlow-condensed-latin-215a93c696.woff2')}}
  @font-face{font-family:IN;font-weight:600;src:${f('inter-latin-3100e775e8.woff2')}}</style>`;
}

const logoData = (file) => `data:image/png;base64,${fs.readFileSync(path.join('D:/Workers/propbetedge-news-site/public/logo', file)).toString('base64')}`;

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const written = [];
const save = async (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); written.push(`${name} ${(buf.length / 1024).toFixed(0)}KB`); };
try {
  // 1. hero master 2400x1350 -> avif/webp at 2400/1600/1200 + mobile portrait crop 900x1200
  const heroPng = await render(page, heroSvg(2400, 1350), 2400, 1350);
  await save('tennis-hero-master-2400x1350.png', await sharp(heroPng).png({ compressionLevel: 9 }).toBuffer());
  for (const w of [2400, 1600, 1200]) {
    const h = Math.round((w * 1350) / 2400);
    await save(`tennis-hero-${w}.avif`, await sharp(heroPng).resize(w, h).avif({ quality: 50 }).toBuffer());
    await save(`tennis-hero-${w}.webp`, await sharp(heroPng).resize(w, h).webp({ quality: 72 }).toBuffer());
  }
  const mobile = await sharp(heroPng).extract({ left: 1000, top: 0, width: 1012, height: 1350 }).resize(900, 1200).toBuffer();
  await save('tennis-hero-mobile-900x1200.avif', await sharp(mobile).avif({ quality: 48 }).toBuffer());
  await save('tennis-hero-mobile-900x1200.webp', await sharp(mobile).webp({ quality: 70 }).toBuffer());

  // 2. generic social card 1200x630 PNG RGB
  const og = `<div style="position:relative;width:1200px;height:630px;overflow:hidden;font-family:IN">
    <div style="position:absolute;inset:0">${heroSvg(1200, 630).replace('<svg ', '<svg style="display:block" ')}</div>
    <div style="position:absolute;left:64px;top:62px;display:flex;align-items:center;gap:20px">
      <img src="${logoData('pbe-mark-240.png')}" style="height:74px"/>
      <div style="width:2px;height:58px;background:rgba(243,246,241,.35)"></div>
      <div style="font:800 34px/1 BC;letter-spacing:.2em;color:${C.gold}">TENNIS</div>
    </div>
    <div style="position:absolute;left:64px;top:214px;font:800 96px/0.92 BC;color:#f3f6f1;letter-spacing:.01em">PROPBETEDGE<br>TENNIS</div>
    <div style="position:absolute;left:66px;top:410px;font:800 34px/1 BC;letter-spacing:.14em;color:${C.gold}">LIVE TENNIS INTELLIGENCE</div>
    <div style="position:absolute;left:66px;top:462px;font:600 21px/1.2 IN;letter-spacing:.06em;color:rgba(243,246,241,.86)">MATCH DATA • PLAYER DNA • RANKINGS • HEAD-TO-HEAD</div>
    <div style="position:absolute;left:66px;bottom:54px;font:600 22px/1 IN;color:rgba(243,246,241,.7)">tennis.propbetedge.ai</div>
  </div>`;
  const ogPng = await render(page, og, 1200, 630);
  await save(`propbetedge-tennis-1200x630.png`, await sharp(ogPng).flatten({ background: C.night }).removeAlpha().png({ compressionLevel: 9 }).toBuffer());
  await save(`propbetedge-tennis-1200x630.jpg`, await sharp(ogPng).flatten({ background: C.night }).jpeg({ quality: 88, mozjpeg: true }).toBuffer());

  // 3. icons: tile mark (favicon svg, png sizes, ico), PBE-mark app icons on court green
  fs.writeFileSync(path.join(ROOT, 'public', 'favicon.svg'), markSvg(64));
  const icon = async (px) => sharp(Buffer.from(markSvg(px))).resize(px, px).png().toBuffer();
  for (const px of [16, 32, 48]) await save(`favicon-${px}.png`, await icon(px));
  const app = async (px) => {
    const html = `<div style="width:${px}px;height:${px}px;background:${C.court};display:grid;place-items:center;position:relative;overflow:hidden">
      <div style="position:absolute;inset:${px * 0.1}px;border:${Math.max(2, px / 64)}px solid rgba(243,246,241,.22);border-radius:${px * 0.04}px"></div>
      <div style="position:absolute;left:${px * 0.1}px;right:${px * 0.1}px;top:50%;height:${Math.max(2, px / 64)}px;background:rgba(243,246,241,.22)"></div>
      <img src="${logoData('pbe-mark-240.png')}" style="width:${px * 0.8}px;position:relative"/></div>`;
    return sharp(await render(page, html, px, px)).removeAlpha().png().toBuffer();
  };
  await save('apple-touch-icon.png', await app(180));
  await save('icon-192.png', await app(192));
  await save('icon-512.png', await app(512));
  await save('icon-maskable-512.png', await app(512));
  // ICO with embedded PNGs (16/32/48)
  const pngs = await Promise.all([16, 32, 48].map(icon));
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach((b, i) => { const sz = [16, 32, 48][i]; const o = 6 + 16 * i; head.writeUInt8(sz, o); head.writeUInt8(sz, o + 1); head.writeUInt8(0, o + 2); head.writeUInt8(0, o + 3); head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(b.length, o + 8); head.writeUInt32LE(off, o + 12); off += b.length; });
  fs.writeFileSync(path.join(ROOT, 'public', 'favicon.ico'), Buffer.concat([head, ...pngs]));
  written.push('favicon.ico');

  // 4. header logo: approved PBE mark, webp 1x/2x (never redrawn)
  for (const [h, name] of [[40, 'pbe-mark-40'], [80, 'pbe-mark-80']]) await save(`${name}.webp`, await sharp(path.join('D:/Workers/propbetedge-news-site/public/logo', 'pbe-mark-240.png')).resize({ height: h }).webp({ quality: 88 }).toBuffer());
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), `${JSON.stringify({
  name: 'PropBetEdge Tennis', short_name: 'PBE Tennis', description: 'Live tennis intelligence, player analytics and match data from PropBetEdge.',
  start_url: '/', scope: '/', display: 'standalone', background_color: '#f6f5f0', theme_color: '#0f4d38',
  icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }]
}, null, 2)}\n`);
console.log(`brand v${VERSION}:\n  ${written.join('\n  ')}`);
