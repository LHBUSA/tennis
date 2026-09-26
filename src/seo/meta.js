// One module decides title / description / canonical / robots / Open Graph / X card / JSON-LD for every
// route. Used by the prerender step (static routes), tennis-web (edge heads for data routes) and the
// browser router (client navigation). PURE.

export const SITE = 'https://tennis.propbetedge.ai';
export const BRAND = 'PropBetEdge Tennis';
export const X_HANDLE = '@PROPBETEDGE';
export const X_URL = 'https://x.com/PROPBETEDGE';
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
    jsonld: overrides.jsonld || null
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
  const ld = jsonLdGraph(m);
  tags.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
  return tags.join('\n    ');
}

// ---- JSON-LD ------------------------------------------------------------------------------------------
export const ORGANIZATION = { '@type': 'Organization', '@id': 'https://propbetedge.ai/#org', name: 'PropBetEdge', url: 'https://propbetedge.ai', sameAs: [X_URL] };
export const WEBSITE = { '@type': 'WebSite', '@id': `${SITE}/#site`, name: BRAND, url: `${SITE}/`, publisher: { '@id': ORGANIZATION['@id'] } };

export function breadcrumb(items) {
  return { '@type': 'BreadcrumbList', itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: canonicalUrl(path) })) };
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
  if (p.photo?.square) n.image = p.photo.square;
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
