// Evidence packet builder (docs/NEWSROOM.md "Evidence packet").
//
// The packet is the ONLY input to the writer, the content plan and the gates, and it is frozen into
// tennis_article_evidence before anything is written. Every family is point-in-time: rankings are the
// official list in force on the match date, DNA is the stored snapshot built strictly before the match,
// form and head-to-head use only earlier tournaments. Families with no data are omitted, never padded.

import { approvedMedia } from '../../shared/media.js';
import { RANKING_LISTS, rankingProvenance, matchSource, tourOf, tourOfList } from './tour.js';
import { MATCH_DEFINITIONS } from '../../shared/dna/match-dna.js';

export const PACKET_VERSION = 'tennis-packet/3.0.0';

// Round codes come prefixed from the WTA feed ('M-S', 'Q-2') and unprefixed from the Slam/ESPN feeds ('S', 'Q', '2',
// 'Q-2' for qualifying): an unprefixed 'Q' is a main-draw QUARTERFINAL, never a qualifying round.
export const parseRound = (code) => {
  const s = String(code || '');
  if (s.includes('-')) { const [stage, r] = s.split('-'); return { stage, r }; }
  return { stage: 'M', r: s };
};
const ROUND_ORDER = (code) => {
  const { stage, r } = parseRound(code);
  const k = { Q: 5, S: 6, F: 7 }[r] ?? (Number(r) || 0);
  return (stage === 'Q' ? 0 : 10) + k;
};
export const roundLabel = (code, drawSize = null) => {
  const { stage, r } = parseRound(code);
  const named = { Q: 'quarterfinal', S: 'semifinal', F: 'final', RR: 'round robin' }[r];
  if (stage === 'Q') return r ? `qualifying round ${r}` : 'qualifying';
  if (named) return named;
  return r ? `round ${r}` : 'match';
};
const pct = (n, d) => (Number.isFinite(n) && Number.isFinite(d) && d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const ratio = (n, d) => (Number.isFinite(n) && Number.isFinite(d) && d > 0 ? { n, d, pct: pct(n, d) } : null);

/** Serve/return lines from two sides' source totals. Every derived value keeps its numerator/denominator. */
export function statLines(sa, sb) {
  if (!sa?.service_points || !sb?.service_points) return null;
  const side = (s, o) => {
    const second = s.service_points - s.first_serves_in;
    const oSecond = o.service_points - o.first_serves_in;
    const servWon = s.first_serve_points_won + s.second_serve_points_won;
    const oServWon = o.first_serve_points_won + o.second_serve_points_won;
    const bpConv = Number.isFinite(o.break_points_faced) && Number.isFinite(o.break_points_saved) ? { n: o.break_points_faced - o.break_points_saved, d: o.break_points_faced } : null;
    return {
      aces: s.aces ?? null,
      double_faults: s.double_faults ?? null,
      first_serve_in: ratio(s.first_serves_in, s.service_points),
      first_serve_won: ratio(s.first_serve_points_won, s.first_serves_in),
      second_serve_won: ratio(s.second_serve_points_won, second),
      service_points_won: ratio(servWon, s.service_points),
      first_return_won: ratio(o.first_serves_in - o.first_serve_points_won, o.first_serves_in),
      second_return_won: ratio(oSecond - o.second_serve_points_won, oSecond),
      return_points_won: ratio(o.service_points - oServWon, o.service_points),
      break_points_saved: ratio(s.break_points_saved, s.break_points_faced),
      break_points_converted: bpConv ? { ...bpConv, pct: pct(bpConv.n, bpConv.d) } : null,
      total_points_won: s.total_points_won ?? null
    };
  };
  return { A: side(sa, sb), B: side(sb, sa) };
}

export const durationParts = (s) => (Number.isFinite(s) && s > 0 ? { hours: Math.floor(s / 3600), minutes: Math.floor((s % 3600) / 60) } : null);

const MATCH_SEL = 'match_id,event_type,round,format_key,status,winner_side,end_reason,score_text,duration_s,started_at,edition_id,source_family,tennis_tournament_editions(edition_id,year,name,level,surface,indoor,start_date,end_date,city,country,source_family,competition_key,tennis_tournaments(slug,name)),tennis_sets(set_no,games_a,games_b,tb_a,tb_b,is_match_tiebreak,winner_side),tennis_match_participants(side,seed,entry_type,participant_key,tennis_participants(tennis_participant_members(slot,tennis_players(pbe_player_id,slug,full_name,last_name,nationality,tennis_player_media(pbe_player_id,approval,derivatives,attribution,license,author,source_page_url)))))';
const inList = (xs) => `in.(${xs.map((x) => `"${x}"`).join(',')})`;

function shapeRow(m) {
  const e = m.tennis_tournament_editions || {};
  const sides = {};
  for (const p of m.tennis_match_participants || []) {
    sides[p.side] = {
      key: p.participant_key, seed: p.seed ?? null, entry: p.entry_type || null,
      players: (p.tennis_participants?.tennis_participant_members || []).sort((a, b) => a.slot - b.slot).map((x) => {
        const pl = x.tennis_players;
        const media = approvedMedia(pl.tennis_player_media);
        const d = media?.derivatives;
        return { id: pl.pbe_player_id, slug: pl.slug, name: pl.full_name, last_name: pl.last_name || null, nationality: pl.nationality, photo: d?.square?.url ? { player_id: media.pbe_player_id, square: d.square.url, wide: d.wide?.url || null, square_jpg: d.square_jpg?.url || null, credit: media.attribution, license: media.license, author: media.author, source_page: media.source_page_url } : null };
      })
    };
  }
  return {
    id: m.match_id, event_type: m.event_type, round: m.round, round_label: roundLabel(m.round), round_order: ROUND_ORDER(m.round), format: m.format_key,
    best_of: /^BO5/.test(m.format_key) ? 5 : 3, status: m.status, winner_side: m.winner_side, end_reason: m.end_reason, score: m.score_text,
    duration_s: m.duration_s, duration: durationParts(m.duration_s), started_at: m.started_at, source_family: m.source_family || null,
    sets: (m.tennis_sets || []).sort((a, b) => a.set_no - b.set_no).map((s) => ({ A: s.games_a, B: s.games_b, tb: s.tb_a == null ? null : { A: s.tb_a, B: s.tb_b }, match_tiebreak: !!s.is_match_tiebreak })),
    tournament: { edition_id: e.edition_id, slug: e.tennis_tournaments?.slug || null, name: e.tennis_tournaments?.name || e.name, year: e.year, level: e.level, surface: e.surface, indoor: e.indoor, city: e.city, country: e.country, start_date: e.start_date, end_date: e.end_date, source_family: e.source_family || null, competition_key: e.competition_key || null },
    sides
  };
}

export async function loadMatch(store, id) {
  const rows = await store.select('tennis_matches', `select=${MATCH_SEL}&match_id=eq.${id}`);
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function loadMatches(store, query) {
  return (await store.select('tennis_matches', `select=${MATCH_SEL}&${query}`)).map(shapeRow);
}

/**
 * The stored list in force on a date (latest list dated on/before it). The returned Map carries `.provenance`
 * (rankingProvenance: official vs secondary source, depth) so prose never calls a secondary list official and
 * never calls a player outside a top-N extract "unranked".
 */
export async function rankAt(store, pids, date, listKey) {
  if (!listKey || !pids.length || !date) return new Map();
  const snap = (await store.select('tennis_ranking_snapshots', `select=snapshot_id,ranking_date,source_family,row_count&list_key=eq.${listKey}&ranking_date=lte.${date}&row_count=gt.0&order=ranking_date.desc&limit=1`))[0];
  if (!snap) return new Map();
  const rows = await store.select('tennis_rankings', `select=pbe_player_id,rank,points&snapshot_id=eq.${snap.snapshot_id}&pbe_player_id=${inList(pids)}`);
  const out = new Map(rows.map((r) => [r.pbe_player_id, { rank: r.rank, points: r.points, list_date: snap.ranking_date, list: listKey, source_family: snap.source_family || null }]));
  out.provenance = { ...rankingProvenance(listKey, snap.source_family, Number(snap.row_count)), list_date: snap.ranking_date };
  return out;
}

// ---- Match DNA v2 (frozen, point-in-time) -------------------------------------------------------------------
// Snapshot as_of STRICTLY BEFORE the event day (never today's rating in an old story). Only medium/high-confidence
// metrics; a percentile only where that metric's same-tour comparison was published in that snapshot; a PBE Rating
// value only where the tour's rating was published (validated) in that build; a surface rating only where the tour's
// surface model was published in that build. Families with nothing usable are omitted, never padded.
const r1 = (x) => Math.round(x * 1000) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const SURF_KEYS = ['match_win_rate', 'set_win_rate', 'game_win_rate', 'tiebreak_win_rate', 'deciding_set_win_rate', 'top10_win_rate', 'top25_win_rate', 'top50_win_rate', 'wins_above_expectation'];
function metricsOut(M, keys = Object.keys(MATCH_DEFINITIONS)) {
  const out = {};
  for (const k of keys) {
    const m = M?.[k];
    if (!m || m.value == null || !Number.isFinite(m.value) || !['medium', 'high'].includes(m.confidence)) continue;
    const d = MATCH_DEFINITIONS[k];
    out[k] = { label: d.label, family: d.family, value: m.value, ...(d.unit === 'ratio' ? { pct: r1(m.value) } : {}), sample_matches: m.sample_matches ?? null, confidence: m.confidence, record: m.record || null, percentile: m.comparative_published && Number.isFinite(m.percentile) ? m.percentile : null };
  }
  return out;
}
const ratingOut = (r) => (!r ? null : r.published ? { value: r.value, percentile: Number.isFinite(r.percentile) ? r.percentile : null, rated_matches: r.rated_matches ?? null, provisional: !!r.provisional, established: !!r.established, published: true } : { published: false, status: 'not_validated', rated_matches: r.rated_matches ?? null });
const split = (o) => (o ? Object.fromEntries(Object.entries(o).map(([k, x]) => [k, { W: x.W, L: x.L, set: x.set ?? null, game: x.game ?? null, wae: x.wae ?? null, n_rated: x.n_rated ?? null }])) : null);

export async function matchDnaBefore(store, pid, date, surface = null) {
  const snap = (await store.select('tennis_dna_snapshots', `select=as_of,metrics&pbe_player_id=eq.${pid}&surface=eq.all&definition_version=eq.2&as_of=lt.${date}&order=as_of.desc&limit=1`))[0];
  if (!snap) return null;
  const M = snap.metrics || {};
  const P = M._profile || {};
  const rating = ratingOut(M._rating);
  const out = { as_of: snap.as_of, definition_version: 2, tour: M._tour || null, rating, metrics: metricsOut(M), form: M._form ? { last10: M._form.last10 || null, last20: M._form.last20 || null, current_streak: M._form.current_streak || null, career: M._form.career || null } : null };
  if (P.windows) out.windows = Object.fromEntries(Object.entries(P.windows).map(([k, w]) => [k, { weeks: Number(String(k).replace('w', '')), from: w.from, W: w.W, L: w.L, wae: w.wae ?? null }]));
  if (P.vs_strength) out.vs_strength = split(P.vs_strength);
  if (P.vs_hand) out.vs_hand = split(P.vs_hand);
  // recent rating trajectory: monthly pre-match ratings, only when the rating itself was published in this build
  if (rating?.published && P.rating_history?.series?.length) out.rating_trajectory = { series: P.rating_history.series.slice(-12).map(([m, r]) => ({ month: m, rating: r })), peak: P.rating_history.peak || null };
  if (surface && ['hard', 'clay', 'grass'].includes(surface)) {
    const ss = (await store.select('tennis_dna_snapshots', `select=as_of,metrics&pbe_player_id=eq.${pid}&surface=eq.${surface}&definition_version=eq.2&as_of=lt.${date}&order=as_of.desc&limit=1`))[0];
    if (ss) {
      const S = ss.metrics || {};
      const sr = S._rating;
      out.surface = { surface, as_of: ss.as_of, record: S._form?.career || null, last10: S._form?.last10 || null, metrics: metricsOut(S, SURF_KEYS), rating: sr?.published ? { value: sr.value, percentile: Number.isFinite(sr.percentile) ? sr.percentile : null, rated_matches: sr.rated_matches ?? null } : null };
    }
  }
  if (!Object.keys(out.metrics).length && !rating) return null;
  return out;
}

/**
 * Pre-match expectation from the PBE Rating: only when both players have a published (validated) overall rating in
 * the SAME stored build dated strictly before the match, neither provisional. Elo expectation of the rating method
 * (1 / (1 + 10^((rb - ra) / 400))). Every number frozen here; prose never states it (gates ban model language):
 * it is shown only in the at-a-glance / intelligence modules, labelled as the model.
 */
export async function expectationBefore(store, wid, lid, date) {
  const rows = await store.select('tennis_dna_snapshots', `select=pbe_player_id,as_of,r:metrics->_rating&pbe_player_id=${inList([wid, lid])}&surface=eq.all&definition_version=eq.2&as_of=lt.${date}&order=as_of.desc&limit=20`);
  const byDate = new Map();
  for (const r of rows) { if (!byDate.has(r.as_of)) byDate.set(r.as_of, {}); byDate.get(r.as_of)[r.pbe_player_id] = r.r; }
  const [asOf, both] = [...byDate.entries()].find(([, x]) => x[wid] && x[lid]) || [];
  if (!asOf) return null;
  const a = both[wid];
  const b = both[lid];
  if (!a?.published || !b?.published || a.provisional || b.provisional || !Number.isFinite(a.value) || !Number.isFinite(b.value)) return null;
  const p = 1 / (1 + 10 ** ((b.value - a.value) / 400));
  return { model: 'PBE Rating (overall, chronological Elo, method v1)', as_of: asOf, winner_rating: a.value, loser_rating: b.value, winner_pre_match_pct: Math.round(p * 100), result_vs_expectation: r2(1 - p), winner_was_rating_underdog: p < 0.5, note: 'model expectation from ratings published before the match; descriptive facts are separate' };
}

const matchDate = (m) => (m.started_at ? m.started_at.slice(0, 10) : m.tournament.start_date);

async function playerHistory(store, pid, limit = 60) {
  const ids = (await store.select('tennis_match_participants', `select=match_id&participant_key=eq.S:${pid}&limit=400`)).map((r) => r.match_id);
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 80) out.push(...(await loadMatches(store, `match_id=${inList(ids.slice(i, i + 80))}&status=in.(completed,retired,walkover)`)));
  return out.sort((a, b) => (a.tournament.start_date < b.tournament.start_date ? 1 : a.tournament.start_date > b.tournament.start_date ? -1 : b.round_order - a.round_order)).slice(0, limit);
}

const sideOfPlayer = (m, pid) => (m.sides.A?.players.some((p) => p.id === pid) ? 'A' : m.sides.B?.players.some((p) => p.id === pid) ? 'B' : null);
const resultRow = (m, pid) => {
  const s = sideOfPlayer(m, pid);
  const o = s === 'A' ? 'B' : 'A';
  const oriented = m.sets.map((x) => (x.match_tiebreak && x.tb ? `[${x.tb[s]}-${x.tb[o]}]` : `${x[s]}-${x[o]}${x.tb ? `(${Math.min(x.tb.A, x.tb.B)})` : ''}`)).join(' ') + (m.status === 'retired' ? ' ret.' : '');
  return { match_id: m.id, result: m.winner_side === s ? 'W' : 'L', opponent: m.sides[o]?.players.map((p) => ({ id: p.id, slug: p.slug, name: p.name })) || [], score: m.status === 'walkover' ? 'w/o' : oriented || null, status: m.status, tournament: m.tournament.name, tournament_slug: m.tournament.slug, year: m.tournament.year, round: m.round, round_label: m.round_label, surface: m.tournament.surface, date: matchDate(m) };
};

/**
 * Build the frozen packet for a detected event. `event` is a detector candidate; for match events the
 * match is loaded again here so the packet reflects stored data, not the detector's working copy.
 */
export async function buildPacket(store, event, { now = new Date().toISOString() } = {}) {
  const packet = { version: PACKET_VERSION, built_at: now, event: { kind: event.kind, event_id: event.event_id, materiality: event.materiality, facts: event.facts, occurred_at: event.occurred_at, detector: event.detector }, provenance: { data_brand: 'DATA · PropSports', data_url: 'https://propsports.proptechusa.ai', upstream: [] } };
  if (!event.match_id) {
    // ranking-list events carry their facts; add the player identity + photo
    const pid = event.entity_ids[0];
    const p = (await store.select('tennis_players', `select=pbe_player_id,slug,full_name,last_name,nationality,tennis_player_media(pbe_player_id,approval,derivatives,attribution,license,author,source_page_url)`+`&pbe_player_id=eq.${pid}`))[0];
    if (!p) return null;
    const media = approvedMedia(p.tennis_player_media);
    packet.player = { id: p.pbe_player_id, slug: p.slug, name: p.full_name, last_name: p.last_name || null, nationality: p.nationality, photo: media?.derivatives?.square?.url ? { player_id: media.pbe_player_id, square: media.derivatives.square.url, wide: media.derivatives.wide?.url || null, credit: media.attribution, license: media.license, author: media.author } : null };
    const hist = await store.select('tennis_rankings', `select=rank,points,tennis_ranking_snapshots!inner(list_key,ranking_date)&pbe_player_id=eq.${pid}&tennis_ranking_snapshots.list_key=eq.${event.facts.list}&tennis_ranking_snapshots.ranking_date=lte.${event.facts.list_date}&order=tennis_ranking_snapshots(ranking_date).desc&limit=52`);
    packet.ranking_history = hist.map((r) => ({ date: r.tennis_ranking_snapshots.ranking_date, rank: r.rank, points: r.points })).sort((a, b) => (a.date < b.date ? -1 : 1));
    // provenance follows the stored list's own source: an ESPN-sourced list is secondary, never "official"
    const snap = (await store.select('tennis_ranking_snapshots', `select=source_family,row_count&list_key=eq.${event.facts.list}&ranking_date=eq.${event.facts.list_date}`))[0];
    const fam = snap?.source_family || event.facts.list_source_family || null;
    packet.ranking_provenance = rankingProvenance(event.facts.list, fam, snap ? Number(snap.row_count) : null);
    packet.tour = tourOfList(event.facts.list);
    packet.provenance.upstream.push({ family: fam || 'unknown', classification: packet.ranking_provenance.classification, what: `${event.facts.list} lists dated ${event.facts.previous_list_date} and ${event.facts.list_date}` });
    const md = await matchDnaBefore(store, pid, event.facts.list_date);
    if (md) packet.match_dna = { [pid]: md };
    packet.canonical_signature = `${event.kind}:${pid}:${event.facts.list_date}`;
    return packet;
  }

  const m = await loadMatch(store, event.match_id);
  if (!m) return null;
  const date = matchDate(m);
  const singles = m.event_type === 'WS' || m.event_type === 'MS';
  // tour-aware ranking context: WS -> WTA singles, MS -> ATP singles, WD -> WTA doubles, MD/XD -> none held
  const listKey = RANKING_LISTS[m.event_type] || null;
  const pids = ['A', 'B'].flatMap((s) => m.sides[s]?.players.map((p) => p.id) || []);
  const ranks = listKey ? await rankAt(store, pids, m.tournament.start_date, listKey) : new Map();
  for (const s of ['A', 'B']) for (const p of m.sides[s].players) p.rank = ranks.get(p.id) || null;
  packet.match = { id: m.id, event_type: m.event_type, round: m.round, round_label: m.round_label, format: m.format, best_of: m.best_of, status: m.status, winner_side: m.winner_side, end_reason: m.end_reason, score: m.score, sets: m.sets, duration_s: m.duration_s, duration: m.duration, started_at: m.started_at, date };
  packet.participants = m.sides;
  packet.tournament = m.tournament;
  packet.tour = tourOf(m.event_type);
  packet.match_source = matchSource(m.source_family);
  packet.ranking_provenance = ranks.provenance || null;
  packet.rankings_note = ranks.provenance ? ranks.provenance.note : null;

  const statsRows = await store.select('tennis_match_stats', `select=side,stats,source_family,captured_at&match_id=eq.${m.id}`);
  packet.provenance.upstream.push({ family: m.source_family || 'unknown', classification: packet.match_source.classification, what: 'match result and set scores' });
  const statFams = [...new Set(statsRows.map((r) => r.source_family).filter(Boolean))];
  if (statsRows.length) packet.provenance.upstream.push({ family: statFams.join(',') || 'unknown', classification: statFams.length && statFams.every((f) => matchSource(f).classification === 'official') ? 'official' : 'secondary', what: 'match statistics' });
  const sa = statsRows.find((r) => r.side === 'A')?.stats;
  const sb = statsRows.find((r) => r.side === 'B')?.stats;
  const lines = statLines(sa, sb);
  if (lines) packet.stats = lines;

  if (singles) {
    const W = m.winner_side;
    const L = W === 'A' ? 'B' : 'A';
    const wid = m.sides[W].players[0].id;
    const lid = m.sides[L].players[0].id;
    const [hw, hl] = await Promise.all([playerHistory(store, wid), playerHistory(store, lid)]);
    const before = (x) => x.tournament.start_date < m.tournament.start_date;
    const form = (h, pid) => h.filter(before).slice(0, 5).map((x) => resultRow(x, pid));
    const fw = form(hw, wid);
    const fl = form(hl, lid);
    if (fw.length || fl.length) packet.recent_form = { [wid]: fw, [lid]: fl };
    const path = hw.filter((x) => x.tournament.edition_id === m.tournament.edition_id && x.round_order < m.round_order).sort((a, b) => a.round_order - b.round_order).map((x) => resultRow(x, wid));
    if (path.length) packet.draw_path = { player_id: wid, matches: path };
    const meetings = hw.filter((x) => before(x) && sideOfPlayer(x, lid)).map((x) => resultRow(x, wid));
    packet.h2h = { player_id: wid, opponent_id: lid, prior_meetings: meetings, wins: meetings.filter((r) => r.result === 'W').length, losses: meetings.filter((r) => r.result === 'L').length, coverage_from: '2024-12-29', note: 'meetings in our archive only (coverage starts 2024-12-29)' };
    // next scheduled match for the winner in this edition, only when the draw already shows it
    const next = (await loadMatches(store, `edition_id=eq.${m.tournament.edition_id}&status=eq.scheduled&limit=40`)).filter((x) => sideOfPlayer(x, wid) && x.round_order > m.round_order)[0];
    if (next) { const s = sideOfPlayer(next, wid); packet.next = { match_id: next.id, round_label: next.round_label, opponent: next.sides[s === 'A' ? 'B' : 'A']?.players.map((p) => ({ id: p.id, slug: p.slug, name: p.name })) || [] }; }
    // DNA: stored snapshot built before the match date, medium/high confidence individual measurements only.
    // No peer percentiles are carried (tour comparison is gated separately and the gates reject comparative
    // claims), so men's singles measurements are usable too. ATP and WTA are never compared.
    const dna = {};
    for (const pid of m.event_type === 'WS' || m.event_type === 'MS' ? [wid, lid] : []) {
      const snap = (await store.select('tennis_dna_snapshots', `select=as_of,surface,definition_version,metrics&pbe_player_id=eq.${pid}&surface=eq.all&definition_version=eq.1&as_of=lt.${date}&order=as_of.desc&limit=1`))[0];
      if (!snap) continue;
      const metrics = Object.fromEntries(Object.entries(snap.metrics || {}).filter(([, v]) => v && ['medium', 'high'].includes(v.confidence) && Number.isFinite(v.value)).map(([k, v]) => [k, { value: v.value, pct: Math.round(v.value * 1000) / 10, sample_matches: v.sample_matches, confidence: v.confidence }]));
      if (Object.keys(metrics).length) dna[pid] = { as_of: snap.as_of, definition_version: snap.definition_version, metrics };
    }
    if (Object.keys(dna).length) packet.dna = dna;
    // Match DNA v2 (results-based) for both players + the validated pre-match expectation, frozen before the match day
    const surf = m.tournament.surface || null;
    const md = {};
    for (const pid of [wid, lid]) { const x = await matchDnaBefore(store, pid, date, surf); if (x) md[pid] = x; }
    if (Object.keys(md).length) packet.match_dna = md;
    const exp = await expectationBefore(store, wid, lid, date);
    if (exp) packet.expectation = { ...exp, winner_id: wid, loser_id: lid };
  }
  packet.canonical_signature = `${event.kind}:${m.id}`;
  return packet;
}
