// Declarative data pages. Each module names the tennis-api endpoint that will back it and the exact
// truthful note shown while that endpoint has no data. Pages never invent content to fill space.

const title = (s) => String(s || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const PAGE_SPECS = {
  live: () => ({
    eyebrow: 'Live', heading: 'Live Now',
    lede: 'Every professional match in progress — ATP, WTA, Challenger, WTA 125, ITF and the Slams — once a live source adapter is in production.',
    modules: [{ key: 'live', title: 'Matches in progress', endpoint: '/v1/live', note: 'No live source is connected yet. When one is, a day with zero live matches will say exactly that.' }]
  }),
  matches: () => ({
    eyebrow: 'Matches', heading: 'Matches',
    lede: 'Scheduled, live and completed matches across tours, singles and doubles.',
    modules: [{ key: 'matches', title: 'Order of play', endpoint: '/v1/matches', note: 'The canonical match store is not populated yet.' }]
  }),
  match: ({ id }) => ({
    eyebrow: 'Match Lab', heading: 'Match Lab',
    lede: 'Identity, rankings, surface strength, form, draw path, head-to-head, serve/return comparison and the frozen PBE evaluation for one match.',
    modules: [
      { key: 'match', title: 'Match', endpoint: `/v1/matches/${encodeURIComponent(id)}`, note: 'This match is not in the canonical store.' },
      { key: 'stats', title: 'Match statistics', endpoint: `/v1/matches/${encodeURIComponent(id)}/stats`, note: 'No statistics source is connected yet.' }
    ]
  }),
  tenniscast: () => ({
    eyebrow: 'TennisCast', heading: 'TennisCast',
    lede: 'Point-by-point live state: score, server, set history, break and set points, and a replayable event stream. The scoring engine is built and tested; no live feed is connected.',
    modules: [{ key: 'live', title: 'Live matches', endpoint: '/v1/live', note: 'TennisCast shows only observed points. It will never reconstruct points from a final score.' }]
  }),
  players: () => ({
    eyebrow: 'Players', heading: 'Players',
    lede: 'One canonical identity per player across ATP, WTA, ITF and team competitions — singles and doubles.',
    modules: [{ key: 'players', title: 'Player directory', endpoint: '/v1/players', note: 'The identity graph is not populated yet. No player appears here until identity is proven.' }]
  }),
  player: ({ slug }) => ({
    eyebrow: 'Player', heading: title(slug),
    lede: 'Profile, ranking history, surface splits and Tennis DNA.',
    modules: [{ key: 'player', title: 'Profile', endpoint: `/v1/players/${encodeURIComponent(slug)}`, note: 'This player is not in the canonical store.' }]
  }),
  'player-sub': ({ slug, tab }) => ({
    eyebrow: title(tab), heading: title(slug),
    lede: { dna: 'Tennis DNA v1: serve, return and pressure metrics with sample, confidence and as-of date.', matches: 'Match history.', surfaces: 'Opponent-adjusted strength and splits by surface.', rankings: 'Official ranking snapshots over time.' }[tab],
    modules: [{ key: tab, title: title(tab), endpoint: `/v1/players/${encodeURIComponent(slug)}/${tab === 'surfaces' ? 'dna' : tab}`, note: 'No data for this player yet.' }]
  }),
  h2h: ({ a, b }) => ({
    eyebrow: 'H2H Lab', heading: `${title(a)} vs ${title(b)}`,
    lede: 'Head-to-head is descriptive evidence with surface and recency context — not the PBE prediction.',
    modules: [{ key: 'h2h', title: 'Meetings', endpoint: `/v1/h2h/${encodeURIComponent(a)}/${encodeURIComponent(b)}`, note: 'Match history is not populated yet.' }]
  }),
  tournaments: () => ({
    eyebrow: 'Tournaments', heading: 'Tournaments',
    lede: 'The calendar across Grand Slams, ATP/WTA, Challenger, WTA 125, ITF and team competitions.',
    modules: [{ key: 'tournaments', title: 'Calendar', endpoint: '/v1/tournaments', note: 'No calendar source is in production yet.' }]
  }),
  tournament: ({ slug, year }) => ({
    eyebrow: `Tournament · ${year}`, heading: title(slug),
    lede: 'Edition overview, events and draws.',
    modules: [{ key: 'tournament', title: 'Edition', endpoint: `/v1/tournaments/${encodeURIComponent(`${slug}-${year}`)}`, note: 'This edition is not in the canonical store.' }]
  }),
  'tournament-sub': ({ slug, year, event }) => ({
    eyebrow: `${title(slug)} · ${year}`, heading: event === 'draw' ? 'Draw Explorer' : title(event),
    lede: 'Seeds, qualifiers, wild cards, lucky losers, byes, withdrawals and results. Projected opponents, when shown, are labeled as projections.',
    modules: [{ key: 'draw', title: 'Draw', endpoint: `/v1/tournaments/${encodeURIComponent(`${slug}-${year}`)}/draws`, note: 'No draw source is in production yet.' }]
  }),
  rankings: () => ({
    eyebrow: 'Rankings', heading: 'Rankings',
    lede: 'Official ATP and WTA singles and doubles rankings, archived weekly so history is ours. Any projection is labeled PBE PROJECTED RANK — never an official ranking.',
    links: [['/rankings/men', 'ATP singles'], ['/rankings/women', 'WTA singles'], ['/rankings/men/doubles', 'ATP doubles'], ['/rankings/women/doubles', 'WTA doubles']],
    modules: [{ key: 'rankings', title: 'Latest snapshots', endpoint: '/v1/rankings', note: 'No ranking snapshot is stored yet.' }]
  }),
  'rankings-list': ({ tour }, route) => ({
    eyebrow: 'Rankings', heading: `${tour === 'men' ? 'ATP' : 'WTA'} ${route.doubles ? 'Doubles' : 'Singles'} Rankings`,
    lede: 'Official ranking snapshot with movement and points, as published.',
    modules: [{ key: 'rankings', title: 'Snapshot', endpoint: `/v1/rankings?tour=${tour === 'men' ? 'atp' : 'wta'}&type=${route.doubles ? 'doubles' : 'singles'}`, note: 'No ranking snapshot is stored yet.' }]
  }),
  'pbe-picks': () => ({
    eyebrow: 'PBE Picks', heading: 'PBE Picks',
    lede: 'Locked pre-match model calls. None exist: the PBE Tennis model has not been trained or validated out of sample, and picks will not launch before it is.',
    modules: [{ key: 'picks', title: 'Today’s locked picks', endpoint: '/v1/pbe-picks', note: 'No picks. This page will never show a pick that was not locked before the match.' }]
  }),
  'track-record': () => ({
    eyebrow: 'Track Record', heading: 'Track Record',
    lede: 'Every graded PBE pick — wins, losses, pushes and voids, with ROI only where a real recorded price exists. Losing periods stay visible.',
    modules: [{ key: 'track', title: 'Graded picks', endpoint: '/v1/track-record', note: 'No picks have been locked, so nothing has been graded.' }]
  }),
  news: () => ({
    eyebrow: 'Newsroom', heading: 'Tennis News',
    lede: 'Original, evidence-grounded tennis journalism generated from events in our own data graph. A story that fails a factual gate is held, not published.',
    links: [['/news/atp', 'ATP'], ['/news/wta', 'WTA'], ['/news/challenger', 'Challenger'], ['/news/itf', 'ITF'], ['/news/doubles', 'Doubles']],
    modules: [{ key: 'news', title: 'Latest', endpoint: '/v1/news', note: 'The newsroom has no evidence graph to write from yet. A quiet day produces no filler.' }]
  }),
  'news-desk': ({ desk }) => ({
    eyebrow: 'Newsroom', heading: `${desk === 'itf' || desk === 'atp' || desk === 'wta' ? desk.toUpperCase() : title(desk)} News`,
    lede: 'Desk coverage from the evidence-grounded newsroom.',
    modules: [{ key: 'news', title: 'Latest', endpoint: `/v1/news?desk=${desk}`, note: 'No stories published.' }]
  }),
  doubles: () => ({
    eyebrow: 'Doubles Lab', heading: 'Doubles Lab',
    lede: 'Pairs are first-class participants: pair record, continuity, surface splits, match-tiebreak record and — once statistically defensible — Partner Lift.',
    modules: [{ key: 'pairs', title: 'Pairs', endpoint: '/v1/doubles/pairs/index', note: 'No doubles results are stored yet.' }]
  }),
  'breakout-watch': () => ({
    eyebrow: 'Breakout Watch', heading: 'Breakout Watch',
    lede: 'A transparent index of players climbing ITF → Challenger / WTA 125 → tour main draws. It will not be called predictive until a historical backtest is published.',
    modules: [{ key: 'breakout', title: 'Index', endpoint: '/v1/breakout-watch', note: 'Methodology and backtest are not published yet.' }]
  })
};
