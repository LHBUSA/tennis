import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noTransform } from '../workers/tennis-web/src/transport.js';

test('transport: every Worker response carries no-transform so Cloudflare never pre-compresses for Vercel', async () => {
  const html = noTransform(new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60, s-maxage=300', 'x-robots-tag': 'all' } }));
  assert.equal(html.headers.get('cache-control'), 'public, max-age=60, s-maxage=300, no-transform');
  assert.equal(html.headers.get('x-robots-tag'), 'all');
  assert.equal(html.status, 200);
  assert.equal(await html.text(), '<!doctype html><html></html>');

  const bare = noTransform(new Response('temporarily unavailable', { status: 503 }));
  assert.equal(bare.headers.get('cache-control'), 'no-transform');
  assert.equal(bare.status, 503);

  const redirect = noTransform(Response.redirect('https://tennis.propbetedge.ai/og/default.png', 302));
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://tennis.propbetedge.ai/og/default.png');
  assert.equal(redirect.headers.get('cache-control'), 'no-transform');
});

test('transport: idempotent — an existing no-transform is left alone', () => {
  const res = new Response('x', { headers: { 'cache-control': 'public, no-transform, max-age=60' } });
  assert.equal(noTransform(res), res);
});
