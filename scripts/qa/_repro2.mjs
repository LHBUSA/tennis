import fs from 'node:fs'; globalThis.__fs = fs;
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
for (const slug of process.argv.slice(2)) {
  await p.goto(`https://tennis.propbetedge.ai/players/${slug}/dna`, { waitUntil: 'load' }); await p.waitForTimeout(8000);
  const t = await p.evaluate(() => (document.querySelector('#main')).innerText);
  require_fs().writeFileSync(`qa-artifacts/dna-parity/text-${slug}.txt`, t);
  await p.screenshot({ path: `qa-artifacts/dna-parity/repro-${slug}-dna.png`, fullPage: true });
  console.log(slug, t.length);
}
function require_fs() { return globalThis.__fs; }
await b.close();
