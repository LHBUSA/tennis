#!/usr/bin/env node
// Post-build: every static route gets its own complete head (title, description, canonical, robots,
// Open Graph, X card, JSON-LD); the SPA shell used for data routes is noindex until tennis-web renders a
// data-backed head. sitemap.xml + robots.txt list only indexable routes. Runs after `vite build`.

import fs from 'node:fs';
import path from 'node:path';
import { STATIC_ROUTES, resolveRoute } from '../src/lib/routes.js';
import { routeMeta, headHtml, SITE, breadcrumb } from '../src/seo/meta.js';

const DIST = path.resolve('dist');
const base = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (!base.includes('<!--seo:start-->') || !base.includes('<!--seo:end-->')) throw new Error('index.html is missing the seo markers');
const HERO_PRELOAD = '<link rel="preload" as="image" type="image/avif" href="/brand/tennis-hero-1600.avif" imagesrcset="/brand/tennis-hero-1200.avif 1200w, /brand/tennis-hero-1600.avif 1600w, /brand/tennis-hero-2400.avif 2400w" imagesizes="100vw" fetchpriority="high" media="(min-width: 601px)" /><link rel="preload" as="image" type="image/avif" href="/brand/tennis-hero-mobile-900x1200.avif" fetchpriority="high" media="(max-width: 600px)" />';

export const withHead = (m, { preload = false } = {}) => base
  .replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, `<!--seo:start-->\n    ${headHtml(m)}\n    <!--seo:end-->`)
  .replace('<!--preload-->', preload ? HERO_PRELOAD : '');

const written = [];
for (const r of STATIC_ROUTES) {
  const resolved = resolveRoute(r.path);
  const crumbs = r.path === '/' ? null : breadcrumb([['PropBetEdge Tennis', '/'], [r.title.split(' — ')[0].split(' | ')[0], r.path]]);
  const m = routeMeta(resolved, { jsonld: crumbs ? [crumbs] : [] });
  const file = r.path === '/' ? 'index.html' : `${r.path.slice(1)}.html`;
  fs.mkdirSync(path.dirname(path.join(DIST, file)), { recursive: true });
  fs.writeFileSync(path.join(DIST, file), withHead(m, { preload: r.path === '/' }));
  written.push(file);
}
// SPA shell for data routes (tennis-web replaces the head with a data-backed one): noindex, no canonical.
const shell = withHead({ title: 'PropBetEdge Tennis', description: 'Live tennis intelligence from PropBetEdge.', robots: 'noindex, follow', canonical: `${SITE}/`, type: 'website' })
  .replace(/\s*<link rel="canonical"[^>]*>/, '').replace(/\s*<meta property="og:url"[^>]*>/, '');
fs.writeFileSync(path.join(DIST, 'app-shell.html'), shell);
fs.writeFileSync(path.join(DIST, 'app-shell-template.html'), base);

const indexable = STATIC_ROUTES.filter((r) => r.index);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((r) => `  <url><loc>${SITE}${r.path === '/' ? '/' : r.path}</loc></url>`).join('\n')}\n</urlset>\n`;
fs.writeFileSync(path.join(DIST, 'sitemap-static.xml'), sitemap);
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /app-shell.html\nDisallow: /app-shell-template.html\nDisallow: /search\nDisallow: /coverage\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`prerender: ${written.length} static routes (${indexable.length} indexable), app-shell.html (noindex)`);
