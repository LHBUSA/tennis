// Owner P0 2026-10-04: after every deploy, edge-rendered pages (match pages) were served for ~5 min from Vercel's edge
// cache (s-maxage=300) with the PREVIOUS deployment's hashed entry script, which no longer exists -> blank page.
// Edge-rendered HTML must never outlive the deployment it names: fresh shell on every render, no shared HTML cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../workers/tennis-web/src/index.js', import.meta.url), 'utf8');

test('edge-rendered HTML: no shared cache (no s-maxage, no stale-while-revalidate), browsers revalidate', () => {
  assert.match(src, /export const HTML_CACHE_CONTROL = 'public, max-age=0, must-revalidate';/);
  const htmlResponses = src.split('\n').filter((l) => /text\/html/.test(l) && /new Response/.test(l));
  assert.ok(htmlResponses.length >= 1);
  for (const l of htmlResponses) {
    assert.match(l, /'cache-control': HTML_CACHE_CONTROL/, l.trim().slice(0, 120));
    assert.ok(!/s-maxage|stale-while-revalidate|max-age=[1-9]/.test(l), l.trim().slice(0, 120));
  }
});

test('the hashed shell template is read fresh on every render (no fetch cache)', () => {
  assert.match(src, /export const SHELL_FETCH_INIT = \{ cache: 'no-store' \};/);
  assert.match(src, /app-shell-template\.html`, SHELL_FETCH_INIT\)/);
  assert.ok(!/app-shell-template[^\n]*cacheTtl/.test(src));
});
