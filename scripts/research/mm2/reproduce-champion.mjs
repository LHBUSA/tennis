// Reproduce the production PBE Rating backtest (dna-v2-job.js) from the fetched inputs with the production functions.
// It must match production's own summary for the same source state before any challenger is trusted.
//   node scripts/research/mm2/reproduce-champion.mjs
import { ratingRun, backtest } from '../../../workers/shared/dna/match-dna.js';
import { loadTour } from './lib/inputs.mjs';

const FROM = { ATP: '2012-01-01', WTA: '2023-01-01' };
for (const tour of ['ATP', 'WTA']) {
  const t = await loadTour(tour);
  const runs = { standard: ratingRun(t.entries, { variant: 'standard' }), margin: ratingRun(t.entries, { variant: 'margin' }) };
  const bt = backtest(t.entries, runs, t.rankAt, { from: FROM[tour] });
  for (const v of ['standard', 'margin']) { const b = bt[v]; console.log(tour, v, 'matches', t.entries.length, 'eval', b.matches, 'll', b.log_loss, 'brier', b.brier, 'vs_rank', b.vs_rank && `${b.vs_rank.rating_log_loss}/${b.vs_rank.rank_log_loss} n=${b.vs_rank.matches}`, 'blend', b.surface_blend && `${b.surface_blend.blended_log_loss}/${b.surface_blend.overall_log_loss} n=${b.surface_blend.matches}`); }
}
