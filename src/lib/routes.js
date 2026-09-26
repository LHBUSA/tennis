// Route authority for tennis.propbetedge.ai. PURE (no DOM) so the prerender script, the sitemap and
// the tests read the same table the browser router uses. docs/SEO.md.
//
// `index: true` only when the route has substantive, truthful content TODAY. Data routes flip to
// indexable once the canonical store serves them — never because a URL pattern exists.

export const ROUTE_TABLE = [
  { id: 'today', path: '/', title: 'PropBetEdge Tennis — Global Tennis Intelligence', description: 'PropBetEdge Tennis is an independent tennis intelligence platform being built on its own canonical data graph: ATP, WTA, Challenger, ITF and Grand Slam singles, doubles and mixed doubles.', index: true },
  { id: 'live', path: '/live', title: 'Live Tennis Matches', description: 'Matches in progress across professional tours.', index: false },
  { id: 'matches', path: '/matches', title: 'Tennis Matches', description: 'Scheduled, live and completed professional tennis matches.', index: false },
  { id: 'match', path: '/matches/:id', title: 'Match Lab', description: 'Match Lab: identity, form, surface strength and head-to-head for one match.', index: false },
  { id: 'tenniscast', path: '/tenniscast', title: 'TennisCast', description: 'TennisCast: point-by-point live match state.', index: false },
  { id: 'players', path: '/players', title: 'Tennis Players', description: 'Professional tennis player directory.', index: false },
  { id: 'player', path: '/players/:slug', title: 'Player', description: 'Player profile.', index: false },
  { id: 'player-sub', path: '/players/:slug/:tab', title: 'Player', description: 'Player intelligence.', index: false, tabs: ['dna', 'matches', 'surfaces', 'rankings'] },
  { id: 'h2h', path: '/h2h/:a/:b', title: 'Head-to-Head Lab', description: 'Head-to-head record and context.', index: false },
  { id: 'tournaments', path: '/tournaments', title: 'Tennis Tournaments', description: 'Professional tennis tournament calendar.', index: false },
  { id: 'tournament', path: '/tournaments/:slug/:year', title: 'Tournament', description: 'Tournament edition.', index: false },
  { id: 'tournament-sub', path: '/tournaments/:slug/:year/:event', title: 'Tournament', description: 'Tournament draw.', index: false, events: ['draw', 'mens-singles', 'womens-singles', 'mens-doubles', 'womens-doubles', 'mixed-doubles'] },
  { id: 'rankings', path: '/rankings', title: 'Tennis Rankings', description: 'ATP and WTA ranking snapshots.', index: false },
  { id: 'rankings-list', path: '/rankings/:tour', title: 'Tennis Rankings', description: 'Ranking snapshots.', index: false, tours: ['men', 'women'] },
  { id: 'rankings-list', path: '/rankings/:tour/doubles', title: 'Doubles Rankings', description: 'Doubles ranking snapshots.', index: false, tours: ['men', 'women'], doubles: true },
  { id: 'pbe-picks', path: '/pbe-picks', title: 'PBE Picks', description: 'Locked pre-match PBE model calls.', index: false },
  { id: 'track-record', path: '/track-record', title: 'Track Record', description: 'Graded PBE picks.', index: false },
  { id: 'news', path: '/news', title: 'Tennis News', description: 'Evidence-grounded tennis newsroom.', index: false },
  { id: 'news-desk', path: '/news/:desk', title: 'Tennis News', description: 'Tennis newsroom desk.', index: false, desks: ['atp', 'wta', 'challenger', 'itf', 'doubles'] },
  { id: 'doubles', path: '/doubles', title: 'Doubles Lab', description: 'Doubles pair intelligence.', index: false },
  { id: 'breakout-watch', path: '/breakout-watch', title: 'Breakout Watch', description: 'Players climbing the professional ladder.', index: false },
  { id: 'labs', path: '/labs', title: 'Labs', description: 'PropBetEdge Tennis labs and tools.', index: false },
  { id: 'methodology', path: '/methodology', title: 'Methodology — Tennis DNA v1 Definitions', description: 'How PropBetEdge Tennis defines every derived number: Tennis DNA v1 formulas, sample sizes, confidence tiers and as-of rules.', index: true },
  { id: 'sources', path: '/sources', title: 'Sources — Where PropBetEdge Tennis Data Comes From', description: 'Every tennis data source PropBetEdge has audited, what it provides, and the latest canary result.', index: true }
];

function compile(path) {
  const keys = [];
  const re = path.replace(/:[a-z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; });
  return { re: new RegExp(`^${re}$`), keys };
}
const COMPILED = ROUTE_TABLE.map((r) => ({ ...r, ...compile(r.path) }));

export function normalizePath(pathname) {
  let p = String(pathname || '/').split('?')[0].split('#')[0];
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
}

/** Resolve a pathname -> { id, params, path, route }. Enumerated params are validated; unknown -> not-found. */
export function resolveRoute(pathname) {
  const path = normalizePath(pathname);
  for (const r of COMPILED) {
    const m = r.re.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    if (r.tabs && !r.tabs.includes(params.tab)) continue;
    if (r.events && !r.events.includes(params.event)) continue;
    if (r.tours && !r.tours.includes(params.tour)) continue;
    if (r.desks && !r.desks.includes(params.desk)) continue;
    if (params.year && !/^\d{4}$/.test(params.year)) continue;
    return { id: r.id, params, path, route: r };
  }
  return { id: 'not-found', params: {}, path, route: { id: 'not-found', title: 'Not found', description: 'This page does not exist.', index: false } };
}

/** Static (param-free) routes: prerendered with their own head, listed in the sitemap if indexable. */
export const STATIC_ROUTES = ROUTE_TABLE.filter((r) => !r.path.includes(':'));
