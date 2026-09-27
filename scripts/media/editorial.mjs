#!/usr/bin/env node
// Editorial media pipeline (docs/MEDIA.md, "Editorial media"). Identity photos (headshots) and editorial
// photos (action, courts, venues) are different products: this builds the editorial catalog only.
//
//   node scripts/media/editorial.mjs [--dry]
//
// APPROVED below is a human visual review, recorded in code: each entry is one Commons file a reviewer
// looked at and classified (type, what it shows, focal point, where it may be used). For every entry the
// script re-verifies from Commons at build time — license (CC0 / PD / CC BY / CC BY-SA only), author,
// size — and the people it depicts from the file's structured data (P180), mapped to canonical players
// ONLY through the exact Wikidata crosswalk (tennis_player_external_ids provider=wikidata). A person the
// file depicts who has no canonical profile is never named. Venue/edition claims come from the file's
// structured data / category and are recorded as evidence.
// Output: R2 tennis-media editorial/<id>/* derivatives + data/media/editorial-media.json (committed).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { storeFromEnv, inList } from '../../workers/shared/store/postgrest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UA = 'PropBetEdge-Tennis-Media/0.1 (+https://tennis.propbetedge.ai/credits)';
const INGEST = 'https://tennis-ingest.sales-fd3.workers.dev';
const API = 'https://tennis-api.propbetedge.ai';
const OK_LICENSE = /^(cc0|public domain|pd|cc by(-sa)?( \d(\.\d)?)?)$/i;
const DRY = process.argv.includes('--dry');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const envText = fs.readFileSync('D:/Workers/secrets/ufc-propbetedge.env', 'utf8').replace(/^\uFEFF/, '');
const g = (k) => (envText.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const store = storeFromEnv({ TENNIS_MODEL_SUPABASE_URL: g('SUPABASE_URL'), TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY: g('SUPABASE_SERVICE_ROLE_KEY') });
const ADMIN = fs.readFileSync('D:/Workers/secrets/tennis-ingest-admin-token', 'utf8').trim();

// type: match_action | player_action | court | venue | tournament_atmosphere (portraits live in the identity store).
// tournaments: tournament slugs the image represents. edition { slug, year }: ONLY when the file title/category names
// that edition. event: where a file photo of a player was taken (never shown for another tournament).
// prefer: reviewer's visual preference inside a tier (e.g. the wide arena shot over a tight single-player crop).
export const APPROVED = [
  { file: 'Carlos Alcaraz serving while playing Jan-Lennard Struff (Wimbledon 2025).jpg', type: 'match_action', tournaments: ['wimbledon'], edition: { slug: 'wimbledon', year: 2025 }, surface: 'grass', focal: { x: 0.55, y: 0.45 }, shows: 'a serve on grass at the 2025 Championships', reviewed: 'visual review 2026-09-27' },
  { file: 'Ballboys and girls Wimbledon 2025.jpg', type: 'tournament_atmosphere', tournaments: ['wimbledon'], edition: { slug: 'wimbledon', year: 2025 }, surface: 'grass', focal: { x: 0.5, y: 0.5 }, shows: 'ball boys and girls on the grounds at the 2025 Championships', reviewed: 'visual review 2026-09-27' },
  { file: 'Leylah Fernandez plays a doubles match with Ena Shibahara.jpg', type: 'match_action', tournaments: ['wimbledon'], edition: { slug: 'wimbledon', year: 2024 }, surface: 'grass', focal: { x: 0.45, y: 0.5 }, shows: 'a doubles match at the 2024 Championships', reviewed: 'visual review 2026-09-27' },
  { file: 'Wimbledon - geograph.org.uk - 7811790.jpg', type: 'tournament_atmosphere', tournaments: ['wimbledon'], edition: { slug: 'wimbledon', year: 2024 }, surface: 'grass', focal: { x: 0.5, y: 0.5 }, shows: 'the grounds at the 2024 Championships', reviewed: 'visual review 2026-09-27' },
  { file: 'Fed backhand in the 2019 Wimbledon final.png', type: 'match_action', tournaments: ['wimbledon'], edition: { slug: 'wimbledon', year: 2019 }, surface: 'grass', focal: { x: 0.5, y: 0.5 }, shows: 'the 2019 gentlemen’s singles final on Centre Court', reviewed: 'visual review 2026-09-27' },
  { file: 'Djoko Humbert 2019.png', type: 'match_action', tournaments: ['wimbledon'], edition: { slug: 'wimbledon', year: 2019 }, surface: 'grass', focal: { x: 0.5, y: 0.5 }, shows: 'a 2019 Championships match on Centre Court', reviewed: 'visual review 2026-09-27' },
  { file: 'Wimbledon doubles final 2019.png', type: 'match_action', tournaments: ['wimbledon'], edition: { slug: 'wimbledon', year: 2019 }, surface: 'grass', focal: { x: 0.5, y: 0.5 }, shows: 'the 2019 ladies’ doubles final on Centre Court', reviewed: 'visual review 2026-09-27' },
  { file: 'Far shot of Wimbledon Centre Court.jpg', type: 'venue', tournaments: ['wimbledon'], surface: 'grass', focal: { x: 0.5, y: 0.55 }, shows: 'Centre Court, Wimbledon', reviewed: 'visual review 2026-09-27' },
  { file: 'Right side of Centre Court, Wimbledon.jpg', type: 'venue', tournaments: ['wimbledon'], surface: 'grass', focal: { x: 0.45, y: 0.55 }, shows: 'Centre Court, Wimbledon', reviewed: 'visual review 2026-09-27' },
  { file: 'Court 14 at Wimbledon.jpg', type: 'court', tournaments: ['wimbledon'], surface: 'grass', focal: { x: 0.5, y: 0.6 }, shows: 'Court 14, Wimbledon', reviewed: 'visual review 2026-09-27' },
  { file: 'Wimbledon Court 18.jpg', type: 'court', tournaments: ['wimbledon'], surface: 'grass', focal: { x: 0.5, y: 0.6 }, shows: 'Court 18, Wimbledon', reviewed: 'visual review 2026-09-27' },
  { file: 'Court Philippe Chatrier - 1er tour de Roland Garros 2010 - tennis french open.jpg', type: 'tournament_atmosphere', tournaments: ['roland-garros'], edition: { slug: 'roland-garros', year: 2010 }, surface: 'clay', focal: { x: 0.5, y: 0.5 }, shows: 'Court Philippe-Chatrier during the first round of Roland-Garros 2010', reviewed: 'visual review 2026-09-27' },
  { file: 'Court Philippe Chatrier, 2011 Roland Garros.jpg', type: 'tournament_atmosphere', tournaments: ['roland-garros'], edition: { slug: 'roland-garros', year: 2011 }, surface: 'clay', focal: { x: 0.5, y: 0.6 }, shows: 'Court Philippe-Chatrier during Roland-Garros 2011', reviewed: 'visual review 2026-09-27' },
  { file: 'Court Philippe Chatrier 2023 cropped.jpg', type: 'court', tournaments: ['roland-garros'], surface: 'clay', focal: { x: 0.5, y: 0.6 }, shows: 'Court Philippe-Chatrier', reviewed: 'visual review 2026-09-27' },
  { file: 'Court Philippe Chatrier 2024.jpg', type: 'court', tournaments: ['roland-garros'], surface: 'clay', focal: { x: 0.5, y: 0.6 }, shows: 'Court Philippe-Chatrier', reviewed: 'visual review 2026-09-27' },
  { file: 'Court Philippe Chatrier May 30th 2013.jpg', type: 'court', tournaments: ['roland-garros'], surface: 'clay', focal: { x: 0.5, y: 0.62 }, shows: 'Court Philippe-Chatrier', reviewed: 'visual review 2026-09-27' },
  { file: 'ChatrierVide.JPG', type: 'venue', tournaments: ['roland-garros'], surface: 'clay', focal: { x: 0.5, y: 0.6 }, shows: 'Court Philippe-Chatrier', reviewed: 'visual review 2026-09-27' },
  { file: 'Świątek Yuan AO26 R1.jpg', type: 'match_action', tournaments: ['australian-open'], edition: { slug: 'australian-open', year: 2026 }, surface: 'hard', focal: { x: 0.5, y: 0.55 }, prefer: 1, shows: 'a first-round match in Rod Laver Arena at the 2026 Australian Open', reviewed: 'visual review 2026-09-27' },
  { file: 'Martínez AO26 R1.jpg', type: 'match_action', tournaments: ['australian-open'], edition: { slug: 'australian-open', year: 2026 }, surface: 'hard', focal: { x: 0.5, y: 0.45 }, shows: 'a first-round match at the 2026 Australian Open', reviewed: 'visual review 2026-09-27' },
  { file: 'Rod Laver Arena before the 2025 Australian Open Women\'s Doubles Final - 26 January 2025.jpg', type: 'tournament_atmosphere', tournaments: ['australian-open'], edition: { slug: 'australian-open', year: 2025 }, surface: 'hard', focal: { x: 0.5, y: 0.6 }, shows: 'Rod Laver Arena before the 2025 women’s doubles final', reviewed: 'visual review 2026-09-27' },
  { file: '1573 Arena during the 2025 Australian Open - 21 January 2025.jpg', type: 'court', tournaments: ['australian-open'], edition: { slug: 'australian-open', year: 2025 }, surface: 'hard', focal: { x: 0.5, y: 0.6 }, shows: '1573 Arena during the 2025 Australian Open', reviewed: 'visual review 2026-09-27' },
  { file: 'Legends Doubles Final at Margaret Court Arena during the 2023 Australian Open (52679820676).jpg', type: 'tournament_atmosphere', tournaments: ['australian-open'], edition: { slug: 'australian-open', year: 2023 }, surface: 'hard', focal: { x: 0.5, y: 0.6 }, shows: 'the legends doubles final in Margaret Court Arena, 2023 Australian Open', reviewed: 'visual review 2026-09-27' },
  { file: 'Margaret Court Arena (Australian Open 2017).jpg', type: 'court', tournaments: ['australian-open'], edition: { slug: 'australian-open', year: 2017 }, surface: 'hard', focal: { x: 0.5, y: 0.6 }, shows: 'Margaret Court Arena at the 2017 Australian Open', reviewed: 'visual review 2026-09-27' },
  { file: 'Australian Open 2015 (15804548103).jpg', type: 'tournament_atmosphere', tournaments: ['australian-open'], edition: { slug: 'australian-open', year: 2015 }, surface: 'hard', focal: { x: 0.5, y: 0.6 }, shows: 'the trophy ceremony in Rod Laver Arena, 2015 Australian Open', reviewed: 'visual review 2026-09-27' },
  { file: 'Australian Open 2015 (15779711323).jpg', type: 'tournament_atmosphere', tournaments: ['australian-open'], edition: { slug: 'australian-open', year: 2015 }, surface: 'hard', focal: { x: 0.55, y: 0.6 }, shows: 'Rod Laver Arena during the 2015 Australian Open', reviewed: 'visual review 2026-09-27' },
  { file: 'Australian Open 2015 (16213838877).jpg', type: 'tournament_atmosphere', tournaments: ['australian-open'], edition: { slug: 'australian-open', year: 2015 }, surface: 'hard', focal: { x: 0.5, y: 0.65 }, shows: 'Rod Laver Arena during the 2015 Australian Open', reviewed: 'visual review 2026-09-27' },
  { file: 'Australian Open 2020 (49837295546).jpg', type: 'tournament_atmosphere', tournaments: ['australian-open'], edition: { slug: 'australian-open', year: 2020 }, surface: 'hard', focal: { x: 0.5, y: 0.6 }, shows: 'Rod Laver Arena during the 2020 Australian Open', reviewed: 'visual review 2026-09-27' },
  { file: '2017-01 Rod Laver Arena.jpg', type: 'venue', tournaments: ['australian-open'], surface: 'hard', focal: { x: 0.5, y: 0.6 }, shows: 'Rod Laver Arena, Melbourne', reviewed: 'visual review 2026-09-27' },
  { file: 'Aryna Sabalenka vs. Qinwen Zheng in a quarterfinals of the 2024 US Open - 03.jpg', type: 'match_action', tournaments: ['us-open'], edition: { slug: 'us-open', year: 2024 }, surface: 'hard', focal: { x: 0.5, y: 0.5 }, shows: 'a 2024 US Open quarterfinal', reviewed: 'visual review 2026-09-27' },
  { file: 'Aryna Sabalenka & Jessica Pegula US Open Final 2024.jpg', type: 'tournament_atmosphere', tournaments: ['us-open'], edition: { slug: 'us-open', year: 2024 }, surface: 'hard', focal: { x: 0.5, y: 0.35 }, shows: 'the 2024 US Open women’s final ceremony', reviewed: 'visual review 2026-09-27' },
  { file: 'Jabeur vs. Osorio (2023 US Open) 01.jpg', type: 'match_action', tournaments: ['us-open'], edition: { slug: 'us-open', year: 2023 }, surface: 'hard', focal: { x: 0.5, y: 0.55 }, shows: 'a 2023 US Open match in Louis Armstrong Stadium', reviewed: 'visual review 2026-09-27' },
  { file: '2021 US Open Armstrong Sabalenka v. Krejčíková quarter far.JPG', type: 'match_action', tournaments: ['us-open'], edition: { slug: 'us-open', year: 2021 }, surface: 'hard', focal: { x: 0.5, y: 0.6 }, shows: 'a 2021 US Open quarterfinal in Louis Armstrong Stadium', reviewed: 'visual review 2026-09-27' },
  { file: '2021 US Open Armstrong Sabalenka v. Krejčíková quarter near.jpg', type: 'match_action', tournaments: ['us-open'], edition: { slug: 'us-open', year: 2021 }, surface: 'hard', focal: { x: 0.5, y: 0.55 }, shows: 'a 2021 US Open quarterfinal in Louis Armstrong Stadium', reviewed: 'visual review 2026-09-27' },
  { file: '2021 US Open, Day 18.jpg', type: 'tournament_atmosphere', tournaments: ['us-open'], edition: { slug: 'us-open', year: 2021 }, surface: 'hard', focal: { x: 0.5, y: 0.6 }, shows: 'Arthur Ashe Stadium during the 2021 US Open', reviewed: 'visual review 2026-09-27' },
  { file: '2021 US Open, Day 14.jpg', type: 'tournament_atmosphere', tournaments: ['us-open'], edition: { slug: 'us-open', year: 2021 }, surface: 'hard', focal: { x: 0.5, y: 0.5 }, shows: 'the grounds during the 2021 US Open', reviewed: 'visual review 2026-09-27' },
  { file: 'Arthur Ashe Stadium US Open 2008.jpg', type: 'tournament_atmosphere', tournaments: ['us-open'], edition: { slug: 'us-open', year: 2008 }, surface: 'hard', focal: { x: 0.5, y: 0.55 }, shows: 'Arthur Ashe Stadium during the 2008 US Open', reviewed: 'visual review 2026-09-27' },
  { file: 'Arthur Ashe Stadium 2010.jpg', type: 'court', tournaments: ['us-open'], surface: 'hard', focal: { x: 0.5, y: 0.6 }, shows: 'Arthur Ashe Stadium', reviewed: 'visual review 2026-09-27' },
  { file: '2019 USTA NTC Court 4 and Ashe at sunset.jpg', type: 'venue', tournaments: ['us-open'], surface: 'hard', focal: { x: 0.5, y: 0.5 }, shows: 'Arthur Ashe Stadium at sunset', reviewed: 'visual review 2026-09-27' },
  { file: '2017 Citi Open Tennis Skylar Morton, Alana Smith (36167836851).jpg', type: 'player_action', tournaments: [], event: { slug: 'citi-open', year: 2017 }, surface: 'hard', focal: { x: 0.6, y: 0.22 }, shows: 'handshake at the net after a doubles match, 2017 Citi Open', reviewed: 'visual review 2026-09-27' },
  { file: 'Ellen Perez and Nicole Melichar-Martinez (2023 DC Open) 07.jpg', type: 'player_action', tournaments: [], event: { slug: 'citi-open', year: 2023 }, surface: 'hard', focal: { x: 0.5, y: 0.45 }, shows: 'celebrating on court at the 2023 DC Open', reviewed: 'visual review 2026-09-27' },
];

const api = async (p) => { await sleep(600); return (await fetch('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', ...p }), { headers: { 'user-agent': UA } })).json(); };
const strip = (x) => String(x?.value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const slugId = (t) => t.replace(/\.[a-z]+$/i, '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function upload(key, data) {
  if (DRY) return;
  const r = await fetch(`${INGEST}/v1/media?key=${encodeURIComponent(key)}`, { method: 'PUT', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/octet-stream' }, body: data });
  if (!r.ok) throw new Error(`upload ${key}: ${r.status} ${await r.text()}`);
}

/** Crop to aspect around the focal point, never upscale. */
async function crop(buf, meta, aspect, width, focal) {
  let w = meta.width;
  let h = Math.round(w / aspect);
  if (h > meta.height) { h = meta.height; w = Math.round(h * aspect); }
  const left = Math.max(0, Math.min(meta.width - w, Math.round(focal.x * meta.width - w / 2)));
  const top = Math.max(0, Math.min(meta.height - h, Math.round(focal.y * meta.height - h / 2)));
  const outW = Math.min(width, w);
  return sharp(buf).extract({ left, top, width: w, height: h }).resize(outW, Math.round(outW / aspect));
}

const qmap = new Map();
for (let off = 0; ; off += 1000) {
  const r = await store.select('tennis_player_external_ids', `select=pbe_player_id,external_id&provider=eq.wikidata&order=pbe_player_id.asc,external_id.asc&limit=1000&offset=${off}`);
  for (const x of r) qmap.set(x.external_id, x.pbe_player_id);
  if (r.length < 1000) break;
}

const items = [];
for (const a of APPROVED) {
  const title = `File:${a.file}`;
  const q = await api({ action: 'query', titles: title, prop: 'imageinfo|info', iiprop: 'size|url|extmetadata', iiurlwidth: 2400, iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|DateTimeOriginal' });
  const page = Object.values(q.query.pages)[0];
  const ii = page.imageinfo?.[0];
  if (!ii) { console.log('SKIP (missing)', a.file); continue; }
  const m = ii.extmetadata || {};
  const license = strip(m.LicenseShortName);
  if (!OK_LICENSE.test(license) || /\bnc\b|\bnd\b/i.test(license)) { console.log('SKIP (license)', a.file, license); continue; }
  const e = await api({ action: 'wbgetentities', ids: `M${page.pageid}` });
  const ent = Object.values(e.entities || {})[0] || {};
  const depictsQ = (ent.statements?.P180 || []).map((s) => s.mainsnak?.datavalue?.value?.id).filter(Boolean);
  const players = depictsQ.map((qid) => qmap.get(qid)).filter(Boolean);
  const pr = players.length ? await store.select('tennis_players', `select=pbe_player_id,slug,full_name&pbe_player_id=${inList(players)}`) : [];
  const id = slugId(a.file);
  await sleep(600);
  const buf = Buffer.from(await (await fetch(ii.thumburl || ii.url, { headers: { 'user-agent': UA } })).arrayBuffer());
  const meta = await sharp(buf).metadata();
  const derivatives = {};
  const put = async (name, pipeline, fmt) => {
    const data = fmt === 'jpg' ? await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer() : await pipeline.webp({ quality: 78 }).toBuffer();
    const key = `editorial/${id}/${name}.${fmt}`;
    await upload(key, data);
    // content-hash version: derivatives are served immutable, so a re-crop must change the URL
    derivatives[name] = { url: `${API}/media/${key}?v=${crypto.createHash('sha1').update(data).digest('hex').slice(0, 10)}`, bytes: data.length };
  };
  for (const w of [2400, 1600, 1200, 800, 480]) if (w <= meta.width) await put(`wide-${w}`, await crop(buf, meta, 16 / 9, w, a.focal), 'webp');
  for (const w of [1200, 800]) if (w <= meta.width) await put(`std-${w}`, await crop(buf, meta, 4 / 3, w, a.focal), 'webp');
  await put('card', await crop(buf, meta, 1200 / 630, 1200, a.focal), 'jpg');
  const names = pr.map((p) => p.full_name);
  items.push({
    id, type: a.type, title: a.file, source_page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    author: strip(m.Artist) || null, license, license_url: strip(m.LicenseUrl) || null, credit: `${strip(m.Artist) || 'Unknown author'} / ${license} / Wikimedia Commons`,
    date: strip(m.DateTimeOriginal) || null, width: meta.width, height: meta.height,
    shows: a.shows, caption: names.length ? (a.type === 'venue' ? `${a.shows} (${names.join(', ')} on court)` : `${names.join(', ')} — ${a.shows}`) : a.shows,
    player_ids: pr.map((p) => p.pbe_player_id), player_slugs: pr.map((p) => p.slug), depicts_wikidata: depictsQ,
    tournaments: a.tournaments, edition: a.edition || null, event: a.event || a.edition || null, match_id: null, surface: a.surface, venue_dominant: !!a.venue_dominant,
    focal: a.focal, prefer: a.prefer || 0, derivatives, reviewed: a.reviewed, verified_at: new Date().toISOString()
  });
  console.log('OK', id, a.type, license, `${meta.width}x${meta.height}`, names.join(', ') || '(no canonical person)');
}
const out = { version: 1, generated_at: new Date().toISOString(), policy: 'docs/MEDIA.md — editorial media: licensed Commons files, human visual review, identity only via the exact Wikidata crosswalk', items };
fs.writeFileSync(path.join(ROOT, 'data/media/editorial-media.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`editorial catalog: ${items.length} items -> data/media/editorial-media.json${DRY ? ' (dry: nothing uploaded)' : ''}`);
