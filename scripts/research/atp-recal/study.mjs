// Tennis Picks V2 — ATP recalibration study atp-recal/2 (docs/research/PICKS_V2_PROTOCOL.md section 1, registered
// ff35487 before any result). Development window ONLY (2012-01-01 .. 2022-12-31): every ATP entry passes through
// developmentEntries() BEFORE the rating run, so nothing dated 2023+ is ever read. The v1 holdout stays closed.
//   node --max-old-space-size=3000 scripts/research/atp-recal/study.mjs
//     -> docs/evidence/atp-recal/dev-study.json + frozen.json
// Also writes the descriptive WTA "outside the chalk" check on the Picker V1 SELECTION window (2023-2024; never its
// holdout) with WTA V1 frozen (tau 0.55, no recalibration).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { ratingRun } from '../../../workers/shared/dna/match-dna.js';
import { loadTour } from '../mm2/lib/inputs.mjs';
import { developmentEntries, HOLDOUT_FROM } from './holdout-guard.mjs';
import { METHODS, fitMethod, applyMethod, logit } from './methods.mjs';

const PROTOCOL = 'docs/research/PICKS_V2_PROTOCOL.md@ff35487';
const DEV_FROM = '2012-01-01';
const VAL_YEARS = [2019, 2020, 2021, 2022];
const TAUS = Array.from({ length: 11 }, (_, i) => Math.round((0.55 + i * 0.025) * 1000) / 1000);
const SELECT = { minCalls: 300, wilsonLo: 0.65, calGap: -0.02 };
const MIN_PRIOR = 10;
const MIN_GAIN = 0.002;
// production serving rule for ATP (docs/evidence/dna-v2-backtest-latest.json: variant standard, surface published) —
// read from production evidence, NOT recomputed (recomputing it would read the post-2022 backtest window)
const PROD = { ATP: { variant: 'standard', surface_published: true }, WTA: { variant: 'margin', surface_published: true } };

const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);
const wilson = (k, n, z = 1.96) => { if (!n) return [null, null]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [r4((c - m) / d), r4((c + m) / d)]; };
const clip = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));

function served(pr, surfacePublished) {
  if (!pr) return null;
  if (surfacePublished && pr.ps != null && pr.nsa >= 5 && pr.nsb >= 5) return pr.ps;
  return pr.p;
}

/** Rows: { day, year, y (A won, completed only), void, pA, hold, rankA, rankB, edition } */
function rowsFor(t, entries, prod) {
  const run = ratingRun(entries, { variant: prod.variant });
  const rows = [];
  for (const e of entries) {
    const pr = run.pre.get(e);
    const p = served(pr, prod.surface_published);
    const hold = !pr || p == null || pr.na < MIN_PRIOR || pr.nb < MIN_PRIOR;
    const ra = t.rankAt(e.A, e.rank_day), rb = t.rankAt(e.B, e.rank_day);
    rows.push({ day: e.day, year: Number(e.day.slice(0, 4)), hold, pA: p, void: e.status !== 'completed', y: e.winner === 'A' ? 1 : 0, rankA: ra?.rank ?? null, rankB: rb?.rank ?? null, edition: e.edition, blend: !!(prod.surface_published && pr?.ps != null && pr.nsa >= 5 && pr.nsb >= 5) });
  }
  return rows;
}

function metrics(items) { // items: { p (prob of A), y }
  const n = items.length;
  if (!n) return { n: 0 };
  let ll = 0, br = 0, acc = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, sp: 0, w: 0 }));
  for (const { p, y } of items) {
    const q = clip(p);
    ll += -(y ? Math.log(q) : Math.log(1 - q)); br += (p - y) ** 2; acc += (p >= 0.5) === (y === 1) ? 1 : 0;
    const pf = Math.max(p, 1 - p), win = (p >= 0.5) === (y === 1) ? 1 : 0;
    const b = bins[Math.min(9, Math.floor(pf * 10))];
    b.n += 1; b.sp += pf; b.w += win;
  }
  const ece = bins.reduce((s, b) => s + (b.n ? (b.n / n) * Math.abs(b.w / b.n - b.sp / b.n) : 0), 0);
  return { n, log_loss: r4(ll / n), brier: r4(br / n), accuracy: r4(acc / n), ece: r4(ece),
    reliability: bins.map((b, i) => (b.n ? { bin: `${i / 10}-${(i + 1) / 10}`, n: b.n, mean_p_fav: r4(b.sp / b.n), fav_won: r4(b.w / b.n) } : null)).filter(Boolean) };
}

function pickerEval(items, tau) { // items: { p, y, void }
  let calls = 0, graded = 0, wins = 0, sp = 0, voids = 0, ll = 0, br = 0;
  for (const it of items) {
    const pf = Math.max(it.p, 1 - it.p);
    if (pf < tau) continue;
    calls += 1;
    if (it.void) { voids += 1; continue; }
    const w = (it.p >= 0.5) === (it.y === 1) ? 1 : 0;
    graded += 1; wins += w; sp += pf; ll += -Math.log(clip(w ? pf : 1 - pf)); br += (pf - w) ** 2;
  }
  const hit = graded ? wins / graded : null, mp = graded ? sp / graded : null;
  return { tau, calls, graded_calls: graded, void_calls: voids, wins, hit_rate: r4(hit), wilson95: wilson(wins, graded), mean_p_fav: r4(mp), calibration_gap: graded ? r4(hit - mp) : null, log_loss: graded ? r4(ll / graded) : null, brier: graded ? r4(br / graded) : null };
}

/** Ranking baseline p = 1/(1+(ra/rb)^c), c by grid on the training rows (ranked pairs only). */
function fitRank(train) {
  const ranked = train.filter((r) => r.rankA && r.rankB);
  let best = { c: 0.7, ll: Infinity };
  for (let c = 0.2; c <= 1.6001; c += 0.05) {
    let ll = 0;
    for (const r of ranked) { const p = clip(1 / (1 + (r.rankA / r.rankB) ** c)); ll += -(r.y ? Math.log(p) : Math.log(1 - p)); }
    if (ll < best.ll) best = { c: r4(c), ll };
  }
  return best.c;
}

function chalk(items, tau) { // CALLs whose PBE favourite is the ranking underdog (both ranked) vs the rest
  const out = { pbe_fav_is_rank_underdog: [], pbe_fav_is_rank_favourite: [], unranked_pair: [] };
  for (const it of items) {
    if (it.void || Math.max(it.p, 1 - it.p) < tau) continue;
    const favA = it.p >= 0.5;
    const k = !(it.rankA && it.rankB) ? 'unranked_pair' : (favA ? it.rankA > it.rankB : it.rankB > it.rankA) ? 'pbe_fav_is_rank_underdog' : 'pbe_fav_is_rank_favourite';
    out[k].push(it);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => {
    const w = v.filter((it) => (it.p >= 0.5) === (it.y === 1)).length, sp = v.reduce((s, it) => s + Math.max(it.p, 1 - it.p), 0);
    return [k, { graded_calls: v.length, wins: w, hit_rate: v.length ? r4(w / v.length) : null, wilson95: wilson(w, v.length), mean_p_fav: v.length ? r4(sp / v.length) : null }];
  }));
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const manifestRaw = fs.readFileSync('D:/Workers/research-data/tennis-mm2/inputs/manifest.json', 'utf8');
const out = { protocol: PROTOCOL, generated_at: new Date().toISOString(), inputs: { manifest_sha256: sha(manifestRaw), fetched_at: JSON.parse(manifestRaw).fetched_at }, code_commit: execSync('git rev-parse HEAD').toString().trim(), ATP: {}, WTA_chalk: null };

// ---------------- ATP ----------------
{
  const t = await loadTour('ATP');
  const dev = developmentEntries(t.entries).filter((e) => e.day >= '1998-01-01'); // full earlier history feeds the walk-forward rating; nothing >= HOLDOUT_FROM
  if (dev.some((e) => e.day >= HOLDOUT_FROM)) throw new Error('holdout leak');
  t.entries = null; // drop the post-2022 entries from memory: never read again
  const rows = rowsFor(t, dev, PROD.ATP);
  const usable = (r) => !r.hold && r.day >= DEV_FROM;
  const oos = Object.fromEntries(METHODS.map((m) => [m, []]));
  oos.uncalibrated = []; oos.coin = []; oos.rank = [];
  const folds = [];
  for (const Y of VAL_YEARS) {
    const train = rows.filter((r) => usable(r) && !r.void && r.year < Y);
    const test = rows.filter((r) => usable(r) && r.year === Y);
    const fold = { year: Y, train: train.length, test: test.length, coefficients: {} };
    const c = fitRank(train);
    fold.rank_c = c;
    for (const m of METHODS) {
      const fit = fitMethod(m, train.map((r) => ({ p: r.pA, y: r.y })));
      fold.coefficients[m] = fit.summary;
      for (const r of test) oos[m].push({ ...r, p: applyMethod(fit, r.pA) });
    }
    for (const r of test) {
      oos.uncalibrated.push({ ...r, p: r.pA }); oos.coin.push({ ...r, p: 0.5 });
      if (r.rankA && r.rankB) oos.rank.push({ ...r, p: 1 / (1 + (r.rankA / r.rankB) ** c) });
    }
    folds.push(fold);
  }
  const graded = (arr) => arr.filter((r) => !r.void);
  const pooled = Object.fromEntries(Object.entries(oos).map(([k, v]) => [k, metrics(graded(v))]));
  // same-match comparison for the ranking baseline (ranked pairs only)
  const rankedIdx = graded(oos.uncalibrated).filter((r) => r.rankA && r.rankB);
  const rankedSame = { n: rankedIdx.length, uncalibrated: metrics(rankedIdx).log_loss, rank: metrics(graded(oos.rank)).log_loss };
  const order = ['temperature', 'platt', 'isotonic'];
  let best = null;
  for (const m of order) { const ll = pooled[m].log_loss; if (!best || ll < best.ll - 0.001) best = { m, ll }; }
  const gain = r4(pooled.uncalibrated.log_loss - best.ll);
  const selected = gain >= MIN_GAIN ? best.m : null;
  const grid = selected ? TAUS.map((tau) => pickerEval(oos[selected], tau)) : [];
  const chosen = grid.find((g) => g.graded_calls >= SELECT.minCalls && g.wilson95[0] >= SELECT.wilsonLo && g.calibration_gap >= SELECT.calGap) || null;
  const uncalGrid = TAUS.map((tau) => pickerEval(oos.uncalibrated, tau));
  let frozen = null;
  if (selected && chosen) {
    const all = rows.filter((r) => usable(r) && !r.void);
    const fit = fitMethod(selected, all.map((r) => ({ p: r.pA, y: r.y })));
    frozen = { challenger: `atp-recal/2:${selected}`, candidate: 'tennis-picker-v2-atp-shadow', status: 'FROZEN_PROSPECTIVE_SHADOW', method: selected, params: fit.params, fit_window: [DEV_FROM, '2022-12-31'], fit_matches: all.length, tau: chosen.tau, min_prior: MIN_PRIOR, production_input: 'matchup-freeze/1 model.probability (PBE Rating served probability, unchanged)', protocol: PROTOCOL, inputs_manifest_sha256: out.inputs.manifest_sha256, code_commit: out.code_commit, frozen_at: new Date().toISOString() };
  }
  out.ATP = { production: PROD.ATP, dev_window: [DEV_FROM, '2022-12-31'], validation_years: VAL_YEARS, rows_dev_total: rows.length, folds, pooled_oos: pooled, ranking_same_matches: rankedSame, selected_method: selected, gain_vs_uncalibrated: gain, tau_grid_selected: grid, tau_grid_uncalibrated: uncalGrid, chosen_tau: chosen?.tau ?? null, selection: chosen,
    outside_chalk: selected && chosen ? { selected: chalk(oos[selected], chosen.tau), uncalibrated_same_tau: chalk(oos.uncalibrated, chosen.tau) } : null, frozen };
  console.log('ATP', JSON.stringify({ selected, gain, chosen: chosen && { tau: chosen.tau, n: chosen.graded_calls, hit: chosen.hit_rate, lo: chosen.wilson95[0], gap: chosen.calibration_gap }, ll: Object.fromEntries(Object.entries(pooled).map(([k, v]) => [k, [v.n, v.log_loss, v.ece]])) }));
}

// ---------------- WTA (descriptive, Picker V1 selection window only, V1 frozen) ----------------
{
  const t = await loadTour('WTA');
  const entries = t.entries.filter((e) => e.day < '2025-01-01'); // never the V1 holdout
  t.entries = null;
  const rows = rowsFor(t, entries, PROD.WTA).filter((r) => !r.hold && r.day >= '2023-01-01' && r.day <= '2024-12-31').map((r) => ({ ...r, p: r.pA }));
  out.WTA_chalk = { window: ['2023-01-01', '2024-12-31'], note: 'Picker V1 selection window (already used to choose tau 0.55); descriptive only, V1 unchanged', tau: 0.55, metrics: metrics(rows.filter((r) => !r.void)), outside_chalk: chalk(rows, 0.55) };
  console.log('WTA chalk', JSON.stringify(out.WTA_chalk.outside_chalk));
}

fs.mkdirSync('docs/evidence/atp-recal', { recursive: true });
fs.writeFileSync('docs/evidence/atp-recal/dev-study.json', JSON.stringify(out, null, 1));
if (out.ATP.frozen) fs.writeFileSync('docs/evidence/atp-recal/frozen.json', JSON.stringify(out.ATP.frozen, null, 1));
console.log('frozen', JSON.stringify(out.ATP.frozen));
