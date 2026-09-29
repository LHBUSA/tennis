// Deterministic content plan + chart specs — tennis-plan/1.0.0. PURE.
// THE MODEL NEVER INVENTS CHART DATA: every series value below is read from the frozen packet. A module
// whose facts are missing is omitted with a reason instead of rendered empty. One axis per chart.

import { provenanceOf } from './tour.js';
export const PLAN_VERSION = 'tennis-plan/4.0.0';
const other = (s) => (s === 'A' ? 'B' : 'A');
const short = (side) => (side?.players || []).map((p) => p.last_name || String(p.name).split(' ').slice(-1)[0]).join('/');

function serveChart(packet, W, L) {
  const s = packet.stats;
  const rows = [['first_serve_in', '1st serve in'], ['first_serve_won', '1st serve pts won'], ['second_serve_won', '2nd serve pts won'], ['service_points_won', 'Service pts won']]
    .filter(([k]) => s[W][k] && s[L][k]).map(([k, label]) => ({ label, w: s[W][k].pct, l: s[L][k].pct, w_n: `${s[W][k].n}/${s[W][k].d}`, l_n: `${s[L][k].n}/${s[L][k].d}` }));
  return rows.length ? { id: 'serve_comparison', type: 'grouped_bar', title: 'On serve', unit: '%', max: 100, legend: [short(packet.participants[W]), short(packet.participants[L])], value_keys: ['w', 'l'], label_key: 'label', series: rows, source: 'official match statistics' } : null;
}
function returnChart(packet, W, L) {
  const s = packet.stats;
  const rows = [['first_return_won', 'vs 1st serve'], ['second_return_won', 'vs 2nd serve'], ['return_points_won', 'Return pts won'], ['break_points_converted', 'Break pts converted']]
    .filter(([k]) => s[W][k]?.d && s[L][k]?.d).map(([k, label]) => ({ label, w: s[W][k].pct, l: s[L][k].pct, w_n: `${s[W][k].n}/${s[W][k].d}`, l_n: `${s[L][k].n}/${s[L][k].d}` }));
  return rows.length ? { id: 'return_comparison', type: 'grouped_bar', title: 'On return', unit: '%', max: 100, legend: [short(packet.participants[W]), short(packet.participants[L])], value_keys: ['w', 'l'], label_key: 'label', series: rows, source: 'official match statistics (derived from the opponent\'s serve totals)' } : null;
}
function countChart(packet, W, L) {
  const s = packet.stats;
  const rows = [['aces', 'Aces'], ['double_faults', 'Double faults']].filter(([k]) => Number.isFinite(s[W][k]) && Number.isFinite(s[L][k])).map(([k, label]) => ({ label, w: s[W][k], l: s[L][k] }));
  return rows.length ? { id: 'serve_counts', type: 'grouped_bar', title: 'Aces and double faults', unit: 'count', legend: [short(packet.participants[W]), short(packet.participants[L])], value_keys: ['w', 'l'], label_key: 'label', series: rows, source: 'official match statistics' } : null;
}
function flowChart(packet, W, L) {
  const sets = packet.match.sets || [];
  if (sets.length < 2) return null;
  return { id: 'match_flow', type: 'grouped_bar', title: 'Games by set', unit: 'games', legend: [short(packet.participants[W]), short(packet.participants[L])], value_keys: ['w', 'l'], label_key: 'label', series: sets.map((s, i) => ({ label: s.match_tiebreak ? 'Match TB' : `Set ${i + 1}`, w: s[W], l: s[L], tb: s.tb ? `${s.tb[W]}-${s.tb[L]}` : null })), source: packet.match_source?.classification === 'secondary' ? `set scores (secondary source: ${packet.match_source.name})` : 'official set scores' };
}
function dnaChart(packet, W, L) {
  const wid = packet.participants[W].players[0]?.id;
  const lid = packet.participants[L].players[0]?.id;
  const a = packet.dna?.[wid];
  const b = packet.dna?.[lid];
  if (!a || !b) return null;
  const LABEL = { service_points_won: 'Service pts won', return_points_won: 'Return pts won', hold_rate: 'Holds', break_rate: 'Breaks', first_serve_won: '1st serve won', second_serve_won: '2nd serve won', bp_saved: 'BP saved', bp_converted: 'BP converted' };
  const rows = Object.keys(LABEL).filter((k) => a.metrics[k] && b.metrics[k]).map((k) => ({ label: LABEL[k], w: a.metrics[k].pct, l: b.metrics[k].pct }));
  return rows.length >= 2 ? { id: 'dna_comparison', type: 'grouped_bar', title: 'Tennis DNA before the match', unit: '%', max: 100, legend: [short(packet.participants[W]), short(packet.participants[L])], value_keys: ['w', 'l'], label_key: 'label', series: rows, source: `stored Tennis DNA snapshots dated ${a.as_of} / ${b.as_of}`, note: 'medium/high-confidence metrics only' } : null;
}
function matchDnaChart(packet, W, L) {
  const wid = packet.participants[W].players[0]?.id;
  const lid = packet.participants[L].players[0]?.id;
  const a = packet.match_dna?.[wid]?.metrics;
  const b = packet.match_dna?.[lid]?.metrics;
  if (!a || !b) return null;
  const KEYS = [['match_win_rate', 'Match win'], ['set_win_rate', 'Set win'], ['deciding_set_win_rate', 'Deciding sets'], ['tiebreak_win_rate', 'Tiebreaks'], ['top10_win_rate', 'vs top 10'], ['top50_win_rate', 'vs top 50']];
  const rows = KEYS.filter(([k]) => a[k]?.pct != null && b[k]?.pct != null).map(([k, label]) => ({ label, w: a[k].pct, l: b[k].pct }));
  const aa = packet.match_dna[wid].as_of;
  const bb = packet.match_dna[lid].as_of;
  return rows.length >= 3 ? { id: 'match_dna_comparison', type: 'grouped_bar', title: 'Match DNA going in', unit: '%', max: 100, legend: [short(packet.participants[W]), short(packet.participants[L])], value_keys: ['w', 'l'], label_key: 'label', series: rows, source: `stored Match DNA v2 snapshots dated ${aa}${bb !== aa ? ` / ${bb}` : ''} (results in our archive, before the match)`, note: 'medium/high-confidence metrics only' } : null;
}

const pctCell = (x) => (x == null ? null : `${x}%`);
const recordCell = (r) => (r && r.W + r.L ? `${r.W}-${r.L}` : null);
/**
 * At-a-glance strip: 3-5 cells, never an empty cell, strictly from the frozen packet. Model expectations are labelled
 * as the PBE Rating model; descriptive facts are separate cells.
 */
export function glanceCells(packet) {
  const cells = [];
  const add = (label, value, note = null, kind = 'fact') => { if (value != null && value !== '') cells.push({ label, value: String(value), note, kind }); };
  if (packet.match) {
    const m = packet.match;
    const W = m.winner_side;
    const L = other(W);
    const setTxt = (m.sets || []).map((x) => (x.match_tiebreak && x.tb ? `[${x.tb[W]}-${x.tb[L]}]` : `${x[W]}-${x[L]}`)).join(' ');
    add(m.status === 'walkover' ? 'Result' : 'Final', m.status === 'walkover' ? 'Walkover' : `${setTxt}${m.status === 'retired' ? ' ret.' : ''}`, short(packet.participants[W]));
    add('Round', m.round_label ? m.round_label.charAt(0).toUpperCase() + m.round_label.slice(1) : null, packet.tournament?.name || null);
    const wid = packet.participants[W]?.players[0]?.id;
    const e = packet.expectation;
    if (e && e.winner_id === wid) {
      add('Pre-match rating model', `${e.winner_pre_match_pct}%`, `${short(packet.participants[W])} win chance · PBE Rating (${e.as_of})`, 'model');
      add('Result vs expectation', `${e.result_vs_expectation > 0 ? '+' : ''}${e.result_vs_expectation}`, 'wins above the rating expectation', 'model');
    } else {
      const r = packet.match_dna?.[wid]?.rating;
      if (r?.published) add('PBE Rating before match', r.value, `${short(packet.participants[W])} · snapshot ${packet.match_dna[wid].as_of}`, 'model');
    }
    add('Surface', packet.tournament?.surface ? packet.tournament.surface.charAt(0).toUpperCase() + packet.tournament.surface.slice(1) : null);
    if (cells.length < 5 && m.duration) add('Duration', m.duration.hours ? `${m.duration.hours}h ${String(m.duration.minutes).padStart(2, '0')}m` : `${m.duration.minutes}m`);
    const wr = packet.participants[W]?.players.length === 1 ? packet.participants[W].players[0].rank?.rank : null;
    if (cells.length < 5 && Number.isFinite(wr)) add('Ranking', `No. ${wr}`, 'list in force at the start of the tournament');
  } else if (packet.player) {
    const f = packet.event.facts || {};
    add('New ranking', Number.isFinite(f.rank) ? `No. ${f.rank}` : null, f.list_date || null);
    add('Previous', Number.isFinite(f.previous_rank) ? `No. ${f.previous_rank}` : 'Outside the list', f.previous_list_date || null);
    const md = packet.match_dna?.[packet.player.id];
    if (md?.rating?.published) add('PBE Rating', md.rating.value, `snapshot ${md.as_of}`, 'model');
    add('Last 52 weeks', recordCell(md?.windows?.['52w']), 'singles, our archive');
    if ((packet.ranking_history || []).length >= 3) add('Weeks in archive', packet.ranking_history.length);
  }
  return cells.slice(0, 5);
}

/**
 * PBE Intelligence module: one deterministic takeaway + the evidence behind it + a truthful counterpoint when the
 * packet holds one. null when the packet has no Match DNA (nothing distinctive to add).
 */
export function intelligence(packet) {
  if (packet.match) {
    const m = packet.match;
    const W = m.winner_side;
    const L = other(W);
    const wS = short(packet.participants[W]);
    const lS = short(packet.participants[L]);
    const wid = packet.participants[W]?.players[0]?.id;
    const lid = packet.participants[L]?.players[0]?.id;
    const mW = packet.match_dna?.[wid];
    const mL = packet.match_dna?.[lid];
    if (!mW) return null;
    const e = packet.expectation;
    let takeaway;
    if (e) takeaway = e.winner_was_rating_underdog ? `${wS} won as the lower-rated player: the PBE Rating gave ${wS} a ${e.winner_pre_match_pct}% chance before the match.` : `${wS} won as the rating favourite (${e.winner_pre_match_pct}% before the match), in line with the model.`;
    else if (mL && mW.metrics?.match_win_rate && mL.metrics?.match_win_rate) takeaway = `${wS} came in with the stronger results record in our archive (${mW.metrics.match_win_rate.pct}% of matches won, against ${mL.metrics.match_win_rate.pct}% for ${lS}).`;
    else if (mW.metrics?.match_win_rate) takeaway = `${wS} came in having won ${mW.metrics.match_win_rate.pct}% of singles matches in our archive.`;
    else return null;
    const evidence = [];
    if (mW.rating?.published) evidence.push({ label: `${wS} PBE Rating`, value: String(mW.rating.value), note: mW.rating.percentile != null ? `${mW.rating.percentile}th percentile, ${mW.tour || ''} (snapshot ${mW.as_of})`.replace(' ,', ',') : `snapshot ${mW.as_of}` });
    const t10 = mW.metrics?.top10_win_rate;
    if (t10?.record) evidence.push({ label: `${wS} vs top 10`, value: `${t10.record.W}-${t10.record.L}`, note: `${t10.pct}%` });
    if (mW.surface?.record && (mW.surface.record.W + mW.surface.record.L)) evidence.push({ label: `${wS} on ${mW.surface.surface}`, value: `${mW.surface.record.W}-${mW.surface.record.L}`, note: 'sourced-surface matches' });
    const y = mW.windows?.['52w'];
    if (y && y.W + y.L) evidence.push({ label: `${wS} last 52 weeks`, value: `${y.W}-${y.L}`, note: y.wae != null ? `${y.wae > 0 ? '+' : ''}${y.wae} vs expectation per rated match` : null });
    let counterpoint = null;
    const h = packet.h2h;
    if (h && h.losses > h.wins) counterpoint = `${lS} still leads their meetings in our archive, ${h.losses}-${h.wins}.`;
    else if (mL?.metrics?.match_win_rate && mW.metrics?.match_win_rate && mL.metrics.match_win_rate.value > mW.metrics.match_win_rate.value) counterpoint = `On the whole record, ${lS} had the higher match-win rate going in (${mL.metrics.match_win_rate.pct}% to ${mW.metrics.match_win_rate.pct}%).`;
    else if (y && y.wae != null && y.wae < 0) counterpoint = `${wS} had been below the rating expectation over the previous 52 weeks (${y.wae} per rated match).`;
    return { takeaway, evidence: evidence.slice(0, 4), counterpoint, basis: 'frozen Match DNA v2 snapshots and the PBE Rating model (validated before publication); descriptive records are from our archive' };
  }
  if (packet.player) {
    const md = packet.match_dna?.[packet.player.id];
    if (!md?.metrics?.match_win_rate) return null;
    const name = packet.player.last_name ? packet.player.last_name.charAt(0) + packet.player.last_name.slice(1).toLowerCase() : packet.player.name;
    const y = md.windows?.['52w'];
    const evidence = [];
    if (md.rating?.published) evidence.push({ label: 'PBE Rating', value: String(md.rating.value), note: `snapshot ${md.as_of}` });
    if (y && y.W + y.L) evidence.push({ label: 'Last 52 weeks', value: `${y.W}-${y.L}`, note: null });
    const t10 = md.metrics?.top10_win_rate;
    if (t10?.record) evidence.push({ label: 'vs top 10', value: `${t10.record.W}-${t10.record.L}`, note: `${t10.pct}%` });
    return { takeaway: `The ranking move follows ${y && y.W + y.L ? `a ${y.W}-${y.L} year` : `a ${md.metrics.match_win_rate.pct}% match-win record`} in our archive.`, evidence, counterpoint: y && y.wae != null && y.wae < 0 ? `${name} had been below the rating expectation over those 52 weeks (${y.wae} per rated match).` : null, basis: 'frozen Match DNA v2 snapshot dated before the list' };
  }
  return null;
}

// ---- V4 deterministic data modules (tennis-plan/4.0.0) -------------------------------------------------------------
// Every value is copied from the frozen packet (numerator/denominator kept); a module appears only when its data is
// present AND meaningful, otherwise it is listed in `omitted` with the reason. The model never supplies a value.
const ratioCell = (x) => (x?.d ? { pct: x.pct, n: x.n, d: x.d } : null);
const countCell = (x) => (Number.isFinite(x) ? { value: x } : null);
function pairRows(packet, W, L, spec) {
  const s = packet.stats;
  return spec.map(([k, label, kind]) => {
    const w = kind === 'count' ? countCell(s[W][k]) : ratioCell(s[W][k]);
    const l = kind === 'count' ? countCell(s[L][k]) : ratioCell(s[L][k]);
    return w && l ? { key: k, label, kind, w, l } : null;
  }).filter(Boolean);
}
const SERVE_SPEC = [['first_serve_in', '1st serve in', 'ratio'], ['first_serve_won', '1st-serve points won', 'ratio'], ['second_serve_won', '2nd-serve points won', 'ratio'], ['service_points_won', 'Service points won', 'ratio'], ['service_games_held', 'Service games held', 'ratio'], ['break_points_saved', 'Break points saved', 'ratio'], ['aces', 'Aces', 'count'], ['double_faults', 'Double faults', 'count']];
const RETURN_SPEC = [['first_return_won', 'Won vs 1st serve', 'ratio'], ['second_return_won', 'Won vs 2nd serve', 'ratio'], ['return_points_won', 'Return points won', 'ratio'], ['break_chances', 'Break points earned', 'count'], ['break_points_converted', 'Break points converted', 'ratio'], ['return_games_won', 'Return games won', 'ratio']];

function keyNumbers(packet, W, L) {
  if (packet.match.status === 'walkover') return null;
  const s = packet.stats;
  const tiles = [];
  const t = (label, w, l, note = null) => { if (w != null && l != null) tiles.push({ label, w, l, note }); };
  if (s) {
    t('Total points won', s[W].total_points_won, s[L].total_points_won);
    t('Breaks of serve', s[W].return_games_won?.n ?? s[W].break_points_converted?.n ?? null, s[L].return_games_won?.n ?? s[L].break_points_converted?.n ?? null);
    if (s[W].break_points_converted?.d != null && s[L].break_points_converted?.d != null) t('Break points', `${s[W].break_points_converted.n}/${s[W].break_points_converted.d}`, `${s[L].break_points_converted.n}/${s[L].break_points_converted.d}`, 'converted / earned');
    t('Winners', s[W].winners, s[L].winners);
    t('Unforced errors', s[W].unforced_errors, s[L].unforced_errors);
  }
  const run = packet.match_development?.complete ? packet.match_development.longest_run : null;
  const out = { tiles, run: run ? { side: run.side === W ? 'W' : 'L', games: run.games, from_set: run.from_set, to_set: run.to_set } : null };
  return tiles.length >= 3 ? out : null;
}

function setBySet(packet, W, L) {
  const m = packet.match;
  if (m.status === 'walkover' || !(m.sets || []).length) return null;
  const perSet = packet.stats_by_set || null;
  const dev = packet.match_development;
  const devBreaks = dev && (dev.complete || dev.source === 'point_by_point') ? dev.breaks_by_set : null;
  const rows = m.sets.map((x, i) => {
    const set = i + 1;
    const ps = perSet?.find((r) => r.set === set) || null;
    const db = devBreaks ? devBreaks.find((r) => r.set === set) || { A: 0, B: 0 } : null;
    const breaks = ps && ps.breaks.A != null && ps.breaks.B != null ? { w: ps.breaks[W], l: ps.breaks[L], source: 'match statistics' } : db ? { w: db[W], l: db[L], source: dev.source === 'point_by_point' ? 'point-by-point' : 'observed live score' } : null;
    return { set, match_tiebreak: !!x.match_tiebreak, games: x.match_tiebreak ? null : { w: x[W], l: x[L] }, tiebreak: x.tb ? { w: x.tb[W], l: x.tb[L] } : null, winner: x.match_tiebreak && x.tb ? (x.tb[W] > x.tb[L] ? 'W' : 'L') : x[W] > x[L] ? 'W' : x[L] > x[W] ? 'L' : null, points_won: ps && ps.points_won.A != null && ps.points_won.B != null ? { w: ps.points_won[W], l: ps.points_won[L] } : null, breaks };
  });
  return { rows, status: m.status };
}

function developmentModule(packet, W) {
  const d = packet.match_development;
  if (!d || (!d.breaks.length && !d.longest_run)) return null;
  const rel = (side) => (side === W ? 'W' : 'L');
  return { source: d.source, complete: d.complete, games_observed: d.games_observed, breaks: d.breaks.map((b) => ({ set: b.set, game: b.game, by: rel(b.by) })), first_break: d.first_break ? { set: d.first_break.set, game: d.first_break.game, by: rel(d.first_break.by) } : null, longest_run: d.complete && d.longest_run ? { by: rel(d.longest_run.side), games: d.longest_run.games, from_set: d.longest_run.from_set, to_set: d.longest_run.to_set } : null };
}

function playerContext(packet, W, L) {
  const out = {};
  for (const [side, rel] of [[W, 'W'], [L, 'L']]) {
    const players = packet.participants[side]?.players || [];
    if (players.length !== 1) continue;
    const p = players[0];
    const md = packet.match_dna?.[p.id];
    const form = (packet.recent_form?.[p.id] || []).map((r) => ({ result: r.result, opponent: (r.opponent || []).map((o) => o.name).join(' / ') || null, tournament: r.tournament, year: r.year, round_label: r.round_label, score: r.score }));
    const c = {
      name: p.name, slug: p.slug,
      rank: Number.isFinite(p.rank?.rank) ? { rank: p.rank.rank, list_date: p.rank.list_date } : null,
      surface: md?.surface?.record && md.surface.record.W + md.surface.record.L ? { surface: md.surface.surface, W: md.surface.record.W, L: md.surface.record.L } : null,
      year: md?.windows?.['52w'] && md.windows['52w'].W + md.windows['52w'].L ? { W: md.windows['52w'].W, L: md.windows['52w'].L } : null,
      form: form.length ? form : null
    };
    if ([c.rank, c.surface, c.year, c.form].filter(Boolean).length) out[rel] = c;
  }
  const h = packet.h2h?.prior_meetings?.length ? { wins: packet.h2h.wins, losses: packet.h2h.losses, meetings: packet.h2h.prior_meetings.length, coverage_from: packet.h2h.coverage_from } : null;
  const facts = Object.values(out).reduce((t, c) => t + [c.rank, c.surface, c.year, c.form].filter(Boolean).length, 0) + (h ? 1 : 0);
  return facts >= 2 ? { players: out, h2h: h, rank_phrase: packet.ranking_provenance?.phrase || null } : null;
}

/**
 * All V4 data modules for a frozen packet (PURE; exported for the offline canary / QA). Returns
 * { modules: [{ id, title, data }], omitted: [{ id, reason }] }.
 */
export function buildModules(packet) {
  const modules = [];
  const omitted = [];
  const add = (id, title, data, reason) => (data ? modules.push({ id, title, data }) : omitted.push({ id, reason }));
  if (!packet?.match) return { modules, omitted: [{ id: 'match_modules', reason: 'not a match story' }] };
  const W = packet.match.winner_side;
  const L = other(W);
  const noStats = packet.match.status === 'walkover' ? 'walkover: no points played' : 'no match statistics stored for this match';
  add('key_numbers', 'Match control', keyNumbers(packet, W, L), packet.stats && packet.match.status !== 'walkover' ? 'fewer than three comparable key numbers' : noStats);
  add('set_by_set', 'Set by set', setBySet(packet, W, L), 'no sets played');
  const sp = packet.stats && packet.match.status !== 'walkover' ? pairRows(packet, W, L, SERVE_SPEC) : [];
  add('serve_profile', 'Serve profile', sp.length >= 3 ? { rows: sp } : null, packet.stats && packet.match.status !== 'walkover' ? 'fewer than three serve measures for both players' : noStats);
  const rp = packet.stats && packet.match.status !== 'walkover' ? pairRows(packet, W, L, RETURN_SPEC) : [];
  add('return_pressure', 'Return pressure', rp.length >= 3 ? { rows: rp } : null, packet.stats && packet.match.status !== 'walkover' ? 'fewer than three return measures for both players' : noStats);
  add('match_development', 'How the match developed', developmentModule(packet, W), 'no observed game-by-game sequence (point events or live score) for this match');
  add('player_context', 'Player context', playerContext(packet, W, L), 'fewer than two context facts (ranking, surface, form, H2H) in the packet');
  return { modules, omitted };
}

function rankingChart(packet) {
  const h = packet.ranking_history || [];
  if (h.length < 3) return null;
  const official = provenanceOf(packet)?.classification === 'official';
  return { id: 'ranking_trajectory', type: 'line', title: official ? 'Official ranking by week' : 'Ranking by week (PropBetEdge archive)', unit: 'rank', invert: true, label_key: 'date', value_keys: ['rank'], series: h.map((r) => ({ date: r.date, rank: r.rank })), source: official ? 'archived official lists' : `archived weekly lists from a secondary source (${String(packet.ranking_provenance?.source_family || 'unknown').toUpperCase()})` };
}

export function buildPlan(packet, article) {
  const modules = [];
  const omitted = [];
  const add = (id, title, data, reason) => (data ? modules.push({ id, title, data }) : omitted.push({ id, reason }));
  const charts = [];
  if (packet.match) {
    const W = packet.match.winner_side;
    const L = other(W);
    add('scoreboard', 'Match', { match_id: packet.match.id, sets: packet.match.sets, winner_side: W, status: packet.match.status, duration: packet.match.duration, round_label: packet.match.round_label, tournament: packet.tournament, sides: packet.participants }, 'no match');
    if (packet.stats && packet.match.status !== 'walkover') {
      for (const c of [serveChart(packet, W, L), returnChart(packet, W, L), countChart(packet, W, L)]) if (c) charts.push(c);
    } else omitted.push({ id: 'stats_charts', reason: packet.match.status === 'walkover' ? 'walkover: no points played' : 'no official statistics stored for this match' });
    const flow = flowChart(packet, W, L);
    if (flow) charts.push(flow);
    const mdna = matchDnaChart(packet, W, L);
    if (mdna) charts.push(mdna); else omitted.push({ id: 'match_dna_comparison', reason: 'no pre-match Match DNA for both players with three shared metrics' });
    const dna = dnaChart(packet, W, L);
    if (dna) charts.push(dna); else omitted.push({ id: 'dna_comparison', reason: 'no pre-match Technical DNA snapshot with at least two medium/high-confidence shared metrics' });
    add('h2h', 'Head-to-head', packet.h2h?.prior_meetings.length ? packet.h2h : null, 'no earlier meeting in our archive');
    add('path', 'Path through the draw', packet.draw_path || null, 'no earlier rounds stored for this tournament');
    add('form', 'Recent form', packet.recent_form && Object.values(packet.recent_form).some((x) => x.length) ? packet.recent_form : null, 'no earlier results stored');
    add('next', "What's next", packet.next || null, 'the next match is not in the draw yet');
    const v4 = buildModules(packet);
    modules.push(...v4.modules);
    omitted.push(...v4.omitted);
  } else {
    add('player', 'Player', packet.player, 'no player');
    const r = rankingChart(packet);
    if (r) charts.push(r); else omitted.push({ id: 'ranking_trajectory', reason: 'fewer than 3 archived lists' });
  }
  if (charts.length) modules.push({ id: 'charts', title: 'The data', data: { charts } });
  modules.push({ id: 'method', title: 'Source & method', data: { provenance: packet.provenance, packet_version: packet.version, built_at: packet.built_at } });
  const glance = glanceCells(packet);
  const intel = intelligence(packet);
  return { version: PLAN_VERSION, modules, omitted, chart_count: charts.length, module_ids: modules.map((m) => m.id), story_type: article?.story_type || packet.event.kind, story_class: article?.story_class || null, glance: glance.length >= 3 ? glance : null, intelligence: intel };
}
