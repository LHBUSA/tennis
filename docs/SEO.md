# SEO

- Route authority: `src/lib/routes.js` (pure; used by browser router, prerender, sitemap, tests).
  Enumerated params (player tabs, draw events, ranking tours, news desks, 4-digit years) are validated —
  unknown combinations are 404, not thin pages.
- `scripts/prerender.mjs` writes each static route's own HTML head (title, description, canonical,
  robots, OG) and a noindex `app-shell.html` for parameterized routes (Vercel rewrite fallback,
  `X-Robots-Tag: noindex`).
- **Indexable today: `/`, `/sources`, `/methodology` only.** Data routes are `noindex, follow` until
  the canonical store serves real content for them. `sitemap.xml` lists only indexable routes.
- Canonicals: `https://tennis.propbetedge.ai<path>`, no trailing slash, no query.
- JSON-LD: Organization + WebSite now; Person, SportsEvent, NewsArticle, BreadcrumbList with data.
- No claim of an official relationship with any tour, federation or tournament.
