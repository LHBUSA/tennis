#!/usr/bin/env node
// Live UX acceptance (homepage live cards + PBEcast ticker / scoreboard / intelligence rail), in a real browser.
//   npm run build && node scripts/qa/live-ux.mjs                  -> local preview of dist/ (real production tennis-api data)
//   QA_BASE=https://tennis.propbetedge.ai node scripts/qa/live-ux.mjs -> production
// Needs >= 1 match live on /v1/live (a real one is picked; nothing is mocked). Per width: no page overflow; no visible
// native rail scrollbar; every live-card score cell inside its card and set columns aligned between the two rows; names
// truncate instead of pushing scores; PBEcast: the current ticker card is marked and visible on first render, arrows move
// the ticker, wheel / swipe scroll it, auto-advance moves one card and pauses on hover / focus / touch, reduced motion
// disables it; intelligence modules match the API's own events; no console errors. Screenshots -> OUT.
import fs from 'node:fs';
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const API = (process.env.API_BASE || 'https://tennis-api.propbetedge.ai').replace(/\/+$/, '');
const server = process.env.QA_BASE ? null : await preview({ preview: { port: 5196, strictPort: true } });
const WEB = (process.env.QA_BASE || server.resolvedUrls.local[0]).replace(/\/+$/, '');
const OUT = process.env.QA_OUT || (process.env.QA_BASE ? 'docs/evidence/live-ux' : 'qa-artifacts/live-ux');
const WIDTHS = (process.env.QA_WIDTHS || '1440,1024,768,430,390,360,320').split(',').map(Number);
const SHOTS = new Set([1440, 1024, 430, 390, 320]);
fs.mkdirSync(OUT, { recursive: true });

const live = (await fetch(`${API}/v1/live`).then((r) => r.json())).data || [];
if (!live.length) { console.error('live-ux: nothing live on /v1/live — this acceptance needs a real live match'); process.exit(2); }
// the doubles match (long names) when one is live, else the first
const target = live.find((m) => /D$/.test(m.event_type)) || live[0];
const cast = (await fetch(`${API}/v1/pbecast/${target.id}`).then((r) => r.json())).data;
console.log(`live: ${live.length} match(es); PBEcast target ${target.id} (${target.event_type}, ${cast?.mode}, ${cast?.events?.length} events)`);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(w, path, { reducedMotion = 'reduce', touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(WEB + path, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  return { ctx, page, errors };
}

const pageChecks = () => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollbars: [...document.querySelectorAll('.hm-track')].filter((t) => vis(t) && t.offsetHeight - t.clientHeight > 0).length,
    // any score cell whose box escapes its card, and any row whose set columns disagree with its sibling row
    escaped: [...document.querySelectorAll('.hm-match, .tk')].flatMap((card) => {
      const c = card.getBoundingClientRect();
      return [...card.querySelectorAll('.sg-c, .sg-nm, .sg-av, footer > *, .hm-go, .hm-mh1 > *, .tk-top > *, .tk-go')].filter((x) => { const r = x.getBoundingClientRect(); return r.width && (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5); }).map((x) => `${card.className.split(' ')[0]}:${x.className}:${x.textContent.trim()}`);
    }),
    misaligned: [...document.querySelectorAll('.sg')].filter((g) => {
      const rows = [...g.querySelectorAll('.sg-row')];
      const xs = rows.map((r) => [...r.querySelectorAll('.sg-c')].map((c) => Math.round(c.getBoundingClientRect().left)).join(','));
      return new Set(xs).size > 1;
    }).length,
    // a name that is cut must be cut by ellipsis inside its own column (never overlapping the score column)
    overlaps: [...document.querySelectorAll('.sg-row:not(.sg-head)')].filter((r) => { const n = r.querySelector('.sg-who')?.getBoundingClientRect(); const c = r.querySelector('.sg-srv')?.getBoundingClientRect(); return n && c && n.right > c.left + 0.5; }).length,
    tinyText: [...document.querySelectorAll('.hm-match *, .tk *, .v3-score *, .v3-rail *')].filter((e) => vis(e) && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 10).map((e) => e.className || e.tagName).slice(0, 5)
  };
};

for (const w of WIDTHS) {
  const fail = [];
  const row = { width: w };
  // ---------------------------------------------------------------- home
  {
    const { ctx, page, errors } = await open(w, '/');
    await page.waitForSelector('[data-next] .hm-match', { timeout: 30000 }).catch(() => fail.push('home: no match cards'));
    await sleep(800);
    const r = await page.evaluate(pageChecks);
    const cards = await page.evaluate(() => [...document.querySelectorAll('[data-next] .hm-match')].map((c) => ({ live: c.classList.contains('is-live'), cast: !!c.querySelector('a[href^="/pbecast/"]'), srv: !!c.querySelector('.sg-row.is-srv .sg-srv i'), pt: c.querySelectorAll('.sg-row:not(.sg-head) .sg-pt').length })));
    const visibleCards = await page.evaluate(() => { const t = document.querySelector('[data-next] .hm-track'); if (!t) return 0; const b = t.getBoundingClientRect(); return [...t.children].reduce((n, c) => { const r = c.getBoundingClientRect(); return n + Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left)) / r.width; }, 0); });
    row.home = { cards: cards.length, live: cards.filter((c) => c.live).length, visible_cards: Number(visibleCards.toFixed(2)), ...r };
    if (r.overflow > 0) fail.push(`home: page overflow ${r.overflow}px`);
    if (r.scrollbars) fail.push(`home: ${r.scrollbars} visible rail scrollbar(s)`);
    if (r.escaped.length) fail.push(`home: score content outside its card: ${r.escaped.slice(0, 3).join(' | ')}`);
    if (r.misaligned) fail.push(`home: ${r.misaligned} scoreboard(s) with misaligned set columns`);
    if (r.overlaps) fail.push(`home: ${r.overlaps} name(s) overlapping the score columns`);
    if (r.tinyText.length) fail.push(`home: text under 10px: ${r.tinyText.join(', ')}`);
    for (const c of cards.filter((x) => x.live)) { if (!c.cast) fail.push('home: live card without PBEcast link'); if (c.pt !== 2) fail.push('home: live card without the point column'); }
    if (w < 760 && (visibleCards < 1.02 || visibleCards > 1.35)) fail.push(`home: ${visibleCards.toFixed(2)} cards visible on a phone (want ~1.1)`);
    if (w >= 1440 && visibleCards < Math.min(3, cards.length) - 0.2) fail.push(`home: only ${visibleCards.toFixed(2)} cards visible at ${w}`);
    if (errors.length) fail.push(`home console: ${errors.slice(0, 2).join(' | ')}`);
    if (SHOTS.has(w)) {
      const st = await page.addStyleTag({ content: '.hdr{position:relative!important;top:auto!important}' });
      await page.locator('[data-next] section').screenshot({ path: `${OUT}/home-live-${w}.png` });
      await st.evaluate((n) => n.remove());
    }
    await ctx.close();
  }
  // ---------------------------------------------------------------- PBEcast (reduced motion: static checks + arrows)
  {
    const { ctx, page, errors } = await open(w, `/pbecast/${target.id}`);
    await page.waitForSelector('[data-moment] .v3-mo', { timeout: 30000 }).catch(() => fail.push('pbecast: stage not hydrated'));
    await page.waitForSelector('.pbc-tk .tk', { timeout: 20000 }).catch(() => {});
    await sleep(800);
    const r = await page.evaluate(pageChecks);
    const t = await page.evaluate(() => {
      const rail = document.querySelector('.pbc-tk [data-rail]');
      const track = rail?.querySelector('.hm-track');
      const cur = track?.querySelector('[aria-current="page"]');
      const tb = track?.getBoundingClientRect();
      const cb = cur?.getBoundingClientRect();
      const nav = rail?.querySelector('.hm-nav');
      return {
        ticker: !!rail, cards: track?.children.length || 0, current: !!cur,
        currentVisible: !!(cb && tb && cb.left >= tb.left - 1 && cb.right <= tb.right + 1),
        navShown: !!nav && !nav.hidden && getComputedStyle(nav).display !== 'none',
        autoState: rail?.dataset.autoState || null, overflowing: track ? track.scrollWidth > track.clientWidth + 4 : false,
        land: !!document.querySelector('.court.is-land'), stageLand: !!document.querySelector('.v3-stage.is-land'),
        rail: [...document.querySelectorAll('.v3-rail .v3-mod-h')].map((h) => h.textContent.trim()),
        scoreH: Math.round(document.querySelector('.v3-score')?.getBoundingClientRect().height || 0),
        courtW: Math.round(document.querySelector('.v3-court .court')?.getBoundingClientRect().width || 0),
        stageW: Math.round(document.querySelector('[data-stage]')?.getBoundingClientRect().width || 0),
        games: [...document.querySelectorAll('.v3-gm li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
        groups: [...document.querySelectorAll('.v3-rc li')].map((li) => { const m = li.textContent.match(/observed ×(\d+)/); return m ? Number(m[1]) : 1; }),
        sets: document.querySelector('.v3-fact dd')?.textContent || null
      };
    });
    row.pbecast = { ...r, ...t };
    if (r.overflow > 0) fail.push(`pbecast: page overflow ${r.overflow}px`);
    if (r.scrollbars) fail.push(`pbecast: ${r.scrollbars} visible ticker scrollbar(s)`);
    if (r.escaped.length) fail.push(`pbecast: ticker score outside its card: ${r.escaped.slice(0, 3).join(' | ')}`);
    if (r.misaligned) fail.push(`pbecast: ${r.misaligned} misaligned ticker scoreboard(s)`);
    if (r.overlaps) fail.push(`pbecast: ${r.overlaps} ticker name(s) overlapping the score`);
    if (r.tinyText.length) fail.push(`pbecast: text under 10px: ${r.tinyText.join(', ')}`);
    const liveNow = ((await fetch(`${API}/v1/live`).then((x) => x.json())).data || []).length; // matches start / end during a run
    if (liveNow > 1) {
      if (!t.ticker || Math.abs(t.cards - liveNow) > 1 || !t.cards) fail.push(`pbecast: ticker shows ${t.cards} of ${liveNow} live matches`);
      if (!t.current || !t.currentVisible) fail.push('pbecast: current match not marked + visible in the ticker on first render');
      if (t.autoState !== 'off-reduced-motion' && t.overflowing) fail.push(`pbecast: reduced motion must disable auto-advance (state ${t.autoState})`);
      if (w >= 760 && t.overflowing && !t.navShown) fail.push('pbecast: ticker overflows but no arrows on desktop');
    }
    if (w >= 1024 && !(t.land && t.stageLand)) fail.push('pbecast: desktop court not in landscape');
    if (w < 1024 && t.land) fail.push('pbecast: phone/tablet court should stay portrait');
    if (JSON.stringify(t.rail) !== JSON.stringify(['Current moment', 'Match pulse', 'Recent moments', 'Recent games'])) fail.push(`pbecast: rail modules ${t.rail.join(',')}`);
    // intelligence = the API's own events: recent games are exactly the provable games (newest first, max 6)
    // compare against the API as of now (a live match moves during the run) — retry once across a poll boundary
    const fresh = (await fetch(`${API}/v1/pbecast/${target.id}`).then((x) => x.json())).data || cast;
    const evs = fresh.events;
    const provable = evs.map((e) => e.event_detail?.game_won).filter((g) => g?.winner).slice(-6).reverse();
    const surname = (s) => (fresh.match.players?.[s] || []).map((p) => p.last_name || p.name.split(' ').slice(-1)[0]).join(' / ');
    const want = provable.map((g) => `S${g.set} · G${g.game} ${g.result === 'break' ? 'BREAK' : g.result === 'hold' ? 'HOLD' : 'GAME'} ${surname(g.winner)}`);
    const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ');
    if (fresh.mode.includes('live') && !evs.some((e) => e.quality === 'point_event') && JSON.stringify(t.games.map(norm)) !== JSON.stringify(want.map(norm)) && JSON.stringify(t.games.slice(1).map(norm)) !== JSON.stringify(want.slice(0, -1).map(norm)) && JSON.stringify(t.games.map(norm).slice(0, -1)) !== JSON.stringify(want.slice(1).map(norm))) fail.push(`pbecast: recent games differ from the API events: ${t.games[0]} vs ${want[0]}`);
    // the grouped moment rows represent consecutive real events only (never more than exist)
    if (t.groups.reduce((a, b) => a + b, 0) > evs.length) fail.push('pbecast: grouped moments claim more observations than exist');
    if (w >= 1024 && t.courtW < t.stageW * 0.45) fail.push(`pbecast: court ${t.courtW}px of a ${t.stageW}px stage — not the visual anchor`);
    if (errors.length) fail.push(`pbecast console: ${errors.slice(0, 2).join(' | ')}`);
    // arrows (desktop): next moves, prev returns
    if (w >= 760 && t.navShown) {
      const tr = page.locator('.pbc-tk .hm-track');
      await tr.evaluate((x) => { x.scrollLeft = 0; });
      await sleep(300);
      const a0 = await tr.evaluate((x) => x.scrollLeft);
      await page.locator('.pbc-tk .hm-arrow:not(.prev)').click();
      await sleep(500);
      const a1 = await tr.evaluate((x) => x.scrollLeft);
      await page.locator('.pbc-tk .hm-arrow.prev').click();
      await sleep(500);
      const a2 = await tr.evaluate((x) => x.scrollLeft);
      row.pbecast.arrows = [a0, a1, a2];
      if (!(a1 > a0 && a2 < a1)) fail.push(`pbecast: ticker arrows did not move (${a0}->${a1}->${a2})`);
    }
    if (t.overflowing && w >= 760) {
      // trackpad: a horizontal wheel over the ticker scrolls it
      const tr = page.locator('.pbc-tk .hm-track');
      await tr.evaluate((x) => { x.scrollLeft = 0; });
      const box = await tr.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(260, 0);
      await sleep(500);
      row.pbecast.wheel = await tr.evaluate((x) => x.scrollLeft);
      if (!(row.pbecast.wheel > 0)) fail.push('pbecast: trackpad/wheel did not scroll the ticker');
    }
    if (SHOTS.has(w)) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${OUT}/pbecast-${w}.png` });
      const st = await page.addStyleTag({ content: '.hdr{position:relative!important;top:auto!important}.v3-score-wrap,.v3-rail{position:relative!important;top:auto!important}' });
      await page.screenshot({ path: `${OUT}/pbecast-${w}-full.png`, fullPage: true });
      await st.evaluate((n) => n.remove());
    }
    await ctx.close();
  }
  row.pass = !fail.length;
  row.fail = fail;
  results.push(row);
  console.log(`${fail.length ? 'FAIL' : 'PASS'} @${w}  home cards=${row.home?.cards} visible=${row.home?.visible_cards}  pbecast ticker=${row.pbecast?.cards} land=${row.pbecast?.land} court=${row.pbecast?.courtW}/${row.pbecast?.stageW} score=${row.pbecast?.scoreH}px${fail.length ? `\n   ✖ ${fail.join('\n   ✖ ')}` : ''}`);
}

// ---------------------------------------------------------------- auto-advance behaviour (motion allowed)
const auto = {};
if (live.length > 1) {
  const fail = [];
  // desktop: runs, pauses on hover and on focus, resumes — at the widest width where the live cards overflow the ticker
  const AW = [1440, 1024, 768, 430, 390].find((w) => results.find((r) => r.width === w)?.pbecast?.overflowing) || 768;
  auto.width = AW;
  {
    const { ctx, page } = await open(AW, `/pbecast/${target.id}`, { reducedMotion: 'no-preference' });
    await page.waitForSelector('.pbc-tk .tk', { timeout: 30000 });
    await page.mouse.move(5, 880);
    const rail = page.locator('.pbc-tk [data-rail]');
    const overflowing = await page.evaluate(() => { const t = document.querySelector('.pbc-tk .hm-track'); return t.scrollWidth > t.clientWidth + 4; });
    auto.overflowing = overflowing;
    if (overflowing) {
      await sleep(10500);
      auto.running = { state: await rail.getAttribute('data-auto-state'), moves: Number(await rail.getAttribute('data-auto-moves') || 0) };
      if (!(auto.running.moves >= 1)) fail.push(`auto-advance did not move in 10.5 s (${JSON.stringify(auto.running)})`);
      const step = await page.evaluate(() => { const t = document.querySelector('.pbc-tk .hm-track'); return t.firstElementChild.getBoundingClientRect().width + parseFloat(getComputedStyle(t).columnGap); });
      auto.step = Math.round(step);
      await page.locator('.pbc-tk .tk').first().hover();
      await sleep(300);
      const m0 = Number(await rail.getAttribute('data-auto-moves') || 0);
      await sleep(10000);
      auto.hover = { state: await rail.getAttribute('data-auto-state'), moved: Number(await rail.getAttribute('data-auto-moves') || 0) - m0 };
      if (auto.hover.state !== 'paused-hover' || auto.hover.moved) fail.push(`hover did not pause auto-advance ${JSON.stringify(auto.hover)}`);
      await page.mouse.move(5, 880);
      await page.locator('.pbc-tk .tk').nth(1).focus();
      await sleep(300);
      const m1 = Number(await rail.getAttribute('data-auto-moves') || 0);
      await sleep(10000);
      auto.focus = { state: await rail.getAttribute('data-auto-state'), moved: Number(await rail.getAttribute('data-auto-moves') || 0) - m1 };
      if (auto.focus.state !== 'paused-focus' || auto.focus.moved) fail.push(`focus did not pause auto-advance ${JSON.stringify(auto.focus)}`);
      await page.evaluate(() => document.activeElement.blur());
      await page.mouse.click(5, 880);
      await sleep(14000);
      auto.resumed = { state: await rail.getAttribute('data-auto-state'), moves: Number(await rail.getAttribute('data-auto-moves') || 0) };
      if (!(auto.resumed.moves > m1)) fail.push(`auto-advance did not resume after hover/focus ended ${JSON.stringify(auto.resumed)}`);
    }
    await ctx.close();
  }
  // phone: a real swipe (touch) scrolls the ticker and pauses auto-advance
  {
    const { ctx, page } = await open(390, `/pbecast/${target.id}`, { reducedMotion: 'no-preference', touch: true });
    await page.waitForSelector('.pbc-tk .tk', { timeout: 30000 });
    const step = await page.evaluate(() => document.querySelector('.pbc-tk .hm-track').firstElementChild.getBoundingClientRect().width);
    const tr = page.locator('.pbc-tk .hm-track');
    await tr.evaluate((x) => { x.scrollLeft = 0; });
    const box = await tr.boundingBox();
    // a real finger drag (touchStart -> 12 touchMoves -> touchEnd), 240px right-to-left
    const cdp = await ctx.newCDPSession(page);
    const y = Math.round(box.y + box.height / 2);
    const x0 = Math.round(box.x + box.width * 0.85);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 12; i += 1) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * 20, y }] }); await sleep(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(900);
    auto.swipe = { scrollLeft: await tr.evaluate((x) => x.scrollLeft), state: await page.locator('.pbc-tk [data-rail]').getAttribute('data-auto-state') };
    if (!(auto.swipe.scrollLeft >= step / 2)) fail.push(`touch swipe did not scroll the ticker a card (${auto.swipe.scrollLeft}px)`);
    if (auto.swipe.state !== 'paused-interaction') fail.push(`touch did not pause auto-advance (${auto.swipe.state})`);
    await ctx.close();
  }
  // reduced motion: never moves on its own
  {
    const { ctx, page } = await open(AW, `/pbecast/${target.id}`, { reducedMotion: 'reduce' });
    await page.waitForSelector('.pbc-tk .tk', { timeout: 30000 });
    await page.mouse.move(5, 880);
    await sleep(10500);
    const rail = page.locator('.pbc-tk [data-rail]');
    auto.reduced = { state: await rail.getAttribute('data-auto-state'), moves: Number(await rail.getAttribute('data-auto-moves') || 0), scrollLeft: await page.locator('.pbc-tk .hm-track').evaluate((x) => x.scrollLeft) };
    if (auto.overflowing && (auto.reduced.moves || auto.reduced.state !== 'off-reduced-motion')) fail.push(`reduced motion did not disable auto-advance ${JSON.stringify(auto.reduced)}`);
    await ctx.close();
  }
  auto.pass = !fail.length;
  auto.fail = fail;
  console.log(`${fail.length ? 'FAIL' : 'PASS'} auto-advance ${JSON.stringify({ running: auto.running, hover: auto.hover, focus: auto.focus, resumed: auto.resumed, swipe: auto.swipe, reduced: auto.reduced })}${fail.length ? `\n   ✖ ${fail.join('\n   ✖ ')}` : ''}`);
}
await browser.close();
if (server) await new Promise((r) => server.httpServer.close(r));
const pass = results.every((r) => r.pass) && (auto.pass ?? true);
fs.writeFileSync(`${OUT}/qa-${process.env.QA_BASE ? 'production' : 'local'}.json`, JSON.stringify({ base: WEB, at: new Date().toISOString(), target: { id: target.id, event_type: target.event_type, mode: cast.mode, events: cast.events.length }, live: live.length, pass, results, auto }, null, 2) + '\n');
console.log(`LIVE UX: ${pass ? 'PASS' : 'FAIL'} (${results.filter((r) => r.pass).length}/${results.length} widths${auto.pass != null ? `, auto-advance ${auto.pass ? 'PASS' : 'FAIL'}` : ''})`);
process.exitCode = pass ? 0 : 1;
