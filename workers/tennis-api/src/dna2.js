// Tennis DNA v2 serving (Match DNA + PBE Rating). docs/TENNIS_DNA_CONTRACT.md §v2.
// Reads stored definition_version 2 snapshots only: percentiles and per-metric comparative gates were computed
// by the build over the same tour + as_of population. ATP and WTA are never pooled. Technical DNA (v1) is served
// separately and unchanged.

import { inList } from '../../shared/store/postgrest.js';
import { MATCH_DEFINITIONS, COMPARATIVE_MIN, PERCENTILE_MIN_PEERS, PROFILE_DEFINITIONS, PROFILE_MIN } from '../../shared/dna/match-dna.js';
import { MEDIA, shapePlayer } from './shape.js';

const FAMILIES = [
  ['result_strength', 'Result strength'],
  ['pressure', 'Pressure'],
  ['opponent_quality', 'Opponent quality']
];
const tourOf = (g) => (g === 'M' ? 'ATP' : 'WTA');

export async function latestV2(store, pid) {
  return (await store.select('tennis_dna_snapshots', `select=as_of,metrics,provenance&pbe_player_id=eq.${pid}&surface=eq.all&definition_version=eq.2&order=as_of.desc&limit=1`))[0] || null;
}

const SURFACE_KEYS = ['match_win_rate', 'set_win_rate', 'game_win_rate', 'tiebreak_win_rate', 'deciding_set_win_rate', 'top10_win_rate', 'top25_win_rate', 'top50_win_rate', 'wins_above_expectation'];
const statusOf = (m) => (m.value == null ? 'missing' : !m.comparable ? 'descriptive' : !['medium', 'high'].includes(m.confidence) ? 'player_sample_low' : !m.comparative_published ? 'population_building' : m.percentile == null ? 'peer_sample_not_mature' : 'published');

/**
 * Surface Match DNA (additive, 2026-09-28): the latest hard / clay / grass v2 snapshots — the same definitions over
 * the player's matches on that sourced surface, compared within the tour x surface population.
 */
export async function surfaceDna(store, pid) {
  const rows = await store.select('tennis_dna_snapshots', `select=as_of,surface,metrics,provenance&pbe_player_id=eq.${pid}&surface=in.(hard,clay,grass)&definition_version=eq.2&order=as_of.desc&limit=9`);
  const latest = new Map();
  for (const r of rows) if (!latest.has(r.surface)) latest.set(r.surface, r);
  return ['hard', 'clay', 'grass'].filter((s) => latest.has(s)).map((sf) => {
    const r = latest.get(sf);
    const M = r.metrics || {};
    const rt = M._rating;
    return {
      surface: sf, as_of: r.as_of, sample: r.provenance?.sample || null, wae_basis: r.provenance?.wae_basis || null,
      rating: rt ? { value: rt.value, rated_matches: rt.rated_matches, provisional: rt.provisional, percentile: rt.percentile ?? null, established: !!rt.established, status: !rt.published ? 'not_validated' : rt.provisional ? 'provisional' : 'published' } : null,
      form: M._form ? { last10: M._form.last10, current_streak: M._form.current_streak, career: M._form.career } : null,
      profile: M._profile || null,
      metrics: SURFACE_KEYS.map((k) => { const m = M[k] || {}; const d = MATCH_DEFINITIONS[k]; return { key: k, label: d.label, unit: d.unit, value: m.value ?? null, confidence: m.confidence || 'insufficient', sample_matches: m.sample_matches ?? 0, record: m.record || null, percentile: m.comparative_published ? m.percentile ?? null : null, population_qualified: m.population_qualified ?? 0, status: statusOf(m) }; })
    };
  });
}

/** One stored v2 metric -> served shape (percentile only where that metric's same-tour comparison is published). */
function metricOut(k, m = {}) {
  const d = MATCH_DEFINITIONS[k];
  return { key: k, label: d.label || k, doc: d.doc, value: m.value ?? null, unit: d.unit, numerator: m.numerator ?? null, denominator: m.denominator ?? null, sample_matches: m.sample_matches ?? 0, confidence: m.confidence || 'insufficient', percentile: m.comparative_published ? m.percentile ?? null : null, population_qualified: m.population_qualified ?? 0, comparative_published: !!m.comparative_published, lower_is_better: !!d.lower_is_better, record: m.record || null, status: statusOf(m) };
}
const ratingOut = (r) => (r ? { ...r, status: !r.published ? 'not_validated' : r.provisional ? 'provisional' : 'published' } : null);

// PBEcast comparison order: result strength, pressure, opponent quality (every key is a stored v2 metric)
export const PBECAST_MATCH_KEYS = ['match_win_rate', 'set_win_rate', 'game_win_rate', 'straight_sets_win_rate', 'deciding_set_win_rate', 'tiebreak_win_rate', 'close_match_win_rate', 'comeback_win_rate', 'top10_win_rate', 'top25_win_rate', 'top50_win_rate', 'wins_above_expectation'];

/**
 * Compact Match DNA for PBEcast (definition_version 2): the player's latest stored snapshot + the match surface's
 * snapshot. Same stored values and gates as /v1/players/:slug/dna; nothing is recomputed. A PBE Rating whose tour
 * has not passed its backtest is reported as not_validated WITHOUT its value.
 */
export async function pbecastMatchDna(store, pid, gender, surf = null) {
  const snap = await latestV2(store, pid);
  if (!snap) return null;
  const M = snap.metrics || {};
  const tour = M._tour || tourOf(gender);
  const gate = (r) => (!r ? null : r.status === 'not_validated' ? { status: 'not_validated', rated_matches: r.rated_matches ?? null } : r);
  const rating = gate(ratingOut(M._rating));
  let surface = null;
  if (surf) {
    const s = (await surfaceDna(store, pid)).find((x) => x.surface === surf);
    if (s) surface = { surface: s.surface, as_of: s.as_of, sample: s.sample, rating: s.rating?.status === 'not_validated' ? { status: 'not_validated' } : s.rating, form: s.form, metrics: s.metrics.filter((m) => ['match_win_rate', 'set_win_rate', 'tiebreak_win_rate', 'deciding_set_win_rate', 'top10_win_rate'].includes(m.key)) };
  }
  const f = M._form || null;
  return {
    definition_version: 2, as_of: snap.as_of, tour, sample: snap.provenance?.sample || null, rating,
    form: f ? { last10: f.last10 || null, last20: f.last20 || null, current_streak: f.current_streak || null, career: f.career || null, rolling20: f.rolling20 || null } : null,
    surface_record: M._surface_record || null, surface,
    metrics: PBECAST_MATCH_KEYS.map((k) => metricOut(k, M[k])),
    gates: { percentile_min_peers: PERCENTILE_MIN_PEERS, comparative_min: COMPARATIVE_MIN, basis: `${tour} singles players with a stored v2 snapshot on ${snap.as_of}; ATP and WTA are never pooled` }
  };
}

/** Match DNA block for one player (null when no v2 snapshot). Opponent names and tournaments are joined for the recent list. */
export async function matchDna(store, player) {
  const snap = await latestV2(store, player.pbe_player_id);
  if (!snap) return null;
  const M = snap.metrics || {};
  const families = FAMILIES.map(([key, label]) => {
    const metrics = Object.entries(MATCH_DEFINITIONS).filter(([, d]) => d.family === key).map(([k]) => metricOut(k, M[k]));
    return { key, label, metrics, published: metrics.filter((x) => x.comparative_published).length };
  });
  const recent = M._recent || [];
  const oppIds = [...new Set(recent.map((r) => r.opponent))];
  const [opps, eds] = await Promise.all([
    oppIds.length ? store.select('tennis_players', `select=pbe_player_id,slug,full_name,last_name,nationality,gender,${MEDIA}&pbe_player_id=${inList(oppIds)}`) : [],
    recent.length ? store.select('tennis_matches', `select=match_id,tennis_tournament_editions(year,name,tennis_tournaments(slug,name))&match_id=${inList(recent.map((r) => r.match_id))}`) : []
  ]);
  const P = new Map(opps.map((o) => [o.pbe_player_id, shapePlayer(o)]));
  const E = new Map(eds.map((e) => [e.match_id, e.tennis_tournament_editions]));
  const rating = ratingOut(M._rating);
  return {
    definition_version: 2, as_of: snap.as_of, tour: M._tour || tourOf(player.gender), sample: snap.provenance?.sample || null,
    rating, form: M._form || null, surface_record: M._surface_record || null, families,
    profile: M._profile || null, profile_definitions: { ...PROFILE_DEFINITIONS, min_sample: PROFILE_MIN }, by_surface: await surfaceDna(store, player.pbe_player_id),
    recent: recent.map((r) => { const e = E.get(r.match_id); return { ...r, opponent: P.get(r.opponent) || null, tournament: e ? { name: e.tennis_tournaments?.name || e.name, slug: e.tennis_tournaments?.slug || null, year: e.year } : null }; }),
    gates: { percentile_min_peers: PERCENTILE_MIN_PEERS, comparative_min: COMPARATIVE_MIN, basis: `${M._tour || tourOf(player.gender)} singles players with a stored v2 snapshot on ${snap.as_of}; a metric's comparison publishes on its own once ${COMPARATIVE_MIN} players qualify (medium/high confidence)` }
  };
}

/** Leaders for a v2 metric or the PBE Rating; each metric is gated on its own qualified population. */
export async function matchDnaLeaders(store, { metric, tour, limit }) {
  const g = tour === 'atp' ? 'M' : 'F';
  const [latest] = await store.select('tennis_dna_snapshots', `select=as_of,tennis_players!inner(gender)&definition_version=eq.2&surface=eq.all&tennis_players.gender=eq.${g}&order=as_of.desc&limit=1`);
  if (!latest) return null;
  const col = metric === 'pbe_rating' ? 'metrics->_rating' : `metrics->${metric}`;
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const page = await store.select('tennis_dna_snapshots', `select=pbe_player_id,m:${col},tennis_players!inner(pbe_player_id,slug,full_name,last_name,nationality,gender,${MEDIA})&as_of=eq.${latest.as_of}&surface=eq.all&definition_version=eq.2&tennis_players.gender=eq.${g}&order=pbe_player_id.asc&limit=1000&offset=${off}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const def = MATCH_DEFINITIONS[metric];
  let list;
  let published;
  let qualified;
  if (metric === 'pbe_rating') {
    list = rows.filter((r) => r.m && r.m.established);
    qualified = list.length;
    published = list.some((r) => r.m.published) && qualified >= COMPARATIVE_MIN;
    list.sort((a, b) => b.m.value - a.m.value);
  } else {
    list = rows.filter((r) => r.m && r.m.value != null && r.m.comparable && ['medium', 'high'].includes(r.m.confidence));
    qualified = list.length;
    published = qualified >= COMPARATIVE_MIN;
    list.sort((a, b) => (def.lower_is_better ? a.m.value - b.m.value : b.m.value - a.m.value));
  }
  return {
    metric, tour, as_of: latest.as_of, definition_version: 2, definition: metric === 'pbe_rating' ? 'PBE Rating (chronological Elo, method v1) among players with 20+ rated matches and a match in the last 365 days' : def.doc,
    published, qualified, threshold: COMPARATIVE_MIN,
    rows: published ? list.slice(0, limit).map((r, i) => ({ rank: i + 1, player: shapePlayer(r.tennis_players), value: r.m.value, numerator: r.m.numerator ?? null, denominator: r.m.denominator ?? null, sample_matches: r.m.sample_matches ?? r.m.rated_matches ?? null, confidence: r.m.confidence ?? null })) : []
  };
}

export const V2_METRICS = new Set([...Object.keys(MATCH_DEFINITIONS), 'pbe_rating']);
