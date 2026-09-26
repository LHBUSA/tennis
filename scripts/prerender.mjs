#!/usr/bin/env node
// Post-build: give every static route its own HTML head (title / description / canonical / robots),
// write the noindex SPA shell used for parameterized routes, and emit sitemap.xml + robots.txt
// listing ONLY indexable routes. Runs after `vite build`.

import fs from 'node:fs';
import path from 'node:path';
import { STATIC_ROUTES, resolveRoute } from '../src/lib/routes.js';
import { routeMeta, headHtml, siteJsonLd, SITE } from '../src/seo/meta.js';

const DIST = path.resolve('dist');
const base = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (!base.includes('<!--seo:start-->') || !base.includes('<!--seo:end-->')) throw new Error('index.html is missing the seo markers');

const withHead = (m) => base
  .replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, `<!--seo:start-->\n    ${headHtml(m)}\n    <!--seo:end-->`)
  .replace('<!--jsonld-->', `<script type="application/ld+json">${JSON.stringify(siteJsonLd())}</script>`);

const written = [];
for (const r of STATIC_ROUTES) {
  const m = routeMeta(resolveRoute(r.path));
  const file = r.path === '/' ? 'index.html' : `${r.path.slice(1)}.html`;
  fs.mkdirSync(path.dirname(path.join(DIST, file)), { recursive: true });
  fs.writeFileSync(path.join(DIST, file), withHead(m));
  written.push(file);
}

// SPA fallback for parameterized routes: noindex, and no canonical pointing at the homepage.
const shell = withHead({ title: 'PropBetEdge Tennis', description: 'PropBetEdge Tennis', robots: 'noindex, follow', canonical: `${SITE}/`, type: 'website' })
  .replace(/\s*<link rel="canonical"[^>]*>/, '')
  .replace(/\s*<meta property="og:url"[^>]*>/, '');
fs.writeFileSync(path.join(DIST, 'app-shell.html'), shell);

const indexable = STATIC_ROUTES.filter((r) => r.index);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((r) => `  <url><loc>${SITE}${r.path}</loc></url>`).join('\n')}\n</urlset>\n`;
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /app-shell.html\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`prerender: ${written.length} static routes, ${indexable.length} in sitemap, app-shell.html (noindex)`);
