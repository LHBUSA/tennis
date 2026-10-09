// Route authority for tennis.propbetedge.ai. PURE (no DOM) so the prerender script, the sitemap, the
// tennis-web head renderer and the tests read the same table the browser router uses. docs/SEO.md.
//
// `index`: static routes prerendered with their own head. `ssr`: parameterized routes whose head (title,
// canonical, OG, JSON-LD) is rendered at the edge by tennis-web from real data; they are indexable only
// when that data exists (tennis-web answers noindex otherwise).

export const ROUTE_TABLE = [
  { id: 'today', path: '/', title: 'PropBetEdge Tennis — Live Tennis Intelligence, Player Analytics & Match Data', description: 'ATP, WTA and Grand Slam tennis intelligence in one product: live scores, results, PBEcast, player analytics, Match DNA and rankings — independent tennis intelligence from PropBetEdge.', index: true },
  { id: 'men', path: '/men', title: 'Men’s Tennis Intelligence', description: 'Men’s tennis inside PropBetEdge Tennis: ATP Tour results since 2007, Grand Slam draws, the weekly ATP singles list from a secondary source, Match DNA, player profiles and PBEcast replays.', index: true },
  { id: 'schedule', path: '/schedule', title: 'Tennis Schedule — Today, Tomorrow & This Week', description: 'Today’s and upcoming professional tennis matches with live status, courts and PBEcast coverage.', index: true },
  { id: 'live', path: '/live', title: 'Live Tennis Scores', description: 'ATP, WTA and Grand Slam matches in progress right now with live set and game scores (point score where the source publishes it) and PBEcast.', index: true },
  { id: 'matches', path: '/matches', title: 'Tennis Matches Today', description: 'Every observed match at tournaments in progress today.', index: false },
  { id: 'match', path: '/matches/:id', title: 'Match', description: 'Match Lab.', index: false, ssr: true },
  { id: 'pbecast-hub', path: '/pbecast', title: 'Tennis PBEcast — Live Analytical Court & Replay', description: 'PBEcast: the live tennis court, score, serve and match intelligence — and replays of completed matches.', index: true },
  { id: 'pbecast', path: '/pbecast/:id', title: 'PBEcast', description: 'Tennis PBEcast.', index: false, ssr: true },
  { id: 'tenniscast', path: '/tenniscast', title: 'TennisCast', description: 'Moved to PBEcast.', index: false, redirect: '/pbecast' },
  { id: 'players', path: '/players', title: 'Tennis Players', description: 'ATP and WTA players in one directory: profiles, photos, rankings, results, Match DNA and Grand Slam history.', index: true },
  { id: 'player', path: '/players/:slug', title: 'Player', description: 'Player profile.', index: false, ssr: true },
  { id: 'player-sub', path: '/players/:slug/:tab', title: 'Player', description: 'Player intelligence.', index: false, tabs: ['dna', 'matches', 'surfaces', 'rankings'] },
  { id: 'h2h', path: '/h2h/:a/:b', title: 'Head-to-Head', description: 'Head-to-head record and context.', index: false },
  { id: 'tournaments', path: '/tournaments', title: 'Tennis Tournaments', description: 'Current and upcoming ATP Tour, WTA Tour, WTA 125 and Grand Slam tournaments — every event of each Grand Slam, with dates, draws and results.', index: true },
  { id: 'tournament', path: '/tournaments/:slug/:year', title: 'Tournament', description: 'Tournament edition.', index: false, ssr: true },
  { id: 'tournament-sub', path: '/tournaments/:slug/:year/:event', title: 'Tournament', description: 'Tournament draw.', index: false, events: ['draw', 'mens-singles', 'womens-singles', 'mens-doubles', 'womens-doubles', 'mixed-doubles', 'qualifying'] },
  { id: 'venue', path: '/venues/:slug', title: 'Venue', description: 'Tennis venue.', index: false },
  { id: 'rankings', path: '/rankings', title: 'Tennis Rankings', description: 'Official WTA singles and doubles rankings archived weekly, plus the weekly ATP singles list carried by a secondary source.', index: true },
  { id: 'rankings-list', path: '/rankings/women', title: 'WTA Singles Rankings', description: 'The official WTA singles ranking list as published, with movement against the previous list PropBetEdge archived.', index: true, fixed: { tour: 'women' } },
  { id: 'rankings-list', path: '/rankings/women/doubles', title: 'WTA Doubles Rankings', description: 'The official WTA doubles ranking list as published, archived weekly by PropBetEdge.', index: true, fixed: { tour: 'women' }, doubles: true },
  { id: 'rankings-list', path: '/rankings/men', title: 'ATP Singles Rankings', description: 'The weekly ATP singles list carried by a secondary source (not an official ATP feed), archived by PropBetEdge.', index: false, fixed: { tour: 'men' } },
  { id: 'rankings-list', path: '/rankings/men/doubles', title: 'ATP Doubles Rankings', description: 'ATP doubles rankings are not yet available.', index: false, fixed: { tour: 'men' }, doubles: true },
  { id: 'matchups', path: '/matchups', title: 'Tennis Matchups This Week — Win Probabilities & Matchup DNA', description: 'Every scheduled ATP and WTA singles match this week with its PBE Rating win probability, rating and surface edges, form, serve/return context and the model’s track record at that confidence.', index: true },
  { id: 'matchup', path: '/matchups/:id', title: 'Matchup DNA', description: 'Matchup DNA: win probability, why it exists, and labelled context.', index: false },
  { id: 'players-to-watch', path: '/players-to-watch', title: 'Tennis Players to Watch This Week — Biggest Rating Movers', description: 'The week’s biggest PropBetEdge Rating movements in men’s and women’s tennis: risers, fallers, surface risers, players rated above their ranking and emerging players, each with minimum samples.', index: true },
  { id: 'dna', path: '/dna', title: 'Tennis DNA — ATP & WTA Match DNA and Player Metrics', description: 'Tennis DNA for ATP and WTA players: results-based Match DNA with same-tour percentiles, plus serve, return and pressure metrics where match statistics exist — samples and confidence on every number.', index: true },
  { id: 'search', path: '/search', title: 'Search', description: 'Search players and tournaments.', index: false },
  { id: 'pbe-picks', path: '/pbe-picks', title: 'PBE Picks (Research)', description: 'Locked pre-match research selections for ATP and WTA singles (All Access). Research, not official picks.', index: false },
  { id: 'track-record', path: '/track-record', title: 'PBE Picks Track Record (Research)', description: 'Every resolved PBE research selection — right, missed and void — from the prospective ledgers. Research, not official picks.', index: false },
  { id: 'news', path: '/news', title: 'Tennis News — Data-Checked Stories from PropBetEdge', description: 'Tennis stories built from PropBetEdge match, ranking and Tennis DNA data, every number checked against frozen evidence.', index: true },
  { id: 'news-desk', path: '/news/:desk', title: 'Tennis News', description: 'PropBetEdge Tennis news desk.', index: false, desks: ['wta', 'atp', 'grand-slams', 'challenger', 'itf', 'doubles', 'rankings'] },
  { id: 'news-article', path: '/news/:slug', title: 'Tennis News', description: 'PropBetEdge Tennis story.', index: false, ssr: true },
  { id: 'doubles', path: '/doubles', title: 'Doubles Lab', description: 'Not live.', index: false },
  { id: 'breakout-watch', path: '/breakout-watch', title: 'Breakout Watch', description: 'Not live.', index: false },
  { id: 'labs', path: '/labs', title: 'More', description: 'PropBetEdge Tennis tools.', index: false },
  { id: 'all-access', path: '/all-access', title: 'All Access — Tennis Intelligence and the PropBetEdge Network', description: 'PropBetEdge All Access on Tennis: Tennis DNA, Matchup DNA win probabilities and Players to Watch, plus every PropBetEdge sport (MLB, NFL, NBA, WNBA, NHL, UFC, Soccer, Golf, F1 Intelligence) and PropBetEdge Predictions for $29/month.', index: true },
  { id: 'methodology', path: '/methodology', title: 'Methodology — Tennis DNA Definitions', description: 'How PropBetEdge Tennis defines every derived number: Match DNA (ATP and WTA, same-tour percentiles) and technical DNA formulas, sample sizes, confidence tiers and as-of rules.', index: true },
  { id: 'sources', path: '/sources', title: 'Sources — Where PropBetEdge Tennis Data Comes From', description: 'Every tennis data source PropBetEdge has audited, what it provides, and the latest canary result.', index: true },
  { id: 'credits', path: '/credits', title: 'Photo Credits', description: 'Every player photo on PropBetEdge Tennis with its author, license and source.', index: false },
  { id: 'coverage', path: '/coverage', title: 'Data Coverage', description: 'Internal: historical warehouse coverage.', index: false }
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
    const params = { ...(r.fixed || {}), ...Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    if (r.tabs && !r.tabs.includes(params.tab)) continue;
    if (r.events && !r.events.includes(params.event)) continue;
    if (r.desks && !r.desks.includes(params.desk)) continue;
    if (params.year && !/^\d{4}$/.test(params.year)) continue;
    if (params.id && r.id !== 'news-desk' && !/^[0-9a-f-]{36}$/.test(params.id)) continue;
    return { id: r.id, params, path, route: r };
  }
  return { id: 'not-found', params: {}, path, route: { id: 'not-found', title: 'Not found', description: 'This page does not exist.', index: false } };
}

/** Static (param-free) routes: prerendered with their own head, listed in the sitemap if indexable. */
export const STATIC_ROUTES = ROUTE_TABLE.filter((r) => !r.path.includes(':') && !r.redirect);
export const REDIRECTS = ROUTE_TABLE.filter((r) => r.redirect).map((r) => ({ source: r.path, destination: r.redirect }));
