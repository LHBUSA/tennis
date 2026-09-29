import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = []; const netf = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 150)));
p.on('requestfailed', (r) => netf.push(r.url().slice(0, 120) + ' ' + r.failure()?.errorText));
const snap = async (tag) => {
  await p.waitForTimeout(7000);
  const r = await p.evaluate(() => ({
    url: location.pathname,
    tabs: [...document.querySelectorAll('a[aria-current], [role=tab][aria-selected=true], .tab.active, a.on')].map((a) => `${a.textContent.trim()}|${a.getAttribute('aria-current') || ''}|${a.getAttribute('href')}`),
    h2: [...document.querySelectorAll('#main h2')].map((h) => h.textContent.trim().replace(/\s+/g, ' ')),
    h3: [...document.querySelectorAll('#main h3')].map((h) => h.textContent.trim().replace(/\s+/g, ' ')),
    dnaTabs: [...document.querySelectorAll('#main a')].filter((a) => /Tennis DNA|Overview/.test(a.textContent)).map((a) => `${a.textContent.trim()}->${a.getAttribute('href')} cur=${a.getAttribute('aria-current')}`).slice(0, 6)
  }));
  await p.screenshot({ path: `qa-artifacts/dna-parity/repro-${tag}.png`, fullPage: true });
  console.log(tag, JSON.stringify(r, null, 1));
};
await p.goto('https://tennis.propbetedge.ai/players/carlos-alcaraz', { waitUntil: 'load' });
await snap('carlos-overview');
const tab = p.locator('#main a', { hasText: /^Tennis DNA$/ }).first();
console.log('tab count', await p.locator('#main a', { hasText: /^Tennis DNA$/ }).count());
await tab.click();
await snap('carlos-after-click');
console.log('errs', errs, 'netfail', netf.filter((x) => !/google/.test(x)));
await b.close();
