// Matchup Intelligence V2 — deterministic DISPLAY layer over stored DNA (PURE; tests/matchup-intel.test.js).
//
// Nothing here is a model or changes the PBE Rating probability. It compares what the two players' stored snapshots
// already measure, keeps every value's sample and confidence, and summarises the comparisons with a published,
// versioned rule (EDGE_MAP_VERSION). A comparison exists only when BOTH players have a medium/high-confidence value;
// low/insufficient values are never shown as if comparable. Technical (serve/return) rows come only from the v1
// technical snapshots built from match statistics — never from set scores.

export const EDGE_MAP_VERSION = 'edge-map/1';
const OK = new Set(['medium', 'high']);
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

/**
 * Match DNA v2 metric definitions. better: 'high' | 'low' | null (neutral — e.g. deciding-set dependence describes a
 * style, not quality, so it never awards an edge). even: the |difference| below which a comparison is "even".
 */
export const DNA_METRICS = Object.freeze([
  ['match_win_rate', 'Match win', 'overall', 'high', 0.01, 'rate'],
  ['set_win_rate', 'Set win', 'overall', 'high', 0.01, 'rate'],
  ['game_win_rate', 'Games won', 'overall', 'high', 0.005, 'rate'],
  ['straight_sets_win_rate', 'Straight-set wins', 'overall', 'high', 0.01, 'rate'],
  ['avg_game_diff', 'Avg game differential', 'overall', 'high', 0.1, 'diff'],
  ['avg_set_diff', 'Avg set differential', 'overall', 'high', 0.03, 'diff'],
  ['deciding_set_win_rate', 'Deciding sets', 'pressure', 'high', 0.01, 'rate'],
  ['tiebreak_win_rate', 'Tiebreaks', 'pressure', 'high', 0.01, 'rate'],
  ['close_match_win_rate', 'Close matches', 'pressure', 'high', 0.01, 'rate'],
  ['comeback_win_rate', 'Comeback wins', 'pressure', 'high', 0.01, 'rate'],
  ['first_set_conversion', 'First-set conversion', 'pressure', 'high', 0.01, 'rate'],
  ['deciding_set_dependence', 'Deciding-set dependence', 'pressure', null, 0, 'rate'],
  ['top10_win_rate', 'vs top 10', 'opposition', 'high', 0.01, 'rate'],
  ['top25_win_rate', 'vs top 25', 'opposition', 'high', 0.01, 'rate'],
  ['top50_win_rate', 'vs top 50', 'opposition', 'high', 0.01, 'rate'],
  ['top100_win_rate', 'vs top 100', 'opposition', 'high', 0.01, 'rate'],
  ['outside100_loss_rate', 'Losses outside top 100', 'opposition', 'low', 0.01, 'rate'],
  ['avg_opponent_rank', 'Avg opponent rank', 'opposition', 'low', 2, 'rank'],
  ['wins_above_expectation', 'Wins above expectation', 'opposition', 'high', 0.005, 'wae']
].map(([key, label, category, better, even, kind]) => Object.freeze({ key, label, category, better, even, kind })));

/** Technical DNA v1 (match statistics). serve/return side + direction. */
export const TECH_METRICS = Object.freeze([
  ['ace_rate', 'Ace rate', 'serve', 'high', 0.005], ['double_fault_rate', 'Double-fault rate', 'serve', 'low', 0.003],
  ['first_serve_in', '1st serve in', 'serve', 'high', 0.01], ['first_serve_won', '1st serve won', 'serve', 'high', 0.01],
  ['second_serve_won', '2nd serve won', 'serve', 'high', 0.01], ['service_points_won', 'Service points won', 'serve', 'high', 0.01],
  ['hold_rate', 'Hold rate', 'serve', 'high', 0.01], ['break_points_saved', 'Break points saved', 'serve', 'high', 0.01],
  ['return_points_won', 'Return points won', 'return', 'high', 0.01], ['first_return_won', '1st-serve return won', 'return', 'high', 0.01],
  ['second_return_won', '2nd-serve return won', 'return', 'high', 0.01], ['return_games_won', 'Return games won (break rate)', 'return', 'high', 0.01],
  ['break_points_converted', 'Break points converted', 'return', 'high', 0.01]
].map(([key, label, category, better, even]) => Object.freeze({ key, label, category, better, even, kind: 'rate' })));

const val = (m) => (m && m.value != null && OK.has(m.confidence) ? { value: m.value, record: m.record || null, sample: m.sample_matches ?? null, confidence: m.confidence } : null);
function advantage(def, a, b) {
  if (!a || !b || !def.better) return null;
  const d = a.value - b.value;
  if (Math.abs(d) < def.even) return 'even';
  return (def.better === 'high' ? d > 0 : d < 0) ? 'A' : 'B';
}

/** Comparison rows for one family of definitions: only metrics BOTH players hold at medium/high confidence. */
export function compareMetrics(defs, ma = {}, mb = {}) {
  const rows = [];
  let withheld = 0;
  for (const def of defs) {
    const A = val(ma?.[def.key]);
    const B = val(mb?.[def.key]);
    if (!A || !B) { if (ma?.[def.key] || mb?.[def.key]) withheld += 1; continue; }
    rows.push({ key: def.key, label: def.label, category: def.category, kind: def.kind, better: def.better, A, B, advantage: advantage(def, A, B), diff: r4(A.value - B.value) });
  }
  return { rows, withheld };
}

/**
 * The edge rule (edge-map/1): within a category, "decided" comparisons are rows whose advantage is A or B (even and
 * neutral rows are not decided). With fewer than 2 qualified rows -> insufficient. A player has the category edge
 * only with >= 2 decided comparisons AND >= 2/3 of them in their favour; anything else is no_edge. Never forced.
 */
export function categoryEdge(rows) {
  const q = rows.filter((r) => r.better);
  if (q.length < 2) return { edge: 'insufficient', A: 0, B: 0, even: 0, qualified: q.length };
  const A = q.filter((r) => r.advantage === 'A').length;
  const B = q.filter((r) => r.advantage === 'B').length;
  const decided = A + B;
  const edge = decided >= 2 && A / decided >= 2 / 3 ? 'A' : decided >= 2 && B / decided >= 2 / 3 ? 'B' : 'no_edge';
  return { edge, A, B, even: q.length - decided, qualified: q.length };
}

const CATS = [['overall', 'Overall'], ['serve', 'Serve'], ['return', 'Return'], ['pressure', 'Pressure'], ['surface', 'Surface'], ['form', 'Form'], ['opposition', 'Opposition']];

/**
 * Edge map: one verdict per category from the displayed rows only. form: opponent-adjusted wins above expectation in
 * the 10-week and 52-week windows (both windows qualified). surface: the stored surface rating gap, only when the
 * edition's surface is sourced (>= 25 rating points to call an edge). Returns { version, rule, categories, tally }.
 */
export function edgeMap({ dna = [], tech = [], form = null, surface = null }) {
  const by = (c) => [...dna, ...tech].filter((r) => r.category === c);
  const out = [];
  for (const [key, label] of CATS) {
    let e;
    if (key === 'form') {
      const w = ['10w', '52w'].map((k) => form?.[k]).filter((x) => x?.A && x?.B && x.wae_edge != null);
      if (w.length < 2) e = { edge: 'insufficient', qualified: w.length };
      else { const s = w.map((x) => (Math.abs(x.wae_edge) < 0.01 ? 'even' : x.wae_edge > 0 ? 'A' : 'B')); e = { edge: s[0] === s[1] && s[0] !== 'even' ? s[0] : 'no_edge', windows: s, qualified: 2 }; }
    } else if (key === 'surface') {
      if (!surface?.surface || surface.edge == null) e = { edge: 'insufficient', qualified: 0, note: surface?.surface ? 'surface ratings missing for a player' : 'the edition surface is not sourced' };
      else e = { edge: Math.abs(surface.edge) < 25 ? 'no_edge' : surface.edge > 0 ? 'A' : 'B', points: surface.edge, qualified: 1 };
    } else e = categoryEdge(by(key));
    out.push({ key, label, ...e });
  }
  const tally = { A: out.filter((x) => x.edge === 'A').length, B: out.filter((x) => x.edge === 'B').length, no_edge: out.filter((x) => x.edge === 'no_edge').length, insufficient: out.filter((x) => x.edge === 'insufficient').length };
  return { version: EDGE_MAP_VERSION, rule: 'a category leans to a player only when that player wins >= 2/3 of >= 2 decided comparisons among the displayed medium/high-confidence metrics (even and neutral metrics decide nothing); form = opponent-adjusted wins above expectation in both the 10- and 52-week windows; surface = stored surface rating gap >= 25 points, only with a sourced surface. A DNA category comparison, not a prediction.', categories: out, tally };
}

/**
 * Serve/return COLLISION: each player's serving metric against the opponent's matching RETURN metric. server_edge =
 * server value + returner value - 1 (positive = the server's measured profile carries more weight than the returner's
 * resistance; context only, no causal claim). Rows need both values at medium/high confidence.
 */
const PAIRS = [['first_serve_won', 'first_return_won', '1st serve'], ['second_serve_won', 'second_return_won', '2nd serve'], ['service_points_won', 'return_points_won', 'Service points'], ['hold_rate', 'return_games_won', 'Hold vs break'], ['break_points_saved', 'break_points_converted', 'Break points']];
export function collision(ta = {}, tb = {}) {
  const side = (srv, ret) => PAIRS.map(([s, r, label]) => { const S = val(srv?.[s]); const R = val(ret?.[r]); return S && R ? { label, serve_key: s, return_key: r, server: S, returner: R, server_edge: r4(S.value + R.value - 1) } : null; }).filter(Boolean);
  const A = side(ta, tb);
  const B = side(tb, ta);
  if (!A.length && !B.length) return { available: false, reason: 'the serve/return collision needs medium/high-confidence technical DNA (built from match statistics) for both players; result-only matches never produce one' };
  const read = (rows) => {
    if (rows.length < 2) return null;
    const s = [...rows].sort((x, y) => y.server_edge - x.server_edge);
    return { strongest_server: s[0].label, strongest_returner: s.at(-1).server_edge < 0 ? s.at(-1).label : null };
  };
  return { available: true, A_serving: A, B_serving: B, read: { A_serving: read(A), B_serving: read(B) }, note: 'server_edge = server value + opponent return value - 1: positive favours the server’s measured profile. Historical measurement, context only — not a model input.' };
}

/** "Why PBE leans this way": MODEL inputs (rating, surface rating when used), then context that agrees / disagrees. */
export function whyStack(model, map, labels = { A: 'A', B: 'B' }) {
  if (model?.status !== 'published') return null;
  const fav = model.probability.A >= model.probability.B ? 'A' : 'B';
  const dog = fav === 'A' ? 'B' : 'A';
  const sign = (x) => (fav === 'A' ? x : -x);
  const inputs = [{ label: 'PBE Rating edge', value: sign(model.rating_edge.points), unit: 'points' }];
  if (model.basis === 'surface_blend' && model.surface_ratings?.A && model.surface_ratings?.B) inputs.push({ label: `${model.surface_ratings.surface} rating edge`, value: sign(model.surface_ratings.A.value - model.surface_ratings.B.value), unit: 'points' });
  const cats = map?.categories || [];
  return {
    favourite: fav, favourite_name: labels[fav],
    model_inputs: inputs,
    supporting: cats.filter((c) => c.edge === fav).map((c) => c.label),
    counterpoint: cats.filter((c) => c.edge === dog).map((c) => c.label),
    note: 'Only the MODEL rows produce the probability. Supporting context and counterpoints are DNA category comparisons shown for understanding; they never change it.'
  };
}

/** Head-to-head by surface (descriptive; only when >= 3 stored meetings). */
export function h2hBySurface(h2h) {
  if (!h2h || (h2h.total || 0) < 3) return null;
  const out = {};
  for (const m of h2h.meetings || []) { const s = m.surface || 'unknown'; out[s] ||= { A: 0, B: 0 }; out[s][m.won_by] += 1; }
  return out;
}
