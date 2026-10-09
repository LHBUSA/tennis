// ATP recalibration map (Tennis Picks V2, docs/research/PICKS_V2_PROTOCOL.md section 1). PURE and monotone: it maps the
// production PBE Rating probability of side A to a recalibrated probability. It never changes the PBE Rating itself or
// the probability the product publishes; it is used only by the ATP SHADOW ledger. Coefficients come from the frozen
// study output docs/evidence/atp-recal/frozen.json (copied into ATP_RECAL below, sha-checked by tests).
export const logit = (p) => Math.log(p / (1 - p));
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clip = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));

/** { method, params } + pA -> recalibrated pA. Symmetric: f(1 - p) = 1 - f(p). */
export function applyRecal(fit, pA) {
  if (!Number.isFinite(pA)) return null;
  const p = clip(pA);
  if (fit.method === 'temperature') return sigmoid(logit(p) / fit.params.T);
  if (fit.method === 'platt') {
    // fitted on both orientations, so b is ~0; apply symmetrically: average of the two orientations
    const a = fit.params.a, b = fit.params.b;
    return (sigmoid(a * logit(p) + b) + (1 - sigmoid(a * logit(1 - p) + b))) / 2;
  }
  if (fit.method === 'isotonic') {
    const favA = p >= 0.5, pf = favA ? p : 1 - p;
    const { x, y } = fit.params;
    let f;
    if (pf <= x[0]) f = y[0];
    else if (pf >= x[x.length - 1]) f = y[y.length - 1];
    else { let i = 1; while (x[i] < pf) i += 1; const t = (pf - x[i - 1]) / (x[i] - x[i - 1]); f = y[i - 1] + t * (y[i] - y[i - 1]); }
    f = Math.max(0.5, Math.min(1 - 1e-4, f));
    return favA ? f : 1 - f;
  }
  if (fit.method === 'identity') return p;
  throw new Error(`unknown recalibration method ${fit.method}`);
}
