// tennis-api Matchup DNA + Players to Watch (Phase 6). Reads stored v2 snapshots, the v1 technical DNA, the
// canonical match store and the build summary in KV (backtest + calibration). Nothing is estimated here:
//   - the win probability is the PBE Rating model's (overall Elo, or the 50/50 overall+surface blend where the
//     edition's surface is sourced and the tour's surface model passed its backtest) and is WITHHELD when the tour's
//     rating is not validated or either player has fewer than MIN_PRIOR rated matches (outside the backtested range)
//   - every other block (form, serve/return, opponent quality, rest, travel, H2H) is CONTEXT: shown with its sample,
//     never fed into the probability, and absent when not sourced
import { envelope, notConfigured } from '../../shared/envelope.js';
import { inList } from '../../shared/store/postgrest.js';
import { calBand, RATING_METHOD_VERSION, PROFILE_MIN } from '../../shared/dna/match-dna.js';
import { MATCH, MEDIA, UUID, shapeMatch, shapePlayer, maxTime, families } from './shape.js';

export const MATCHUP_VERSION = '1.0.0';
export const MIN_PRIOR = 10; // the backtest's minPrior: probabilities outside it were never evaluated
const SURFACE_MIN = 5;       // the surface blend applies only when both players have >= 5 surface-rated matches
const LOW_SAMPLE_BAND = 200; // a calibration band with fewer out-of-sample matches is 'thin'
const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const ok = (data, { rows = [], source = null, updated = null, policy, semantics, degraded = [] }) => envelope(data, { source: source || families(rows), source_updated_at: updated ?? maxTime(rows), policy, semantics, degraded });
const TECH = [['service_points_won', 'Service points won'], ['return_points_won', 'Return points won'], ['hold_rate', 'Hold %'], ['return_games_won', 'Break %'], ['break_points_saved', 'Break points saved'], ['break_points_converted', 'Break points converted']];

let summaryCache = null;
export async function buildSummary(env, now = Date.now()) {
  if (summaryCache && now - summaryCache.at < 600e3) return summaryCache.v;
  const v = env?.TENNIS_STATE ? await env.TENNIS_STATE.get('dna:v2:summary', 'json') : null;
  summaryCache = { at: now, v };
  return v;
}
export const _resetSummaryCache = () => { summaryCache = null; };

async function latestV2AsOf(store) {
  return (await store.select('tennis_dna_snapshots', 'select=as_of&definition_version=eq.2&surface=eq.all&order=as_of.desc&limit=1'))[0]?.as_of || null;
}

/** Latest v2 overall + surface snapshot slices for the players (one query). */
async function snapshots(store, pids, asOf, { detail = false } = {}) {
  if (!pids.length || !asOf) return new Map();
  const cols = ['pbe_player_id', 'surface', 'r:metrics->_rating', 'w:metrics->_profile->windows', 'wae:metrics->wins_above_expectation', 'aor:metrics->avg_opponent_rank', 'f:metrics->_form->last10', 'n:provenance->sample->matches'];
  if (detail) cols.push('recent:metrics->_recent');
  const rows = await store.select('tennis_dna_snapshots', `select=${cols.join(',')}&pbe_player_id=${inList(pids)}&as_of=eq.${asOf}&definition_version=eq.2&limit=${pids.length * 4}`);
  const out = new Map();
  for (const r of rows) { if (!out.has(r.pbe_player_id)) out.set(r.pbe_player_id, {}); out.get(r.pbe_player_id)[r.surface] = r; }
  return out;
}

const playerOf = (m, side) => m.sides?.[side]?.players?.length === 1 ? m.sides[side].players[0] : null;
const tourOfMatch = (m) => (m.event_type === 'MS' ? 'ATP' : m.event_type === 'WS' ? 'WTA' : null);

/**
 * The model block of one matchup (pure: stored snapshots + tour summary in, probability and its context out).
 * a/b: { all, hard?, clay?, grass? } snapshot slices; surface: the edition's sourced surface or null.
 */
export function modelBlock(tourSummary, a, b, surface) {
  const ra = a?.all?.r;
  const rb = b?.all?.r;
  const variant = tourSummary?.variant || null;
  const model = { name: 'PBE Rating', method_version: RATING_METHOD_VERSION, variant, matchup_version: MATCHUP_VERSION };
  if (!ra || !rb) return { status: 'no_rating', probability: null, model, reason: 'one or both players have no PBE Rating in the stored ledger' };
  const ratings = { A: { value: ra.value, rated_matches: ra.rated_matches, provisional: !!ra.provisional }, B: { value: rb.value, rated_matches: rb.rated_matches, provisional: !!rb.provisional } };
  const edge = { points: ra.value - rb.value, favours: ra.value === rb.value ? null : ra.value > rb.value ? 'A' : 'B' };
  if (!tourSummary?.published) return { status: 'not_validated', probability: null, model, ratings, rating_edge: edge, reason: 'this tour’s PBE Rating has not beaten the ranking model out of sample; no probability is published' };
  if (ra.rated_matches < MIN_PRIOR || rb.rated_matches < MIN_PRIOR) return { status: 'insufficient_history', probability: null, model, ratings, rating_edge: edge, reason: `a probability needs both players with at least ${MIN_PRIOR} rated matches (the backtested range)` };
  const pOverall = expected(ra.value, rb.value);
  const sa = surface ? a?.[surface]?.r : null;
  const sb = surface ? b?.[surface]?.r : null;
  const blend = !!(surface && tourSummary.surface_published && sa?.rated_matches >= SURFACE_MIN && sb?.rated_matches >= SURFACE_MIN);
  const p = blend ? expected((ra.value + sa.value) / 2, (rb.value + sb.value) / 2) : pOverall;
  const basis = blend ? 'surface_blend' : 'overall';
  const bt = tourSummary.backtest?.[variant] || null;
  const table = bt?.calibration?.[basis] || null;
  const band = calBand(p);
  const similar = (key) => { const x = table?.[key]?.[band]; return x && x.matches ? { surface: key, band: [x.from, x.to], matches: x.matches, predicted: x.predicted, favourite_won: x.observed } : null; };
  const sim = { same_surface: surface ? similar(surface) : null, all_surfaces: similar('all') };
  const provisional = ratings.A.provisional || ratings.B.provisional;
  const thin = !sim.all_surfaces || sim.all_surfaces.matches < LOW_SAMPLE_BAND;
  return {
    status: 'published', probability: { A: r3(p), B: r3(1 - p) }, basis, overall_probability: { A: r3(pOverall), B: r3(1 - pOverall) }, model, ratings, rating_edge: edge,
    surface_ratings: surface ? { surface, A: sa ? { value: sa.value, rated_matches: sa.rated_matches } : null, B: sb ? { value: sb.value, rated_matches: sb.rated_matches } : null, used: blend } : null,
    confidence: { level: provisional ? 'provisional' : thin ? 'thin_history' : 'standard', provisional_player: provisional, similar_matches: sim,
      backtest: bt ? { matches: bt.matches, accuracy: bt.accuracy, log_loss: bt.log_loss, brier: bt.brier, vs_rank: bt.vs_rank ? { rating_log_loss: bt.vs_rank.rating_log_loss, rank_log_loss: bt.vs_rank.rank_log_loss } : null, from: null } : null }
  };
}

/** Context edges (never model inputs). */
export function contextBlock(a, b, surface) {
  const w = (x, k) => x?.all?.w?.[k] || null;
  const form = {};
  for (const k of ['10w', '52w']) {
    const A = w(a, k); const B = w(b, k);
    const both = A && B && A.n_rated >= PROFILE_MIN && B.n_rated >= PROFILE_MIN;
    form[k] = { A, B, wae_edge: both ? r3(A.wae - B.wae) : null, note: both ? null : `edge shown when both players have ${PROFILE_MIN}+ rated matches in the window` };
  }
  const q = (x) => ({ wins_above_expectation: x?.all?.wae?.value ?? null, wae_matches: x?.all?.wae?.denominator ?? null, avg_opponent_rank: x?.all?.aor?.value ?? null, ranked_opponents: x?.all?.aor?.denominator ?? null });
  const sf = surface ? { surface, A: a?.[surface]?.r ? { rating: a[surface].r.value, rated_matches: a[surface].r.rated_matches, vs_overall: a[surface].r.value - (a.all?.r?.value ?? a[surface].r.value) } : null, B: b?.[surface]?.r ? { rating: b[surface].r.value, rated_matches: b[surface].r.rated_matches, vs_overall: b[surface].r.value - (b.all?.r?.value ?? b[surface].r.value) } : null } : null;
  if (sf?.A && sf?.B) sf.edge = sf.A.rating - sf.B.rating;
  return { form, opponent_quality: { A: q(a), B: q(b) }, surface: sf || { surface: null, note: 'the edition’s surface is not sourced; no surface edge' } };
}

/** Rest from the player's own completed matches before the match day (stored recent list + this edition's results). */
export function restBlock(recent, day) {
  const played = recent.filter((r) => r.day < day).sort((x, y) => (x.day < y.day ? 1 : -1));
  const within = (d) => played.filter((r) => (Date.parse(day) - Date.parse(r.day)) / 86400e3 <= d);
  const sets = (xs) => xs.reduce((t, r) => t + (r.score ? r.score.replace(/ ret\.$/, '').split(' ').filter(Boolean).length : 0), 0);
  return played.length ? { last_match: played[0].day, days_since_last: Math.round((Date.parse(day) - Date.parse(played[0].day)) / 86400e3), matches_7d: within(7).length, matches_14d: within(14).length, sets_7d: sets(within(7)), sets_14d: sets(within(14)) } : null;
}

function explain(m, model, ctx) {
  const A = playerOf(m, 'A')?.name || 'Player A';
  const B = playerOf(m, 'B')?.name || 'Player B';
  const out = [];
  if (model.status !== 'published') { out.push(model.reason); return out; }
  const fav = model.probability.A >= 0.5 ? ['A', A, B] : ['B', B, A];
  const pf = Math.round(Math.max(model.probability.A, model.probability.B) * 100);
  out.push(`${fav[1]} is rated ${Math.abs(model.rating_edge.points)} PBE Rating points ${model.rating_edge.points === 0 ? 'level with' : 'above'} ${fav[2]} (${model.ratings[fav[0]].value} vs ${model.ratings[fav[0] === 'A' ? 'B' : 'A'].value}).`);
  if (model.basis === 'surface_blend') out.push(`On ${model.surface_ratings.surface}, the model averages each player’s overall and ${model.surface_ratings.surface} ratings (${model.surface_ratings.A.value} vs ${model.surface_ratings.B.value}); this blend beat the overall rating out of sample for this tour.`);
  out.push(`That gives ${fav[1]} a ${pf}% win probability (overall rating alone: ${Math.round(Math.max(model.overall_probability.A, model.overall_probability.B) * 100)}%).`);
  const s = model.confidence.similar_matches.same_surface || model.confidence.similar_matches.all_surfaces;
  if (s) out.push(`In ${s.matches.toLocaleString('en-US')} past ${s.surface === 'all' ? '' : `${s.surface} `}matches where the model gave the favourite ${Math.round(s.band[0] * 100)}–${Math.round(s.band[1] * 100)}%, the favourite won ${Math.round(s.favourite_won * 100)}%.`);
  if (model.confidence.provisional_player) out.push('At least one player has fewer than 20 rated matches: the rating is provisional and moves quickly.');
  out.push('Form, serve/return, rest and head-to-head below are context only: none of them changes this probability.');
  return out;
}

async function techDna(store, pids) {
  const rows = await store.select('tennis_dna_snapshots', `select=pbe_player_id,as_of,metrics&pbe_player_id=${inList(pids)}&surface=eq.all&definition_version=eq.1&order=as_of.desc&limit=10`);
  const out = new Map();
  for (const r of rows) if (!out.has(r.pbe_player_id)) out.set(r.pbe_player_id, r);
  return out;
}
export function serveReturn(ta, tb) {
  const g = (t, k) => { const m = t?.metrics?.[k]; return m && m.value != null && ['medium', 'high'].includes(m.confidence) ? { value: m.value, sample_matches: m.sample_matches, confidence: m.confidence } : null; };
  const rows = TECH.map(([k, label]) => ({ key: k, label, A: g(ta, k), B: g(tb, k) }));
  if (!rows.some((r) => r.A && r.B)) return { available: false, reason: 'serve/return statistics need a medium-confidence technical DNA sample for both players (match statistics coverage is limited)' };
  const pair = (s, r) => (s && r ? r3(s.value - r.value) : null);
  const x = Object.fromEntries(rows.map((r) => [r.key, r]));
  return { available: true, as_of: { A: ta?.as_of || null, B: tb?.as_of || null }, metrics: rows,
    matchups: { A_serve_vs_B_return: pair(x.service_points_won.A, x.return_points_won.B && { value: 1 - x.return_points_won.B.value }), B_serve_vs_A_return: pair(x.service_points_won.B, x.return_points_won.A && { value: 1 - x.return_points_won.A.value }) },
    note: 'serve-vs-return rows compare one player’s service points won with the service points the opponent’s returns ALLOW (1 - return points won); positive favours the server. Context only.' };
}

async function h2hBlock(store, pa, pb) {
  const ka = `S:${pa}`;
  const kb = `S:${pb}`;
  const mine = [];
  for (let off = 0; off < 6000; off += 1000) { const r = await store.select('tennis_match_participants', `select=match_id,side&participant_key=eq.${ka}&order=match_id.asc&limit=1000&offset=${off}`); mine.push(...r); if (r.length < 1000) break; }
  const sideA = new Map(mine.map((r) => [r.match_id, r.side]));
  const ids = [...sideA.keys()];
  const shared = [];
  for (let i = 0; i < ids.length; i += 250) shared.push(...await store.select('tennis_match_participants', `select=match_id&participant_key=eq.${kb}&match_id=${inList(ids.slice(i, i + 250))}`));
  const mids = shared.map((r) => r.match_id);
  const rows = mids.length ? await store.select('tennis_matches', `select=match_id,status,winner_side,score_text,round,scheduled_at,event_type,tennis_tournament_editions(year,surface,end_date,tennis_tournaments(slug,name))&match_id=${inList(mids)}&event_type=in.(MS,WS)`) : [];
  const done = rows.filter((m) => ['completed', 'retired', 'walkover'].includes(m.status)).map((m) => ({ id: m.match_id, won_by: m.winner_side === sideA.get(m.match_id) ? 'A' : 'B', status: m.status, score: m.score_text, round: m.round, date: (m.scheduled_at || m.tennis_tournament_editions?.end_date || '').slice(0, 10) || null, tournament: m.tennis_tournament_editions?.tennis_tournaments?.name || null, slug: m.tennis_tournament_editions?.tennis_tournaments?.slug || null, year: m.tennis_tournament_editions?.year || null, surface: m.tennis_tournament_editions?.surface || null }))
    .sort((x, y) => (x.date < y.date ? 1 : -1));
  return { model_input: false, record: { A: done.filter((m) => m.won_by === 'A').length, B: done.filter((m) => m.won_by === 'B').length }, meetings: done.slice(0, 10), total: done.length, note: 'head-to-head is descriptive and deliberately NOT a model feature (small samples, old meetings); coverage is the stored ledger' };
}

async function travelBlock(store, recent, m) {
  const last = recent.find((r) => r.day < (m.scheduled_at || '').slice(0, 10));
  if (!last) return null;
  const row = (await store.select('tennis_matches', `select=tennis_tournament_editions(edition_id,city,country,end_date,tennis_tournaments(name))&match_id=eq.${last.match_id}`))[0]?.tennis_tournament_editions;
  if (!row) return null;
  const here = m.tournament;
  const same = row.city && here?.city ? row.city === here.city && row.country === here.country : null;
  return { previous_event: row.tennis_tournaments?.name || null, previous_city: row.city || null, previous_country: row.country || null, previous_match: last.day, this_city: here?.city || null, this_country: here?.country || null, same_city: same, country_change: row.country && here?.country ? row.country !== here.country : null,
    note: 'locations as the tournament sources publish them; no distance, time-zone or jet-lag estimate is made' };
}

// ---- routes ---------------------------------------------------------------------------------------------
async function upcoming(store, env, url) {
  const tour = url.searchParams.get('tour') === 'atp' ? 'ATP' : url.searchParams.get('tour') === 'wta' ? 'WTA' : null;
  const now = Date.now();
  const from = new Date(now - 6 * 3600e3).toISOString();
  const to = new Date(now + 7 * 86400e3).toISOString();
  const et = tour === 'ATP' ? 'eq.MS' : tour === 'WTA' ? 'eq.WS' : 'in.(MS,WS)';
  const rows = await store.select('tennis_matches', `select=${MATCH}&status=eq.scheduled&event_type=${et}&scheduled_at=gte.${from}&scheduled_at=lte.${to}&order=scheduled_at.asc&limit=300`);
  const ms = rows.map(shapeMatch).filter((m) => playerOf(m, 'A') && playerOf(m, 'B'));
  const [summary, asOf] = await Promise.all([buildSummary(env), latestV2AsOf(store)]);
  const snaps = await snapshots(store, [...new Set(ms.flatMap((m) => [playerOf(m, 'A').id, playerOf(m, 'B').id]))], asOf);
  const list = ms.map((m) => {
    const t = tourOfMatch(m);
    const a = snaps.get(playerOf(m, 'A').id);
    const b = snaps.get(playerOf(m, 'B').id);
    const surface = ['hard', 'clay', 'grass'].includes(m.tournament?.surface) ? m.tournament.surface : null;
    const model = modelBlock(summary?.tours?.[t], a, b, surface);
    const ctx = contextBlock(a, b, surface);
    return { match: { id: m.id, round: m.round, scheduled_at: m.scheduled_at, court: m.court, tournament: m.tournament, sides: m.sides }, tour: t,
      model: { status: model.status, probability: model.probability, basis: model.basis || null, rating_edge: model.rating_edge || null, confidence: model.confidence?.level || null },
      form_edge_52w: ctx.form['52w'].wae_edge, surface_edge: ctx.surface?.edge ?? null };
  });
  return ok({ as_of: asOf, window: { from, to }, matchup_version: MATCHUP_VERSION, matchups: list }, { rows, policy: { currentS: 600, staleS: 3600 }, semantics: 'scheduled singles matches in the next 7 days with the PBE Rating matchup; probability published only for validated tours and players inside the backtested range' });
}

async function detail(store, env, id) {
  const rows = await store.select('tennis_matches', `select=${MATCH}&match_id=eq.${id}`);
  if (!rows.length) return null;
  const m = shapeMatch(rows[0]);
  const pa = playerOf(m, 'A');
  const pb = playerOf(m, 'B');
  if (!pa || !pb || !['MS', 'WS'].includes(m.event_type)) return envelope(null, { freshness: 'UNAVAILABLE', semantics: 'Matchup DNA covers singles matches with both players identified' });
  const t = tourOfMatch(m);
  const [summary, asOf] = await Promise.all([buildSummary(env), latestV2AsOf(store)]);
  const [snaps, tech, h2h] = await Promise.all([snapshots(store, [pa.id, pb.id], asOf, { detail: true }), techDna(store, [pa.id, pb.id]), h2hBlock(store, pa.id, pb.id)]);
  const a = snaps.get(pa.id);
  const b = snaps.get(pb.id);
  const surface = ['hard', 'clay', 'grass'].includes(m.tournament?.surface) ? m.tournament.surface : null;
  const model = modelBlock(summary?.tours?.[t], a, b, surface);
  const ctx = contextBlock(a, b, surface);
  const day = (m.scheduled_at || new Date().toISOString()).slice(0, 10);
  // rest: the stored recent list (matches before as_of) + this edition's results since as_of
  const ed = await store.select('tennis_matches', `select=match_id,status,winner_side,score_text,scheduled_at,tennis_match_participants(side,participant_key)&edition_id=eq.${rows[0].edition_id}&status=in.(completed,retired)&limit=400`);
  const since = (pid) => ed.filter((x) => (x.scheduled_at || '').slice(0, 10) >= (asOf || '') && x.tennis_match_participants.some((p) => p.participant_key === `S:${pid}`)).map((x) => ({ match_id: x.match_id, day: x.scheduled_at.slice(0, 10), score: x.score_text }));
  const recentOf = (s, pid) => { const seen = new Set(); return [...since(pid), ...(s?.all?.recent || [])].filter((r) => (seen.has(r.match_id) ? false : seen.add(r.match_id))); };
  const ra = recentOf(a, pa.id);
  const rb = recentOf(b, pb.id);
  const [ta, tb] = await Promise.all([travelBlock(store, [...(a?.all?.recent || [])], m), travelBlock(store, [...(b?.all?.recent || [])], m)]);
  const data = {
    as_of: asOf, tour: t, matchup_version: MATCHUP_VERSION, match: m,
    model, why: explain(m, model, ctx),
    context: { ...ctx, serve_return: serveReturn(tech.get(pa.id), tech.get(pb.id)), rest: { A: restBlock(ra, day), B: restBlock(rb, day), basis: 'completed singles matches in the stored ledger before the match day' }, travel: { A: ta, B: tb } },
    h2h
  };
  return ok(data, { rows, source: ['pbe_derived', ...families(rows)], policy: { currentS: 600, staleS: 3600 }, semantics: 'Matchup DNA: the PBE Rating model (probability + backtest calibration) and separate, labelled context; H2H is not a model feature' });
}

async function watch(store, env, url) {
  const week = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('week') || '') ? url.searchParams.get('week') : null;
  const kv = env?.TENNIS_STATE;
  if (!kv) return notConfigured('build state not bound to this Worker');
  const [w, weeks] = await Promise.all([kv.get(week ? `dna:v2:watch:week:${week}` : 'dna:v2:watch:current', 'json'), kv.get('dna:v2:watch:weeks', 'json')]);
  if (!w) return envelope(null, { freshness: 'UNAVAILABLE', semantics: week ? `no Players to Watch edition for the week of ${week}` : 'Players to Watch not built yet' });
  // a tour whose PBE Rating has not passed its backtest publishes no movement lists (same rule as the rating itself)
  for (const [t, x] of Object.entries(w.tours || {})) if (x && !x.rating_published) w.tours[t] = { as_of: x.as_of, rating_published: false, status: 'not_validated', note: `${t} PBE Rating has not beaten the ranking model out of sample; movement lists are withheld` };
  const ids = new Set();
  const walk =(x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x.pbe_player_id) ids.add(x.pbe_player_id); Object.values(x).forEach(walk); } };
  walk(w.tours);
  const list = [...ids];
  const people = [];
  for (let i = 0; i < list.length; i += 150) people.push(...await store.select('tennis_players', `select=pbe_player_id,slug,full_name,last_name,nationality,gender,${MEDIA}&pbe_player_id=${inList(list.slice(i, i + 150))}`));
  const P = new Map(people.map((p) => [p.pbe_player_id, shapePlayer(p)]));
  const attach = (x) => (Array.isArray(x) ? x.map(attach) : x && typeof x === 'object' ? (x.pbe_player_id ? { ...x, player: P.get(x.pbe_player_id) || null } : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, attach(v)]))) : x);
  return ok({ ...w, tours: attach(w.tours), edition: week ? 'weekly' : 'current', weeks: weeks || [] }, { rows: [], source: ['pbe_derived'], updated: w.built_at, policy: { currentS: 86400 * 2, staleS: 86400 * 8 }, semantics: 'Players to Watch: ranked PBE Rating movements with minimum samples (no editorial selection); the weekly edition is frozen each Monday' });
}

export async function matchupRoute(path, url, store, env) {
  const own = /^\/v1\/(matchups(\/[0-9a-f-]{36})?|players-to-watch)$/.test(path);
  if (!own) return undefined;
  if (!store) return notConfigured('canonical store not connected to this Worker');
  if (path === '/v1/matchups') return upcoming(store, env, url);
  if (path === '/v1/players-to-watch') return watch(store, env, url);
  const m = /^\/v1\/matchups\/([0-9a-f-]{36})$/.exec(path);
  return m && UUID.test(m[1]) ? detail(store, env, m[1]) : null;
}
