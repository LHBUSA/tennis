// tennis-api v2 routes: PBEcast, schedule, stored Tennis DNA (+ population percentiles), player profile,
// search, venues, broadcast, credits, coverage. Returns undefined for paths it does not own.

import { envelope, notConfigured } from '../../shared/envelope.js';
import { inList } from '../../shared/store/postgrest.js';
import { keyMoments, matchControl, gamesFromPoints, normalizeStoredEvent } from '../../shared/canonical/events.js';
import { DEFINITIONS, DEFINITION_VERSION } from '../../shared/dna/metric.js';
import { MATCH, MEDIA, FINAL, TOUR_LEVELS, UUID, SLUG, today, addDays, shapeMatch, shapePlayer, shapePhoto, shapeEdition, maxTime, families } from './shape.js';

const ok = (data, { rows = [], source = null, updated = null, policy, semantics, degraded = [] }) => envelope(data, { source: source || families(rows), source_updated_at: updated ?? maxTime(rows), policy, semantics, degraded });

const DNA_CACHE_VERSION = 'perf-1';
async function dnaCacheGet(env, key) {
  if (!env?.TENNIS_STATE) return null;
  try { return await env.TENNIS_STATE.get(`api:${DNA_CACHE_VERSION}:${key}`, 'json'); } catch { return null; }
}
async function dnaCachePut(env, key, value, ttl = 21600) {
  if (!env?.TENNIS_STATE || value == null) return;
  try { await env.TENNIS_STATE.put(`api:${DNA_CACHE_VERSION}:${key}`, JSON.stringify(value), { expirationTtl: ttl }); } catch {}
}

// DNA dimensions shown as radar/percentiles — every one is a stored v1 metric (no proxies).
export const DNA_DIMENSIONS = [
  ['service_points_won', 'Serve'], ['hold_rate', 'Hold'], ['first_serve_won', '1st serve won'], ['second_serve_won', '2nd serve won'],
  ['return_points_won', 'Return'], ['return_games_won', 'Break rate'], ['break_points_saved', 'BP saved'], ['break_points_converted', 'BP converted']
];
const LOWER_IS_BETTER = new Set(['double_fault_rate']);

import { coveredEditions, keepTour, TOUR_FILTERS, TOUR_COVERAGE } from './tours.js';
import { matchDna, matchDnaLeaders, pbecastMatchDna, V2_METRICS } from './dna2.js';

// offset paging is only exact over a stable order: every caller's query names one (a page boundary over an unordered
// scan can skip or repeat rows, which made leader counts drift between requests until 2026-09-28)
export async function allRows(store, table, query, cap = 5000) {
  if (!/(^|&)order=/.test(query)) throw new Error(`allRows needs an order: ${table}`);
  const out = [];
  for (let off = 0; off < cap; off += 1000) {
    const r = await store.select(table, `${query}&limit=1000&offset=${off}`);
    out.push(...r);
    if (r.length < 1000) break;
  }
  return out;
}

async function playerBySlug(store, slug) {
  const col = UUID.test(slug) ? 'pbe_player_id' : 'slug';
  return (await store.select('tennis_players', `select=pbe_player_id,slug,full_name,first_name,last_name,gender,dob,nationality,plays,height_cm,updated_at,${MEDIA}&${col}=eq.${slug}`))[0] || null;
}

/** Latest DNA snapshot date for ONE tour. Tours are never coupled: a newer WTA build must not move the ATP gate
 *  (or the reverse) onto a date where that tour has no complete snapshot. */
export async function latestAsOfForGender(store, gender) {
  return (await store.select('tennis_dna_snapshots', `select=as_of,tennis_players!inner(gender)&definition_version=eq.1&tennis_players.gender=eq.${gender === 'M' ? 'M' : 'F'}&order=as_of.desc&limit=1`))[0]?.as_of || null;
}

const TOUR_OF = { F: 'WTA', M: 'ATP' };
/** A tour's Tennis DNA is published only once its population is meaningful (owner rule 2026-09-26). */
export const DNA_MIN_QUALIFIED = 30;
/** Level-3 gate, evaluated live on every request from the tour's own latest snapshot: it opens at
 *  DNA_MIN_QUALIFIED and closes again if a newer legitimate snapshot drops below it (fails closed). */
export async function tourDnaStatus(store, gender) {
  const asOf = await latestAsOfForGender(store, gender);
  if (!asOf) return { ready: false, qualified: 0, as_of: null };
  const rows = await allRows(store, 'tennis_dna_snapshots', `select=metrics,tennis_players!inner(gender)&as_of=eq.${asOf}&surface=eq.all&definition_version=eq.1&tennis_players.gender=eq.${gender === 'M' ? 'M' : 'F'}&order=pbe_player_id.asc`);
  const qualified = rows.filter((r) => ['medium', 'high'].includes(r.metrics?.service_points_won?.confidence)).length;
  return { ready: qualified >= DNA_MIN_QUALIFIED, qualified, as_of: asOf, threshold: DNA_MIN_QUALIFIED, tour: TOUR_OF[gender === 'M' ? 'M' : 'F'] };
}
/** Population for percentiles: same as_of + surface + TOUR (ATP and WTA are never pooled), confidence medium/high. */
async function population(store, asOf, surface, gender) {
  const rows = await allRows(store, 'tennis_dna_snapshots', `select=pbe_player_id,metrics,tennis_players!inner(gender)&as_of=eq.${asOf}&surface=eq.${surface}&definition_version=eq.${DEFINITION_VERSION}&tennis_players.gender=eq.${gender === 'M' ? 'M' : 'F'}&order=pbe_player_id.asc`);
  const pop = {};
  for (const [k] of Object.entries(DEFINITIONS)) pop[k] = rows.map((r) => r.metrics?.[k]).filter((m) => m && m.value != null && ['medium', 'high'].includes(m.confidence)).map((m) => m.value).sort((a, b) => a - b);
  const gateQualified = rows.filter((r) => ['medium', 'high'].includes(r.metrics?.service_points_won?.confidence)).length;
  return { pop, players: rows.length, gateQualified };
}

async function cachedPopulation(store, env, asOf, surface, gender) {
  const key = `dna-pop:v1:${gender}:${surface}:${asOf}`;
  const hit = await dnaCacheGet(env, key);
  if (hit?.pop) return hit;
  const built = await population(store, asOf, surface, gender);
  await dnaCachePut(env, key, built, 86400);
  return built;
}

function percentile(sorted, v, key) {
  if (v == null || sorted.length < 10) return null;
  let below = 0;
  for (const x of sorted) if (x < v) below += 1; else break;
  const p = Math.round((below / sorted.length) * 100);
  return LOWER_IS_BETTER.has(key) ? 100 - p : p;
}

async function storedDna(store, pid, surface = 'all') {
  return (await store.select('tennis_dna_snapshots', `select=as_of,surface,definition_version,metrics,provenance&pbe_player_id=eq.${pid}&surface=eq.${surface}&definition_version=eq.1&order=as_of.desc&limit=1`))[0] || null;
}

/** PBEcast DNA pair: the player's individual measurements (+ surface snapshot); comparison rules inside. */
async function gatedPair(store, pid, surf) {
  const all = await dnaWithPercentiles(store, pid, 'all');
  return { all, surface: surf ? await storedDna(store, pid, surf) : null };
}

/** Technical DNA (v1) status for one player: published / building (stored, tour gate not passed) / unavailable. */
export function technicalStatus(all) {
  if (!all) return { status: 'unavailable', message: 'No technical serve/return DNA yet: it needs matches with published match statistics.' };
  if (all.comparative?.published) return { status: 'published', message: `${all.tour} technical DNA is published` };
  return { status: 'building', message: `Technical serve/return DNA is still building: ${all.comparative?.qualified ?? 0} of ${all.comparative?.threshold ?? DNA_MIN_QUALIFIED} ${all.tour} players meet the full comparative standard. Individual measurements are shown; a metric's percentile appears once 10 same-tour peers qualify.` };
}

/**
 * PBEcast DNA contract (pbecast-dna/2, 2026-09-29). Match DNA v2 (results-based, same-tour population, surface
 * context) is the primary comparison; technical DNA v1 (serve/return from match statistics) is an additional module
 * with its gates unchanged. One never suppresses the other. `A.all` / `A.surface` are kept for older clients.
 */
export async function pbecastDna(store, a, b, surf) {
  const side = async (p) => {
    const [pair, md] = await Promise.all([gatedPair(store, p.id, surf), pbecastMatchDna(store, p.id, p.gender, surf)]);
    return { ...pair, match_dna: md, technical: { ...technicalStatus(pair.all), definition_version: 1 } };
  };
  const [A, B] = await Promise.all([side(a), side(b)]);
  const tours = [A.match_dna?.tour, B.match_dna?.tour].filter(Boolean);
  return {
    contract: 'pbecast-dna/2', A, B, surface: surf,
    match_dna: { A: A.match_dna, B: B.match_dna, definition_version: 2, same_tour: tours.length === 2 ? tours[0] === tours[1] : null },
    technical_dna: { A: { ...A.technical, data: A.all }, B: { ...B.technical, data: B.all }, definition_version: 1 },
    note: 'stored Tennis DNA snapshots (as_of exclusive); values are never recomputed in the browser; each player is compared within their own tour population (ATP and WTA are never pooled)'
  };
}

/**
 * Tennis DNA publication contract (owner rule 2026-09-26). Publication layer only: definitions, definition_version,
 * confidence thresholds, missingness, as-of exclusivity and tour separation are unchanged.
 *   Level 1  individual measurements: published whenever stored (value, sample, numerator/denominator,
 *            confidence). Missing stays missing; no percentile is implied.
 *   Level 2  metric percentile: only when the player's metric is medium/high confidence AND the same-tour peer
 *            population for that metric reaches the percentile minimum (percentile() -> null below 10).
 *   Level 3  full comparative DNA (radar/fingerprint, strengths, watch areas, headline traits, leaderboard):
 *            only when the tour has DNA_MIN_QUALIFIED qualified players (tourDnaStatus().ready).
 */
export async function dnaWithPercentiles(store, pid, surface = 'all', genderHint = null, env = null) {
  const snap = await storedDna(store, pid, surface);
  if (!snap) return null;
  const gender = genderHint === 'M' || genderHint === 'F'
    ? genderHint
    : (await store.select('tennis_players', `select=gender&pbe_player_id=eq.${pid}`))[0]?.gender === 'M' ? 'M' : 'F';
  const latestAsOf = await latestAsOfForGender(store, gender);
  const { pop, players, gateQualified } = await cachedPopulation(store, env, snap.as_of, surface, gender);
  const gate = surface === 'all' && latestAsOf === snap.as_of
    ? { ready: gateQualified >= DNA_MIN_QUALIFIED, qualified: gateQualified, as_of: latestAsOf, threshold: DNA_MIN_QUALIFIED, tour: TOUR_OF[gender] }
    : await tourDnaStatus(store, gender);
  const dims = DNA_DIMENSIONS.map(([k, label]) => {
    const m = snap.metrics[k];
    const usable = m && m.value != null && ['medium', 'high'].includes(m.confidence);
    const p = usable ? percentile(pop[k], m.value, k) : null;
    const status = m?.value == null ? 'missing' : !usable ? 'player_sample_low' : p == null ? 'peer_sample_not_mature' : 'published';
    return { key: k, label, value: m?.value ?? null, confidence: m?.confidence ?? 'insufficient', sample_matches: m?.sample_matches ?? 0, numerator: m?.numerator ?? null, denominator: m?.denominator ?? null, percentile: p, percentile_status: status, population: pop[k].length };
  });
  const tour = TOUR_OF[gender];
  return {
    as_of: snap.as_of, surface, definition_version: snap.definition_version, metrics: snap.metrics, dimensions: dims, population_players: players, matches_considered: snap.provenance?.matches_considered ?? null, tour,
    percentile_basis: `${tour} singles players with a stored v${snap.definition_version} snapshot on ${snap.as_of} (${surface}) whose metric confidence is medium or high (a percentile needs at least 10 such peers)`,
    comparative: { published: gate.ready, qualified: gate.qualified, threshold: gate.threshold, as_of: gate.as_of, status: gate.ready ? `${tour} comparative DNA is published` : `${tour} comparative DNA is still building: ${gate.qualified} of ${gate.threshold} players currently meet the full comparative-DNA standard` }
  };
}

async function rankAt(store, pid, date) {
  const r = await store.select('tennis_rankings', `select=rank,points,tennis_ranking_snapshots!inner(list_key,ranking_date)&pbe_player_id=eq.${pid}&tennis_ranking_snapshots.ranking_date=lte.${date}&tennis_ranking_snapshots.list_key=in.(wta_singles,atp_singles)&order=tennis_ranking_snapshots(ranking_date).desc&limit=1`);
  return r[0] ? { rank: r[0].rank, points: r[0].points, list: r[0].tennis_ranking_snapshots.list_key, date: r[0].tennis_ranking_snapshots.ranking_date } : null;
}

// ---- PBEcast ------------------------------------------------------------------------------------------
export async function pbecast(store, id) {
  const rows = await store.select('tennis_matches', `select=${MATCH}&match_id=eq.${id}`);
  if (!rows.length) return null;
  const m = shapeMatch(rows[0]);
  const [points, snaps, stats] = await Promise.all([
    allRows(store, 'tennis_match_events', `select=event_id,quality,event_sequence,event_type,observed_at,event_at,set_number,game_number,server_side,winner_side,derivation,event_detail,state,serve_speed_kmh,serve_number,rally_length,coordinates,source&match_id=eq.${id}&quality=eq.point_event&order=event_sequence.asc`),
    allRows(store, 'tennis_match_events', `select=event_id,quality,event_sequence,event_type,observed_at,event_at,set_number,server_side,winner_side,derivation,event_detail,state,source&match_id=eq.${id}&quality=eq.score_snapshot&order=event_sequence.asc`),
    store.select('tennis_match_stats', `select=side,source_family,stats,captured_at&match_id=eq.${id}`)
  ]);
  const hasPoints = points.length > 0;
  const live = m.status === 'in_progress' || m.status === 'suspended';
  const mode = hasPoints ? (live ? 'point_by_point_live' : 'point_by_point_replay') : live ? 'observed_live' : snaps.length ? 'observed_replay' : m.status === 'scheduled' ? 'scheduled' : 'result_only';
  const events = (hasPoints ? points : snaps).map(normalizeStoredEvent);
  const date = (m.source_updated_at || new Date().toISOString()).slice(0, 10);
  const singles = m.sides.A?.players?.length === 1 && m.sides.B?.players?.length === 1;
  const players = {};
  for (const s of ['A', 'B']) {
    players[s] = [];
    for (const p of m.sides[s]?.players || []) players[s].push({ ...p, rank: p.id ? await rankAt(store, p.id, date) : null });
  }
  let dna = null;
  let h2h = null;
  if (singles) {
    const [a, b] = [m.sides.A.players[0], m.sides.B.players[0]];
    const surf = ['hard', 'clay', 'grass'].includes(m.tournament?.surface) ? m.tournament.surface : null;
    dna = await pbecastDna(store, a, b, surf);
    const ka = `S:${a.id}`; const kb = `S:${b.id}`;
    const mp = await store.select('tennis_match_participants', `select=match_id,side,participant_key&participant_key=${inList([ka, kb])}&limit=2000`);
    const by = new Map();
    for (const r of mp) { if (!by.has(r.match_id)) by.set(r.match_id, {}); by.get(r.match_id)[r.participant_key] = r.side; }
    const ids = [...by].filter(([mid, v]) => v[ka] && v[kb] && mid !== id).map(([mid]) => mid);
    const past = ids.length ? (await store.select('tennis_matches', `select=match_id,status,winner_side,score_text,surface,source_updated_at,tennis_tournament_editions(year,tennis_tournaments(name))&match_id=${inList(ids)}&order=source_updated_at.desc`)) : [];
    const won = (r, key) => FINAL.includes(r.status) && r.winner_side === by.get(r.match_id)[key];
    h2h = { A: past.filter((r) => won(r, ka)).length, B: past.filter((r) => won(r, kb)).length, meetings: past.slice(0, 5).map((r) => ({ id: r.match_id, winner: won(r, ka) ? 'A' : won(r, kb) ? 'B' : null, score: r.score_text, surface: r.surface, year: r.tennis_tournament_editions?.year, tournament: r.tennis_tournament_editions?.tennis_tournaments?.name })), basis: 'singles meetings in the PropBetEdge store (coverage-limited)' };
  }
  const data = {
    contract: 'pbecast/1.0.0', match: { ...m, players }, mode,
    quality: hasPoints ? 'point_event' : snaps.length ? 'score_snapshot' : null,
    cadence_note: hasPoints ? 'every point as published by the source' : m.source === 'espn' ? 'game-level observation of a secondary source (ESPN; not an official ATP feed) about every 20 seconds while live — it publishes set and game scores only, so no point score or server is shown; changes between two observations are shown as one update' : 'periodic observation of the source (about every 18 seconds while live); changes between two observations are shown as one update',
    events, moments: keyMoments(events), control: matchControl(hasPoints ? gamesFromPoints(points).map((g) => ({ event_detail: { game_won: { winner: g.winner, result: g.result } } })) : events),
    games: hasPoints ? gamesFromPoints(points) : null,
    statistics: stats.length ? Object.fromEntries(stats.map((s) => [s.side, s.stats])) : null,
    dna, h2h
  };
  return ok(data, { rows: [rows[0]], source: [...new Set([m.source, ...events.map((e) => e.source)])].filter(Boolean), updated: m.source_updated_at, policy: { currentS: 60, staleS: 600 }, semantics: `PBEcast ${mode}: ${data.cadence_note}` });
}

// ---- schedule -----------------------------------------------------------------------------------------
export async function schedule(store, url) {
  const view = url.searchParams.get('view') || 'today';
  const d = today();
  const win = { today: [d, d], tomorrow: [addDays(d, 1), addDays(d, 1)], week: [d, addDays(d, 6)], upcoming: [addDays(d, 1), addDays(d, 45)] }[view] || [d, d];
  // every covered tour (tours.js): official WTA levels + Grand Slams + ESPN ATP Tour editions
  const eds = await coveredEditions(store, win[0], win[1], { extra: 'venue_id,tennis_tournaments(slug,name),tennis_venues(slug,city,country,venue_name,precision)', limit: 200 });
  const ids = eds.map((e) => e.edition_id);
  const tourOf = new Map(eds.map((e) => [e.edition_id, e.tour]));
  const statusF = url.searchParams.get('status');
  const statusQ = statusF === 'live' ? '&status=eq.in_progress' : statusF === 'scheduled' ? '&status=eq.scheduled' : statusF === 'completed' ? `&status=${inList(FINAL)}` : '';
  const eventF = url.searchParams.get('event');
  // gender filter on the canonical event type: men MS/MD, women WS/WD, mixed XD (never on ranking availability)
  const G = { men: ['MS', 'MD'], women: ['WS', 'WD'], mixed: ['XD'] }[url.searchParams.get('gender')] || null;
  const E = eventF === 'singles' ? ['MS', 'WS'] : eventF === 'doubles' ? ['MD', 'WD', 'XD'] : null;
  const types = G && E ? G.filter((t) => E.includes(t)) : G || E;
  const eventQ = types ? `&event_type=in.(${(types.length ? types : ['none']).join(',')})` : '';
  const includeMatches = view === 'today' || view === 'tomorrow' || statusF;
  const matches = includeMatches && ids.length ? await store.select('tennis_matches', `select=${MATCH}&edition_id=${inList(ids)}&status=neq.superseded${statusQ}${eventQ}&order=source_updated_at.desc.nullslast&limit=500`) : [];
  const surf = url.searchParams.get('surface');
  const tour = url.searchParams.get('tour');
  const keepEd = (e) => (!surf || e.surface === surf) && keepTour(tour, e.tour);
  const shaped = matches.map((m) => ({ ...shapeMatch(m), tour: tourOf.get(m.edition_id) || null })).filter((mm) => keepEd({ surface: mm.tournament?.surface, tour: mm.tour }));
  const tournaments = eds.filter(keepEd).map((e) => ({ ...shapeEdition({ ...e }), tour: e.tour, status: e.source_status, venue: e.tennis_venues || null }));
  const at = (x) => x.scheduled_at || '9';
  const seen = (x) => x.source_updated_at || x.updated_at || '';
  const done = shaped.filter((x) => FINAL.includes(x.status)).sort((a, b) => seen(b).localeCompare(seen(a)));
  return ok({ view, window: win, tournaments, live: shaped.filter((x) => x.status === 'in_progress'), scheduled: shaped.filter((x) => x.status === 'scheduled').sort((a, b) => at(a).localeCompare(at(b))), completed: done.slice(0, 60), completed_total: done.length, filters: { tours: TOUR_FILTERS, surfaces: ['hard', 'clay', 'grass'], events: ['singles', 'doubles'], genders: ['men', 'women', 'mixed'] }, coverage: TOUR_COVERAGE },
    { rows: [...eds, ...matches], policy: { currentS: 300, staleS: 1800 }, semantics: `schedule ${view} (${win[0]}..${win[1]}): ATP Tour (secondary source: fixtures once that source lists them), WTA Tour and WTA 125 (official), Grand Slams (every event). Start times are shown only when the source publishes a full timestamp. See coverage for what each tour's schedule, live and ranking layers are.`, degraded: ['ATP Challenger and ITF schedules are not yet acquirable; ATP Tour tournament level and surface are not published by its secondary source'] });
}

// ---- DNA ----------------------------------------------------------------------------------------------
async function playerDnaV2(store, slug, url, env) {
  const surface = ['hard', 'clay', 'grass'].includes(url.searchParams.get('surface')) ? url.searchParams.get('surface') : 'all';
  const cacheKey = `player-dna:${slug}:${surface}`;
  const hit = await dnaCacheGet(env, cacheKey);
  if (hit?.data) {
    return ok(hit.data, { rows: [], source: ['pbe_derived'], updated: hit.updated || null, policy: { currentS: 86400 * 2, staleS: 86400 * 8 }, semantics: 'Tennis DNA: cached derived snapshot; match_dna = v2 Match DNA + PBE Rating; dna = v1 technical serve/return DNA' });
  }

  const p = await playerBySlug(store, slug);
  if (!p) return null;
  const [d, md, surfaceRows] = await Promise.all([
    dnaWithPercentiles(store, p.pbe_player_id, surface, p.gender, env),
    matchDna(store, p),
    Promise.all(['hard', 'clay', 'grass'].map((s) => storedDna(store, p.pbe_player_id, s)))
  ]);
  const surfaces = {};
  ['hard', 'clay', 'grass'].forEach((s, i) => {
    const x = surfaceRows[i];
    if (x) surfaces[s] = { as_of: x.as_of, matches_considered: x.provenance?.matches_considered ?? null, metrics: x.metrics };
  });
  const asOf = md?.as_of || d?.as_of || null;
  const data = { player: shapePlayer(p), dna: d, surfaces, match_dna: md };
  await dnaCachePut(env, cacheKey, { data, updated: asOf ? `${asOf}T00:00:00Z` : null }, 21600);
  return ok(data, { rows: [], source: ['pbe_derived'], updated: asOf ? `${asOf}T00:00:00Z` : null, policy: { currentS: 86400 * 2, staleS: 86400 * 8 }, semantics: 'Tennis DNA: match_dna = v2 Match DNA + PBE Rating from canonical results (per-metric same-tour gates); dna = v1 technical serve/return DNA from match statistics (unchanged gates)' });
}

async function dnaLeaders(store, url, env = null) {
  const metric = url.searchParams.get('metric') || 'hold_rate';
  const surface = ['hard', 'clay', 'grass'].includes(url.searchParams.get('surface')) ? url.searchParams.get('surface') : 'all';
  const tour = url.searchParams.get('tour') === 'atp' ? 'atp' : 'wta';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 25, 100);
  const cacheKey = `leaders:${metric}:${tour}:${surface}:${limit}`;
  const cached = await dnaCacheGet(env, cacheKey);
  if (cached) return cached;
  if (V2_METRICS.has(metric)) {
    const d = await matchDnaLeaders(store, { metric, tour, limit });
    if (!d) return envelope(null, { freshness: 'UNAVAILABLE', semantics: 'no Match DNA snapshots stored yet' });
    const out = ok(d, { rows: [], source: ['pbe_derived'], updated: `${d.as_of}T00:00:00Z`, policy: { currentS: 86400 * 2, staleS: 86400 * 8 }, semantics: d.published ? `${tour.toUpperCase()} singles leaders (Match DNA v2) among players whose sample is medium or high confidence; ATP and WTA are separate populations` : `${tour.toUpperCase()} ${metric}: comparison not published until ${d.threshold} players qualify (currently ${d.qualified})` });
    await dnaCachePut(env, cacheKey, out, 21600);
    return out;
  }
  if (!DEFINITIONS[metric]) return envelope(null, { freshness: 'ERROR', semantics: 'unknown metric' });
  const gate = await tourDnaStatus(store, tour === 'atp' ? 'M' : 'F');
  const asOf = gate.as_of;
  if (!asOf) return envelope(null, { freshness: 'UNAVAILABLE', semantics: 'no DNA snapshots stored yet' });
  if (!gate.ready) return ok({ metric, tour, published: false, definition: DEFINITIONS[metric].doc, surface, as_of: asOf, qualified: gate.qualified, threshold: gate.threshold, rows: [] }, { rows: [], source: ['pbe_derived'], updated: `${asOf}T00:00:00Z`, policy: { currentS: 86400 * 2, staleS: 86400 * 8 }, semantics: `${tour.toUpperCase()} Tennis DNA is not published until ${gate.threshold} players have a medium-confidence sample (currently ${gate.qualified})` });
  const rows = await allRows(store, 'tennis_dna_snapshots', `select=pbe_player_id,metrics,tennis_players!inner(pbe_player_id,slug,full_name,last_name,nationality,gender,${MEDIA})&as_of=eq.${asOf}&surface=eq.${surface}&definition_version=eq.1&tennis_players.gender=eq.${tour === 'atp' ? 'M' : 'F'}&order=pbe_player_id.asc`);
  const list = rows.map((r) => ({ player: shapePlayer(r.tennis_players), m: r.metrics?.[metric] })).filter((x) => x.m && x.m.value != null && ['medium', 'high'].includes(x.m.confidence));
  list.sort((a, b) => (LOWER_IS_BETTER.has(metric) ? a.m.value - b.m.value : b.m.value - a.m.value));
  const out = ok({ metric, tour, definition: DEFINITIONS[metric].doc, surface, as_of: asOf, qualified: list.length, rows: list.slice(0, limit).map((x, i) => ({ rank: i + 1, player: x.player, value: x.m.value, numerator: x.m.numerator, denominator: x.m.denominator, sample_matches: x.m.sample_matches, confidence: x.m.confidence })) },
    { rows: [], source: ['pbe_derived'], updated: `${asOf}T00:00:00Z`, policy: { currentS: 86400 * 2, staleS: 86400 * 8 }, semantics: `${tour.toUpperCase()} singles leaders among players whose metric confidence is medium or high (small samples excluded; ATP and WTA are separate populations)` });
  await dnaCachePut(env, cacheKey, out, 21600);
  return out;
}

async function homeDnaPreview(store, env) {
  const key = 'home-dna-preview';
  const hit = await dnaCacheGet(env, key);
  if (hit) return hit;
  const metrics = ['pbe_rating', 'hold_rate', 'return_games_won'];
  const tours = ['atp', 'wta'];
  const boards = {};
  await Promise.all(metrics.flatMap((metric) => tours.map(async (tour) => {
    const u = new URL(`https://tennis-api.internal/v1/dna/leaders?metric=${metric}&tour=${tour}&limit=5`);
    const r = await dnaLeaders(store, u, env);
    boards[`${metric}:${tour}`] = r?.data || null;
  })));
  const out = ok({ boards }, { rows: [], source: ['pbe_derived'], updated: new Date().toISOString(), policy: { currentS: 21600, staleS: 86400 }, semantics: 'cached homepage Tennis DNA preview: PBE Rating, hold rate and break rate for ATP and WTA, capped at five rows per board' });
  await dnaCachePut(env, key, out, 21600);
  return out;
}

// ---- player profile (form, surface record, opponents, current tournament) ------------------------------
async function profile(store, slug) {
  const p = await playerBySlug(store, slug);
  if (!p) return null;
  const key = `S:${p.pbe_player_id}`;
  const mp = await store.select('tennis_match_participants', `select=match_id,side&participant_key=eq.${key}&limit=2000`);
  const side = new Map(mp.map((r) => [r.match_id, r.side]));
  // id lists in groups of 150: one in.() of 900 uuids overflows the request line (postgrest 400 for every player with a
  // long career — Djokovic, Zverev, Sabalenka — until 2026-09-29)
  const ids = [...side.keys()].slice(0, 900);
  const sel = `select=match_id,status,winner_side,surface,source_updated_at,round,score_text,edition_id,tennis_tournament_editions(year,name,level,start_date,end_date,tennis_tournaments(slug,name)),tennis_match_participants(side,tennis_participants(tennis_participant_members(${'tennis_players(pbe_player_id,slug,full_name,nationality,gender,' + MEDIA + ')'})))`;
  const groups = [];
  for (let i = 0; i < ids.length; i += 150) groups.push(ids.slice(i, i + 150));
  const ms = (await Promise.all(groups.map((g) => store.select('tennis_matches', `${sel}&match_id=${inList(g)}&order=match_id.asc`)))).flat()
    .sort((x, y) => (y.source_updated_at || '').localeCompare(x.source_updated_at || '') || (x.match_id < y.match_id ? -1 : 1));
  const finals = ms.filter((m) => FINAL.includes(m.status) && m.status !== 'walkover');
  const result = (m) => (m.winner_side === side.get(m.match_id) ? 'W' : 'L');
  const surf = {};
  for (const m of finals) { const s = m.surface || 'unknown'; surf[s] = surf[s] || { W: 0, L: 0 }; surf[s][result(m)] += 1; }
  const opp = {};
  for (const m of finals) {
    const o = m.tennis_match_participants.find((x) => x.side !== side.get(m.match_id));
    const op = o?.tennis_participants?.tennis_participant_members?.[0]?.tennis_players;
    if (!op) continue;
    opp[op.slug] = opp[op.slug] || { ...shapePlayer(op), W: 0, L: 0 };
    opp[op.slug][result(m)] += 1;
  }
  const d = today();
  const cur = ms.find((m) => m.tennis_tournament_editions && m.tennis_tournament_editions.start_date <= d && m.tennis_tournament_editions.end_date >= addDays(d, -1));
  return ok({
    player: shapePlayer(p),
    form: finals.slice(0, 10).map((m) => ({ id: m.match_id, result: result(m), score: m.score_text, round: m.round, tournament: m.tennis_tournament_editions?.tennis_tournaments?.name, year: m.tennis_tournament_editions?.year, surface: m.surface })),
    surface_record: surf, top_opponents: Object.values(opp).sort((a, b) => b.W + b.L - (a.W + a.L)).slice(0, 8),
    matches_in_store: ms.length,
    current_tournament: cur ? { slug: cur.tennis_tournament_editions.tennis_tournaments?.slug, name: cur.tennis_tournament_editions.tennis_tournaments?.name, year: cur.tennis_tournament_editions.year } : null
  }, { rows: ms, policy: { currentS: 3600, staleS: 86400 }, semantics: 'singles results in the PropBetEdge store (coverage grows with the historical backfill)' });
}

// ---- search, venues, broadcast, credits, coverage ------------------------------------------------------
async function search(store, url) {
  const q = (url.searchParams.get('q') || '').trim().replace(/[^\p{L}\p{N} '-]/gu, '').slice(0, 60);
  if (q.length < 2) return envelope({ players: [], tournaments: [] }, { freshness: 'CURRENT', semantics: 'query too short' });
  const words = q.split(/\s+/).filter((w) => w.length > 1).slice(0, 4);
  const yr = words.find((w) => /^\d{4}$/.test(w));
  const text = words.filter((w) => w !== yr);
  const like = (w) => `*${encodeURIComponent(w)}*`;
  const players = text.length ? await store.select('tennis_players', `select=pbe_player_id,slug,full_name,nationality,gender,${MEDIA}&or=(${text.map((w) => `full_name.ilike.${like(w)}`).join(',')})&limit=20`) : [];
  const ranked = players.map((p) => ({ p, score: text.filter((w) => p.full_name.toLowerCase().includes(w.toLowerCase())).length })).sort((a, b) => b.score - a.score).map((x) => shapePlayer(x.p));
  const tours = text.length ? await store.select('tennis_tournaments', `select=slug,name,tennis_tournament_editions(year,start_date,level)&or=(${text.map((w) => `name.ilike.${like(w)}`).join(',')})&limit=10`) : [];
  return ok({ players: ranked.slice(0, 10), tournaments: tours.map((t) => ({ slug: t.slug, name: t.name, editions: (t.tennis_tournament_editions || []).filter((e) => !yr || String(e.year) === yr).map((e) => ({ year: e.year, level: e.level })).sort((a, b) => b.year - a.year) })) },
    { rows: [], source: ['pbe_identity_graph'], policy: { currentS: 3600, staleS: 86400 }, semantics: `canonical entities matching "${q}"` });
}

async function venue(store, slug) {
  const v = (await store.select('tennis_venues', `select=*&slug=eq.${slug}`))[0];
  if (!v) return null;
  const eds = await store.select('tennis_tournament_editions', `select=year,name,level,surface,indoor,start_date,end_date,tennis_tournaments(slug,name)&venue_id=eq.${v.venue_id}&order=start_date.desc&limit=50`);
  return ok({ venue: { slug: v.slug, name: v.venue_name, city: v.city, country: v.country, precision: v.precision, coordinates: v.precision === 'venue' && v.latitude != null ? { lat: v.latitude, lon: v.longitude } : null }, editions: eds.map(shapeEdition) },
    { rows: [v], policy: { currentS: 86400, staleS: 7 * 86400 }, semantics: v.precision === 'city' ? 'city-level location: the source names the city, not the venue' : 'venue' });
}

async function broadcast(store, id) {
  const m = (await store.select('tennis_matches', `select=match_id,edition_id&match_id=eq.${id}`))[0];
  if (!m) return null;
  const nowIso = new Date().toISOString();
  const rows = await store.select('tennis_broadcasts', `select=territory,country_code,broadcaster,service,distribution_type,official_url,deep_link,subscription_required,free_to_watch,language,source,source_url,verified_at,expires_at&or=(match_id.eq.${id},edition_id.eq.${m.edition_id})&superseded_by=is.null&or=(expires_at.is.null,expires_at.gt.${nowIso})`);
  if (!rows.length) return envelope(null, { freshness: 'UNAVAILABLE', semantics: 'no verified broadcast rights for this match or tournament', degraded: ['broadcast discovery has no verified official source ingested yet'] });
  return ok(rows, { rows: [], source: [...new Set(rows.map((r) => r.source))], updated: maxTime(rows, 'verified_at'), policy: { currentS: 7 * 86400, staleS: 30 * 86400 }, semantics: 'territorial broadcast rights, each with its source and verification date' });
}

async function credits(store) {
  const rows = await allRows(store, 'tennis_player_media', `select=author,license,source_page_url,attribution,verified_at,tennis_players(slug,full_name)&approval=eq.approved&order=verified_at.desc`);
  return ok(rows.map((r) => ({ player: { slug: r.tennis_players?.slug, name: r.tennis_players?.full_name }, author: r.author, license: r.license, source_page: r.source_page_url })), { rows: [], source: ['wikimedia_commons'], updated: maxTime(rows, 'verified_at'), policy: { currentS: 86400, staleS: 7 * 86400 }, semantics: 'every approved player photo with its author, license and source page' });
}

async function coverage(store) {
  const rows = await allRows(store, 'tennis_coverage_summary', 'select=*&order=year.desc');
  const [players, photos, dna, ranks] = await Promise.all([store.count('tennis_players'), store.count('tennis_player_media', 'approval=eq.approved'), store.count('tennis_dna_snapshots', 'definition_version=eq.1'), store.count('tennis_ranking_snapshots', 'row_count=gt.0')]);
  return ok({ by_year: rows, players, approved_photos: photos, dna_snapshots: dna, ranking_snapshots: ranks }, { rows: [], source: ['pbe_warehouse'], policy: { currentS: 3600, staleS: 86400 }, semantics: 'warehouse coverage: Q1 result only, Q2 set/game score, Q3 match statistics, Q4 point-by-point, Q5 point + spatial' });
}

export async function v2Route(path, url, store, env) {
  const own = /^\/v1\/(pbecast\/[0-9a-f-]{36}|schedule|dna\/leaders|home-dna-preview|players\/[a-z0-9-]+\/(dna|profile)|search|venues\/[a-z0-9-]+|matches\/[0-9a-f-]{36}\/broadcast|credits|coverage)$/.test(path);
  if (!own) return undefined;
  if (!store) return notConfigured('canonical store not connected to this Worker');
  let m;
  if ((m = /^\/v1\/pbecast\/([0-9a-f-]{36})$/.exec(path))) return UUID.test(m[1]) ? pbecast(store, m[1]) : null;
  if (path === '/v1/schedule') return schedule(store, url);
  if (path === '/v1/dna/leaders') return dnaLeaders(store, url, env);
  if (path === '/v1/home-dna-preview') return homeDnaPreview(store, env);
  if ((m = /^\/v1\/players\/([a-z0-9-]+)\/dna$/.exec(path))) return SLUG.test(m[1]) ? playerDnaV2(store, m[1], url, env) : null;
  if ((m = /^\/v1\/players\/([a-z0-9-]+)\/profile$/.exec(path))) return SLUG.test(m[1]) ? profile(store, m[1]) : null;
  if (path === '/v1/search') return search(store, url);
  if ((m = /^\/v1\/venues\/([a-z0-9-]+)$/.exec(path))) return venue(store, m[1]);
  if ((m = /^\/v1\/matches\/([0-9a-f-]{36})\/broadcast$/.exec(path))) return UUID.test(m[1]) ? broadcast(store, m[1]) : null;
  if (path === '/v1/credits') return credits(store);
  if (path === '/v1/coverage') return coverage(store);
  return undefined;
}
