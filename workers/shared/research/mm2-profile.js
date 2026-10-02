// Matchup Model V2 RESEARCH — the frozen per-player profile and feature definitions (mm2-features/1), shared by the
// offline research dataset (scripts/research/mm2) and the research-only shadow lane. PURE. Never read by an API route:
// nothing here changes a published PBE Rating probability (tests/mm2-research.test.js).
//
// A player record is one of the player's ledger matches, from that player's view. profileFrom() uses ONLY records
// dated strictly before the match day; retirements count as activity but never update a profile.

export const FEATURE_VERSION = 'mm2-features/1';
export const FEATURES_B = ['L', 'surf_edge', 'form', 'opp', 'act30', 'rest', 'dec', 'tb', 'ss', 'fsc', 'cb'];
export const FEATURES_TECH = ['serve', 'ret', 'bps', 'bpc'];
export const FEATURES_C = [...FEATURES_B, ...FEATURES_TECH];
export const FORM_N = 10;   // wins above expectation: last 10 completed matches, shrunk by +5 pseudo-matches at 0
export const OPP_N = 20;    // opponent strength: mean pre-match opponent rating, last 20 completed matches
export const PROF_N = 60;   // set-profile window: last 60 completed matches
export const K = 10;        // set-profile shrinkage pseudo-count
export const PRIOR = Object.freeze({ dec: 0.5, tb: 0.5, ss: 0.6, fsc: 0.8, cb: 0.2 });

export const dayNum = (d) => Math.floor(Date.parse(d) / 86400e3);
export const logit = (p) => Math.log(p / (1 - p));
export const clampP = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));

/** Sets of a ledger entry from A's view (games per set only). */
export function setInfo(sets, bestOf) {
  let sa = 0; let sb = 0; let tbA = 0; let tbB = 0;
  for (const s of sets) { if (s.a > s.b) sa += 1; else if (s.b > s.a) sb += 1; if ((s.a === 7 && s.b === 6) || (s.a === 6 && s.b === 7)) { if (s.a > s.b) tbA += 1; else tbB += 1; } }
  const toWin = bestOf ? (bestOf + 1) / 2 : Math.max(sa, sb);
  // deciding set played: the loser won exactly one set fewer than needed (e.g. 2-1 in best of 3, 3-2 in best of 5)
  return { sa, sb, decider: toWin > 1 && Math.max(sa, sb) === toWin && Math.min(sa, sb) === toWin - 1, tbA, tbB, firstA: sets[0] ? sets[0].a > sets[0].b : null };
}

/**
 * The two player records of one ledger entry. pA = the champion's pre-match probability for A (rating run, overall);
 * ra/rb = pre-match ratings. Returns [recordForA, recordForB]. Compact arrays:
 * [dnum, retired, won, pexp, oppR, decider, tbW, tbL, straight, first(1|0|-1)]
 */
export function recordsOf(e, pA, ra, rb) {
  const si = setInfo(e.sets, e.bestOf);
  const dn = dayNum(e.day);
  const ret = e.status !== 'completed' ? 1 : 0;
  const fA = si.firstA == null ? -1 : si.firstA ? 1 : 0;
  const fB = si.firstA == null ? -1 : si.firstA ? 0 : 1;
  return [
    [dn, ret, e.winner === 'A' ? 1 : 0, pA, rb, si.decider ? 1 : 0, si.tbA, si.tbB, e.winner === 'A' && si.sb === 0 ? 1 : 0, fA],
    [dn, ret, e.winner === 'B' ? 1 : 0, 1 - pA, ra, si.decider ? 1 : 0, si.tbB, si.tbA, e.winner === 'B' && si.sa === 0 ? 1 : 0, fB]
  ];
}

/** Profile of one player for a match on day number `dnum`, from that player's chronological records (strictly earlier days). */
export function profileFrom(recs, dnum) {
  let j = recs.length - 1;
  while (j >= 0 && recs[j][0] >= dnum) j -= 1;
  const last = j >= 0 ? recs[j][0] : null;
  let act30 = 0;
  for (let k = j; k >= 0 && dnum - recs[k][0] <= 30; k -= 1) act30 += 1;
  const rest = j >= 0 ? Math.min(365, dnum - recs[j][0]) : 365;
  let wae = 0; let nf = 0; let opp = 0; let no = 0; let np = 0;
  const c = { dec: [0, 0], tb: [0, 0], ss: [0, 0], fsc: [0, 0], cb: [0, 0] };
  for (let k = j; k >= 0 && np < PROF_N; k -= 1) {
    const [, ret, won, pexp, oppR, dec, tbW, tbL, straight, first] = recs[k];
    if (ret) continue;
    if (nf < FORM_N) { wae += won - pexp; nf += 1; }
    if (no < OPP_N) { opp += oppR; no += 1; }
    np += 1;
    if (dec) { c.dec[1] += 1; if (won) c.dec[0] += 1; }
    c.tb[0] += tbW; c.tb[1] += tbW + tbL;
    if (won) { c.ss[1] += 1; if (straight) c.ss[0] += 1; }
    if (first === 1) { c.fsc[1] += 1; if (won) c.fsc[0] += 1; }
    if (first === 0) { c.cb[1] += 1; if (won) c.cb[0] += 1; }
  }
  const sh = (k) => (c[k][0] + K * PRIOR[k]) / (c[k][1] + K);
  return { last_dnum: last, act30, rest, form: wae / (nf + 5), opp: no ? opp / no : null, dec: sh('dec'), tb: sh('tb'), ss: sh('ss'), fsc: sh('fsc'), cb: sh('cb') };
}

/** Challenger B feature vector from the champion probability, the surface ratings it used (or null) and two profiles. */
export function featuresB(champP, surf, a, b) {
  return {
    L: logit(clampP(champP)),
    surf_edge: surf ? (surf.sra - surf.srb) / 400 : 0, // withheld surface -> 0 (never inferred)
    form: a.form - b.form,
    opp: a.opp != null && b.opp != null ? (a.opp - b.opp) / 400 : 0,
    act30: Math.log1p(a.act30) - Math.log1p(b.act30),
    rest: Math.log1p(a.rest) - Math.log1p(b.rest),
    dec: a.dec - b.dec, tb: a.tb - b.tb, ss: a.ss - b.ss, fsc: a.fsc - b.fsc, cb: a.cb - b.cb
  };
}

/** Probability of A from a frozen coefficient set { names, coef } (antisymmetric: no intercept). */
export function predictFrom(model, f) {
  let z = 0;
  model.names.forEach((k, j) => { z += model.coef[j] * f[k]; });
  return 1 / (1 + Math.exp(-z));
}
