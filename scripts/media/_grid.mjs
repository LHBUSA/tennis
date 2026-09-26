import sharp from 'sharp';
const [out, ...files] = process.argv.slice(2);
const W = 720;
const imgs = await Promise.all(files.map(async (f) => { const b = await sharp(f).resize(W).toBuffer(); const m = await sharp(b).metadata(); return { b, h: m.height }; }));
const H = Math.max(...imgs.map((i) => i.h));
await sharp({ create: { width: W * imgs.length + 10 * (imgs.length - 1), height: H, channels: 3, background: '#fff' } }).composite(imgs.map((i, k) => ({ input: i.b, left: k * (W + 10), top: 0 }))).jpeg({ quality: 82 }).toFile(out);
