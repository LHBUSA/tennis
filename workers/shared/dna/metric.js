// Tennis DNA metric object + v1 serve/return builder. PURE and deterministic.
// Contract: docs/TENNIS_DNA_CONTRACT.md. Definitions: DEFINITIONS below (frozen per definition_version).
//
// as_of is EXCLUSIVE: a snapshot at D includes only matches with match_date < D, so an article
// written on Oct 1 can never read a number that only became true on Oct 20.

export const DEFINITION_VERSION = 1;

/**
 * Every v1 metric: formula over canonical per-side match stats (`s` = the player's side, `o` = the
 * opponent's side of the same match). Numerator/denominator are summed across the sample, never
 * averaged per match. `min_den` = the denominator below which confidence is `insufficient`.
 */
export const DEFINITIONS = Object.freeze({
  ace_rate:              { family: 'serve',  unit: 'ratio', num: (s) => s.aces, den: (s) => s.service_points, min_den: 150, doc: 'aces / service points played' },
  double_fault_rate:     { family: 'serve',  unit: 'ratio', num: (s) => s.double_faults, den: (s) => s.service_points, min_den: 150, doc: 'double faults / service points played' },
  first_serve_in:        { family: 'serve',  unit: 'ratio', num: (s) => s.first_serves_in, den: (s) => s.service_points, min_den: 150, doc: 'first serves in / service points played' },
  first_serve_won:       { family: 'serve',  unit: 'ratio', num: (s) => s.first_serve_points_won, den: (s) => s.first_serves_in, min_den: 100, doc: 'points won on first serve / first serves in' },
  second_serve_won:      { family: 'serve',  unit: 'ratio', num: (s) => s.second_serve_points_won, den: (s) => sub(s.service_points, s.first_serves_in), min_den: 60, doc: 'points won on second serve / (service points - first serves in)' },
  service_points_won:    { family: 'serve',  unit: 'ratio', num: (s) => add(s.first_serve_points_won, s.second_serve_points_won), den: (s) => s.service_points, min_den: 150, doc: '(1st + 2nd serve points won) / service points' },
  hold_rate:             { family: 'serve',  unit: 'ratio', num: (s) => sub(s.service_games, sub(s.break_points_faced, s.break_points_saved)), den: (s) => s.service_games, min_den: 30, doc: '(service games - times broken) / service games; times broken = break points faced - saved' },
  break_points_saved:    { family: 'pressure', unit: 'ratio', num: (s) => s.break_points_saved, den: (s) => s.break_points_faced, min_den: 20, doc: 'break points saved / break points faced' },
  return_points_won:     { family: 'return', unit: 'ratio', num: (s, o) => sub(o.service_points, add(o.first_serve_points_won, o.second_serve_points_won)), den: (s, o) => o.service_points, min_den: 150, doc: "opponent service points not won by opponent / opponent service points" },
  first_return_won:      { family: 'return', unit: 'ratio', num: (s, o) => sub(o.first_serves_in, o.first_serve_points_won), den: (s, o) => o.first_serves_in, min_den: 100, doc: "opponent first serves in - opponent first-serve points won, over opponent first serves in" },
  second_return_won:     { family: 'return', unit: 'ratio', num: (s, o) => sub(sub(o.service_points, o.first_serves_in), o.second_serve_points_won), den: (s, o) => sub(o.service_points, o.first_serves_in), min_den: 60, doc: 'opponent second-serve points lost by opponent / opponent second-serve points' },
  return_games_won:      { family: 'return', unit: 'ratio', num: (s, o) => sub(o.break_points_faced, o.break_points_saved), den: (s, o) => o.service_games, min_den: 30, doc: 'breaks of serve / opponent service games' },
  break_points_converted:{ family: 'pressure', unit: 'ratio', num: (s, o) => sub(o.break_points_faced, o.break_points_saved), den: (s, o) => o.break_points_faced, min_den: 20, doc: 'breaks / break points created (= opponent break points faced)' }
});

// null-propagating arithmetic: a missing input keeps the result missing (never coerced to 0)
function add(a, b) { return a == null || b == null ? null : a + b; }
function sub(a, b) { return a == null || b == null ? null : a - b; }

export const CONFIDENCE = Object.freeze(['insufficient', 'low', 'medium', 'high']);

export function confidenceFor(denominator, minDen, sampleMatches) {
  if (!denominator || denominator < minDen) return 'insufficient';
  if (sampleMatches < 5 || denominator < minDen * 2) return 'low';
  if (sampleMatches < 15 || denominator < minDen * 5) return 'medium';
  return 'high';
}

/** The one metric object shape, everywhere. */
export function metricObject({ key, numerator, denominator, sample, coverage, sourceFamilies, asOf }) {
  const def = DEFINITIONS[key];
  if (!def) throw new Error(`unknown metric ${key}`);
  const value = denominator ? numerator / denominator : null;
  return {
    metric_key: key,
    value: value === null ? null : Math.round(value * 10000) / 10000,
    unit: def.unit,
    numerator: denominator ? numerator : null,
    denominator: denominator || null,
    sample_matches: sample.matches,
    sample_sets: sample.sets,
    sample_games: sample.games,
    confidence: value === null ? 'insufficient' : confidenceFor(denominator, def.min_den, sample.matches),
    coverage_status: coverage,
    definition_version: DEFINITION_VERSION,
    origin: 'pbe_derived',
    source_families: [...sourceFamilies].sort(),
    as_of: asOf
  };
}

/**
 * Build a player's v1 serve/return/pressure metrics.
 * rows: [{ match_id, match_date:'YYYY-MM-DD', surface, sets_played, games_played, source_family,
 *          side: {stats}, opp: {stats} }] where stats use canonical keys (service_points, aces, …).
 * A row contributes to a metric only when EVERY input of that metric is present on that row;
 * rows missing inputs lower `coverage_status` instead of being counted as zeros.
 */
export function buildDna(rows, { asOf, surface = null } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asOf))) throw new Error('asOf YYYY-MM-DD required');
  const eligible = rows.filter((r) => r.match_date < asOf && (!surface || r.surface === surface));
  const metrics = {};
  for (const [key, def] of Object.entries(DEFINITIONS)) {
    let num = 0;
    let den = 0;
    const sample = { matches: 0, sets: 0, games: 0 };
    const families = new Set();
    let missing = 0;
    for (const r of eligible) {
      const n = def.num(r.side || {}, r.opp || {});
      const d = def.den(r.side || {}, r.opp || {});
      if (n == null || d == null || d < 0 || n < 0 || n > d) { missing += 1; continue; }
      num += n;
      den += d;
      sample.matches += 1;
      sample.sets += r.sets_played ?? 0;
      sample.games += r.games_played ?? 0;
      if (r.source_family) families.add(r.source_family);
    }
    const coverage = !eligible.length ? 'none' : missing === 0 ? 'complete' : sample.matches ? 'partial' : 'none';
    metrics[key] = metricObject({ key, numerator: num, denominator: den, sample, coverage, sourceFamilies: families, asOf });
  }
  return { as_of: asOf, surface, definition_version: DEFINITION_VERSION, matches_considered: eligible.length, metrics };
}
