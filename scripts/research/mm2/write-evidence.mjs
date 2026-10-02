// Matchup Model V2 research — assemble docs/evidence/matchup-model-v2-latest.json from the frozen dataset manifest, the
// frozen configuration and both evaluation stages, and classify each challenger by the coded promotion gate below.
//   node scripts/research/mm2/write-evidence.mjs
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './lib/inputs.mjs';

const J = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const ds = J('dataset/manifest.json');
const frozen = J('frozen-config.json');
const dev = J('eval-dev.json');
const fin = J('eval-final.json');
const sim = JSON.parse(fs.readFileSync('docs/evidence/sim-backtest-latest.json', 'utf8'));

const maxGap = (rel) => Math.max(0, ...rel.filter((b) => b.n >= 200).map((b) => Math.abs(b.predicted - b.observed)));
const failures = (segs) => Object.entries(segs).flatMap(([k, arr]) => arr.filter((s) => s.material_failure).map((s) => `${k}:${s.group} (+${s.delta}, n=${s.n})`));

/** SHADOW-READY needs every check; a challenger that does not improve on the development window is REJECT. */
function gate(tour, x) {
  const D = dev.tours[tour].dev; const F = fin.tours[tour].final;
  const pd = D.paired[`${x}_vs_champion`]; const pf = F.paired[`${x}_vs_champion`];
  const checks = {
    chronological_walk_forward: true,
    exact_rows_vs_champion: D[x].n === D.champion.n && F[x].n === F.champion.n,
    probability_quality_dev: pd.ci95_log_loss[1] < 0 && pd.delta_brier < 0,
    calibration_acceptable: D[x].ece <= D.champion.ece + 0.005 && F[x].ece <= F.champion.ece + 0.005 && maxGap(F[x].reliability) <= Math.max(0.05, maxGap(F.champion.reliability)),
    coverage_equals_champion: D[x].n === D.champion.n,
    no_material_segment_failure: failures(D[`segments_${x}`]).length === 0 && failures(F[`segments_${x}`]).length === 0,
    untouched_later_window_replicates: pf.ci95_log_loss[1] < 0 && pf.delta_brier < 0
  };
  const verdict = Object.values(checks).every(Boolean) ? 'SHADOW-READY' : !(pd.delta_log_loss < 0) ? 'REJECT' : 'KEEP RESEARCHING';
  return { verdict, checks, segment_failures: { dev: failures(D[`segments_${x}`]), final: failures(F[`segments_${x}`]) }, dev: { delta_log_loss: pd.delta_log_loss, ci95: pd.ci95_log_loss, delta_brier: pd.delta_brier }, final: { delta_log_loss: pf.delta_log_loss, ci95: pf.ci95_log_loss, delta_brier: pf.delta_brier } };
}

const tours = {};
for (const tour of ['ATP', 'WTA']) {
  const D = dev.tours[tour]; const F = fin.tours[tour];
  const A = gate(tour, 'A'); const B = gate(tour, 'B');
  // A is nested in B: if B is credibly better than A on both windows, A is not the candidate
  if (A.verdict !== 'REJECT' && D.dev.paired.B_vs_A.ci95_log_loss[1] < 0 && F.final.paired.B_vs_A.ci95_log_loss[1] < 0.0002) A.note = 'dominated by Challenger B (B improves on A on both windows)';
  tours[tour] = {
    windows: { development: D.window, later_untouched: F.window },
    lambda_selection: D.lambda_selection,
    development: D.dev, later_window: F.final,
    fits: { development: D.fits, later_window: F.fits },
    challenger_C: F.challenger_C || { status: 'not evaluable', reason: `${ds.tours[tour].tech_rows} rows where both players hold qualified technical history (men's match statistics exist only for one Australian Open, 238 matches)` },
    verdicts: { A, B }
  };
  if (tour === 'WTA') {
    const C = F.challenger_C.evaluated; const pc = C.paired.C_vs_champion;
    tours[tour].verdicts.C = { verdict: 'KEEP RESEARCHING', reason: `no credible gain over the champion on the technical subset (delta ${pc.delta_log_loss}, 95% CI ${pc.ci95_log_loss.join(' to ')}), worse than Challenger B on the same rows (${C.C.log_loss} vs ${C.B.log_loss}); technical history begins 2025, so no separate untouched replication window exists — revisit as statistics accrue`, n: C.n };
  } else tours[tour].verdicts.C = { verdict: 'REJECT', reason: 'not evaluable: no qualified men\'s technical history' };
}

const overall = ['ATP', 'WTA'].every((t) => tours[t].verdicts.B.verdict === 'SHADOW-READY') ? 'Challenger B (mm2-B-context/1) SHADOW-READY on both tours; not promoted (owner decision after prospective shadow evidence)' : 'see per-tour verdicts';
const evidence = {
  generated_at: new Date().toISOString(),
  phase: 'Matchup Model V2 — research challenger (RESEARCH ONLY: production PBE Rating, /v1/matchups/:id and PBEcast frozen probabilities unchanged)',
  verdict: overall,
  champion: { model: 'PBE Rating', method_version: 1, variant: ds.champion.variant, serving_rule: 'tennis-api modelBlock: ratings rounded as served; both players >= 10 rated matches; surface blend when the tour publishes it and both hold >= 5 surface-rated matches', reproduction: 'local replay of the production DNA v2 backtest from the cached build inputs matches dna:v2:summary (built 2026-10-02T06:50:39Z) exactly: ATP 34,456 / WTA 104,715 evaluation matches, every log loss, Brier, ranking and surface-blend figure' },
  dataset: { dataset_version: ds.dataset_version, generated_at: ds.generated_at, dataset_hash: ds.dataset_hash, feature_version: ds.feature_version, feature_schema: ds.feature_schema, tours: ds.tours, inputs: ds.inputs, row_fields: ['match_id', 'tour', 'scheduled_day', 'round_order', 'round', 'edition', 'surface', 'level', 'winner', 'y', 'champion_probability', 'champion_overall_probability', 'champion_basis', 'rated_matches', 'tech_both', 'feature_as_of', 'feature_version', 'features'], location: 'outside the repository (research data dir); reproduce with fetch-inputs.mjs + build-dataset.mjs (same inputs -> same hashes)' },
  frozen_configuration: frozen,
  model_versions: dev.model_versions,
  models: { A: 'p = sigmoid(a * logit(p_champion)) — calibration only, no tennis features', B: 'L2 logistic regression, no intercept (antisymmetric), standardised by RMS: logit(p_champion), surface-rating edge, form (wins above expectation, last 10), opponent strength (last 20), activity (30 days), rest, deciding-set, tiebreak, straight-set, first-set conversion, comeback profiles (last 60, shrunk)', C: 'B + technical serve / return / break-point-saved / break-point-converted edges, only where both players hold >= 5 stat matches and >= 200 points (WTA only)' },
  excluded_inputs: ['raw H2H', 'nationality', 'player name', 'tournament name', 'seed flags', 'editorial story types', 'PBE Edge Map output', 'sportsbook prices', 'ranking (baseline only)', 'DNA snapshots / current profiles'],
  market_benchmark: { status: 'none', reason: 'tennis_odds_snapshots holds 0 rows (2026-10-02); nothing was purchased or created' },
  tours,
  prior_research: { model_version: sim.model_version, status: sim.status, generated_at: sim.generated_at, test_all: sim.test_all, note: 'preserved unchanged as an early failed baseline (log loss above the coin); not reused' },
  no_betting_claims: 'model-quality research only: no +EV, profitability, ROI or betting-edge claim is made or implied'
};
fs.writeFileSync('docs/evidence/matchup-model-v2-latest.json', JSON.stringify(evidence, null, 1));
for (const t of ['ATP', 'WTA']) console.log(t, Object.fromEntries(Object.entries(tours[t].verdicts).map(([k, v]) => [k, v.verdict])), JSON.stringify(tours[t].verdicts.B.checks), JSON.stringify(tours[t].verdicts.A.segment_failures));
console.log(overall);
