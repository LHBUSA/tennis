// Tennis matchup simulator — RESEARCH (docs/SIMULATOR.md). PURE.
//
// Two independent solvers over the same point model, which must agree:
//   exact     — a Markov chain point -> game -> tiebreak -> set -> match (closed dynamic programme);
//   simulate  — seeded Monte Carlo that plays every point through the CANONICAL scoring engine
//               (workers/shared/canonical/scoring.js applyPoint), so simulated matches obey exactly the
//               rules live scoring and replay obey.
// Point model: each side wins a point on its own serve with a fixed probability (iid points). That is a
// known simplification (no momentum, no pressure effects) and is stated on every output.

import { FORMATS, resolveFormat, startMatch, applyPoint, setsToWin, other } from '../canonical/scoring.js';

export const SIM_VERSION = 'tennis-sim/0.1.0-research';

/** mulberry32 — small, fast, deterministic; seeds are stored with every simulation row. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- exact solver ------------------------------------------------------------------------------------

/** P(server holds) for serve-point probability p. Ad scoring: closed form; no-ad: deciding point at 3-3. */
export function holdProb(p, noAd = false) {
  const q = 1 - p;
  const toDeuce = 20 * p ** 3 * q ** 3;
  const before = p ** 4 * (1 + 4 * q + 10 * q ** 2);
  return before + toDeuce * (noAd ? p : (p * p) / (1 - 2 * p * q));
}

/** Tiebreak to `to` (win by 2). pA/pB = serve-point win prob of A/B; `first` serves point 1. Returns P(A wins). */
const TB_CACHE = new Map();
export function tiebreakProb(pA, pB, to, first) {
  const ck = `${pA},${pB},${to},${first}`;
  if (TB_CACHE.has(ck)) return TB_CACHE.get(ck);
  if (TB_CACHE.size > 50000) TB_CACHE.clear();
  const memo = new Map();
  const serverAt = (n) => (Math.floor((n + 1) / 2) % 2 === 0 ? first : other(first));
  // Beyond (to-1, to-1) the state repeats every 2 points with the same server pattern: solve the
  // "from level" win probability in closed form for each parity.
  const levelWin = (n) => {
    // two points from level; servers of point n and n+1
    const a1 = serverAt(n) === 'A' ? pA : 1 - pB;
    const a2 = serverAt(n + 1) === 'A' ? pA : 1 - pB;
    const win2 = a1 * a2;
    const lose2 = (1 - a1) * (1 - a2);
    return win2 / (win2 + lose2);
  };
  const f = (a, b) => {
    if (a >= to && a - b >= 2) return 1;
    if (b >= to && b - a >= 2) return 0;
    if (a === b && a >= to - 1) return levelWin(a + b);
    const k = `${a},${b}`;
    if (memo.has(k)) return memo.get(k);
    const n = a + b;
    const pa = serverAt(n) === 'A' ? pA : 1 - pB;
    const v = pa * f(a + 1, b) + (1 - pa) * f(a, b + 1);
    memo.set(k, v);
    return v;
  };
  const v = f(0, 0);
  TB_CACHE.set(ck, v);
  return v;
}

/**
 * One set. Returns a distribution over outcomes { winner, games:{A,B}, next_first_server, tiebreak }
 * as [{ prob, winner, gA, gB, next, tb }].
 */
function setDist(pA, pB, format, idx, first) {
  const final = idx === format.best_of - 1;
  const mode = final ? format.final_set.mode : 'tiebreak';
  const holdA = holdProb(pA, format.no_ad);
  const holdB = holdProb(pB, format.no_ad);
  if (mode === 'match_tiebreak') {
    const w = tiebreakProb(pA, pB, format.final_set.tiebreak_to, first);
    return [{ prob: w, winner: 'A', gA: 1, gB: 0, next: null, tb: true }, { prob: 1 - w, winner: 'B', gA: 0, gB: 1, next: null, tb: true }];
  }
  const G = format.games_per_set;
  const TB = format.tiebreak_at;
  const out = new Map();
  const add = (k, o, p) => { const e = out.get(k); if (e) e.prob += p; else out.set(k, { ...o, prob: p }); };
  // forward propagation over game scores
  let frontier = new Map([['0,0', 1]]);
  for (let step = 0; step < 60 && frontier.size; step += 1) {
    const nextF = new Map();
    for (const [k, pr] of frontier) {
      const [a, b] = k.split(',').map(Number);
      const server = (a + b) % 2 === 0 ? first : other(first);
      if (mode !== 'advantage' && a === TB && b === TB) {
        const to = final ? format.final_set.tiebreak_to : format.tiebreak_to;
        const w = tiebreakProb(pA, pB, to, server);
        const nx = other(server); // receiver of the tiebreak's first point serves the next set
        add(`A,${a + 1},${b},tb`, { winner: 'A', gA: a + 1, gB: b, next: nx, tb: true }, pr * w);
        add(`B,${a},${b + 1},tb`, { winner: 'B', gA: a, gB: b + 1, next: nx, tb: true }, pr * (1 - w));
        continue;
      }
      const pWinA = server === 'A' ? holdA : 1 - holdB;
      for (const [na, nb, pp] of [[a + 1, b, pWinA], [a, b + 1, 1 - pWinA]]) {
        const hi = Math.max(na, nb);
        const lead = Math.abs(na - nb);
        const done = mode === 'advantage' ? hi >= G && lead >= 2 : hi >= G && lead >= 2 && hi <= TB + 1;
        const nextServer = (na + nb) % 2 === 0 ? first : other(first);
        if (done) add(`${na > nb ? 'A' : 'B'},${na},${nb}`, { winner: na > nb ? 'A' : 'B', gA: na, gB: nb, next: nextServer, tb: false }, pr * pp);
        else nextF.set(`${na},${nb}`, (nextF.get(`${na},${nb}`) || 0) + pr * pp);
      }
    }
    frontier = nextF;
  }
  return [...out.values()];
}

/** Exact match outcome: P(A wins) plus set-score distribution. */
export function exact({ pA, pB, format: f = 'BO3_TB7', firstServer = 'A' }) {
  const format = resolveFormat(f);
  const need = setsToWin(format);
  const setScores = {};
  let winA = 0;
  let tbAny = 0;
  const go = (sA, sB, idx, first, pr, sawTb) => {
    if (pr < 1e-15) return;
    if (sA === need || sB === need) {
      if (sA === need) winA += pr;
      setScores[`${sA}-${sB}`] = (setScores[`${sA}-${sB}`] || 0) + pr;
      if (sawTb) tbAny += pr;
      return;
    }
    for (const o of setDist(pA, pB, format, idx, first)) go(sA + (o.winner === 'A'), sB + (o.winner === 'B'), idx + 1, o.next, pr * o.prob, sawTb || o.tb);
  };
  go(0, 0, 0, firstServer, 1, false);
  return { p_a_wins: winA, set_scores: setScores, p_any_tiebreak: tbAny };
}

// ---- Monte Carlo on the canonical engine --------------------------------------------------------------

export function simulate({ pA, pB, format = 'BO3_TB7', iterations = 10000, seed = 1, firstServer = null }) {
  if (!(pA > 0 && pA < 1 && pB > 0 && pB < 1)) throw new Error('serve-point probabilities must be in (0,1)');
  const r = rng(seed);
  let winA = 0;
  const setScores = {};
  const totalGames = {};
  let tb = 0;
  let points = 0;
  for (let i = 0; i < iterations; i += 1) {
    // The toss is not a model input: alternate first server unless the caller pins it.
    let s = startMatch(format, firstServer || (i % 2 === 0 ? 'A' : 'B'));
    while (s.status === 'in_progress') s = applyPoint(s, r() < (s.server === 'A' ? pA : 1 - pB) ? 'A' : 'B');
    if (s.winner === 'A') winA += 1;
    const k = `${s.sets_won.A}-${s.sets_won.B}`;
    setScores[k] = (setScores[k] || 0) + 1;
    const g = s.sets.reduce((t, x) => t + x.games.A + x.games.B, 0);
    totalGames[g] = (totalGames[g] || 0) + 1;
    if (s.sets.some((x) => x.tiebreak)) tb += 1;
    points += s.points_played;
  }
  const p = winA / iterations;
  const norm = (o) => Object.fromEntries(Object.entries(o).sort().map(([k, v]) => [k, v / iterations]));
  return {
    p_a_wins: p, se: Math.sqrt((p * (1 - p)) / iterations), set_scores: norm(setScores), total_games: norm(totalGames),
    p_any_tiebreak: tb / iterations, mean_points: points / iterations, iterations, seed, format: typeof format === 'string' ? format : 'custom'
  };
}

// ---- point model from point-in-time features ---------------------------------------------------------

/**
 * Serve-point probabilities from each player's serve and return points won (point-in-time, pre-match),
 * shrunk toward the tour mean by sample size, then combined additively around the tour average
 * (Barnett & Clarke 2005 style): pA = mu + (sA - mu) - (rB - (1 - mu)).
 */
export function pointModel({ a, b, mu = 0.56, k = 400 }) {
  const shrink = (x, n, m) => (x == null || !n ? m : (x * n + m * k) / (n + k));
  const sA = shrink(a.serve_won, a.serve_n, mu);
  const sB = shrink(b.serve_won, b.serve_n, mu);
  const rA = shrink(a.return_won, a.return_n, 1 - mu);
  const rB = shrink(b.return_won, b.return_n, 1 - mu);
  const clip = (x) => Math.min(0.9, Math.max(0.3, x));
  return { pA: clip(mu + (sA - mu) - (rB - (1 - mu))), pB: clip(mu + (sB - mu) - (rA - (1 - mu))) };
}

export { FORMATS };
