#!/usr/bin/env node
// Source evidence for `youtube.feed` (official tennis channels, keyless): re-proves every enabled channel in
// data/source-registry/youtube-channels.json — feed <title> + channel id, and the second proof (official-site link,
// Wikidata P2397, or the verified badge) — and records counts only (titles are public; no video bytes).
//   node scripts/evidence/youtube-channels.mjs   -> docs/evidence/youtube-channels-latest.json
import fs from 'node:fs';
import { USER_AGENT } from '../../workers/shared/http.js';
import { parseFeed } from '../../workers/providers/youtube.js';

const reg = JSON.parse(fs.readFileSync('data/source-registry/youtube-channels.json', 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u, accept = 'text/html') => { await sleep(1500); const r = await fetch(u, { headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'en' } }); return { status: r.status, text: await r.text() }; };
const out = [];
for (const c of reg.channels) {
  const feed = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.id}`, 'application/atom+xml');
  const f = parseFeed(feed.text);
  const proofs = { feed_title_match: f.feed_title === c.verification.feed_title && f.channel_id === c.id };
  for (const chk of c.verification.checks.filter((x) => x !== 'feed_title_match')) {
    if (chk === 'verified_badge') { const p = await get(`https://www.youtube.com/channel/${c.id}`); proofs.verified_badge = /BADGE_STYLE_TYPE_VERIFIED/.test(p.text); }
    else if (chk.startsWith('linked_from_official_site:')) {
      const site = chk.slice('linked_from_official_site:'.length).split(' ')[0];
      const s = await get(site);
      const links = [...new Set(s.text.match(/https?:\/\/(?:www\.)?youtube\.com\/[^\s"'<>]+/g) || [])];
      let same = false;
      for (const l of links.slice(0, 3)) { const p = await get(l); if ((p.text.match(/"externalId":"(UC[\w-]{22})"/) || [])[1] === c.id) { same = true; break; } }
      proofs.linked_from_official_site = same;
    } else if (chk.startsWith('wikidata:P2397')) {
      const q = `SELECT ?item WHERE { ?item wdt:P2397 "${c.id}" }`;
      const w = await get(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, 'application/sparql-results+json');
      proofs.wikidata_p2397 = (JSON.parse(w.text).results?.bindings || []).some((b) => /Q300008$/.test(b.item.value));
    }
  }
  const passed = proofs.feed_title_match && Object.values(proofs).filter(Boolean).length >= 2;
  out.push({ handle: c.handle, id: c.id, class: c.class, feed_http: feed.status, feed_title: f.feed_title, entries: f.entries.length, shorts: f.entries.filter((e) => e.is_short).length, proofs, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${c.handle} ${JSON.stringify(proofs)}`);
}
fs.writeFileSync('docs/evidence/youtube-channels-latest.json', JSON.stringify({ generated_at: new Date().toISOString(), source: 'youtube.feed (keyless official channels)', channels: out, all_passed: out.every((x) => x.passed) }, null, 1));
