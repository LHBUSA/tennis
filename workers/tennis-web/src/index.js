// tennis-web — edge publishing layer for tennis.propbetedge.ai (docs/SEO.md). Vercel proxies data routes
// here (vercel.json rewrites). For each route it fetches the real record from tennis-api (service
// binding), renders a data-backed head (title, description, canonical, robots, OG/X, JSON-LD) into the
// static SPA shell, and serves 1200x630 social cards rendered with resvg. Pages whose data does not
// exist get noindex; the SPA still renders the truthful empty state.

import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import fontXB from './fonts/BarlowCondensed-ExtraBold.ttf';
import fontSB from './fonts/BarlowCondensed-SemiBold.ttf';
import { resolveRoute, STATIC_ROUTES } from '../../../src/lib/routes.js';
import { routeMeta, headHtml, SITE, OG_DEFAULT, NOINDEX_ROBOTS, canonicalUrl } from '../../../src/seo/meta.js';
import { playerCard, matchCard, tournamentCard, rankingsCard, newsCardV4 } from './cards.js';

export const VERSION = '0.1.1';
let wasmReady = null;
const ready = () => (wasmReady ||= initWasm(wasm));

import { headFor, apiGet, ROUND, fmtD, newsEntities, playerRank, permanentRedirect, supersededRecordHead } from './heads.js';
import { noTransform } from './transport.js';

// Edge-rendered HTML names the CURRENT deployment's hashed entry script, and Vercel stops serving the previous
// deployment's hashes the moment a new one is live. So this HTML must never outlive the deployment it was built from:
// the shell is read fresh on every render and the HTML is never kept by a shared cache (no s-maxage, no
// stale-while-revalidate). Owner P0 2026-10-04: with `s-maxage=300` + a 30 s shell cache, match pages referenced a
// dead bundle (blank page) for ~5 min after every deploy. Head DATA stays cached where it is fetched (tennis-api).
export const HTML_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
export const SHELL_FETCH_INIT = { cache: 'no-store' };

async function shellTemplate(env) {
  const res = await fetch(`${env.SITE_ORIGIN || SITE}/app-shell-template.html`, SHELL_FETCH_INIT);
  if (!res.ok) throw new Error(`shell template ${res.status}`);
  return res.text();
}

// ---- social cards ------------------------------------------------------------------------------------
async function r2Jpeg(env, key) {
  if (!env.TENNIS_MEDIA || !/^editorial\/[a-z0-9-]{1,60}\/card\.jpg$/.test(key)) return null;
  const obj = await env.TENNIS_MEDIA.get(key);
  if (!obj) return null;
  const bytes = new Uint8Array(await obj.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function jpeg(env, url) {
  if (!url) return null;
  const m = /\/media\/players\/([0-9a-f-]{36})\//.exec(url);
  if (!m || !env.TENNIS_MEDIA) return null;
  const obj = await env.TENNIS_MEDIA.get(`players/${m[1]}/square.jpg`);
  if (!obj) return null;
  const bytes = new Uint8Array(await obj.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function cardSvg(env, path) {
  let m;
  if ((m = /^\/og\/player\/([a-z0-9-]+)(\/dna)?\.png$/.exec(path))) {
    const p = await apiGet(env, `/v1/players/${m[1]}`);
    if (!p) return null;
    const rk = playerRank(p);
    return playerCard({ name: p.name, rank: rk?.rank, list: rk?.card || '', nationality: p.nationality, jpegB64: await jpeg(env, p.photo?.square_jpg || p.photo?.square), label: m[2] ? 'TENNIS DNA' : 'PLAYER', note: m[2] ? 'Match DNA · same-tour percentiles, with samples' : null });
  }
  if ((m = /^\/og\/(match|pbecast)\/([0-9a-f-]{36})\.png$/.exec(path))) {
    const x = await apiGet(env, `/v1/matches/${m[2]}`);
    if (!x || x.status === 'superseded') return null; // never a card for a duplicate record (generic card instead)
    const side = async (s) => { const p = x.sides?.[s]?.players || []; return { name: p.map((q) => q.name).join(' / '), jpegB64: p.length === 1 ? await jpeg(env, p[0].photo?.square_jpg || p[0].photo?.square) : null }; };
    return matchCard({ a: await side('A'), b: await side('B'), tournament: x.tournament?.tournament, round: ROUND(x.round), status: x.status, pbecast: m[1] === 'pbecast' });
  }
  if ((m = /^\/og\/tournament\/([a-z0-9-]+)\/(\d{4})\.png$/.exec(path))) {
    const d = await apiGet(env, `/v1/tournaments/${m[1]}/${m[2]}`);
    if (!d) return null;
    const e = d.edition;
    return tournamentCard({ name: e.tournament, year: e.year, surface: e.surface, level: e.level, location: [e.city, e.country].filter(Boolean).join(', '), dates: `${fmtD(e.start_date)} – ${fmtD(e.end_date)}` });
  }
  if ((m = /^\/og\/news\/([a-z0-9-]+)\.png$/.exec(path))) {
    const a = await apiGet(env, `/v1/news/${m[1]}`);
    if (!a) return null;
    // same resolver as the article (workers/shared/editorial.js): real event photo, else the featured
    // players' approved headshots, else the branded treatment. Never a generated scene.
    const h = a.media?.hero;
    const photoB64 = h?.images?.[0]?.kind === 'catalog' && h.images[0].id ? await r2Jpeg(env, `editorial/${h.images[0].id}/card.jpg`) : null;
    const heads = !photoB64 && h?.type === 'portrait' ? await Promise.all(h.images.slice(0, 2).map((p) => jpeg(env, p.square_jpg || p.square))) : [];
    const league = a.desk === 'grand-slams' ? 'GRAND SLAMS' : a.desk === 'atp' ? 'ATP' : a.desk === 'doubles' ? 'DOUBLES' : 'TENNIS';
    const entity = [a.tournament?.name && `${a.tournament.name} ${a.tournament.year || ''}`.trim(), (a.team || []).map((p) => p.name).join(' / ')].filter(Boolean).join(' · ');
    return newsCardV4({ headline: a.headline, kind: a.story_type, league, entity, photoB64, heads });
  }
  if ((m = /^\/og\/rankings\/wta-(singles|doubles)\.png$/.exec(path))) {
    const d = await apiGet(env, `/v1/rankings?tour=wta&type=${m[1]}&limit=1`);
    return rankingsCard({ tour: 'WTA', type: m[1], date: d ? fmtD(d.ranking_date) : null });
  }
  return null;
}

async function ogImage(env, ctx, request, path) {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;
  let svg = null;
  try { svg = await cardSvg(env, path); } catch { svg = null; }
  if (!svg) return Response.redirect(OG_DEFAULT.url, 302); // never a broken card: the generic Tennis card
  await ready();
  const png = new Resvg(svg, { font: { fontBuffers: [new Uint8Array(fontXB), new Uint8Array(fontSB)], loadSystemFonts: false, defaultFontFamily: 'Barlow Condensed' }, fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  const res = new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' } });
  ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

// ---- sitemap ------------------------------------------------------------------------------------------
async function sitemap(env) {
  // every indexable static route from the one route table (so /men, /rankings, ... can never be forgotten)
  const urls = STATIC_ROUTES.filter((r) => r.index).map((r) => canonicalUrl(r.path));
  // ranked players of both tours (ATP list from the secondary source), then Slam draws
  for (const tour of ['wta', 'atp']) {
    const r = await apiGet(env, `/v1/rankings?tour=${tour}&type=singles&limit=500`);
    for (const x of r?.rows || []) if (x.player?.slug) urls.push(canonicalUrl(`/players/${x.player.slug}`));
  }
  // men: players in the newest Grand Slam main draws + every men's Grand Slam edition we hold
  const mp = await apiGet(env, '/v1/men/players');
  for (const x of mp?.rows || []) urls.push(canonicalUrl(`/players/${x.player.slug}`));
  const men = await apiGet(env, '/v1/men');
  for (const e of men?.editions || []) urls.push(canonicalUrl(`/tournaments/${e.slug}/${e.year}`));
  const n = await apiGet(env, '/v1/news?limit=60');
  for (const a of n?.articles || []) urls.push(canonicalUrl(`/news/${a.slug}`));
  const t = await apiGet(env, `/v1/tournaments?from=2020-01-01&to=${new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10)}`);
  for (const e of t || []) urls.push(canonicalUrl(`/tournaments/${e.slug}/${e.year}`));
  const uniq = [...new Set(urls)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${uniq.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
}

export default {
  // Every response leaves with no-transform: see transport.js for why (Vercel cache vs Accept-Encoding).
  async fetch(request, env, ctx) {
    return noTransform(await handle(request, env, ctx));
  }
};

async function handle(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/health') return new Response(JSON.stringify({ ok: true, worker: 'tennis-web', version: VERSION, api_binding: !!env.API, media: !!env.TENNIS_MEDIA }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    if (path.startsWith('/og/')) return ogImage(env, ctx, request, path);
    if (path === '/sitemap.xml') return new Response(await sitemap(env), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    const r = resolveRoute(path);
    let overrides = {};
    try { overrides = await headFor(env, r, url); } catch { overrides = { robots: NOINDEX_ROBOTS }; }
    // superseded match / PBEcast id with a resolved survivor: permanent canonical migration, path only (match pages carry
    // no meaningful query parameters), GET/HEAD only — never the old blank page
    const moved = permanentRedirect(overrides, request.method);
    if (moved) return moved;
    if (overrides.redirect) overrides = supersededRecordHead();
    const meta = routeMeta(r, overrides);
    let tpl;
    try { tpl = await shellTemplate(env); } catch { return new Response('temporarily unavailable', { status: 503 }); }
    const html = tpl.replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, `<!--seo:start-->\n    ${headHtml(meta)}\n    <!--seo:end-->`).replace('<!--preload-->', '');
    const status = r.id === 'not-found' || /not found/i.test(meta.title) ? 404 : 200;
    return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': HTML_CACHE_CONTROL, 'x-robots-tag': meta.robots.startsWith('noindex') ? 'noindex' : 'all', 'x-content-type-options': 'nosniff' } });
}
