// PropBetEdge network X identity on tennis.propbetedge.ai: twitter:site, Organization sameAs and one
// footer X link (new tab, safe rel, accessible name). Stale PropBetEdge handles never appear.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { headHtml, siteJsonLd } from '../src/seo/meta.js';
import { footerHtml } from '../src/ui/shell.js';
import { PROPBETEDGE_X_URL, PROPBETEDGE_X_HANDLE } from '../src/data/network.js';

const STALE = /MLBHRALERTSPBE|propbetedgeai|X \/ Twitter|twitter\.com\/intent/i;

test('canonical constants', () => {
  assert.equal(PROPBETEDGE_X_URL, 'https://x.com/PROPBETEDGE');
  assert.equal(PROPBETEDGE_X_HANDLE, '@PROPBETEDGE');
});

test('head: exactly one twitter:site @PROPBETEDGE', () => {
  const h = headHtml({ title: 't', description: 'd', robots: 'index, follow', canonical: 'https://tennis.propbetedge.ai/', type: 'website' });
  assert.equal((h.match(/<meta name="twitter:site" content="@PROPBETEDGE" \/>/g) || []).length, 1);
  const shell = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal((shell.match(/<meta name="twitter:site" content="@PROPBETEDGE" \/>/g) || []).length, 1);
});

test('Organization sameAs is the canonical X profile only', () => {
  const org = siteJsonLd()['@graph'].find((n) => n['@type'] === 'Organization');
  assert.deepEqual(org.sameAs, ['https://x.com/PROPBETEDGE']);
});

test('footer: one PropBetEdge X link, new tab, safe rel, accessible name', () => {
  const f = String(footerHtml());
  const links = [...f.matchAll(/<a [^>]*href="https:\/\/x\.com\/PROPBETEDGE"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
  assert.equal(links.length, 1);
  assert.match(links[0], /target="_blank"/);
  assert.match(links[0], /rel="noopener noreferrer"/);
  assert.match(links[0], /aria-label="Follow PropBetEdge on X \(@PROPBETEDGE\)"/);
  assert.match(links[0], /@PROPBETEDGE<\/a>$/);
  assert.doesNotMatch(f, STALE);
});

test('Tennis is in PropBetEdge All Access: footer links /pro; contract lists Tennis', async () => {
  const { NETWORK: CONTRACT_NETWORK, SPORT_LABELS, CONTRACT_VERSION } = await import('../src/lib/pbe-membership.js');
  assert.equal(CONTRACT_VERSION, '1.2.0');
  assert.equal(SPORT_LABELS.tennis, 'Tennis');
  assert.ok(CONTRACT_NETWORK.some((s) => s.key === 'tennis' && s.url === 'https://tennis.propbetedge.ai'));
  const f = String(footerHtml());
  assert.match(f, /<a class="ftr-aa" href="https:\/\/propbetedge\.ai\/pro" data-pbe-footer-all-access>All Access · \$29\/month<\/a>/);
});
