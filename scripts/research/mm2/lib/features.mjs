// Matchup Model V2 research — FROZEN feature definitions (FEATURE_VERSION) and the strictly as-of dataset rows.
//
// Champion (production PBE Rating, method_version 1) is reproduced with the production rating run and the production
// serving rule (tennis-api matchup.js modelBlock): ratings rounded as served, both players >= MIN_PRIOR (10) rated
// matches, surface blend only when the tour publishes it and both players hold >= 5 surface-rated matches.
//
// Challenger features use ONLY a player's ledger matches dated strictly BEFORE the match day (day < e.day): a
// same-day earlier round is excluded because the ledger's time-of-day ordering is not proven for every source. No
// ranking, DNA snapshot, profile, H2H, name, nationality, tournament name, seed, editorial or market input is read.
// Retirements never update a profile (unfinished contest) but count as activity. Missing stays missing: a technical
// feature is null unless BOTH players qualify, and the row is then outside Challenger C (never imputed).
import { ratingRun } from '../../../../workers/shared/dna/match-dna.js';
import { FEATURE_VERSION, FEATURES_B, FEATURES_C, recordsOf, profileFrom, featuresB, dayNum } from '../../../../workers/shared/research/mm2-profile.js';

export { FEATURE_VERSION, FEATURES_B, FEATURES_C };
export const MIN_PRIOR = 10;
export const SURFACE_MIN = 5;
export const VARIANT = { ATP: 'standard', WTA: 'margin' };       // dna:v2:summary (2026-10-02 build): the served variant
export const SURFACE_PUBLISHED = { ATP: true, WTA: true };       // same build
// technical (Challenger C)
const TECH_MIN_MATCHES = 5;
const TECH_MIN_POINTS = 200;
const TECH_PRIOR = { serve: 0.56, ret: 0.44, bps: 0.58, bpc: 0.42 };
const TECH_K_POINTS = 200;
const TECH_K_BP = 20;

const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));

/** Champion probability (production serving rule) for ledger position i; null when production would publish none. */
export function championAt(run, e, i, tour) {
  const pr = run.pre.get(e);
  if (!pr || pr.na < MIN_PRIOR || pr.nb < MIN_PRIOR) return null;
  const ra = Math.round(pr.ra); const rb = Math.round(pr.rb);
  const overall = expected(ra, rb);
  const s = e.surface ? run.pre.surface(e) : null;
  const blend = !!(s && SURFACE_PUBLISHED[tour] && s.nsa >= SURFACE_MIN && s.nsb >= SURFACE_MIN);
  const p = blend ? expected((ra + Math.round(s.sra)) / 2, (rb + Math.round(s.srb)) / 2) : overall;
  return { p, overall, blend, na: pr.na, nb: pr.nb, surf: blend ? { sra: Math.round(s.sra), srb: Math.round(s.srb) } : null, ra, rb };
}

/** Per-player tech aggregate from stats of strictly earlier matches. */
function techOf(t) {
  if (!t || t.m < TECH_MIN_MATCHES || t.sp < TECH_MIN_POINTS || t.rp < TECH_MIN_POINTS) return null;
  return {
    serve: (t.spw + TECH_K_POINTS * TECH_PRIOR.serve) / (t.sp + TECH_K_POINTS),
    ret: (t.rpw + TECH_K_POINTS * TECH_PRIOR.ret) / (t.rp + TECH_K_POINTS),
    bps: (t.bps + TECH_K_BP * TECH_PRIOR.bps) / (t.bpf + TECH_K_BP),
    bpc: (t.bpc + TECH_K_BP * TECH_PRIOR.bpc) / (t.bpo + TECH_K_BP)
  };
}

/**
 * Build dataset rows for one tour. entries: sorted ledger (loadTour). stats: Map(match_id -> { A: arr, B: arr }) where
 * arr = [service_points, first_in, first_won, second_won, bp_faced, bp_saved, aces, dfs]. Returns { rows, exclusions }.
 * Every completed entry with a champion probability gets a row (role decided later by the time windows).
 */
export function buildRows(tour, entries, { stats = new Map(), run = null } = {}) {
  run ||= ratingRun(entries, { variant: VARIANT[tour] });
  const hist = new Map(); // pid -> array of records (chronological)
  const tech = new Map(); // pid -> { m, sp, spw, rp, rpw, bpf, bps, bpo, bpc, days: [] } with per-match deltas for as-of
  const H = (pid) => { let h = hist.get(pid); if (!h) { h = []; hist.set(pid, h); } return h; };
  const rows = [];
  const exclusions = { retired_not_graded: 0, insufficient_history: 0 };
  // tech records are appended per match; the as-of aggregate is recomputed from records with day < e.day
  const T = (pid) => { let t = tech.get(pid); if (!t) { t = []; tech.set(pid, t); } return t; };
  const techAsOf = (pid, day) => {
    const arr = tech.get(pid);
    if (!arr) return null;
    const a = { m: 0, sp: 0, spw: 0, rp: 0, rpw: 0, bpf: 0, bps: 0, bpo: 0, bpc: 0 };
    for (const r of arr) { if (r.day >= day) break; a.m += 1; a.sp += r.sp; a.spw += r.spw; a.rp += r.rp; a.rpw += r.rpw; a.bpf += r.bpf; a.bps += r.bps; a.bpo += r.bpo; a.bpc += r.bpc; }
    return techOf(a);
  };
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const dnum = dayNum(e.day);
    const pr = run.pre.get(e);
    if (e.status === 'completed') {
      const ch = championAt(run, e, i, tour);
      if (!ch) exclusions.insufficient_history += 1;
      else {
        const a = profileFrom(hist.get(e.A) || [], dnum);
        const b = profileFrom(hist.get(e.B) || [], dnum);
        const ta = techAsOf(e.A, e.day);
        const tb = techAsOf(e.B, e.day);
        const techBoth = !!(ta && tb);
        const f = { ...featuresB(ch.p, ch.surf, a, b), serve: techBoth ? ta.serve - tb.serve : null, ret: techBoth ? ta.ret - tb.ret : null, bps: techBoth ? ta.bps - tb.bps : null, bpc: techBoth ? ta.bpc - tb.bpc : null };
        const iso = (n) => (n == null ? null : new Date(n * 86400e3).toISOString().slice(0, 10));
        const asOf = [a.last_dnum, b.last_dnum].filter((x) => x != null).sort((x, y) => x - y).map(iso).at(-1) || null;
        rows.push({ match_id: e.id, tour, day: e.day, ro: e.ro, edition: e.edition, surface: e.surface || 'unknown', level: e.level || 'unknown', round: e.round ?? null,
          y: e.winner === 'A' ? 1 : 0, champion: ch.p, overall: ch.overall, blend: ch.blend, na: ch.na, nb: ch.nb, tech: techBoth, feature_as_of: asOf, f });
      }
    } else exclusions.retired_not_graded += 1;
    // AFTER the row: this match enters both players' histories (later matches only; the strict day filter also
    // keeps it out of any same-day match)
    if (pr) {
      const [ra, rb] = recordsOf(e, pr.p, pr.ra, pr.rb);
      H(e.A).push(ra);
      H(e.B).push(rb);
    }
    const st = stats.get(e.id);
    if (st?.A && st?.B && !e.status.startsWith('walk')) {
      const rec = (me, op) => ({ day: e.day, sp: me[0], spw: me[2] + me[3], rp: op[0], rpw: op[0] - (op[2] + op[3]), bpf: me[4], bps: me[5], bpo: op[4], bpc: op[4] - op[5] });
      if ([...st.A, ...st.B].slice(0, 6).every((x) => Number.isFinite(x)) && st.A[0] > 0 && st.B[0] > 0) { T(e.A).push(rec(st.A, st.B)); T(e.B).push(rec(st.B, st.A)); }
    }
  }
  return { rows, exclusions, run };
}
