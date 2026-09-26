// tennis-api v2 routes: PBEcast, schedule, stored Tennis DNA (+ population percentiles), player profile,
// search, venues, broadcast, credits, coverage. Returns undefined for paths it does not own.

import { envelope, notConfigured } from '../../shared/envelope.js';
import { inList } from '../../shared/store/postgrest.js';
import { keyMoments, matchControl, gamesFromPoints, normalizeStoredEvent } from '../../shared/canonical/events.js';
import { DEFINITIONS, DEFINITION_VERSION } from '../../shared/dna/metric.js';
import { MATCH, MEDIA, FINAL, TOUR_LEVELS, UUID, SLUG, today, addDays, shapeMatch, shapePlayer, shapePhoto, shapeEdition, maxTime, families } from './shape.js';

const ok = (data, { rows = [], source = null, updated = null, policy, semantics, degraded = [] }) => envelope(data, { source: source || families(rows), source_updated_at: updated ?? maxTime(rows), policy, semantics, degraded });

// DNA dimensions shown as radar/percentiles — every one is a stored v1 metric (no proxies).
export const DNA_DIMENSIONS = [
  ['service_points_won', 'Serve'], ['hold_rate', 'Hold'], ['first_serve_won', '1st serve won'], ['second_serve_won', '2nd serve won'],
  ['return_points_won', 'Return'], ['return_games_won', 'Break rate'], ['break_points_saved', 'BP saved'], ['break_points_converted', 'BP converted']
];
const LOWER_IS_BETTER = new Set(['double_fault_rate']);

export async function allRows(store, table, query, cap = 5000) {
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

async function latestAsOf(store) {
  return (await store.select('tennis_dna_snapshots', 'select=as_of&order=as_of.desc&limit=1'))[0]?.as_of || null;
}

const TOUR_OF = { F: 'WTA', M: 'ATP' };
/** A tour's Tennis DNA is published only once its population is meaningful (owner rule 2026-09-26). */
export const DNA_MIN_QUALIFIED = 30;
export async function tourDnaStatus(store, gender) {
  const asOf = await latestAsOf(store);
  if (!asOf) return { ready: false, qualified: 0, as_of: null };
  const rows = await allRows(store, 'tennis_dna_snapshots', `select=metrics,tennis_players!inner(gender)&as_of=eq.${asOf}&surface=eq.all&tennis_players.gender=eq.${gender === 'M' ? 'M' : 'F'}`);
  const qualified = rows.filter((r) => ['medium', 'high'].includes(r.metrics?.service_points_won?.confidence)).length;
  return { ready: qualified >= DNA_MIN_QUALIFIED, qualified, as_of: asOf, threshold: DNA_MIN_QUALIFIED };
}
/** Population for percentiles: same as_of + surface + TOUR (ATP and WTA are never pooled), confidence medium/high. */
async function population(store, asOf, surface, gender) {
  const rows = await allRows(store, 'tennis_dna_snapshots', `select=pbe_player_id,metrics,tennis_players!inner(gender)&as_of=eq.${asOf}&surface=eq.${surface}&definition_version=eq.${DEFINITION_VERSION}&tennis_players.gender=eq.${gender === 'M' ? 'M' : 'F'}`);
  const pop = {};
  for (const [k] of Object.entries(DEFINITIONS)) pop[k] = rows.map((r) => r.metrics?.[k]).filter((m) => m && m.value != null && ['medium', 'high'].includes(m.confidence)).map((m) => m.value).sort((a, b) => a - b);
  return { pop, players: rows.length };
}

function percentile(sorted, v, key) {
  if (v == null || sorted.length < 10) return null;
  let below = 0;
  for (const x of sorted) if (x < v) below += 1; else break;
  const p = Math.round((below / sorted.length) * 100);
  return LOWER_IS_BETTER.has(key) ? 100 - p : p;
}

async function storedDna(store, pid, surface = 'all') {
  return (await store.select('tennis_dna_snapshots', `select=as_of,surface,definition_version,metrics,provenance&pbe_player_id=eq.${pid}&surface=eq.${surface}&order=as_of.desc&limit=1`))[0] || null;
}

/** PBEcast DNA pair: surface snapshots only when the tour's DNA is published. */
async function gatedPair(store, pid, surf) {
  const all = await dnaWithPercentiles(store, pid, 'all');
  if (all?.published === false) return { all, surface: null };
  return { all, surface: surf ? await storedDna(store, pid, surf) : null };
}

async function dnaWithPercentiles(store, pid, surface = 'all') {
  const snap = await storedDna(store, pid, surface);
  if (!snap) return null;
  const gender = (await store.select('tennis_players', `select=gender&pbe_player_id=eq.${pid}`))[0]?.gender === 'M' ? 'M' : 'F';
  const gate = await tourDnaStatus(store, gender);
  if (!gate.ready) return { published: false, tour: TOUR_OF[gender], reason: `${TOUR_OF[gender]} Tennis DNA is published once ${gate.threshold} players have a medium-confidence sample (currently ${gate.qualified})`, qualified: gate.qualified, threshold: gate.threshold };
  const { pop, players } = await population(store, snap.as_of, surface, gender);
  const dims = DNA_DIMENSIONS.map(([k, label]) => {
    const m = snap.metrics[k];
    const usable = m && m.value != null && ['medium', 'high'].includes(m.confidence);
    return { key: k, label, value: m?.value ?? null, confidence: m?.confidence ?? 'insufficient', sample_matches: m?.sample_matches ?? 0, percentile: usable ? percentile(pop[k], m.value, k) : null, population: pop[k].length };
  });
  return { as_of: snap.as_of, surface, definition_version: snap.definition_version, metrics: snap.metrics, dimensions: dims, population_players: players, matches_considered: snap.provenance?.matches_considered ?? null, tour: TOUR_OF[gender], percentile_basis: `${TOUR_OF[gender]} singles players with a stored v${snap.definition_version} snapshot on ${snap.as_of} (${surface}) whose metric confidence is medium or high` };
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
    dna = {
      A: await gatedPair(store, a.id, surf),
      B: await gatedPair(store, b.id, surf),
      surface: surf,
      note: 'stored Tennis DNA snapshots (as_of exclusive); values are never recomputed in the browser'
    };
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
    cadence_note: hasPoints ? 'every point as published by the source' : 'periodic observation of the source (about every 18 seconds while live); changes between two observations are shown as one update',
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
  const lv = TOUR_LEVELS;
  const eds = await store.select('tennis_tournament_editions', `select=edition_id,year,name,level,surface,indoor,start_date,end_date,city,country,source_status,source_family,updated_at,venue_id,tennis_tournaments(slug,name),tennis_venues(slug,city,country,venue_name,precision)&start_date=lte.${win[1]}&end_date=gte.${win[0]}&level=${inList(lv)}&order=start_date.asc&limit=200`);
  const ids = eds.map((e) => e.edition_id);
  const statusF = url.searchParams.get('status');
  const statusQ = statusF === 'live' ? '&status=eq.in_progress' : statusF === 'scheduled' ? '&status=eq.scheduled' : statusF === 'completed' ? `&status=${inList(FINAL)}` : '';
  const eventF = url.searchParams.get('event');
  // gender filter on the canonical event type: men MS/MD, women WS/WD, mixed XD (never on ranking availability)
  const G = { men: ['MS', 'MD'], women: ['WS', 'WD'], mixed: ['XD'] }[url.searchParams.get('gender')] || null;
  const E = eventF === 'singles' ? ['MS', 'WS'] : eventF === 'doubles' ? ['MD', 'WD', 'XD'] : null;
  const types = G && E ? G.filter((t) => E.includes(t)) : G || E;
  const eventQ = types ? `&event_type=in.(${(types.length ? types : ['none']).join(',')})` : '';
  const includeMatches = view === 'today' || view === 'tomorrow' || statusF;
  const matches = includeMatches && ids.length ? await store.select('tennis_matches', `select=${MATCH}&edition_id=${inList(ids)}${statusQ}${eventQ}&order=source_updated_at.desc.nullslast&limit=300`) : [];
  const surf = url.searchParams.get('surface');
  const tour = url.searchParams.get('tour');
  const keepEd = (e) => (!surf || e.surface === surf) && (!tour || (tour === 'grand-slam' ? e.level === 'Grand Slam' : tour === 'wta-125' ? e.level === 'WTA 125' : tour === 'wta' ? /^WTA (1000|500|250|Finals)$/.test(e.level) : true));
  const shaped = matches.map(shapeMatch).filter((mm) => keepEd({ surface: mm.tournament?.surface, level: mm.tournament?.level }));
  const tournaments = eds.filter(keepEd).map((e) => ({ ...shapeEdition({ ...e }), status: e.source_status, venue: e.tennis_venues || null }));
  return ok({ view, window: win, tournaments, live: shaped.filter((x) => x.status === 'in_progress'), scheduled: shaped.filter((x) => x.status === 'scheduled'), completed: shaped.filter((x) => FINAL.includes(x.status)).slice(0, 60), completed_total: shaped.filter((x) => FINAL.includes(x.status)).length, filters: { tours: ['wta', 'wta-125', 'grand-slam'], surfaces: ['hard', 'clay', 'grass'], events: ['singles', 'doubles'], genders: ['men', 'women', 'mixed'] } },
    { rows: [...eds, ...matches], policy: { currentS: 300, staleS: 1800 }, semantics: `schedule ${view} (${win[0]}..${win[1]}): covered sources only — women: WTA Tour, WTA 125 and Grand Slams; men and mixed: supported Grand Slam sources. Start times are shown only when the source publishes a full timestamp.`, degraded: ['ATP Tour, ATP Challenger and ITF schedules are not yet acquirable'] });
}

// ---- DNA ----------------------------------------------------------------------------------------------
async function playerDnaV2(store, slug, url) {
  const p = await playerBySlug(store, slug);
  if (!p) return null;
  const surface = ['hard', 'clay', 'grass'].includes(url.searchParams.get('surface')) ? url.searchParams.get('surface') : 'all';
  const d = await dnaWithPercentiles(store, p.pbe_player_id, surface);
  const surfaces = {};
  if (d?.published !== false) for (const s of ['hard', 'clay', 'grass']) { const x = await storedDna(store, p.pbe_player_id, s); if (x) surfaces[s] = { as_of: x.as_of, matches_considered: x.provenance?.matches_considered ?? null, metrics: x.metrics }; }
  return ok({ player: shapePlayer(p), dna: d, surfaces }, { rows: [], source: ['pbe_derived'], updated: d?.as_of ? `${d.as_of}T00:00:00Z` : null, policy: { currentS: 86400 * 2, staleS: 86400 * 8 }, semantics: 'stored Tennis DNA v1 (singles); percentiles vs the stored population on the same as_of date' });
}

async function dnaLeaders(store, url) {
  const metric = url.searchParams.get('metric') || 'hold_rate';
  if (!DEFINITIONS[metric]) return envelope(null, { freshness: 'ERROR', semantics: 'unknown metric' });
  const surface = ['hard', 'clay', 'grass'].includes(url.searchParams.get('surface')) ? url.searchParams.get('surface') : 'all';
  const asOf = await latestAsOf(store);
  if (!asOf) return envelope(null, { freshness: 'UNAVAILABLE', semantics: 'no DNA snapshots stored yet' });
  const tour = url.searchParams.get('tour') === 'atp' ? 'atp' : 'wta';
  const gate = await tourDnaStatus(store, tour === 'atp' ? 'M' : 'F');
  if (!gate.ready) return ok({ metric, tour, published: false, definition: DEFINITIONS[metric].doc, surface, as_of: asOf, qualified: gate.qualified, threshold: gate.threshold, rows: [] }, { rows: [], source: ['pbe_derived'], updated: `${asOf}T00:00:00Z`, policy: { currentS: 86400 * 2, staleS: 86400 * 8 }, semantics: `${tour.toUpperCase()} Tennis DNA is not published until ${gate.threshold} players have a medium-confidence sample (currently ${gate.qualified})` });
  const rows = await allRows(store, 'tennis_dna_snapshots', `select=pbe_player_id,metrics,tennis_players!inner(pbe_player_id,slug,full_name,last_name,nationality,gender,${MEDIA})&as_of=eq.${asOf}&surface=eq.${surface}&tennis_players.gender=eq.${tour === 'atp' ? 'M' : 'F'}`);
  const list = rows.map((r) => ({ player: shapePlayer(r.tennis_players), m: r.metrics?.[metric] })).filter((x) => x.m && x.m.value != null && ['medium', 'high'].includes(x.m.confidence));
  list.sort((a, b) => (LOWER_IS_BETTER.has(metric) ? a.m.value - b.m.value : b.m.value - a.m.value));
  const limit = Math.min(Number(url.searchParams.get('limit')) || 25, 100);
  return ok({ metric, tour, definition: DEFINITIONS[metric].doc, surface, as_of: asOf, qualified: list.length, rows: list.slice(0, limit).map((x, i) => ({ rank: i + 1, player: x.player, value: x.m.value, numerator: x.m.numerator, denominator: x.m.denominator, sample_matches: x.m.sample_matches, confidence: x.m.confidence })) },
    { rows: [], source: ['pbe_derived'], updated: `${asOf}T00:00:00Z`, policy: { currentS: 86400 * 2, staleS: 86400 * 8 }, semantics: `${tour.toUpperCase()} singles leaders among players whose metric confidence is medium or high (small samples excluded; ATP and WTA are separate populations)` });
}

// ---- player profile (form, surface record, opponents, current tournament) ------------------------------
async function profile(store, slug) {
  const p = await playerBySlug(store, slug);
  if (!p) return null;
  const key = `S:${p.pbe_player_id}`;
  const mp = await store.select('tennis_match_participants', `select=match_id,side&participant_key=eq.${key}&limit=2000`);
  const side = new Map(mp.map((r) => [r.match_id, r.side]));
  const ms = mp.length ? await allRows(store, 'tennis_matches', `select=match_id,status,winner_side,surface,source_updated_at,round,score_text,edition_id,tennis_tournament_editions(year,name,level,start_date,end_date,tennis_tournaments(slug,name)),tennis_match_participants(side,tennis_participants(tennis_participant_members(${'tennis_players(pbe_player_id,slug,full_name,nationality,gender,' + MEDIA + ')'})))&match_id=${inList([...side.keys()].slice(0, 900))}&order=source_updated_at.desc.nullslast`) : [];
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
  const [players, photos, dna, ranks] = await Promise.all([store.count('tennis_players'), store.count('tennis_player_media', 'approval=eq.approved'), store.count('tennis_dna_snapshots'), store.count('tennis_ranking_snapshots', 'row_count=gt.0')]);
  return ok({ by_year: rows, players, approved_photos: photos, dna_snapshots: dna, ranking_snapshots: ranks }, { rows: [], source: ['pbe_warehouse'], policy: { currentS: 3600, staleS: 86400 }, semantics: 'warehouse coverage: Q1 result only, Q2 set/game score, Q3 match statistics, Q4 point-by-point, Q5 point + spatial' });
}

export async function v2Route(path, url, store) {
  const own = /^\/v1\/(pbecast\/[0-9a-f-]{36}|schedule|dna\/leaders|players\/[a-z0-9-]+\/(dna|profile)|search|venues\/[a-z0-9-]+|matches\/[0-9a-f-]{36}\/broadcast|credits|coverage)$/.test(path);
  if (!own) return undefined;
  if (!store) return notConfigured('canonical store not connected to this Worker');
  let m;
  if ((m = /^\/v1\/pbecast\/([0-9a-f-]{36})$/.exec(path))) return UUID.test(m[1]) ? pbecast(store, m[1]) : null;
  if (path === '/v1/schedule') return schedule(store, url);
  if (path === '/v1/dna/leaders') return dnaLeaders(store, url);
  if ((m = /^\/v1\/players\/([a-z0-9-]+)\/dna$/.exec(path))) return SLUG.test(m[1]) ? playerDnaV2(store, m[1], url) : null;
  if ((m = /^\/v1\/players\/([a-z0-9-]+)\/profile$/.exec(path))) return SLUG.test(m[1]) ? profile(store, m[1]) : null;
  if (path === '/v1/search') return search(store, url);
  if ((m = /^\/v1\/venues\/([a-z0-9-]+)$/.exec(path))) return venue(store, m[1]);
  if ((m = /^\/v1\/matches\/([0-9a-f-]{36})\/broadcast$/.exec(path))) return UUID.test(m[1]) ? broadcast(store, m[1]) : null;
  if (path === '/v1/credits') return credits(store);
  if (path === '/v1/coverage') return coverage(store);
  return undefined;
}
