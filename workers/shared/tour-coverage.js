// Per-tour coverage semantics — PURE, shared by tennis-api (schedule/today/tournament meta) and the
// /sources page. One product: each tour's layers (results, schedule, live, rankings) are stated with their
// provenance. ATP Tour data comes from a secondary source (ESPN) and is never described as official ATP data.

export const TOUR_COVERAGE = Object.freeze({
  atp: {
    label: 'ATP Tour',
    provenance: 'secondary',
    source: 'ESPN (secondary source; not an official ATP feed)',
    tournaments_results: 'ATP Tour events and results 2007–present (singles, doubles, mixed); tournament level and surface are not published by this source',
    schedule: 'fixtures only once the secondary source lists them (usually the draw and the next day’s order of play)',
    live: 'set and game score from the secondary source while a match is observed live; no point-by-point',
    rankings: 'weekly ATP singles list, top 100–150, carried by the secondary source — not an official ATP ranking; no ATP doubles list'
  },
  wta: {
    label: 'WTA Tour', provenance: 'official', source: 'WTA (official)',
    tournaments_results: 'WTA 250–1000 and WTA Finals editions', schedule: 'official order of play', live: 'official live score with point score and server', rankings: 'official WTA singles and doubles lists'
  },
  'wta-125': {
    label: 'WTA 125', provenance: 'official', source: 'WTA (official)',
    tournaments_results: 'WTA 125 editions', schedule: 'official order of play', live: 'official live score with point score and server', rankings: 'official WTA singles and doubles lists'
  },
  'grand-slam': {
    label: 'Grand Slams', provenance: 'official + secondary', source: 'official Grand Slam feeds where accessible, else the WTA feed (women) and ESPN (men, secondary)',
    tournaments_results: 'every event of each edition we hold: men’s and women’s singles and doubles, mixed doubles, qualifying',
    schedule: 'as each source publishes it', live: 'as each source publishes it', rankings: 'n/a'
  }
});

