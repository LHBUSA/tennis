// tennis-api — the public read API behind tennis.propbetedge.ai. docs/API.md.
//
// Reads the canonical store (Supabase, service role — never exposed) and returns the envelope with
// provenance + freshness on every response. Routes whose backing data does not exist yet (picks, odds,
// news, Breakout Watch) answer NOT_CONFIGURED with data: null — never a sample.

import { picksRoute, verificationSummary } from './picks-api.js';
import { envelope, notConfigured, json } from '../../shared/envelope.js';
import { health } from '../../shared/health.js';
import { storeFromEnv, inList } from '../../shared/store/postgrest.js';
import { buildDna } from '../../shared/dna/metric.js';
import registry from '../../../data/source-registry/sources.json' with { type: 'json' };
import canary from '../../../docs/evidence/source-canary-latest.json' with { type: 'json' };

export const VERSION = '0.10.8';

const TENNIS_ORIGIN = 'https://tennis.propbetedge.ai';
const PREMIUM_PATHS = [
  // PBE PICKS ledger incl. pending pre-match sides (All Access); /v1/picks/track-record (resolved proof) stays public
  /^\/v1\/picks(?:\/[0-9a-f-]{36})?$/,
  /^\/v1\/picks\/verification$/, // owner-only audit surface (state 'owner' checked after the membership gate)
  /^\/v1\/matchups(?:\/|$)/,
  /^\/v1\/players-to-watch(?:\/|$)/,
  /^\/v1\/dna(?:\/|$)/,
  /^\/v1\/players\/[^/]+\/dna$/,
];
// the homepage's capped free preview (3 boards x top 5) — Match DNA metrics with mature populations on both tours; must
// match src/pages/today.js HOME_DNA_BOARDS. Technical DNA (hold / break rate) is no longer previewed: ATP is below its gate.
const PUBLIC_DNA_PREVIEW_METRICS = new Set(['pbe_rating', 'match_win_rate', 'game_win_rate']);
const isPremiumPath = (path, url) => {
  if (path === '/v1/dna/leaders' && url.searchParams.get('preview') === '1') {
    const metric = url.searchParams.get('metric') || 'hold_rate';
    const limit = Number(url.searchParams.get('limit')) || 5; // raw value: a capped copy could never exceed 5
    return !PUBLIC_DNA_PREVIEW_METRICS.has(metric) || limit > 5;
  }
  return PREMIUM_PATHS.some((re) => re.test(path));
};

function corsFor(request) {
  const origin = request.headers.get('Origin') || '';
  return origin === TENNIS_ORIGIN
    ? { 'access-control-allow-origin': TENNIS_ORIGIN, 'access-control-allow-credentials': 'true', vary: 'Origin' }
    : { 'access-control-allow-origin': '*' };
}

/**
 * A cached response carries the CORS headers of the request that FILLED the cache (the key does not vary on Origin):
 * an Origin-less fill (curl, crawler, uptime check) stored `*`, and every later credentialed browser read of that URL
 * failed CORS for the whole TTL (seen 2026-10-01 on two homepage DNA boards). Re-issue CORS for THIS request.
 */
export function withCors(res, request) {
  const h = new Headers(res.headers);
  for (const k of ['access-control-allow-origin', 'access-control-allow-credentials']) h.delete(k);
  for (const [k, v] of Object.entries(corsFor(request))) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

async function membershipFor(request, env) {
  if (!env.AUTH) return { authenticated: false, reason: 'auth_unavailable', membership: { sport: 'tennis', state: 'free', entitled: false } };
  try {
    const headers = new Headers({ accept: 'application/json', Origin: TENNIS_ORIGIN });
    const cookie = request.headers.get('Cookie');
    if (cookie) headers.set('Cookie', cookie);
    const res = await env.AUTH.fetch(new Request('https://auth.propbetedge.ai/membership?sport=tennis', { method: 'GET', headers }));
    const body = await res.json();
    if (!res.ok || !body?.membership) return { authenticated: false, reason: 'auth_denied', membership: { sport: 'tennis', state: 'free', entitled: false } };
    return body;
  } catch {
    return { authenticated: false, reason: 'auth_unavailable', membership: { sport: 'tennis', state: 'free', entitled: false } };
  }
}


import { configureScheduleDay, PLAYER, MATCH, FINAL, TOUR_LEVELS, UUID, SLUG, today, addDays, shapeEdition, shapeMatch, hasBothSides, shapePlayer, shapePhoto, maxTime, families, MEDIA } from './shape.js';
import { v2Route } from './v2.js';
import { newsRoute, isPreview } from './news.js';
import { menRoute } from './men.js';
import { coveredEditions, editionTour, TOUR_FILTERS, TOUR_COVERAGE } from './tours.js';
import { matchupRoute } from './matchup.js';
import { videoRoute } from './videos.js';
import { scheduledRun } from './scheduled.js';
import { withMemo } from './memo.js';
import { withHeartbeat } from './store-heartbeat.js';
import { supersession } from './supersede.js';
import { resolveHero } from '../../shared/editorial.js';
import editorial from '../../../data/media/editorial-media.json' with { type: 'json' };
export { shapeMatch };

function ok(data, { rows = [], source = null, updated = null, policy, semantics, degraded = [] }) {
  return envelope(data, { source: source || families(rows), source_updated_at: updated ?? maxTime(rows), policy, semantics, degraded });
}

// ---- handlers ------------------------------------------------------------------------------------------
/** Live only when the edition is current and the source spoke recently: a finished edition's 'in progress'
 *  row (a source that never completed the match) is not live. */
export function isGenuinelyLive(m, now = Date.now()) {
  const end = m.tennis_tournament_editions?.end_date || m.tournament?.end_date;
  const src = m.source_updated_at ? Date.parse(m.source_updated_at) : null;
  // ESPN (secondary, game-level) rows are re-observed every ~20 s by tennis-live while live: 20 min without an
  // observation means nobody is watching the match any more, so it is not shown as live
  const maxAge = m.source_family === 'espn' || m.source === 'espn' ? 20 * 60e3 : 12 * 3600e3;
  return m.status === 'in_progress' && (!end || end >= new Date(now - 2 * 86400e3).toISOString().slice(0, 10)) && (src === null || now - src < maxAge);
}

/**
 * THE live contract, shared by /v1/live and /v1/today.live (one rule, never two): genuinely live (above) AND still
 * linked to a source. A row no source links to any more (its external ids moved to the surviving row of a duplicate
 * pair) can never be observed again: it is not live (2026-09-29: two 0-0 Adana rows from 09:10 shown next to their
 * finished duplicates). Callers must select tennis_match_external_ids(provider). Status is never inferred.
 */
export const isLiveRow = (m, now = Date.now()) => isGenuinelyLive(m, now) && (m.tennis_match_external_ids || []).length > 0;

/**
 * The live rows: ONE query (status-filtered, so small and fast) + isLiveRow. /v1/live serves these; /v1/today.live is
 * the intersection with them. Never embed external ids into the 600-row /today read: that query hit statement
 * timeout 57014 in production (2026-10-02, tennis-api 0.9.4 first deploy, rolled back within ~3 min).
 */
export async function liveRows(store, now = Date.now()) {
  return (await store.select('tennis_matches', `select=${MATCH},tennis_match_external_ids(provider)&status=eq.in_progress&order=updated_at.desc&limit=200`))
    .filter((m) => isLiveRow(m, now));
}

async function live(store) {
  const rows = await liveRows(store);
  return ok(rows.map(shapeMatch).filter(hasBothSides), { rows, policy: { currentS: 240, staleS: 900 }, semantics: 'matches whose latest observed source state is in progress, every tour and event type (MS, WS, MD, WD, XD); point score + server where the live source publishes them (point-level live), set and game scores only otherwise (game-level live)' });
}

async function editionsInWindow(store, from, to, all) {
  if (all) {
    const rows = await store.select('tennis_tournament_editions', `select=edition_id,year,name,level,surface,indoor,start_date,end_date,city,country,source_status,source_family,competition_key,updated_at,tennis_tournaments(slug,name)&start_date=lte.${to}&end_date=gte.${from}&order=start_date.asc,name.asc&limit=300`);
    return rows.map((e) => ({ ...e, tour: editionTour(e) }));
  }
  // every covered tour: official WTA levels + Grand Slams + ESPN ATP editions (tours.js)
  return coveredEditions(store, from, to);
}

const matchDay = (m) => m.source_updated_at || m.updated_at || '';
const withTour = (e) => ({ ...shapeEdition(e), tour: e.tour || null, status: e.source_status });

// A scheduled row can survive upstream after its start time passed (postponement,
// missing final, duplicate-source lag). /today must never advertise days-old rows as
// "upcoming". Keep a six-hour reconciliation grace window, matching Matchup DNA's
// stale-fixture contract, then suppress the row until the source corrects it.
export function isCurrentUpcoming(m, now = Date.now()) {
  if (m?.status !== 'scheduled' || !m?.scheduled_at) return false;
  const at = Date.parse(m.scheduled_at);
  return Number.isFinite(at) && at >= now - 6 * 3600e3;
}

async function todayView(store) {
  const d = today();
  const eds = await editionsInWindow(store, d, d, false);
  const ids = eds.map((e) => e.edition_id);
  // the 600-row read stays exactly as before (no embeds: see liveRows); the live set comes from liveRows in parallel
  const [matches, liveSet] = await Promise.all([
    ids.length ? store.select('tennis_matches', `select=${MATCH}&edition_id=${inList(ids)}&status=neq.superseded&order=source_updated_at.desc.nullslast&limit=600`) : [],
    ids.length ? liveRows(store) : [],
  ]);
  const tourOf = new Map(eds.map((e) => [e.edition_id, e.tour]));
  const shaped = matches.map((m) => ({ ...shapeMatch(m), tour: tourOf.get(m.edition_id) || null }));
  // live = the SAME rows /v1/live serves (liveRows). A stale / unlinked 'in_progress' row is simply not live; its
  // stored status is not rewritten or reinterpreted here.
  const liveIds = new Set(liveSet.map((m) => m.match_id));
  const data = {
    date: d,
    tournaments: eds.map((e) => ({ ...withTour(e), matches: shaped.filter((m) => m.tournament?.slug === e.tennis_tournaments?.slug && m.tournament?.year === e.year).length })),
    live: shaped.filter((m) => m.status === 'in_progress' && liveIds.has(m.id) && hasBothSides(m)),
    upcoming: shaped.filter((m) => isCurrentUpcoming(m)).sort((a, b) => String(a.scheduled_at || '9').localeCompare(String(b.scheduled_at || '9'))),
    // newest first by when we last observed the result (ESPN rows carry no source timestamp: our write time)
    // up to 20 newest per side of the sport (women's / men's + mixed), merged newest first: a burst of one tour's
    // results (e.g. a backfill) never pushes the other tour's finals off the list
    latest_results: (() => { const fin = shaped.filter((m) => FINAL.includes(m.status) && hasBothSides(m)).sort((a, b) => matchDay(b).localeCompare(matchDay(a))); return [...fin.filter((m) => /^W/.test(m.event_type || '')).slice(0, 20), ...fin.filter((m) => !/^W/.test(m.event_type || '')).slice(0, 20)].sort((a, b) => matchDay(b).localeCompare(matchDay(a))); })(),
    coverage: TOUR_COVERAGE
  };
  // a finished match has a PBEcast REPLAY only when we stored its events (observed live or source points): one row per
  // match (its first event) — the homepage never claims a replay for a result-only match
  const fin = data.latest_results.map((m) => m.id);
  if (fin.length) {
    const first = await store.select('tennis_match_events', `select=match_id,quality&event_sequence=eq.0&match_id=${inList(fin)}`).catch(() => []);
    const q = new Map(first.map((e) => [e.match_id, e.quality === 'point_event' ? 'point' : 'observed']));
    for (const m of data.latest_results) m.replay = q.get(m.id) || null;
  }
  return ok(data, { rows: matches, policy: { currentS: 300, staleS: 1800 }, semantics: 'editions in progress today across the ATP Tour (secondary source), WTA Tour, WTA 125 and the Grand Slams, and their observed matches', degraded: ['ATP Challenger and ITF match data are not yet acquirable; ATP Tour data comes from a secondary source (see /v1/sources)'] });
}

async function tournaments(store, url) {
  const d = today();
  const from = url.searchParams.get('from') || addDays(d, -7);
  const to = url.searchParams.get('to') || addDays(d, 60);
  const tour = url.searchParams.get('tour');
  const eds = (await editionsInWindow(store, from, to, url.searchParams.get('all') === '1')).filter((e) => !tour || !TOUR_FILTERS.includes(tour) || e.tour === tour);
  return ok(eds.map(withTour), { rows: eds, policy: { currentS: 6 * 3600, staleS: 48 * 3600 }, semantics: `tournament editions overlapping ${from}..${to}: ATP Tour (secondary source), WTA Tour, WTA 125 and Grand Slams${tour && TOUR_FILTERS.includes(tour) ? ` · tour=${tour}` : ''}` });
}

async function tournament(store, slug, year) {
  const t = await store.select('tennis_tournaments', `select=tournament_id,slug,name&slug=eq.${slug}`);
  if (!t.length) return null;
  const e = await store.select('tennis_tournament_editions', `select=edition_id,year,name,level,surface,indoor,start_date,end_date,city,country,source_status,source_family,competition_key,updated_at,tennis_tournaments(slug,name),tennis_venues(slug,city,country,venue_name,precision)&tournament_id=eq.${t[0].tournament_id}&year=eq.${year}`);
  if (!e.length) return null;
  const [matches, slots, attrs] = await Promise.all([
    store.select('tennis_matches', `select=${MATCH}&edition_id=eq.${e[0].edition_id}&status=neq.superseded&limit=1000`),
    store.select('tennis_draw_slots', `select=event_type,draw,position,participant_key,bye,seed,entry_type,source,source_ref,capture_id&edition_id=eq.${e[0].edition_id}&order=event_type.asc,draw.asc,position.asc&limit=1000`),
    store.select('tennis_edition_attributes', `select=attribute,value,source,method,source_ref&edition_id=eq.${e[0].edition_id}`)
  ]);
  // draws (additive 0.5.0): official draw-sheet slots proven against this edition's matches; unresolved slots stay null
  const pids = [...new Set(slots.map((x) => x.participant_key).filter((k) => k && k.startsWith('S:')).map((k) => k.slice(2)))];
  const people = pids.length ? new Map((await store.select('tennis_players', `select=pbe_player_id,slug,full_name,last_name,nationality,gender,${MEDIA}&pbe_player_id=${inList(pids)}`)).map((x) => [x.pbe_player_id, shapePlayer(x)])) : new Map();
  const draws = [];
  for (const sl of slots) {
    let d = draws.find((x) => x.event_type === sl.event_type && x.draw === sl.draw && x.source === sl.source);
    if (!d) { d = { event_type: sl.event_type, draw: sl.draw, source: sl.source, source_ref: sl.source_ref, capture_id: sl.capture_id, slots: [] }; draws.push(d); }
    d.slots.push({ position: sl.position, bye: sl.bye, seed: sl.seed, entry: sl.entry_type, player: sl.participant_key?.startsWith('S:') ? people.get(sl.participant_key.slice(2)) || null : null });
  }
  const surfaceProvenance = attrs.filter((x) => x.attribute === 'surface').map((x) => ({ value: x.value, source: x.source, method: x.method }));
  const tour = editionTour(e[0], new Set(matches.some((x) => x.event_type === 'MS') ? [e[0].edition_id] : []));
  return ok({ edition: { ...shapeEdition(e[0]), tour, tour_coverage: tour ? TOUR_COVERAGE[tour] : null, status: e[0].source_status, venue: e[0].tennis_venues || null, surface_provenance: surfaceProvenance }, media: { hero: resolveHero({ tournament: { slug, year }, featured_ids: [], player_ids: [] }, editorial) }, matches: matches.map(shapeMatch), draws }, { rows: [...e, ...matches], policy: { currentS: 300, staleS: 3600 }, semantics: 'one tournament edition with every observed match (all events and stages); draws = official draw-sheet slots proven against these matches' });
}

async function match(store, id) {
  const rows = await store.select('tennis_matches', `select=${MATCH}&match_id=eq.${id}`);
  if (!rows.length) return null;
  const [stats, changes] = await Promise.all([
    store.select('tennis_match_stats', `select=side,source_family,stats,captured_at&match_id=eq.${id}`),
    store.select('tennis_source_changes', `select=kind,field,from_value,to_value,observed_at,source_family&entity_type=eq.match&entity_id=eq.${id}&order=observed_at.asc&limit=200`)
  ]);
  const m = shapeMatch(rows[0]);
  Object.assign(m, await supersession(store, id, m.status));
  m.statistics = stats.length ? Object.fromEntries(stats.map((s) => [s.side, s.stats])) : null;
  m.observed_changes = changes;
  return ok(m, { rows, policy: { currentS: 240, staleS: 1800 }, semantics: 'canonical match; statistics are the source totals mapped to PropBetEdge keys; observed_changes are upstream mutations we recorded' });
}

async function latestSnapshot(store, listKey, date) {
  const q = date ? `&ranking_date=lte.${date}` : '';
  const snaps = await store.select('tennis_ranking_snapshots', `select=snapshot_id,list_key,ranking_date,row_count,captured_at,source_family&list_key=eq.${listKey}${q}&row_count=gt.0&order=ranking_date.desc&limit=1`);
  return snaps[0] || null;
}

async function rankings(store, url) {
  const tour = url.searchParams.get('tour') || 'wta';
  const type = url.searchParams.get('type') || 'singles';
  if (!['wta', 'atp'].includes(tour) || !['singles', 'doubles'].includes(type)) return envelope(null, { freshness: 'ERROR', semantics: 'invalid tour/type' });
  const listKey = `${tour}_${type}`;
  const snap = await latestSnapshot(store, listKey, url.searchParams.get('date'));
  if (!snap) return envelope(null, { freshness: 'UNAVAILABLE', semantics: `${listKey}: no complete snapshot stored`, degraded: tour === 'atp' ? ['ATP rankings: atptour.com refuses automated access; no legitimate path yet'] : [] });
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  const rows = await store.select('tennis_rankings', `select=rank,points,tournaments_played,provider_player_id,${PLAYER}&snapshot_id=eq.${snap.snapshot_id}&order=rank.asc&limit=${limit}&offset=${offset}`);
  const prev = await store.select('tennis_ranking_snapshots', `select=snapshot_id,ranking_date&list_key=eq.${listKey}&ranking_date=lt.${snap.ranking_date}&row_count=gt.0&order=ranking_date.desc&limit=1`);
  let prevRank = new Map();
  if (prev.length && rows.length) {
    const pr = await store.select('tennis_rankings', `select=provider_player_id,rank&snapshot_id=eq.${prev[0].snapshot_id}&provider_player_id=${inList(rows.map((r) => r.provider_player_id))}`);
    prevRank = new Map(pr.map((r) => [r.provider_player_id, r.rank]));
  }
  const data = {
    list: listKey, ranking_date: snap.ranking_date, previous_date: prev[0]?.ranking_date || null, total: snap.row_count,
    rows: rows.map((r) => ({ rank: r.rank, points: r.points, tournaments: r.tournaments_played, previous_rank: prevRank.get(r.provider_player_id) ?? null, player: shapePlayer(r.tennis_players) }))
  };
  return envelope(data, { source: [snap.source_family], source_updated_at: snap.captured_at, policy: { currentS: 8 * 86400, staleS: 15 * 86400 }, semantics: snap.source_family === 'espn' ? `${tour.toUpperCase()} ${type} list as carried by a secondary source (not an official ${tour.toUpperCase()} feed); ranking_date is the Monday from which the list is in force (the first Monday of the source's list week); movement compares with our archived previous list` : `official ${tour.toUpperCase()} ${type} list dated ${snap.ranking_date}, as published; movement compares with our archived previous list` });
}

async function playerBySlug(store, slug) {
  const col = UUID.test(slug) ? 'pbe_player_id' : 'slug';
  const p = await store.select('tennis_players', `select=pbe_player_id,slug,full_name,first_name,last_name,gender,dob,nationality,plays,height_cm,updated_at,${MEDIA}&${col}=eq.${slug}`);
  return p[0] || null;
}

async function playerMatchIds(store, pid) {
  const mem = await store.select('tennis_participant_members', `select=participant_key&pbe_player_id=eq.${pid}`);
  if (!mem.length) return [];
  // newest first (scheduled date, then last source update) so a long career never truncates the recent end
  return store.select('tennis_match_participants', `select=match_id,side,participant_key,tennis_matches!inner(scheduled_at,source_updated_at)&participant_key=${inList(mem.map((m) => m.participant_key))}&order=tennis_matches(scheduled_at).desc.nullslast&limit=2000`);
}

async function player(store, slug) {
  const p = await playerBySlug(store, slug);
  if (!p) return null;
  const [ext, ranks, mp] = await Promise.all([
    store.select('tennis_player_external_ids', `select=provider,external_id,method&pbe_player_id=eq.${p.pbe_player_id}`),
    store.select('tennis_rankings', `select=rank,points,tennis_ranking_snapshots!inner(list_key,ranking_date,source_family)&pbe_player_id=eq.${p.pbe_player_id}&order=tennis_ranking_snapshots(ranking_date).desc&limit=1000`),
    playerMatchIds(store, p.pbe_player_id)
  ]);
  const recent = mp.length ? await store.select('tennis_matches', `select=${MATCH}&match_id=${inList(mp.map((x) => x.match_id).slice(0, 60))}&status=neq.superseded&order=scheduled_at.desc.nullslast,source_updated_at.desc.nullslast&limit=25`) : [];
  const hist = ranks.map((r) => ({ list: r.tennis_ranking_snapshots.list_key, date: r.tennis_ranking_snapshots.ranking_date, rank: r.rank, points: r.points, source: r.tennis_ranking_snapshots.source_family })).sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = {};
  for (const r of hist) if (!latest[r.list]) latest[r.list] = { rank: r.rank, points: r.points, date: r.date, secondary_source: r.source === 'espn' };
  const data = {
    id: p.pbe_player_id, slug: p.slug, name: p.full_name, first_name: p.first_name, last_name: p.last_name, gender: p.gender, dob: p.dob, nationality: p.nationality,
    external_ids: ext.filter((e) => e.provider !== 'commons_image').map((e) => ({ provider: e.provider, id: e.external_id })),
    rankings: latest, ranking_history: hist, recent_matches: recent.map(shapeMatch), photo: shapePhoto(p.tennis_player_media)
  };
  return ok(data, { rows: recent, source: [...new Set(['wta', ...families(recent)])], updated: p.updated_at, policy: { currentS: 86400, staleS: 7 * 86400 }, semantics: 'canonical player: identity crosswalk, official ranking history we archived, recent observed matches' });
}

async function playerDna(store, slug, url) {
  const p = await playerBySlug(store, slug);
  if (!p) return null;
  const asOf = url.searchParams.get('as_of') || addDays(today(), 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return envelope(null, { freshness: 'ERROR', semantics: 'as_of must be YYYY-MM-DD' });
  const mp = (await playerMatchIds(store, p.pbe_player_id)).filter((x) => x.participant_key === `S:${p.pbe_player_id}`);
  const surface = url.searchParams.get('surface');
  const opts = { asOf, surface: ['hard', 'clay', 'grass'].includes(surface) ? surface : null };
  if (!mp.length) return ok({ player: shapePlayer(p), ...buildDna([], opts) }, { rows: [], policy: { currentS: 86400, staleS: 7 * 86400 }, semantics: 'Tennis DNA v1 (singles): no stored matches yet' });
  const ids = mp.map((x) => x.match_id);
  const side = new Map(mp.map((x) => [x.match_id, x.side]));
  const [stats, ms] = await Promise.all([
    store.select('tennis_match_stats', `select=match_id,side,source_family,stats&match_id=${inList(ids)}&limit=4000`),
    store.select('tennis_matches', `select=match_id,source_updated_at,surface,status,tennis_sets(set_no,games_a,games_b)&match_id=${inList(ids)}&limit=2000`)
  ]);
  const meta = new Map(ms.map((m) => [m.match_id, m]));
  const byMatch = new Map();
  for (const s of stats) { if (!byMatch.has(s.match_id)) byMatch.set(s.match_id, {}); byMatch.get(s.match_id)[s.side] = s; }
  const rows = [];
  for (const [mid, sides] of byMatch) {
    const me = side.get(mid);
    const opp = me === 'A' ? 'B' : 'A';
    const m = meta.get(mid);
    if (!sides[me] || !sides[opp] || !m?.source_updated_at) continue;
    const sets = m.tennis_sets || [];
    rows.push({ match_id: mid, match_date: m.source_updated_at.slice(0, 10), surface: m.surface, sets_played: sets.length, games_played: sets.reduce((t, x) => t + x.games_a + x.games_b, 0), source_family: sides[me].source_family, side: sides[me].stats, opp: sides[opp].stats });
  }
  return ok({ player: shapePlayer(p), ...buildDna(rows, opts) }, { rows: stats, updated: maxTime(ms, 'source_updated_at'), policy: { currentS: 86400, staleS: 7 * 86400 }, semantics: 'Tennis DNA v1 singles metrics from stored source statistics; match date = date of the final source update; as_of exclusive', degraded: ['sample limited to matches whose statistics have been ingested so far'] });
}

async function h2h(store, a, b) {
  const [pa, pb] = await Promise.all([playerBySlug(store, a), playerBySlug(store, b)]);
  if (!pa || !pb) return null;
  const ka = `S:${pa.pbe_player_id}`;
  const kb = `S:${pb.pbe_player_id}`;
  const mp = await store.select('tennis_match_participants', `select=match_id,side,participant_key&participant_key=${inList([ka, kb])}&limit=2000`);
  const bySide = new Map();
  for (const r of mp) { if (!bySide.has(r.match_id)) bySide.set(r.match_id, {}); bySide.get(r.match_id)[r.participant_key] = r.side; }
  const ids = [...bySide].filter(([, v]) => v[ka] && v[kb]).map(([k]) => k);
  const rows = ids.length ? await store.select('tennis_matches', `select=${MATCH}&match_id=${inList(ids)}&status=neq.superseded&order=source_updated_at.desc.nullslast`) : [];
  const meetings = rows.map(shapeMatch);
  const won = (m, key) => FINAL.includes(m.status) && m.winner_side === bySide.get(m.id)[key];
  const record = { [pa.slug]: meetings.filter((m) => won(m, ka)).length, [pb.slug]: meetings.filter((m) => won(m, kb)).length };
  return ok({ a: shapePlayer(pa), b: shapePlayer(pb), record, meetings }, { rows, policy: { currentS: 86400, staleS: 7 * 86400 }, semantics: 'singles meetings present in the canonical store (coverage-limited while history backfills); descriptive, not a prediction' });
}

async function players(store, url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q) {
    const safe = q.replace(/[^\p{L}\p{N} '-]/gu, '').slice(0, 60);
    const rows = await store.select('tennis_players', `select=pbe_player_id,slug,full_name,nationality,gender,updated_at,${MEDIA}&full_name=ilike.*${encodeURIComponent(safe)}*&order=full_name.asc&limit=50`);
    return ok(rows.map(shapePlayer), { rows, source: ['pbe_identity_graph'], policy: { currentS: 86400, staleS: 7 * 86400 }, semantics: `players matching "${safe}"` });
  }
  return rankings(store, new URL('https://x/?tour=wta&type=singles&limit=200'));
}

function sources() {
  return envelope({ registry, canary }, { source: ['pbe_source_audit'], source_updated_at: canary.run_at || null, freshness: canary.run_at ? 'CACHED' : 'UNAVAILABLE', semantics: 'Audited source registry + latest committed canary run.' });
}

const NOT_YET = {
  '/v1/breakout-watch': 'Breakout Watch index: methodology and backtest not published',
  '/v1/odds': 'MARKET UNAVAILABLE: no legitimate tennis market source is captured',
  '/v1/pbe-picks': 'PBE Picks: the Tennis model is not validated; no picks exist',
  '/v1/track-record': 'Track Record: no picks have been locked, nothing graded',
};

const TTL = [[/^\/v1\/picks\/track-record$/, 120], [/^\/v1\/slams$/, 21600], [/^\/v1\/men(?:\/players)?$/, 21600], [/^\/v1\/matches\/[0-9a-f-]{36}\/videos$/, 300], [/^\/v1\/videos/, 300], [/^\/v1\/matchups/, 600], [/^\/v1\/players-to-watch/, 3600], [/^\/v1\/news/, 60], [/^\/v1\/pbecast/, 15], [/^\/v1\/schedule/, 60], [/^\/v1\/(dna|credits)/, 3600], [/^\/v1\/players\/[^/]+\/(dna|profile)/, 1800], [/^\/v1\/coverage/, 600], [/^\/v1\/search/, 300], [/^\/v1\/venues/, 3600], [/^\/v1\/live/, 15], [/^\/v1\/today/, 30], [/^\/v1\/matches\//, 20], [/^\/v1\/tournaments/, 120], [/^\/v1\/rankings/, 900], [/^\/v1\/players/, 300], [/^\/v1\/h2h/, 600], [/^\/v1\/sources/, 300]];
const QUERY_AGNOSTIC_ARCHIVE = /^\/v1\/(?:slams|men(?:\/players)?)$/;
// One cache namespace for every caller (2026-10-07): the key used to carry url.origin, so tennis-web's SSR reads through
// the service binding (https://tennis-api.internal/...) and the browser's read of the same page
// (https://tennis-api.propbetedge.ai/...) never shared an entry: every crawled tournament / player page cost two DB reads.
// No route's body depends on the request host.
const CACHE_ORIGIN = 'https://tennis-api.propbetedge.ai';
// Phase 3 coalescing (see fetchApi): the two routes behind tkmln's top statement (the 5-level edition-list read,
// ~180 ms alone, ~2 s under concurrent misses) wait for a peer isolate's in-flight build
const COALESCE_ACROSS = /^\/v1\/(?:today|schedule)$/;
const INFLIGHT = new Map();
const LOCK_S = 10;          // a lock outlives no build by more than this (a crashed builder never blocks the key)
const WAIT_MS = 6000;       // a waiter gives up and builds itself after this
const POLL_MS = 200;
export async function waitForPeer(cache, cacheKey, lockKey, { waitMs = WAIT_MS, pollMs = POLL_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!(await cache.match(lockKey).catch(() => null))) return null;
  for (let t = 0; t < waitMs; t += pollMs) {
    await sleep(pollMs);
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) return hit;
    if (!(await cache.match(lockKey).catch(() => null))) return (await cache.match(cacheKey).catch(() => null)) || null;
  }
  return null;
}

export async function route(path, url, store, env) {
  if (path === '/v1/sources') return sources();
  const vid = await videoRoute(path, env);
  if (vid !== undefined) return vid;
  const news = await newsRoute(path, url, store, env);
  if (news !== undefined) return news;
  const mr = await menRoute(path, url, store);
  if (mr !== undefined) return mr;
  const pk = await picksRoute(path, url, env);
  if (pk !== undefined) return pk;
  const mu = await matchupRoute(path, url, store, env);
  if (mu !== undefined) return mu;
  const v2 = await v2Route(path, url, store, env);
  if (v2 !== undefined) return v2;
  if (NOT_YET[path]) return notConfigured(NOT_YET[path]);
  if (/^\/v1\/doubles\/pairs\//.test(path)) return notConfigured('Doubles Lab pair profiles: pair snapshots not built yet');
  const known = /^\/v1\/(live|today|tournaments(\/[a-z0-9-]+\/\d{4})?|rankings|players(\/[a-z0-9-]+(\/dna)?)?|matches\/[0-9a-f-]{36}|h2h\/[a-z0-9-]+\/[a-z0-9-]+)$/.test(path);
  if (!known) return undefined;
  if (!store) return notConfigured('canonical store not connected to this Worker');
  if (path === '/v1/live') return live(store);
  if (path === '/v1/today') return todayView(store);
  if (path === '/v1/tournaments') return tournaments(store, url);
  let m = /^\/v1\/tournaments\/([a-z0-9-]+)\/(\d{4})$/.exec(path);
  if (m) return tournament(store, m[1], Number(m[2]));
  if (path === '/v1/rankings') return rankings(store, url);
  if (path === '/v1/players') return players(store, url);
  m = /^\/v1\/matches\/([0-9a-f-]{36})$/.exec(path);
  if (m) return UUID.test(m[1]) ? match(store, m[1]) : null;
  m = /^\/v1\/players\/([a-z0-9-]+)\/dna$/.exec(path);
  if (m) return SLUG.test(m[1]) ? playerDna(store, m[1], url) : null;
  m = /^\/v1\/players\/([a-z0-9-]+)$/.exec(path);
  if (m) return SLUG.test(m[1]) ? player(store, m[1]) : null;
  m = /^\/v1\/h2h\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(path);
  if (m) return h2h(store, m[1], m[2]);
  return undefined;
}

async function fetchApi(request, env, ctx, { propsportsInternal = false } = {}) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...corsFor(request), 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type, Authorization' } });
    if (path === '/v1/magic/request' && request.method === 'POST') {
      if (!env.AUTH) return json({ ok: false, message: 'Sign-in is unavailable.' }, { status: 503, headers: { ...corsFor(request), 'cache-control': 'private, no-store' } });
      const payload = await request.text();
      const upstream = await env.AUTH.fetch(new Request('https://auth.propbetedge.ai/magic/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', Origin: TENNIS_ORIGIN },
        body: payload,
      }));
      const text = await upstream.text();
      return new Response(text, { status: upstream.status, headers: { ...corsFor(request), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });
    }
    if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, { status: 405, headers: corsFor(request) });
    if (path === '/v1/membership') {
      const verdict = await membershipFor(request, env);
      return json(verdict, { headers: { ...corsFor(request), 'cache-control': 'private, no-store' } });
    }
    if (path === '/health' || path === '/') {
      return json(await health({ worker: 'tennis-api', version: VERSION, env, deps: ['TENNIS_MODEL_SUPABASE_URL', 'TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY', 'TENNIS_STATE', 'AUTH'], extra: { routes: ['/v1/today', '/v1/live', '/v1/tournaments', '/v1/tournaments/:slug/:year', '/v1/matches/:id', '/v1/players', '/v1/players/:slug', '/v1/players/:slug/dna', '/v1/rankings', '/v1/h2h/:a/:b', '/v1/sources', '/v1/men', '/v1/men/players', '/v1/slams', '/v1/matchups', '/v1/matchups/:id', '/v1/players-to-watch', '/v1/picks', '/v1/picks/:id', '/v1/picks/track-record'], picks_verification: await verificationSummary(env) } }), { headers: { 'cache-control': 'no-store' } });
    }
    // approved player media (generated by scripts/media/photos.mjs, provenance in tennis_player_media)
    const mm = /^\/media\/(players\/[0-9a-f-]{36}\/(?:portrait|square|thumb|wide)|editorial\/[a-z0-9-]{1,60}\/(?:wide-(?:2400|1600|1200|800|480)|std-(?:1200|800)|card))\.(webp|jpg)$/.exec(path);
    if (mm) {
      const obj = env.TENNIS_MEDIA ? await env.TENNIS_MEDIA.get(`${mm[1]}.${mm[2]}`) : null;
      if (!obj) return new Response('not found', { status: 404, headers: { 'cache-control': 'public, max-age=300' } });
      return new Response(obj.body, { headers: { 'content-type': mm[2] === 'jpg' ? 'image/jpeg' : 'image/webp', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
    }
    const premium = isPremiumPath(path, url);
    let membership = null;
    if (premium && !propsportsInternal) {
      membership = await membershipFor(request, env);
      if (!membership?.membership?.entitled) {
        return json({ ok: false, error: 'membership_required', membership: membership?.membership || null }, {
          status: 401,
          headers: { ...corsFor(request), 'cache-control': 'private, no-store' },
        });
      }
    }
    // the picks verification ledger is the owner's audit surface: never served to members or internal callers
    if (path === '/v1/picks/verification' && membership?.membership?.state !== 'owner') {
      return json({ ok: false, error: 'owner_required' }, { status: 403, headers: { ...corsFor(request), 'cache-control': 'private, no-store' } });
    }
    const cache = ctx && globalThis.caches?.default;
    const ttl = (TTL.find(([re]) => re.test(path)) || [null, 30])[1];
    const bypass = premium || isPreview(url, env);
    // cache key carries the API version: a deploy that changes response shapes never serves the old shape
    const cacheSearch = QUERY_AGNOSTIC_ARCHIVE.test(path) ? '' : url.search;
    const cacheKey = new Request(`${CACHE_ORIGIN}${url.pathname}${cacheSearch}${cacheSearch ? '&' : '?'}__v=${VERSION}`, { method: 'GET' });
    if (cache && !bypass) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        // a cached copy comes back with the ZONE's browser TTL (observed: max-age=14400 on /v1/live and /v1/pbecast,
        // 2026-10-03), which let browsers hold live state for hours; restamp this route's own TTL on every hit
        const r = withCors(new Response(hit.body, hit), request);
        r.headers.set('cache-control', `public, max-age=${ttl}`);
        return r;
      }
    }
    // Coalescing (2026-10-07, Phase 3): concurrent misses of one cache key build once. In this isolate: one in-flight
    // build per key (single-flight). Across isolates of the colo (/today, /schedule): the first miss leaves a short lock
    // entry in caches.default and the others wait for its response to land (bounded; then they build themselves). The
    // cached body, TTL and freshness are unchanged — waiters get the same fresh build. Never for bypass (premium/preview).
    let lockKey = null;
    if (cache && !bypass && COALESCE_ACROSS.test(path) && !INFLIGHT.has(cacheKey.url)) {
      lockKey = new Request(`${cacheKey.url}&__lock=1`, { method: 'GET' });
      const waited = await waitForPeer(cache, cacheKey, lockKey);
      if (waited) {
        const r = withCors(new Response(waited.body, waited), request);
        r.headers.set('cache-control', `public, max-age=${ttl}`);
        return r;
      }
    }
    const build = async () => {
      if (lockKey) await cache.put(lockKey, new Response('1', { headers: { 'cache-control': `max-age=${LOCK_S}` } })).catch(() => {});
      try {
        // withMemo: build-versioned shared results (memo.js) for the DNA population / gate reads
        // withHeartbeat: per-edition source confirmation merged into tennis_matches.updated_at (store-heartbeat.js)
        return await route(path, url, withHeartbeat(withMemo(storeFromEnv(env), env, ctx), env), env);
      } catch (e) {
        return envelope(null, { freshness: 'ERROR', semantics: 'canonical store read failed', degraded: [String(e?.message || e).slice(0, 200)] });
      }
    };
    let body;
    if (cache && !bypass) {
      let p = INFLIGHT.get(cacheKey.url);
      if (!p) { p = build().finally(() => INFLIGHT.delete(cacheKey.url)); INFLIGHT.set(cacheKey.url, p); } else lockKey = null;
      body = await p;
    } else body = await build();
    if (body === undefined) return json({ ok: false, error: 'not_found' }, { status: 404 });
    if (body === null) return json(envelope(null, { freshness: 'UNAVAILABLE', semantics: 'not found in the canonical store' }), { status: 404 });
    const res = json(body, { headers: { ...corsFor(request), 'cache-control': bypass ? (premium ? 'private, no-store' : 'no-store') : `public, max-age=${ttl}`, ...(bypass ? { 'x-robots-tag': 'noindex' } : {}) } });
    if (cache && !bypass && body.meta?.freshness !== 'ERROR') {
      const put = cache.put(cacheKey, res.clone());
      // the lock goes only after the real entry has landed (a waiter that sees neither builds itself)
      ctx.waitUntil(lockKey ? put.then(() => cache.delete(lockKey)).catch(() => {}) : put);
    } else if (lockKey) ctx.waitUntil(cache.delete(lockKey).catch(() => {}));
    return res;
}

export async function propsportsFetch(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  // Service-entrypoint contract: PropSports may bypass the consumer membership gate only for
  // the Player DNA route it commercially exposes. Every other PropSports Tennis route is the
  // ordinary public API (same behaviour as tennis-api.propbetedge.ai): no bypass.
  if (request.method === 'GET' && /^\/v1\/players\/[a-z0-9-]+\/dna$/.test(path)) {
    return fetchApi(request, env, ctx, { propsportsInternal: true });
  }
  if (request.method !== 'GET') return json({ ok: false, error: 'not_found' }, { status: 404 });
  return fetchApi(request, env, ctx);
}

export default {
  fetch(request, env, ctx) {
    configureScheduleDay(env);
    return fetchApi(request, env, ctx);
  },
  // frozen pre-match matchup snapshots (matchup-freeze.js): write-once while matches are scheduled (scheduled.js)
  scheduled(_e, env, ctx) {
    configureScheduleDay(env);
    ctx.waitUntil(scheduledRun(storeFromEnv(env), env));
  }
};
