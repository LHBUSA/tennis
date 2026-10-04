// Other venues on the match page (shared venueLines from the vendored client, propbetedge-workers 4e49f5f).
// Real production desk record: WTA Beijing Gauff v Sun (our match 0752bed5) with the Polymarket market
// attached by pm-tennis (both players exact + WTA + China Open -> beijing) and gated RULE_MISMATCH.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { venueLines } from '../src/vendor/kalshi/kalshi-market-ui.js';

const DESK = JSON.parse(fs.readFileSync(new URL('./fixtures/kalshi/tennis-desk-gauff-sun.json', import.meta.url), 'utf8')).event;

test('real desk record: Polymarket shown as a related market with its own price + reason, never a gap', () => {
  assert.equal(DESK.canonical_event_id.slice(0, 8), '0752bed5');
  const html = venueLines(DESK, { placement: 'match-venues' });
  assert.match(html, /Polymarket/);
  assert.match(html, /RELATED MARKET · RULES DIFFER/);
  assert.match(html, /Coco Gauff/);
  assert.match(html, /Rules differ if the match is/);
  assert.match(html, /Shown at its own price; not compared\./);
  assert.match(html, /href="https:\/\/polymarket\.com\/event\/wta-gauff-su-2026-10-04"/);
  assert.ok(!/gap \d/.test(html));
});

test('match page: VENUE-NEUTRAL — Kalshi and other venues independent, from the same bounded first read and poll', () => {
  const live = fs.readFileSync(new URL('../src/pages/live-pages.js', import.meta.url), 'utf8');
  assert.match(live, /return raw\(card \+ venueLines\(desk, \{ placement: 'match-venues', standalone: !card \}\)\);/);
  assert.ok(!/card \? card \+ venueLines/.test(live), 'Kalshi is never a prerequisite for another venue');
  assert.match(live, /kalshi\.loadDesk\(params\.id\)\.then\(\(d\) => \{ kxDesk = d; \}\)/);
  assert.match(live, /Promise\.all\(\[kalshi\.loadEvent\(params\.id, \{ force: true \}\), kalshi\.loadDesk\(params\.id\)\]\)/);
  assert.equal(venueLines(null), '');
});

test('Polymarket-only match (real WTA 125 shape, no Kalshi): standalone Market Pulse on the match page + compact cue', async () => {
  const { venueChip } = await import('../src/vendor/kalshi/kalshi-market-ui.js');
  const l = (mid) => ({ venue: 'polymarket', match: 'VENUE_ONLY', label: 'PREDICTION MARKET', market_url: 'https://polymarket.com/event/wta-jacquem-liu-2026-10-05', mid_bp: mid, bid_bp: mid - 50, ask_bp: mid + 50, freshness: 'live' });
  const d = { canonical_event_id: '69c67903-e47e-53fb-8df8-dc1fd70a8b28', contracts: [{ label: 'Elsa Jacquemot', venues: [], related: [], listed: [l(4450)] }, { label: 'Claire Liu', venues: [], related: [], listed: [l(5550)] }] };
  const html = venueLines(d, { placement: 'match-venues', standalone: true });
  assert.match(html, /Market Pulse/); assert.match(html, /Polymarket/); assert.match(html, /44\.5¢/); assert.ok(!/Kalshi/.test(html)); assert.match(html, /class="ic kx kx--venue kx--polymarket"/);
  assert.match(venueChip(d), /MARKET<\/i> · POLYMARKET/);
  const data = fs.readFileSync(new URL('../src/data/kalshi.js', import.meta.url), 'utf8');
  assert.match(data, /kalshiLine\(entry\) \+ venueChip\(kalshi\.deskFor\(id\)\)/);
  for (const f of ['../src/pages/live-pages.js', '../src/pages/today.js', '../src/pages/pbecast.js']) assert.match(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /loadMarketBoards\(\)/, f);
  assert.match(fs.readFileSync(new URL('../src/pages/pbecast.js', import.meta.url), 'utf8'), /panel \+ venueLines\(kxDesk, \{ placement: 'pbecast-venues', standalone: !panel \}\)/);
});

test('live refresh: the venue desk has its own 30 s cadence (independent of Kalshi), freshness ticks in place, timers cleared on unmount', () => {
  const data = fs.readFileSync(new URL('../src/data/kalshi.js', import.meta.url), 'utf8');
  assert.match(data, /export const DESK_POLL_MS = 30_000;/);
  const live = fs.readFileSync(new URL('../src/pages/live-pages.js', import.meta.url), 'utf8');
  assert.match(live, /kalshi\.loadDesk\(params\.id, \{ force: true \}\)/);
  assert.match(live, /setInterval\(\(\) => tickVenueAges\(root\.querySelector\('\[data-kx-card\]'\)\), VENUE_AGE_TICK_MS\)/);
  assert.match(live, /clearTimeout\(kxDeskTimer\); kxDeskTimer = null; clearInterval\(kxAgeTimer\);/);
  const cast = fs.readFileSync(new URL('../src/pages/pbecast.js', import.meta.url), 'utf8');
  assert.match(cast, /clearTimeout\(kxDeskTimer\); clearInterval\(kxAgeTimer\);/);
});
