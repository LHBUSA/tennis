#!/usr/bin/env node
// Candidate ATP tournament ids (CANDIDATES ONLY — never a mapping): en.wikipedia pages that link an
// atptour.com tournament page (/en/tournaments/<slug>/<id>/...), via the MediaWiki exturlusage API (CC BY-SA).
// A candidate becomes a mapping only when the official draw sheet of that id proves an ESPN edition
// (scripts/context/drawsheets.mjs). Output: data/context/atp-candidates.json
import fs from 'node:fs';
const UA = 'PropBetEdgeTennis/1.0 (+https://tennis.propbetedge.ai; data@propbetedge.ai)';
const ids = new Map();
for (const proto of ['https', 'http']) {
  for (const q of ['www.atptour.com/en/tournaments/', 'atptour.com/en/tournaments/']) {
    let cont = null;
    for (let n = 0; n < 40; n += 1) {
      const u = `https://en.wikipedia.org/w/api.php?action=query&list=exturlusage&euquery=${encodeURIComponent(q)}&euprotocol=${proto}&eulimit=500&format=json&eunamespace=0${cont ? `&eucontinue=${cont}` : ''}`;
      const j = await (await fetch(u, { headers: { 'user-agent': UA } })).json();
      for (const x of j.query?.exturlusage || []) {
        const m = x.url.match(/atptour\.com\/en\/tournaments\/([a-z0-9-]+)\/(\d+)\//i);
        if (!m) continue;
        const e = ids.get(m[2]) || { atp_id: m[2], slugs: new Set(), pages: new Set() };
        e.slugs.add(m[1].toLowerCase()); if (e.pages.size < 5) e.pages.add(x.title);
        ids.set(m[2], e);
      }
      cont = j.continue?.eucontinue;
      await new Promise((r) => setTimeout(r, 1000));
      if (!cont) break;
    }
  }
}
const out = [...ids.values()].map((e) => ({ atp_id: e.atp_id, slugs: [...e.slugs], sample_pages: [...e.pages] })).sort((a, b) => Number(a.atp_id) - Number(b.atp_id));
fs.mkdirSync('data/context', { recursive: true });
fs.writeFileSync('data/context/atp-candidates.json', `${JSON.stringify({ generated_at: new Date().toISOString(), source: 'en.wikipedia.org exturlusage (candidates only, never a mapping)', count: out.length, candidates: out }, null, 1)}\n`);
console.log(out.length);
