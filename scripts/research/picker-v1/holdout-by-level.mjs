// DESCRIPTIVE ONLY (not a gate, not a re-selection): the frozen WTA holdout at the chosen tau, broken down by level.
// Answers "does the passing result hold at tour level, or only on ITF volume?". Reads the study's frozen tau.
import fs from 'node:fs';
import { ratingRun, backtest } from '../../../workers/shared/dna/match-dna.js';
import { loadTour } from '../mm2/lib/inputs.mjs';

const study = JSON.parse(fs.readFileSync('docs/evidence/picker-v1-study.json', 'utf8'));
const tour = 'WTA';
const S = study.tours[tour];
const tau = S.chosen_tau;
const t = await loadTour(tour);
const runs = { standard: ratingRun(t.entries, { variant: 'standard' }), margin: ratingRun(t.entries, { variant: 'margin' }) };
backtest(t.entries, runs, t.rankAt, { from: S.production.backtest_from });
const run = runs[S.production.variant];
const GROUP = (lv) => (['grand_slam', 'wta_1000', 'wta_500', 'wta_250', 'wta_finals'].includes(lv) ? 'WTA tour-level' : lv === 'wta_125' ? 'WTA 125' : lv === 'itf_women' ? 'ITF women' : 'other');
const wilson = (k, n, z = 1.96) => { const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d].map((x) => Math.round(x * 10000) / 10000); };
const acc = {};
for (const e of t.entries) {
  if (e.day < S.windows.hold[0]) continue;
  const pr = run.pre.get(e);
  if (!pr || pr.na < 10 || pr.nb < 10) continue;
  const p = S.production.surface_published && pr.ps != null && pr.nsa >= 5 && pr.nsb >= 5 ? pr.ps : pr.p;
  const pfav = Math.max(p, 1 - p);
  const g = (acc[GROUP(e.level)] ||= { eligible: 0, calls: 0, graded: 0, wins: 0, sum_p: 0 });
  g.eligible += 1;
  if (pfav < tau) continue;
  g.calls += 1;
  if (e.status !== 'completed') continue;
  g.graded += 1; g.sum_p += pfav; g.wins += (e.winner === 'A') === (p >= 0.5) ? 1 : 0;
}
const out = Object.fromEntries(Object.entries(acc).map(([k, g]) => [k, { eligible: g.eligible, call_rate: Math.round(g.calls / g.eligible * 1000) / 1000, graded_calls: g.graded, hit_rate: Math.round(g.wins / g.graded * 10000) / 10000, wilson95: wilson(g.wins, g.graded), mean_p_fav: Math.round(g.sum_p / g.graded * 10000) / 10000, calibration_gap: Math.round((g.wins / g.graded - g.sum_p / g.graded) * 10000) / 10000 }]));
study.tours[tour].holdout_by_level_descriptive = { note: 'descriptive breakdown of the frozen holdout at the chosen tau; not a gate and not used for selection', tau, groups: out };
fs.writeFileSync('docs/evidence/picker-v1-study.json', JSON.stringify(study, null, 1));
console.log(JSON.stringify(out, null, 1));
