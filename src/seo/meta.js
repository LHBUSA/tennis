// One module decides title / description / canonical / robots / Open Graph / X card / JSON-LD for every
// route. Used by the prerender step (static routes), tennis-web (edge heads for data routes) and the
// browser router (client navigation). PURE.

export const SITE = 'https://tennis.propbetedge.ai';
export const BRAND = 'PropBetEdge Tennis';
import { PROPBETEDGE_X_URL, PROPBETEDGE_X_HANDLE } from '../data/network.js';
import { ownedImage, licensedImage, compositeImage, imageObject } from './image-metadata.js';

export const X_HANDLE = PROPBETEDGE_X_HANDLE;
export const X_URL = PROPBETEDGE_X_URL;
export const OG_VERSION = '20260926';
export const OG_DEFAULT = { url: `${SITE}/brand/propbetedge-tennis-1200x630.png?v=${OG_VERSION}`, type: 'image/png', width: 1200, height: 630, alt: 'PropBetEdge Tennis — live tennis intelligence: match data, player DNA, rankings and head-to-head' };
export const INDEX_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1';
export const NOINDEX_ROBOTS = 'noindex, follow';

export const canonicalUrl = (path) => `${SITE}${path === '/' ? '/' : path}`;

export function routeMeta(resolved, overrides = {}) {
  const r = resolved.route;
  const base = resolved.id === 'today' ? r.title : `${r.title} | ${BRAND}`;
  return {
    title: overrides.title || base,
    description: overrides.description || r.description,
    robots: overrides.robots || (r.index ? INDEX_ROBOTS : NOINDEX_ROBOTS),
    canonical: canonicalUrl(resolved.path),
    path: resolved.path,
    type: overrides.type || 'website',
    image: overrides.image || OG_DEFAULT,
    jsonld: overrides.jsonld || null,
    article: overrides.article || null
  };
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function headHtml(m) {
  const i = m.image || OG_DEFAULT;
  const tags = [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<meta name="robots" content="${esc(m.robots)}" />`,
    `<link rel="canonical" href="${esc(m.canonical)}" />`,
    `<meta property="og:type" content="${esc(m.type)}" />`,
    `<meta property="og:site_name" content="${BRAND}" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:url" content="${esc(m.canonical)}" />`,
    `<meta property="og:image" content="${esc(i.url)}" />`,
    `<meta property="og:image:secure_url" content="${esc(i.url)}" />`,
    `<meta property="og:image:type" content="${esc(i.type)}" />`,
    `<meta property="og:image:width" content="${i.width}" />`,
    `<meta property="og:image:height" content="${i.height}" />`,
    `<meta property="og:image:alt" content="${esc(i.alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:site" content="${X_HANDLE}" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${esc(i.url)}" />`,
    `<meta name="twitter:image:alt" content="${esc(i.alt)}" />`
  ];
  if (m.article) {
    if (m.article.published_time) tags.push(`<meta property="article:published_time" content="${esc(m.article.published_time)}" />`);
    if (m.article.modified_time) tags.push(`<meta property="article:modified_time" content="${esc(m.article.modified_time)}" />`);
    if (m.article.section) tags.push(`<meta property="article:section" content="${esc(m.article.section)}" />`);
  }
  const ld = jsonLdGraph(m);
  tags.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
  return tags.join('\n    ');
}

// ---- Image rights ---------------------------------------------------------------------------------------
// Every ImageObject goes through ./image-metadata.js (network contract: docs/IMAGE_METADATA_CONTRACT.md in
// propbetedge-news-site). Photos are Commons files with a recorded author/license/file page; a generated card is
// PropBetEdge art plus the photos workers/tennis-web composites into it (catalog hero, else up to two portraits).

/** The canonical deed URL for a Creative Commons license name ("CC BY-SA 4.0", "CC0"), else null. */
export function ccLicenseUrl(name) {
  const t = String(name || '').trim();
  const m = /^CC (BY(?:-NC)?(?:-SA|-ND)?) (\d\.\d)$/i.exec(t);
  if (m) return `https://creativecommons.org/licenses/${m[1].toLowerCase()}/${m[2]}/`;
  return /^CC0\b/i.test(t) ? 'https://creativecommons.org/publicdomain/zero/1.0/' : null;
}
// Commons fills a missing author with "No machine-readable author provided. X assumed": a guess, not a recorded author.
const recordedAuthor = (a) => (/no machine-readable author|\bassumed\b|^unknown\b|^anonymous\b/i.test(String(a || '')) ? '' : a);
export const photoRecord = (ph, base = {}) => licensedImage({ ...base, author: recordedAuthor(ph?.author), license: ph?.license, license_url: ph?.license_url || ccLicenseUrl(ph?.license), source_page: ph?.source_page });

/** What the /og/news card embeds (workers/tennis-web/src/index.js): the catalog hero photo, else portrait heads. */
export function newsCardParts(a) {
  const h = a?.media?.hero;
  const first = h?.images?.[0];
  if (first?.kind === 'catalog' && first.id) return [photoRecord(first)];
  if (h?.type === 'portrait') return (h.images || []).slice(0, 2).map((x) => photoRecord(x));
  return [];
}

// ---- JSON-LD ------------------------------------------------------------------------------------------
export const ORGANIZATION = { '@type': 'Organization', '@id': 'https://propbetedge.ai/#organization', name: 'PropBetEdge', url: 'https://propbetedge.ai', logo: imageObject(ownedImage({ url: `${SITE}/brand/icon-512.png`, width: 512, height: 512, caption: 'PropBetEdge' })), sameAs: [X_URL] };
export const WEBSITE = { '@type': 'WebSite', '@id': `${SITE}/#site`, name: BRAND, url: `${SITE}/`, publisher: { '@id': ORGANIZATION['@id'] } };

export function breadcrumb(items) {
  // a path is site-relative; an absolute URL (the network root) is used as given
  return { '@type': 'BreadcrumbList', itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: /^https?:/.test(path) ? path : canonicalUrl(path) })) };
}

/** Site-level graph (network identity convention: Organization sameAs the canonical X profile). */
export function siteJsonLd() {
  return { '@context': 'https://schema.org', '@graph': [ORGANIZATION, WEBSITE] };
}

/** The page's graph: Organization + WebSite + WebPage (+ route-specific nodes passed in m.jsonld). */
export function jsonLdGraph(m) {
  const page = { '@type': 'WebPage', '@id': `${m.canonical}#page`, url: m.canonical, name: m.title, description: m.description, isPartOf: { '@id': WEBSITE['@id'] } };
  return { '@context': 'https://schema.org', '@graph': [ORGANIZATION, WEBSITE, page, ...(m.jsonld || [])] };
}

/** Person — only what the source proves (name, nationality code, birth date, image). */
export function personLd(p, canonical) {
  const n = { '@type': 'Person', '@id': `${canonical}#person`, name: p.name, url: canonical };
  if (p.nationality) n.nationality = p.nationality;
  if (p.dob) n.birthDate = p.dob;
  if (p.photo?.square) n.image = imageObject(photoRecord(p.photo, { url: p.photo.square, caption: p.name }));
  n.knowsAbout = 'Tennis';
  return n;
}

/** SportsEvent — only when players and tournament are known. */
export function sportsEventLd(m, canonical) {
  const players = ['A', 'B'].flatMap((s) => m.sides?.[s]?.players || []);
  if (players.length < 2 || !m.tournament?.tournament) return null;
  const n = { '@type': 'SportsEvent', '@id': `${canonical}#event`, name: `${players.map((p) => p.name).join(' vs ')} — ${m.tournament.tournament}`, sport: 'Tennis', url: canonical, competitor: players.map((p) => ({ '@type': 'Person', name: p.name, url: canonicalUrl(`/players/${p.slug}`) })) };
  const status = { scheduled: 'https://schema.org/EventScheduled', in_progress: 'https://schema.org/EventScheduled', completed: 'https://schema.org/EventScheduled', suspended: 'https://schema.org/EventPostponed' }[m.status];
  if (status) n.eventStatus = status;
  if (m.scheduled_at && /T\d{2}:\d{2}/.test(m.scheduled_at)) n.startDate = m.scheduled_at;
  else if (m.tournament.start_date) n.startDate = m.tournament.start_date;
  if (m.tournament.city) n.location = { '@type': 'Place', name: [m.tournament.city, m.tournament.country].filter(Boolean).join(', ') };
  return n;
}

export function itemListLd(name, items) {
  return { '@type': 'ItemList', name, itemListElement: items.map(([label, path], i) => ({ '@type': 'ListItem', position: i + 1, name: label, url: canonicalUrl(path) })) };
}

/** NewsArticle — published stories only; headline/dates/image/author are the story's own stored fields. */
export function newsArticleLd(a, canonical, image, ctx = {}) {
  const n = { '@type': 'NewsArticle', '@id': `${canonical}#article`, mainEntityOfPage: canonical, url: canonical, headline: String(a.headline).slice(0, 110), description: a.dek || undefined, datePublished: a.first_published_at || a.published_at, dateModified: a.updated_at || a.published_at, author: { '@type': 'Organization', name: 'PropBetEdge Tennis Desk', url: `${SITE}/news` }, publisher: { '@id': ORGANIZATION['@id'] }, isPartOf: { '@id': WEBSITE['@id'] }, articleSection: ctx.section || 'Tennis' };
  const card = image ? imageObject(compositeImage({ url: image.url || image, width: image.width, height: image.height, caption: image.alt, year: a.first_published_at || a.published_at, parts: newsCardParts(a) })) : null;
  const photos = ctx.photos ? ctx.photos.map((ph) => imageObject(photoRecord(ph, { url: ph.square, caption: ph.name }))) : ctx.images || [];
  const images = [card, ...photos].filter(Boolean);
  if (images.length) n.image = images;
  // entities only from the frozen evidence: people by their canonical player page (the same #person @id the
  // player pages publish), the match by its match page event, the edition by its tournament page
  const person = (p) => ({ '@type': 'Person', '@id': `${canonicalUrl(`/players/${p.slug}`)}#person`, name: p.name, url: canonicalUrl(`/players/${p.slug}`) });
  const about = [...(ctx.featured || []).map(person), ...(ctx.match_id ? [{ '@type': 'SportsEvent', '@id': `${canonicalUrl(`/matches/${ctx.match_id}`)}#event`, url: canonicalUrl(`/matches/${ctx.match_id}`) }] : [])];
  const mentions = [...(ctx.people || []).map(person), ...(ctx.tournament?.slug ? [{ '@type': 'Event', name: `${ctx.tournament.name} ${ctx.tournament.year}`, url: canonicalUrl(`/tournaments/${ctx.tournament.slug}/${ctx.tournament.year}`) }] : [])];
  if (about.length) n.about = about;
  if (mentions.length) n.mentions = mentions;
  return n;
}
