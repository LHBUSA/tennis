import sharp from 'sharp';
import fs from 'node:fs';
const ids = process.argv.slice(3); const out = process.argv[2];
const W = 400, H = 260, cols = 4;
const tiles = [];
for (const [i, id] of ids.entries()) {
  const img = await sharp(`D:/Temp/claude/ed/p2/${id}.jpg`).resize(W, H, { fit: 'cover' }).toBuffer();
  const label = Buffer.from(`<svg width="${W}" height="30"><rect width="${W}" height="30" fill="black" opacity="0.7"/><text x="8" y="21" font-size="18" fill="white" font-family="Arial">${id}</text></svg>`);
  tiles.push({ input: await sharp(img).composite([{ input: label, top: 0, left: 0 }]).toBuffer(), left: (i % cols) * W, top: Math.floor(i / cols) * H });
}
await sharp({ create: { width: cols * W, height: Math.ceil(ids.length / cols) * H, channels: 3, background: '#222' } }).composite(tiles).jpeg({ quality: 80 }).toFile(out);
