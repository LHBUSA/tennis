// Tour classification for tournament editions — one Tennis product, ATP and WTA as peers.
//
// Official WTA calendar editions carry their own level ('WTA 1000' ... 'WTA 125'); Grand Slams carry
// 'Grand Slam' whatever feed wrote them. ATP Tour editions come from ESPN (secondary source): ESPN publishes
// no tour level, so those rows have level = null and source_family = 'espn'. An ESPN edition is classified
// ATP only when it actually holds men's singles matches (the ATP league feed writes MS/MD/XD; ESPN WTA-league
// editions that did not map onto an official WTA edition hold WS/WD) and it is not a team or exhibition
// competition (competition_key null or atp_finals). Nothing is inferred from the name.

import { inList } from '../../shared/store/postgrest.js';
import { TOUR_LEVELS } from './shape.js';
import { TOUR_COVERAGE } from '../../shared/tour-coverage.js';

export { TOUR_COVERAGE };

export const TOUR_FILTERS = ['atp', 'wta', 'wta-125', 'grand-slam'];
const ATP_COMPETITIONS = new Set([null, 'atp_finals']);

/** Pure: the product tour of one edition row. `atpIds` = editions proven to hold men's singles. */
export function editionTour(e, atpIds = new Set()) {
  if (!e) return null;
  if (e.level === 'Grand Slam') return 'grand-slam';
  if (e.level === 'WTA 125') return 'wta-125';
  if (/^WTA (1000|500|250|Finals)$/.test(e.level || '')) return 'wta';
  if (e.level == null && e.source_family === 'espn' && ATP_COMPETITIONS.has(e.competition_key ?? null) && atpIds.has(e.edition_id)) return 'atp';
  return null;
}

/** Pure: does a tour filter keep this tour? (no filter keeps everything classified) */
export const keepTour = (filter, tour) => !!tour && (!filter || !TOUR_FILTERS.includes(filter) || filter === tour);

const ED_COLS = 'edition_id,year,name,level,surface,indoor,start_date,end_date,city,country,source_status,source_family,competition_key,updated_at';

/**
 * Editions overlapping [from, to] across every covered tour: official WTA-level + Grand Slam rows, and ESPN
 * ATP rows (level null) proven by a stored men's singles match. `extra` adds select columns/embeds.
 * Returns rows with `tour` set; unclassified rows (ITF, unmapped ESPN WTA editions, team events) are dropped.
 */
export async function coveredEditions(store, from, to, { extra = 'tennis_tournaments(slug,name)', limit = 300 } = {}) {
  const sel = `select=${ED_COLS},${extra}`;
  const win = `start_date=lte.${to}&end_date=gte.${from}&order=start_date.asc,name.asc&limit=${limit}`;
  const [tour, espn] = await Promise.all([
    store.select('tennis_tournament_editions', `${sel}&${win}&level=${inList(TOUR_LEVELS)}`),
    // ONE query: each ESPN candidate edition embeds at most one of its men's singles matches (index on edition_id;
    // an edition without one embeds []) — no per-edition probes, so a multi-year window stays one request
    store.select('tennis_tournament_editions', `${sel},tennis_matches(match_id)&tennis_matches.event_type=eq.MS&tennis_matches.limit=1&${win}&level=is.null&source_family=eq.espn`).catch(() => [])
  ]); // an ATP-query failure degrades to the official tours, never fails the page
  const atpIds = new Set(espn.filter((e) => Array.isArray(e.tennis_matches) && e.tennis_matches.length).map((e) => e.edition_id));
  return [...tour, ...espn.map(({ tennis_matches: _ms, ...e }) => e)]
    .map((e) => ({ ...e, tour: editionTour(e, atpIds) }))
    .filter((e) => e.tour)
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)) || String(a.name).localeCompare(String(b.name)));
}
