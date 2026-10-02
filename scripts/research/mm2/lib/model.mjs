// Matchup Model V2 research — models, splits and metrics (pure; tests/mm2-research.test.js).
// Models are antisymmetric by construction: no intercept, every feature is an A-minus-B difference (or the champion's
// logit), so swapping the listed sides gives exactly 1 - p. Side A/B is the source's listing order and is never a signal.

const sig = (z) => 1 / (1 + Math.exp(-z));
export const ll = (p, y) => -(y ? Math.log(Math.max(1e-12, p)) : Math.log(Math.max(1e-12, 1 - p)));

/**
 * L2-regularised logistic regression without intercept, fitted by Newton/IRLS on standardised features.
 * X: rows of numbers, y: 0/1. lambda applies to the standardised coefficients (sum of squares), scaled by n.
 * Returns { names, mean: 0 (no centring: features are antisymmetric), scale, coef (raw scale), lambda, iterations }.
 */
export function fitLogistic(X, y, names, { lambda = 1, iters = 50, tol = 1e-9 } = {}) {
  const n = X.length; const d = names.length;
  if (!n) throw new Error('empty training set');
  // scale only (centring would break antisymmetry): root mean square of each feature
  const scale = names.map((_, j) => { let s = 0; for (const r of X) s += r[j] * r[j]; const v = Math.sqrt(s / n); return v > 1e-12 ? v : 1; });
  const Z = X.map((r) => r.map((x, j) => x / scale[j]));
  let w = new Array(d).fill(0);
  let it = 0;
  for (; it < iters; it += 1) {
    const g = new Array(d).fill(0);
    const Hm = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < n; i += 1) {
      const z = Z[i]; let s = 0; for (let j = 0; j < d; j += 1) s += w[j] * z[j];
      const p = sig(s); const r = p - y[i]; const q = p * (1 - p);
      for (let j = 0; j < d; j += 1) { g[j] += r * z[j]; const qz = q * z[j]; for (let k = 0; k <= j; k += 1) Hm[j][k] += qz * z[k]; }
    }
    for (let j = 0; j < d; j += 1) { g[j] = g[j] / n + (lambda / n) * w[j]; for (let k = 0; k <= j; k += 1) { Hm[j][k] /= n; Hm[k][j] = Hm[j][k]; } Hm[j][j] += lambda / n; }
    const step = solve(Hm, g);
    let mx = 0;
    for (let j = 0; j < d; j += 1) { w[j] -= step[j]; mx = Math.max(mx, Math.abs(step[j])); }
    if (mx < tol) { it += 1; break; }
  }
  return { names: [...names], scale, coef: w.map((x, j) => x / scale[j]), coef_std: w, lambda, iterations: it, n };
}
function solve(A, b) {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c; for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const v = M[c][c] || 1e-12;
    for (let r = 0; r < n; r += 1) { if (r === c) continue; const f = M[r][c] / v; for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / (M[i][i] || 1e-12));
}
export const predict = (m, x) => sig(m.coef.reduce((s, c, j) => s + c * x[j], 0));

/** Fitted ranking baseline p = rB^c / (rA^c + rB^c), c on a grid by training log loss (as production's backtest). */
export function fitRank(pairs) {
  let best = Infinity; let c = null;
  for (let x = 0.05; x <= 3.001; x += 0.05) { let t = 0; for (const [a, b, y] of pairs) t += ll(b ** x / (a ** x + b ** x), y); if (t < best) { best = t; c = Math.round(x * 100) / 100; } }
  return c;
}
export const rankP = (c, a, b) => b ** c / (a ** c + b ** c);

/**
 * Chronological walk-forward blocks. Every block's training rows are dated strictly before the block's first day;
 * there is no random split anywhere. blocks: [{ name, from, to }] (to exclusive).
 */
export function walkForward(rows, blocks) {
  return blocks.map((b) => ({ ...b, train: rows.filter((r) => r.day < b.from), test: rows.filter((r) => r.day >= b.from && r.day < b.to) }));
}

// ---- metrics ------------------------------------------------------------------------------------------
export const FAV_BANDS = [[0.5, 0.55], [0.55, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.0001]];
export function metrics(ps, ys) {
  const n = ps.length;
  if (!n) return { n: 0 };
  let L = 0; let B = 0; let A = 0;
  for (let i = 0; i < n; i += 1) { L += ll(ps[i], ys[i]); B += (ps[i] - ys[i]) ** 2; A += (ps[i] > 0.5) === (ys[i] === 1) ? 1 : 0; }
  const rel = reliability(ps, ys);
  const ece = rel.reduce((s, b) => s + (b.n ? (b.n / n) * Math.abs(b.predicted - b.observed) : 0), 0);
  const r4 = (x) => Math.round(x * 10000) / 10000;
  return { n, log_loss: r4(L / n), brier: r4(B / n), accuracy: r4(A / n), ece: r4(ece), reliability: rel };
}
/** Favourite-probability bands (10 bands of 0.05, as production's calibration tables). */
export function reliability(ps, ys) {
  const bands = Array.from({ length: 10 }, (_, i) => ({ from: 0.5 + i * 0.05, to: 0.55 + i * 0.05, n: 0, sp: 0, sw: 0 }));
  for (let i = 0; i < ps.length; i += 1) { const f = Math.max(ps[i], 1 - ps[i]); const b = bands[Math.min(9, Math.floor((f - 0.5) / 0.05))]; b.n += 1; b.sp += f; b.sw += ps[i] >= 0.5 ? ys[i] : 1 - ys[i]; }
  return bands.map((b) => ({ from: Math.round(b.from * 100) / 100, to: Math.round(b.to * 100) / 100, n: b.n, predicted: b.n ? Math.round((b.sp / b.n) * 10000) / 10000 : null, observed: b.n ? Math.round((b.sw / b.n) * 10000) / 10000 : null }));
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * Paired cluster bootstrap of the mean log-loss (and Brier) difference challenger - champion on IDENTICAL rows.
 * Clusters = tournament editions (matches in one draw are not independent). Returns delta, 95% CI, P(delta < 0).
 */
export function pairedBootstrap(rows, pc, pk, { reps = 1000, seed = 20261002 } = {}) {
  const byC = new Map();
  rows.forEach((r, i) => { const k = r.edition || r.match_id; if (!byC.has(k)) byC.set(k, []); byC.get(k).push(i); });
  const clusters = [...byC.values()].map((ix) => { let dl = 0; let db = 0; for (const i of ix) { const y = rows[i].y; dl += ll(pc[i], y) - ll(pk[i], y); db += (pc[i] - y) ** 2 - (pk[i] - y) ** 2; } return [dl, db, ix.length]; });
  const tot = clusters.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]);
  const R = rng(seed); const ds = []; const bs = [];
  for (let r = 0; r < reps; r += 1) { let a = 0; let b = 0; let n = 0; for (let k = 0; k < clusters.length; k += 1) { const c = clusters[Math.floor(R() * clusters.length)]; a += c[0]; b += c[1]; n += c[2]; } ds.push(a / n); bs.push(b / n); }
  ds.sort((x, y) => x - y); bs.sort((x, y) => x - y);
  const q = (s, p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r5 = (x) => Math.round(x * 100000) / 100000;
  return { n: rows.length, clusters: clusters.length, reps, seed, delta_log_loss: r5(tot[0] / tot[2]), ci95_log_loss: [r5(q(ds, 0.025)), r5(q(ds, 0.975))], p_improves: Math.round((ds.filter((x) => x < 0).length / reps) * 1000) / 1000, delta_brier: r5(tot[1] / tot[2]), ci95_brier: [r5(q(bs, 0.025)), r5(q(bs, 0.975))] };
}

/** Assert two prediction sets cover exactly the same evaluation ids in the same order. */
export function assertSameRows(a, b) {
  if (a.length !== b.length || a.some((r, i) => r.match_id !== b[i].match_id)) throw new Error('champion and challenger are not evaluated on identical rows');
  return true;
}
