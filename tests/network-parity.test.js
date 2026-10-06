// Footer family parity: src/data/network.js must agree with the vendored canonical registry
// src/data/family.json (LHBUSA/propbetedge-workers shared/network/family.json; re-vendor, never hand-edit).
import { NETWORK_ALL_ACCESS_URL } from '../src/lib/all-access.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NETWORK, CURRENT_SPORT } from '../src/data/network.js';
import { footerHtml } from '../src/ui/shell.js';
import { SPORT_LABELS, NETWORK as CONTRACT_NETWORK } from '../src/lib/pbe-membership.js';
import { siteJsonLd } from '../src/seo/meta.js';

const FAMILY = JSON.parse(readFileSync(new URL('../src/data/family.json', import.meta.url), 'utf8'));
const SELF = `https://${CURRENT_SPORT}.propbetedge.ai/`;
const abs = (href) => (href === '/' ? SELF : href);

test('footer sports registry matches family.json (set, order, urls)', () => {
  assert.deepEqual(NETWORK.sports.map((s) => s.key), FAMILY.sports.map((s) => s.key));
  assert.deepEqual(NETWORK.sports.map((s) => abs(s.href)), FAMILY.sports.map((s) => s.url));
});

test('All Access products are separate products, never sports', () => {
  assert.deepEqual(NETWORK.products.map((p) => [p.key, p.href]), FAMILY.products.map((p) => [p.key, p.url]));
  for (const p of NETWORK.products) {
    assert.ok(!NETWORK.sports.some((s) => s.key === p.key));
    assert.ok(!(p.key in SPORT_LABELS));
    assert.ok(!CONTRACT_NETWORK.some((s) => s.key === p.key));
  }
});

test('network links match family.json', () => {
  const want = Object.fromEntries(FAMILY.network.map((n) => [n.key, n.url]));
  assert.equal(NETWORK.news.href, want.hub);
  assert.equal(NETWORK.learn.href, want.learn);
  const f = String(footerHtml());
  /* Owner 2026-10-05: the footer's All Access link stays on Tennis (native /all-access); the family's
     all_access URL remains the network reference constant. */
  assert.ok(f.includes('href="/all-access"'), 'All Access link is the local page');
  assert.equal(NETWORK_ALL_ACCESS_URL, FAMILY.all_access.find((n) => n.key === 'all_access').url);
});

test('rendered footer: exactly one F1 and each premium product anchor, canonical https, no retired hosts', () => {
  const f = String(footerHtml());
  const hrefs = [...f.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(hrefs.filter((h) => h === 'https://f1.propbetedge.ai/').length, 1);
  for (const p of FAMILY.products) assert.equal(hrefs.filter((h) => h === p.url).length, 1, p.key);
  for (const host of FAMILY.retired_hosts) assert.ok(!f.includes(host), host);
  assert.ok(!/http:\/\/[^"]*propbetedge\.ai/.test(f));
  assert.ok(!/\b(11|eleven) sports\b/i.test(f));
});

test('one PropBetEdge Organization id', () => {
  const orgs = siteJsonLd()['@graph'].filter((n) => n['@type'] === 'Organization');
  assert.equal(orgs.length, 1);
  assert.equal(orgs[0]['@id'], FAMILY.organization);
});
