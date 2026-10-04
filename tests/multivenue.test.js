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

test('match page: venues render only under a Kalshi module, from the same bounded first read and the same poll', () => {
  const live = fs.readFileSync(new URL('../src/pages/live-pages.js', import.meta.url), 'utf8');
  assert.match(live, /return raw\(card \? card \+ venueLines\(desk, \{ placement: 'match-venues' \}\) : ''\);/);
  assert.match(live, /kalshi\.loadDesk\(params\.id\)\.then\(\(d\) => \{ kxDesk = d; \}\)/);
  assert.match(live, /Promise\.all\(\[kalshi\.loadEvent\(params\.id, \{ force: true \}\), kalshi\.loadDesk\(params\.id\)\]\)/);
  assert.equal(venueLines(null), '');
});
