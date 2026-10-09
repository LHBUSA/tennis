// Candidate recalibration methods (closed list, ATP_RECALIBRATION_PROTOCOL.md / PICKS_V2_PROTOCOL.md): fitting here,
// applying through the Worker's own pure function so research and production use identical arithmetic.
import { applyRecal, logit, sigmoid } from '../../../workers/tennis-api/src/recal.js';
export { logit };
export const METHODS = ['temperature', 'platt', 'isotonic'];
const clip = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const r6 = (x) => Math.round(x * 1e6) / 1e6;

function nll(items, f) { let s = 0; for (const { p, y } of items) { const q = clip(f(p)); s += -(y ? Math.log(q) : Math.log(1 - q)); } return s / items.length; }

function fitTemperature(items) {
  let lo = Math.log(0.3), hi = Math.log(3);
  const g = (lt) => nll(items, (p) => sigmoid(logit(clip(p)) / Math.exp(lt)));
  for (let i = 0; i < 80; i += 1) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (g(m1) < g(m2)) hi = m2; else lo = m1; }
  return { T: r6(Math.exp((lo + hi) / 2)) };
}

function fitPlatt(items) { // both orientations; Newton on (a, b)
  let a = 1, b = 0;
  for (let it = 0; it < 50; it += 1) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (const { p, y } of items) for (const [x, t] of [[logit(clip(p)), y], [logit(clip(1 - p)), 1 - y]]) {
      const q = sigmoid(a * x + b), w = q * (1 - q);
      ga += (q - t) * x; gb += (q - t); haa += w * x * x; hab += w * x; hbb += w;
    }
    const det = haa * hbb - hab * hab;
    const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
    a -= da; b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-10) break;
  }
  return { a: r6(a), b: r6(b) };
}

function fitIsotonic(items, nb = 20) {
  const fav = items.map(({ p, y }) => (p >= 0.5 ? { x: p, w: y } : { x: 1 - p, w: 1 - y })).sort((u, v) => u.x - v.x);
  const blocks = [];
  for (let i = 0; i < nb; i += 1) {
    const s = fav.slice(Math.floor((i * fav.length) / nb), Math.floor(((i + 1) * fav.length) / nb));
    if (!s.length) continue;
    blocks.push({ x: s.reduce((t, r) => t + r.x, 0) / s.length, y: s.reduce((t, r) => t + r.w, 0) / s.length, n: s.length });
  }
  // pool adjacent violators (non-decreasing in x)
  const st = [];
  for (const b of blocks) {
    st.push({ ...b, xs: [b.x] });
    while (st.length > 1 && st[st.length - 2].y > st[st.length - 1].y) {
      const q = st.pop(), p = st.pop();
      const n = p.n + q.n;
      st.push({ x: (p.x * p.n + q.x * q.n) / n, y: (p.y * p.n + q.y * q.n) / n, n, xs: [...p.xs, ...q.xs] });
    }
  }
  // one knot per original bin centre, carrying its pooled value
  const x = [], y = [];
  for (const b of st) for (const bx of b.xs) { x.push(r6(bx)); y.push(r6(b.y)); }
  return { x, y };
}

export function fitMethod(method, items) {
  const params = method === 'temperature' ? fitTemperature(items) : method === 'platt' ? fitPlatt(items) : fitIsotonic(items);
  const summary = method === 'isotonic' ? { knots: params.x.length, y_first: params.y[0], y_last: params.y.at(-1) } : params;
  return { method, params, summary };
}
export const applyMethod = (fit, p) => applyRecal(fit, p);
