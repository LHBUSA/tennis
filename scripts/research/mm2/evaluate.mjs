// Matchup Model V2 research — walk-forward evaluation, champion vs challengers on IDENTICAL rows (RESEARCH ONLY).
//   node --max-old-space-size=12000 scripts/research/mm2/evaluate.mjs dev     # selection on the development window;
//                                                                             # FREEZES the configuration (frozen-config.json)
//   node --max-old-space-size=12000 scripts/research/mm2/evaluate.mjs final   # requires the frozen config; touches the
//                                                                             # untouched later window ONCE; writes the evidence
// Nothing here is read by any Worker or by the frontend (tests/mm2-research.test.js proves no import path).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, loadTour } from './lib/inputs.mjs';
import { FEATURES_B, FEATURES_C, FEATURE_VERSION } from './lib/features.mjs';
import { fitLogistic, predict, fitRank, rankP, walkForward, metrics, pairedBootstrap, assertSameRows, FAV_BANDS } from './lib/model.mjs';

export const MODEL_VERSIONS = { A: 'mm2-A-calibration/1', B: 'mm2-B-context/1', C: 'mm2-C-technical/1' };
const STAGE = process.argv[2];
if (!['dev', 'final'].includes(STAGE)) throw new Error('usage: evaluate.mjs dev|final');
const FROZEN = path.join(DATA, 'frozen-config.json');
const HOLDOUT_FROM = '2025-07-01';
const EVAL_FROM = { ATP: '2012-01-01', WTA: '2023-01-01' }; // production's own backtest windows
const LAMBDAS = [1, 100, 10000];
const C_LAMBDA = 100; // pre-registered (no tuning possible: technical history starts 2025)
const MIN_TRAIN = 2000;

const devBlocks = (tour) => {
  const out = [];
  for (let y = Number(EVAL_FROM[tour].slice(0, 4)); y <= 2024; y += 1) out.push({ name: String(y), from: `${y}-01-01`, to: `${y + 1}-01-01` });
  out.push({ name: '2025H1', from: '2025-01-01', to: HOLDOUT_FROM });
  return out;
};
const finalBlocks = [{ name: '2025H2', from: HOLDOUT_FROM, to: '2026-01-01' }, { name: '2026', from: '2026-01-01', to: '2027-01-01' }];
const cBlocks = [{ name: '2025Q3', from: '2025-07-01', to: '2025-10-01' }, { name: '2025Q4', from: '2025-10-01', to: '2026-01-01' }, { name: '2026Q1', from: '2026-01-01', to: '2026-04-01' }, { name: '2026Q2', from: '2026-04-01', to: '2026-07-01' }, { name: '2026Q3+', from: '2026-07-01', to: '2027-01-01' }];

const readRows = (tour) => fs.readFileSync(path.join(DATA, 'dataset', `${tour}.jsonl`), 'utf8').trim().split('\n').map((l) => { const r = JSON.parse(l); return { ...r, day: r.scheduled_day }; });
const X = (rows, names) => rows.map((r) => names.map((k) => r.features[k]));
const Y = (rows) => rows.map((r) => r.y);

async function rankPairs(tour, rows) {
  const t = await loadTour(tour);
  const byId = new Map(t.entries.map((e) => [e.id, e]));
  const out = new Map();
  for (const r of rows) { const e = byId.get(r.match_id); const a = t.rankAt(e.A, e.rank_day); const b = t.rankAt(e.B, e.rank_day); if (a?.rank && b?.rank) out.set(r.match_id, [a.rank, b.rank]); }
  return out;
}

/** Walk-forward predictions for blocks: champion, overall, A, B (lambda), rank (where ranked). */
function runBlocks(rows, blocks, { lambdaB, ranks }) {
  const res = []; const fits = [];
  for (const b of walkForward(rows, blocks)) {
    if (!b.test.length) continue;
    if (b.train.length < MIN_TRAIN) { fits.push({ block: b.name, skipped: `train ${b.train.length} < ${MIN_TRAIN}` }); continue; }
    const A = fitLogistic(X(b.train, ['L']), Y(b.train), ['L'], { lambda: 1 });
    const Bm = fitLogistic(X(b.train, FEATURES_B), Y(b.train), FEATURES_B, { lambda: lambdaB });
    const rp = b.train.filter((r) => ranks.has(r.match_id)).map((r) => [...ranks.get(r.match_id), r.y]);
    const c = rp.length >= 200 ? fitRank(rp) : null;
    fits.push({ block: b.name, from: b.from, to: b.to, train_rows: b.train.length, test_rows: b.test.length, train_last_day: b.train.at(-1).day, A: { coef: A.coef.map(r6) }, B: { lambda: lambdaB, coef: Object.fromEntries(FEATURES_B.map((k, j) => [k, r6(Bm.coef[j])])) }, rank_c: c, rank_fit_rows: rp.length });
    for (const r of b.test) {
      const rk = ranks.get(r.match_id);
      res.push({ r, block: b.name, champion: r.champion_probability, overall: r.champion_overall_probability, A: predict(A, [r.features.L]), B: predict(Bm, FEATURES_B.map((k) => r.features[k])), rank: rk && c != null ? rankP(c, rk[0], rk[1]) : null });
    }
  }
  return { res, fits };
}
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const strip = (m) => ({ ...m });

function summarize(res, { boot = true, models = ['champion', 'overall', 'A', 'B'] } = {}) {
  const rows = res.map((x) => x.r);
  const out = { n: res.length, coin: metrics(res.map(() => 0.5), Y(rows)) };
  delete out.coin.reliability;
  for (const k of models) out[k] = metrics(res.map((x) => x[k]), Y(rows));
  if (boot) {
    out.paired = {};
    for (const k of models.filter((m) => m !== 'champion')) out.paired[`${k}_vs_champion`] = pairedBootstrap(rows, res.map((x) => x[k]), res.map((x) => x.champion));
    if (models.includes('B') && models.includes('A')) out.paired.B_vs_A = pairedBootstrap(rows, res.map((x) => x.B), res.map((x) => x.A));
  }
  const ranked = res.filter((x) => x.rank != null);
  if (ranked.length) {
    out.ranked_subset = { n: ranked.length, rank: metrics(ranked.map((x) => x.rank), Y(ranked.map((x) => x.r))) };
    for (const k of models) out.ranked_subset[k] = metrics(ranked.map((x) => x[k]), Y(ranked.map((x) => x.r)));
    for (const k of Object.keys(out.ranked_subset)) if (out.ranked_subset[k]?.reliability) delete out.ranked_subset[k].reliability;
  }
  return out;
}

const favBand = (p) => { const f = Math.max(p, 1 - p); const i = FAV_BANDS.findIndex(([a, b]) => f >= a && f < b); return ['50-55', '55-60', '60-70', '70-80', '80-90', '90+'][i]; };
const levelGroup = (l) => (/grand_slam/.test(l) ? 'slam' : /1000/.test(l) ? '1000' : /500/.test(l) ? '500' : /250/.test(l) ? '250' : /125|itf|challenger/.test(l) ? 'lower (125/ITF/Challenger)' : /finals|olympics/.test(l) ? 'finals/olympics' : 'unknown');
const depth = (r) => { const m = Math.min(...r.rated_matches); return m < 20 ? '10-19' : m < 50 ? '20-49' : m < 100 ? '50-99' : '100+'; };
const SEGMENTS = { surface: (x) => (['hard', 'clay', 'grass'].includes(x.r.surface) ? x.r.surface : x.r.surface === 'unknown' ? 'unknown' : `other (${x.r.surface})`), level: (x) => levelGroup(x.r.level), favourite_band: (x) => favBand(x.champion), history_depth: (x) => depth(x.r), technical_dna: (x) => (x.r.tech_both ? 'both qualified' : 'not both') };

/** Segment table: per group champion vs challenger log loss with a paired bootstrap; material failure flagged. */
function segments(res, challenger) {
  const out = {};
  for (const [name, fn] of Object.entries(SEGMENTS)) {
    const g = new Map();
    for (const x of res) { const k = fn(x); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
    out[name] = [...g.entries()].sort().map(([k, xs]) => {
      const rows = xs.map((x) => x.r);
      const mc = metrics(xs.map((x) => x.champion), Y(rows)); const mx = metrics(xs.map((x) => x[challenger]), Y(rows));
      const bt = xs.length >= 200 ? pairedBootstrap(rows, xs.map((x) => x[challenger]), xs.map((x) => x.champion), { reps: 300 }) : null;
      const material = !!(bt && bt.ci95_log_loss[0] > 0); // challenger credibly WORSE in this segment
      return { group: k, n: xs.length, champion_log_loss: mc.log_loss, challenger_log_loss: mx.log_loss, delta: bt?.delta_log_loss ?? r6(mx.log_loss - mc.log_loss), ci95: bt?.ci95_log_loss ?? null, champion_ece: mc.ece, challenger_ece: mx.ece, material_failure: material };
    });
  }
  return out;
}

const out = { stage: STAGE, generated_at: new Date().toISOString(), feature_version: FEATURE_VERSION, model_versions: MODEL_VERSIONS, tours: {} };
let frozen = null;
if (STAGE === 'final') {
  if (!fs.existsSync(FROZEN)) throw new Error('final stage requires the frozen configuration from the dev stage');
  frozen = JSON.parse(fs.readFileSync(FROZEN, 'utf8'));
  const ds = JSON.parse(fs.readFileSync(path.join(DATA, 'dataset/manifest.json'), 'utf8')).dataset_hash;
  if (ds !== frozen.dataset_hash) throw new Error('dataset changed since the configuration was frozen');
}
const frozenNew = { frozen_at: new Date().toISOString(), dataset_hash: JSON.parse(fs.readFileSync(path.join(DATA, 'dataset/manifest.json'), 'utf8')).dataset_hash, feature_version: FEATURE_VERSION, model_versions: MODEL_VERSIONS, holdout_from: HOLDOUT_FROM, tours: {} };

for (const tour of ['ATP', 'WTA']) {
  const rows = readRows(tour);
  const ranks = await rankPairs(tour, rows);
  const T = (out.tours[tour] = {});
  if (STAGE === 'dev') {
    // lambda for B chosen on the development window only (pooled walk-forward log loss)
    const trials = [];
    let best = null;
    for (const lam of LAMBDAS) {
      const { res } = runBlocks(rows, devBlocks(tour), { lambdaB: lam, ranks });
      const m = metrics(res.map((x) => x.B), Y(res.map((x) => x.r)));
      trials.push({ lambda: lam, n: m.n, log_loss: m.log_loss });
      if (!best || m.log_loss < best.log_loss) best = { lambda: lam, log_loss: m.log_loss };
    }
    const { res, fits } = runBlocks(rows, devBlocks(tour), { lambdaB: best.lambda, ranks });
    assertSameRows(res.map((x) => x.r), res.map((x) => x.r));
    T.window = { from: EVAL_FROM[tour], to: HOLDOUT_FROM, blocks: devBlocks(tour) };
    T.lambda_selection = { grid: LAMBDAS, trials, chosen: best.lambda };
    T.dev = summarize(res);
    T.dev.segments_B = segments(res, 'B');
    T.dev.segments_A = segments(res, 'A');
    T.fits = fits;
    frozenNew.tours[tour] = { lambda_B: best.lambda, lambda_A: 1, features_A: ['L'], features_B: FEATURES_B };
  } else {
    const cfg = frozen.tours[tour];
    const { res, fits } = runBlocks(rows, finalBlocks, { lambdaB: cfg.lambda_B, ranks });
    T.window = { from: HOLDOUT_FROM, blocks: finalBlocks, untouched_during_selection: true, frozen_config_at: frozen.frozen_at };
    T.final = summarize(res);
    T.final.segments_B = segments(res, 'B');
    T.final.segments_A = segments(res, 'A');
    T.fits = fits;
    if (tour === 'WTA') {
      // Challenger C: technical subset only; champion, A and B rescored on exactly these rows
      const techRows = rows.filter((r) => r.tech_both);
      const resC = [];
      const cfits = [];
      const byId = new Map(res.map((x) => [x.r.match_id, x]));
      for (const b of walkForward(techRows, cBlocks)) {
        if (!b.test.length) continue;
        if (b.train.length < 1000) { cfits.push({ block: b.name, skipped: `train ${b.train.length} < 1000`, test_rows: b.test.length }); continue; }
        const Cm = fitLogistic(X(b.train, FEATURES_C), Y(b.train), FEATURES_C, { lambda: C_LAMBDA });
        cfits.push({ block: b.name, train_rows: b.train.length, test_rows: b.test.length, coef: Object.fromEntries(FEATURES_C.map((k, j) => [k, r6(Cm.coef[j])])) });
        for (const r of b.test) { const base = byId.get(r.match_id); if (base) resC.push({ ...base, C: predict(Cm, FEATURES_C.map((k) => r.features[k])) }); }
      }
      T.challenger_C = { lambda: C_LAMBDA, blocks: cBlocks, fits: cfits, technical_rows_total: techRows.length, evaluated: summarize(resC, { models: ['champion', 'A', 'B', 'C'] }), note: 'technical history begins 2025: every evaluated C row is in the later window; there is no separate untouched replication for C' };
    }
  }
  console.log(tour, STAGE, JSON.stringify((T.dev || T.final), (k, v) => (['reliability', 'segments_A', 'segments_B', 'ranked_subset'].includes(k) ? undefined : v)).slice(0, 1600));
}
if (STAGE === 'dev') {
  fs.writeFileSync(FROZEN, JSON.stringify(frozenNew, null, 1));
  frozenNew.config_hash = crypto.createHash('sha256').update(JSON.stringify(frozenNew.tours)).digest('hex');
  fs.writeFileSync(FROZEN, JSON.stringify(frozenNew, null, 1));
}
fs.writeFileSync(path.join(DATA, `eval-${STAGE}.json`), JSON.stringify(out, null, 1));
console.log('written', path.join(DATA, `eval-${STAGE}.json`));
