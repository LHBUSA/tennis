// Tennis PBE Picker V1 study — implements docs/research/PICKER_V1_PROTOCOL.md exactly (registered b27aeec, before any
// result). Production PBE Rating via the production functions; selection window chooses tau; holdout evaluated ONCE.
//   node scripts/research/picker-v1/study.mjs  -> docs/evidence/picker-v1-study.json (+ .md)
import fs from 'node:fs';
import { ratingRun, backtest } from '../../../workers/shared/dna/match-dna.js';
import { loadTour } from '../mm2/lib/inputs.mjs';

const PROTOCOL = 'docs/research/PICKER_V1_PROTOCOL.md@b27aeec';
const BACKTEST_FROM = { ATP: '2012-01-01', WTA: '2023-01-01' }; // = dna-v2-job.js
const MIN_EVAL = 500; // = dna-v2-job.js
const MIN_PRIOR = 10; // production backtest minPrior
const WINDOWS = { ATP: { sel: ['2012-01-01', '2022-12-31'], hold: ['2023-01-01', '9999-12-31'] }, WTA: { sel: ['2023-01-01', '2024-12-31'], hold: ['2025-01-01', '9999-12-31'] } };
const TAUS = Array.from({ length: 11 }, (_, i) => Math.round((0.55 + i * 0.025) * 1000) / 1000);
const SELECT = { minCalls: 300, wilsonLo: 0.65, calGap: -0.02 };
const GATE = { minCalls: 100, wilsonLo: 0.60, calGap: -0.03 };

const wilson = (k, n, z = 1.96) => { if (!n) return [null, null]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

/** Production served probability for one entry: overall p, or the 50/50 surface blend where it is published and both have >= 5 surface matches. */
function served(pr, surfacePublished) {
  if (!pr) return null;
  if (surfacePublished && pr.ps != null && pr.nsa >= 5 && pr.nsb >= 5) return pr.ps;
  return pr.p;
}

function evaluate(rows, tau) {
  const out = { tau, eligible: 0, hold: 0, call: 0, pass: 0, graded: 0, void: 0, wins: 0, sum_p: 0, ll: 0, brier: 0, bands: {} };
  for (const r of rows) {
    if (r.hold) { out.hold += 1; continue; }
    out.eligible += 1;
    if (r.pfav < tau) { out.pass += 1; continue; }
    out.call += 1;
    if (r.void) { out.void += 1; continue; }
    out.graded += 1; out.wins += r.win ? 1 : 0; out.sum_p += r.pfav;
    out.ll += -Math.log(r.win ? r.pfav : 1 - r.pfav); out.brier += (r.pfav - (r.win ? 1 : 0)) ** 2;
    const b = (Math.floor(r.pfav * 20) / 20).toFixed(2);
    const bb = (out.bands[b] ||= { n: 0, wins: 0, sum_p: 0 }); bb.n += 1; bb.wins += r.win ? 1 : 0; bb.sum_p += r.pfav;
  }
  const n = out.graded;
  const hit = n ? out.wins / n : null, meanP = n ? out.sum_p / n : null;
  const [lo, hi] = wilson(out.wins, n);
  const total = out.hold + out.eligible;
  return {
    tau, total, graded_calls: n, void_calls: out.void, wins: out.wins, hit_rate: r4(hit), wilson95: [r4(lo), r4(hi)], mean_p_fav: r4(meanP),
    calibration_gap: n ? r4(hit - meanP) : null, log_loss: n ? r4(out.ll / n) : null, brier: n ? r4(out.brier / n) : null,
    rates: { call: r4(out.call / total), pass: r4(out.pass / total), hold: r4(out.hold / total) }, counts: { call: out.call, pass: out.pass, hold: out.hold },
    bands: Object.fromEntries(Object.entries(out.bands).sort().map(([b, v]) => [b, { n: v.n, hit_rate: r4(v.wins / v.n), mean_p: r4(v.sum_p / v.n) }])),
  };
}

const result = { protocol: PROTOCOL, generated_at: new Date().toISOString(), inputs_manifest: JSON.parse(fs.readFileSync('D:/Workers/research-data/tennis-mm2/inputs/manifest.json', 'utf8')).fetched_at, tours: {} };
for (const tour of ['ATP', 'WTA']) {
  const t = await loadTour(tour);
  const runs = { standard: ratingRun(t.entries, { variant: 'standard' }), margin: ratingRun(t.entries, { variant: 'margin' }) };
  const bt = backtest(t.entries, runs, t.rankAt, { from: BACKTEST_FROM[tour] });
  const variant = (bt.margin.log_loss ?? 9) < (bt.standard.log_loss ?? 9) ? 'margin' : 'standard';
  const b = bt[variant];
  const published = b.matches >= MIN_EVAL && b.log_loss < b.coin_log_loss && !!b.vs_rank && b.vs_rank.matches >= MIN_EVAL && b.vs_rank.rating_log_loss < b.vs_rank.rank_log_loss;
  const surfacePublished = published && !!b.surface_blend && b.surface_blend.matches >= MIN_EVAL && b.surface_blend.blended_log_loss < b.surface_blend.overall_log_loss;
  const run = runs[variant];
  const rowsIn = ([from, to]) => {
    const rows = [];
    for (const e of t.entries) {
      if (e.day < from || e.day > to) continue;
      const pr = run.pre.get(e);
      const p = served(pr, surfacePublished);
      const hold = !published || !pr || p == null || pr.na < MIN_PRIOR || pr.nb < MIN_PRIOR;
      if (hold) { rows.push({ hold: true }); continue; }
      const favA = p >= 0.5;
      rows.push({ pfav: favA ? p : 1 - p, void: e.status !== 'completed', win: e.status === 'completed' && (e.winner === 'A') === favA });
    }
    return rows;
  };
  const sel = rowsIn(WINDOWS[tour].sel), hold = rowsIn(WINDOWS[tour].hold);
  const grid = TAUS.map((tau) => evaluate(sel, tau));
  const chosen = grid.find((g) => g.graded_calls >= SELECT.minCalls && g.wilson95[0] >= SELECT.wilsonLo && g.calibration_gap >= SELECT.calGap) || null;
  const holdout = chosen ? evaluate(hold, chosen.tau) : null;
  const gate = holdout ? { min_calls: holdout.graded_calls >= GATE.minCalls, wilson_lo: holdout.wilson95[0] >= GATE.wilsonLo, calibration: holdout.calibration_gap >= GATE.calGap, beats_coin: holdout.log_loss < Math.log(2) } : null;
  result.tours[tour] = {
    production: { variant, published, surface_published: surfacePublished, backtest_from: BACKTEST_FROM[tour], data_last_day: t.entries.at(-1)?.day },
    windows: WINDOWS[tour], selection_grid: grid, chosen_tau: chosen?.tau ?? null, selection: chosen,
    holdout, gate, passed: Boolean(gate && Object.values(gate).every(Boolean)),
  };
  console.log(tour, JSON.stringify({ variant, published, surfacePublished, chosen_tau: chosen?.tau ?? null, sel: chosen && { calls: chosen.graded_calls, hit: chosen.hit_rate, lo: chosen.wilson95[0], gap: chosen.calibration_gap }, holdout: holdout && { calls: holdout.graded_calls, hit: holdout.hit_rate, wilson: holdout.wilson95, gap: holdout.calibration_gap, ll: holdout.log_loss, rates: holdout.rates }, gate }));
}
fs.writeFileSync('docs/evidence/picker-v1-study.json', JSON.stringify(result, null, 1));
