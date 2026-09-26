// One function decides title / description / canonical / robots for every route. The prerender step
// writes it into each static HTML file; the browser router applies the same result on navigation.

export const SITE = 'https://tennis.propbetedge.ai';
export const BRAND = 'PropBetEdge Tennis';
export const INDEX_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1';
export const NOINDEX_ROBOTS = 'noindex, follow';

export function canonicalUrl(path) {
  return `${SITE}${path === '/' ? '/' : path}`;
}

export function routeMeta(resolved) {
  const r = resolved.route;
  const title = resolved.id === 'today' ? r.title : `${r.title} | ${BRAND}`;
  return {
    title,
    description: r.description,
    robots: r.index ? INDEX_ROBOTS : NOINDEX_ROBOTS,
    canonical: canonicalUrl(resolved.path),
    path: resolved.path,
    type: 'website'
  };
}

/** JSON-LD for the site shell. No claim of any relationship with a tour, federation or tournament. */
export function siteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'PropBetEdge', url: 'https://propbetedge.ai/' },
      { '@type': 'WebSite', '@id': `${SITE}/#site`, name: BRAND, url: `${SITE}/`, publisher: { '@id': `${SITE}/#org` } }
    ]
  };
}

export function headHtml(m) {
  const e = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return [
    `<title>${e(m.title)}</title>`,
    `<meta name="description" content="${e(m.description)}" />`,
    `<meta name="robots" content="${e(m.robots)}" />`,
    `<link rel="canonical" href="${e(m.canonical)}" />`,
    `<meta property="og:site_name" content="${BRAND}" />`,
    `<meta property="og:type" content="${e(m.type)}" />`,
    `<meta property="og:url" content="${e(m.canonical)}" />`,
    `<meta property="og:title" content="${e(m.title)}" />`,
    `<meta property="og:description" content="${e(m.description)}" />`,
    `<meta name="twitter:card" content="summary" />`
  ].join('\n    ');
}
