// Deterministic content plan + chart specs — tennis-plan/1.0.0. PURE.
// THE MODEL NEVER INVENTS CHART DATA: every series value below is read from the frozen packet. A module
// whose facts are missing is omitted with a reason instead of rendered empty. One axis per chart.

import { provenanceOf } from './tour.js';
export const PLAN_VERSION = 'tennis-plan/1.0.0';
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
    const dna = dnaChart(packet, W, L);
    if (dna) charts.push(dna); else omitted.push({ id: 'dna_comparison', reason: 'no pre-match DNA snapshot with at least two medium/high-confidence shared metrics' });
    add('h2h', 'Head-to-head', packet.h2h?.prior_meetings.length ? packet.h2h : null, 'no earlier meeting in our archive');
    add('path', 'Path through the draw', packet.draw_path || null, 'no earlier rounds stored for this tournament');
    add('form', 'Recent form', packet.recent_form && Object.values(packet.recent_form).some((x) => x.length) ? packet.recent_form : null, 'no earlier results stored');
    add('next', "What's next", packet.next || null, 'the next match is not in the draw yet');
  } else {
    add('player', 'Player', packet.player, 'no player');
    const r = rankingChart(packet);
    if (r) charts.push(r); else omitted.push({ id: 'ranking_trajectory', reason: 'fewer than 3 archived lists' });
  }
  if (charts.length) modules.push({ id: 'charts', title: 'The data', data: { charts } });
  modules.push({ id: 'method', title: 'Evidence & method', data: { provenance: packet.provenance, packet_version: packet.version, built_at: packet.built_at } });
  return { version: PLAN_VERSION, modules, omitted, chart_count: charts.length, module_ids: modules.map((m) => m.id), story_type: article?.story_type || packet.event.kind };
}
