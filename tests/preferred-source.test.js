import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredSourceTarget, preferredSourceDeeplink, preferredSourceHtml } from '../src/ui/preferred-source.js';
import { footerHtml } from '../src/ui/shell.js';
import { EVENTS, __test as gaTest } from '../src/analytics.js';

test('tennis.propbetedge.ai is not a Google-listed source: deeplink to the parent, no SDK', () => {
  assert.deepEqual(preferredSourceTarget('tennis.propbetedge.ai'), { source: 'propbetedge.ai', sdk: false });
  assert.equal(preferredSourceTarget('mlb.propbetedge.ai').sdk, true);
  assert.equal(preferredSourceDeeplink('propbetedge.ai'), 'https://www.google.com/preferences/source?q=propbetedge.ai');
});

test('footer carries our own Preferred Sources control, never Google auto-render markup', () => {
  const f = String(footerHtml());
  assert.match(f, /data-pbe-preferred-source/);
  assert.match(f, /href="https:\/\/www\.google\.com\/preferences\/source\?q=propbetedge\.ai"/);
  assert.match(f, /data-surface="footer" data-sport="tennis"/);
  assert.doesNotMatch(f, /google-add-preferred-source-btn|publisher\.js/);
});

test('article CTA and analytics event contract', () => {
  const a = String(preferredSourceHtml({ surface: 'article' }));
  assert.match(a, /Add PropBetEdge/);
  assert.match(a, /data-surface="article"/);
  assert.ok(EVENTS.includes('preferred_source_click'));
  for (const k of ['surface', 'sport', 'method']) assert.ok(gaTest.ALLOWED_PARAMS.has(k), k);
});
