// Tennis DNA v2 — MATCH DNA + PBE Rating. PURE and deterministic. Contract: docs/TENNIS_DNA_CONTRACT.md §v2.
//
// Built only from the canonical singles match ledger (results, sets, games, tiebreaks, dates, surfaces that
// are stored) and ranking lists as they stood at the time. Never reads match statistics (that is technical
// DNA, v1, unchanged) and never estimates a serve/return number from results.
//
// Time rules (no future information):
//   day       = the match's own timestamp date (scheduled_at / started_at); for undated official archive rows,
//               the edition's end_date (the result is known by then at the latest); no date at all -> excluded.
//   as_of D   = EXCLUSIVE: a snapshot at D reads only matches with day < D.
//   rank_day  = edition start_date (the list in force when the tournament began), else the match day. The rank
//               used is the latest list with ranking_date <= rank_day, and only if that list is at most
//               RANK_MAX_AGE_DAYS old; an opponent absent from a list of N players is "outside the top N".
//   ratings   = updated in chronological order; every prediction uses ratings from strictly earlier matches.

export const MATCH_DNA_VERSION = 2;
export const RATING_METHOD_VERSION = 1;
export const RANK_MAX_AGE_DAYS = 28;
const ROUND_ORDER = { 'Q-1': 1, 'Q-2': 2, 'Q-3': 3, 'Q-4': 4, RR: 5, 1: 6, 2: 7, 3: 8, 4: 9, Q: 10, S: 11, F: 12 };
const roundOrder = (r) => ROUND_ORDER[String(r || '').replace(/^M-/, '')] ?? 6;

// ---- ledger -------------------------------------------------------------------------------------------
/**
 * Canonical rows -> ledger entries (singles, completed or retired; walkovers are not played matches).
 * row: { match_id, event_type, round, format_key, status, winner_side, scheduled_at, started_at, surface,
 *        source_family, sets: [{ set_no, games_a, games_b, tb_a, tb_b }], A: pid, B: pid,
 *        edition: { start_date, end_date, competition_key, level, year } }
 */
export function ledgerEntry(r, tourOf) {
  if (!['MS', 'WS'].includes(r.event_type) || !['completed', 'retired'].includes(r.status) || !['A', 'B'].includes(r.winner_side)) return null;
  if (!r.A || !r.B || r.A === r.B) return null;
  const tour = tourOf(r.A);
  if (!tour || tourOf(r.B) !== tour) return null; // never pool tours (a mis-gendered row is dropped, not mixed)
  const ts = r.scheduled_at || r.started_at;
  // a timestamp outside the edition's year +-1 is a source placeholder (ESPN 1900/2050): the edition end date stands in
  const plausible = ts && (!r.edition?.year || Math.abs(Number(String(ts).slice(0, 4)) - r.edition.year) <= 1);
  const day = plausible ? String(ts).slice(0, 10) : r.edition?.end_date || null;
  if (!day) return null;
  const sets = [...(r.sets || [])].sort((a, b) => a.set_no - b.set_no).map((s) => ({ a: s.games_a, b: s.games_b, tbA: s.tb_a, tbB: s.tb_b }));
  const bestOf = /^BO5|^BO5_/.test(r.format_key || '') ? 5 : /^(BO3|DOUBLES_TOUR)/.test(r.format_key || '') ? 3 : null;
  return {
    id: r.match_id, tour, day, rank_day: r.edition?.start_date && r.edition.start_date <= day ? r.edition.start_date : day,
    order: `${day}|${String(roundOrder(r.round)).padStart(2, '0')}|${r.match_id}`, A: r.A, B: r.B, winner: r.winner_side, status: r.status,
    sets, bestOf, surface: r.surface || null, round: r.round, source: r.source_family, level: r.edition?.competition_key || null
  };
}

// ---- ranking at match time ----------------------------------------------------------------------------
/** lists: [{ date, size, ranks: Map(pid -> rank) }] for ONE tour. Returns (pid, day) -> { rank } | { outside } | null. */
export function rankIndex(lists) {
  const sorted = [...lists].sort((a, b) => (a.date < b.date ? -1 : 1));
  const dates = sorted.map((l) => l.date);
  return (pid, day) => {
    let lo = 0;
    let hi = dates.length - 1;
    let at = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (dates[mid] <= day) { at = mid; lo = mid + 1; } else hi = mid - 1; }
    if (at < 0) return null;
    const l = sorted[at];
    if ((Date.parse(day) - Date.parse(l.date)) / 86400e3 > RANK_MAX_AGE_DAYS) return null;
    const r = l.ranks.get(pid);
    return r ? { rank: r, list_date: l.date } : { outside: l.size, list_date: l.date };
  };
}

// ---- PBE Rating (Elo) ---------------------------------------------------------------------------------
export const RATING_VARIANTS = Object.freeze({
  // FiveThirtyEight-style decaying K: new players move fast, established players slowly
  standard: { k: (n) => 250 / (n + 5) ** 0.4, margin: false },
  // same, with K scaled by the game-share margin (capped): tested, published only if it beats standard
  margin: { k: (n) => 250 / (n + 5) ** 0.4, margin: true }
});
const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));

function gameShare(e) {
  let a = 0;
  let b = 0;
  for (const s of e.sets) { a += s.a; b += s.b; }
  return a + b ? a / (a + b) : 0.5;
}

/**
 * Chronological rating run over ONE tour's ledger (sorted by `order`). Retirements do not update ratings
 * (unfinished contests); every other entry updates both players after the prediction is recorded.
 * Returns { ratings: Map(pid -> { r, n, last_day }), pre: Map(matchId -> { ra, rb, na, nb, p }), surface: Map }.
 */
export function ratingRun(ledger, { variant = 'standard', surfaces = true, init = 1500 } = {}) {
  const v = RATING_VARIANTS[variant];
  const ratings = new Map();
  const surf = new Map(); // `${pid}|${surface}` -> { r, n }
  const get = (m, k) => { if (!m.has(k)) m.set(k, { r: init, n: 0, last_day: null }); return m.get(k); };
  const pre = new Map();
  for (const e of ledger) {
    const a = get(ratings, e.A);
    const b = get(ratings, e.B);
    const p = expected(a.r, b.r);
    let ps = null;
    let sa = null;
    let sb = null;
    if (surfaces && e.surface) {
      sa = get(surf, `${e.A}|${e.surface}`);
      sb = get(surf, `${e.B}|${e.surface}`);
      ps = expected((a.r + sa.r) / 2, (b.r + sb.r) / 2);
    }
    pre.set(e.id, { ra: a.r, rb: b.r, na: a.n, nb: b.n, p, ps, nsa: sa?.n ?? null, nsb: sb?.n ?? null });
    if (e.status !== 'completed') continue;
    const won = e.winner === 'A' ? 1 : 0;
    const mult = v.margin ? Math.min(2, 1 + Math.abs(gameShare(e) - 0.5) * 2) : 1;
    const ka = v.k(a.n) * mult;
    const kb = v.k(b.n) * mult;
    a.r += ka * (won - p); b.r += kb * ((1 - won) - (1 - p)); a.n += 1; b.n += 1; a.last_day = e.day; b.last_day = e.day;
    if (sa) { const q = expected(sa.r, sb.r); sa.r += v.k(sa.n) * mult * (won - q); sb.r += v.k(sb.n) * mult * ((1 - won) - (1 - q)); sa.n += 1; sb.n += 1; }
  }
  return { ratings, pre, surface: surf };
}

const ll = (p, y) => -(y ? Math.log(Math.max(1e-9, p)) : Math.log(Math.max(1e-9, 1 - p)));
/**
 * Walk-forward backtest: predictions are always pre-match; evaluation starts at `from` (earlier seasons are
 * burn-in) and needs both players with >= minPrior rated matches. Baselines on the SAME matches: coin (0.5)
 * and, where both players hold a numeric rank at match time, a rank model p = rB^c / (rA^c + rB^c) whose c is
 * fitted on the burn-in seasons only.
 */
export function backtest(ledger, runs, rankAt, { from, minPrior = 10 } = {}) {
  // the rank model's exponent is fitted on the EARLIEST 40% of ranked matches in the window; the rating-vs-rank
  // comparison uses only the later 60% (both models out of sample there)
  const ranked = [];
  for (const e of ledger) {
    if (e.status !== 'completed' || e.day < from) continue;
    const ra = rankAt(e.A, e.rank_day);
    const rb = rankAt(e.B, e.rank_day);
    if (ra?.rank && rb?.rank) ranked.push(e);
  }
  const cut = ranked[Math.floor(ranked.length * 0.4)]?.order ?? null;
  const train = ranked.filter((e) => cut && e.order < cut).map((e) => [rankAt(e.A, e.rank_day).rank, rankAt(e.B, e.rank_day).rank, e.winner === 'A' ? 1 : 0]);
  let c = null;
  let best = Infinity;
  for (let x = 0.05; x <= 3.001 && train.length >= 200; x += 0.05) {
    const loss = train.reduce((t, [a, b, y]) => t + ll(b ** x / (a ** x + b ** x), y), 0);
    if (loss < best) { best = loss; c = Math.round(x * 100) / 100; }
  }
  const out = {};
  for (const [name, run] of Object.entries(runs)) {
    const acc = { n: 0, ll: 0, brier: 0, right: 0, coin_ll: 0, ranked: { n: 0, ll: 0, rank_ll: 0, brier: 0, rank_brier: 0, right: 0, rank_right: 0 }, surface: { n: 0, ll: 0, overall_ll: 0 } };
    for (const e of ledger) {
      if (e.status !== 'completed' || e.day < from) continue;
      const pr = run.pre.get(e.id);
      if (!pr || pr.na < minPrior || pr.nb < minPrior) continue;
      const y = e.winner === 'A' ? 1 : 0;
      acc.n += 1; acc.ll += ll(pr.p, y); acc.brier += (pr.p - y) ** 2; acc.right += (pr.p > 0.5) === (y === 1) ? 1 : 0; acc.coin_ll += Math.log(2);
      const ra = rankAt(e.A, e.rank_day);
      const rb = rankAt(e.B, e.rank_day);
      if (c != null && ra?.rank && rb?.rank && e.order >= cut) {
        const q = rb.rank ** c / (ra.rank ** c + rb.rank ** c);
        const R = acc.ranked;
        R.n += 1; R.ll += ll(pr.p, y); R.rank_ll += ll(q, y); R.brier += (pr.p - y) ** 2; R.rank_brier += (q - y) ** 2; R.right += (pr.p > 0.5) === (y === 1) ? 1 : 0; R.rank_right += (q > 0.5) === (y === 1) ? 1 : 0;
      }
      if (pr.ps != null && pr.nsa >= 5 && pr.nsb >= 5) { acc.surface.n += 1; acc.surface.ll += ll(pr.ps, y); acc.surface.overall_ll += ll(pr.p, y); }
    }
    const r4 = (x) => Math.round(x * 10000) / 10000;
    const R = acc.ranked;
    out[name] = {
      matches: acc.n, log_loss: acc.n ? r4(acc.ll / acc.n) : null, brier: acc.n ? r4(acc.brier / acc.n) : null, accuracy: acc.n ? r4(acc.right / acc.n) : null, coin_log_loss: acc.n ? r4(acc.coin_ll / acc.n) : null,
      vs_rank: R.n ? { rank_model_fit_matches: train.length, matches: R.n, rating_log_loss: r4(R.ll / R.n), rank_log_loss: r4(R.rank_ll / R.n), rating_brier: r4(R.brier / R.n), rank_brier: r4(R.rank_brier / R.n), rating_accuracy: r4(R.right / R.n), rank_accuracy: r4(R.rank_right / R.n), rank_model_c: c } : null,
      surface_blend: acc.surface.n ? { matches: acc.surface.n, blended_log_loss: r4(acc.surface.ll / acc.surface.n), overall_log_loss: r4(acc.surface.overall_ll / acc.surface.n) } : null
    };
  }
  return out;
}

// ---- Match DNA ----------------------------------------------------------------------------------------
/** min_den per metric: below it the value is stored but `insufficient` (never compared). */
export const MATCH_DEFINITIONS = Object.freeze({
  match_win_rate:        { label: 'Match win %', family: 'result_strength', unit: 'ratio', min_den: 10, doc: 'matches won / matches played (completed + retired; walkovers are not played)' },
  set_win_rate:          { label: 'Set win %', family: 'result_strength', unit: 'ratio', min_den: 25, doc: 'completed sets won / completed sets played' },
  game_win_rate:         { label: 'Games won %', family: 'result_strength', unit: 'ratio', min_den: 200, doc: 'games won / games played (every recorded game, including unfinished sets)' },
  straight_sets_win_rate:{ label: 'Straight-sets wins', family: 'result_strength', unit: 'ratio', min_den: 10, doc: 'completed wins without losing a set / completed wins' },
  avg_game_diff:         { label: 'Game differential / match', family: 'result_strength', unit: 'games_per_match', min_den: 10, doc: 'mean (games won - games lost) per completed match' },
  avg_set_diff:          { label: 'Set differential / match', family: 'result_strength', unit: 'sets_per_match', min_den: 10, doc: 'mean (sets won - sets lost) per completed match' },
  deciding_set_win_rate: { label: 'Deciding-set win %', family: 'pressure', unit: 'ratio', min_den: 8, doc: 'deciding sets won / deciding sets played (the last possible set of the format: 3rd of Bo3, 5th of Bo5; completed matches with a known format)' },
  tiebreak_win_rate:     { label: 'Tiebreak win %', family: 'pressure', unit: 'ratio', min_den: 10, doc: 'tiebreak sets won / tiebreak sets played (a 7-6 set, or 13-12 under a 12-all tiebreak rule; unfinished sets excluded)' },
  close_match_win_rate:  { label: 'Close-match win %', family: 'pressure', unit: 'ratio', min_den: 8, doc: 'wins / close matches; close = a completed match that reached its deciding set OR whose total game margin was 2 or fewer' },
  comeback_win_rate:     { label: 'Comeback win % (lost set 1)', family: 'pressure', unit: 'ratio', min_den: 8, doc: 'wins after losing the first set / completed matches in which the first set was lost' },
  first_set_conversion:  { label: 'Won set 1 → won match', family: 'pressure', unit: 'ratio', min_den: 10, doc: 'wins after winning the first set / completed matches in which the first set was won' },
  deciding_set_dependence: { label: 'Wins needing a deciding set', family: 'pressure', unit: 'ratio', min_den: 10, doc: 'completed wins that needed a deciding set / completed wins', comparable: false },
  top10_win_rate:        { label: 'vs top 10', family: 'opponent_quality', unit: 'ratio', min_den: 5, doc: 'wins / matches vs opponents ranked 1-10 on the list in force at match time' },
  top25_win_rate:        { label: 'vs top 25', family: 'opponent_quality', unit: 'ratio', min_den: 5, doc: 'wins / matches vs opponents ranked 1-25 at match time' },
  top50_win_rate:        { label: 'vs top 50', family: 'opponent_quality', unit: 'ratio', min_den: 8, doc: 'wins / matches vs opponents ranked 1-50 at match time' },
  top100_win_rate:       { label: 'vs top 100', family: 'opponent_quality', unit: 'ratio', min_den: 10, doc: 'wins / matches vs opponents ranked 1-100 at match time' },
  outside100_loss_rate:  { label: 'Losses vs outside top 100', family: 'opponent_quality', unit: 'ratio', min_den: 10, lower_is_better: true, doc: 'losses to opponents outside the top 100 at match time / matches vs such opponents (only where a list of at least 100 was in force)' },
  avg_opponent_rank:     { label: 'Average opponent rank', family: 'opponent_quality', unit: 'rank', min_den: 10, lower_is_better: true, doc: 'mean ranking of opponents holding a numeric rank at match time' },
  wins_above_expectation:{ label: 'Wins above expectation / match', family: 'opponent_quality', unit: 'wins_per_match', min_den: 10, doc: 'mean (result - PBE Rating pre-match win probability) over rated completed matches: opponent-adjusted performance' }
});

const conf = (den, minDen, matches) => {
  if (!den || den < minDen) return 'insufficient';
  if (matches < 5 || den < minDen * 2) return 'low';
  if (matches < 15 || den < minDen * 5) return 'medium';
  return 'high';
};
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);

function metric(key, num, den, matches, asOf, extra = {}) {
  const d = MATCH_DEFINITIONS[key];
  const value = den ? num / den : null;
  return { metric_key: key, family: d.family, value: r4(value), unit: d.unit, numerator: den ? r4(num) : null, denominator: den || null, sample_matches: matches, confidence: value == null ? 'insufficient' : conf(den, d.min_den, matches), comparable: d.comparable !== false, lower_is_better: !!d.lower_is_better, definition_version: MATCH_DNA_VERSION, origin: 'pbe_derived', as_of: asOf, ...extra };
}

const isTiebreakSet = (s) => (Math.max(s.a, s.b) === 7 && Math.min(s.a, s.b) === 6) || (Math.max(s.a, s.b) === 13 && Math.min(s.a, s.b) === 12);
const setDone = (s) => { const hi = Math.max(s.a, s.b); const lo = Math.min(s.a, s.b); return (hi >= 6 && hi - lo >= 2) || isTiebreakSet(s); };

/** One player's view of a ledger entry: me/opp oriented. */
function view(e, pid) {
  const me = e.A === pid ? 'A' : 'B';
  const sets = e.sets.map((s) => (me === 'A' ? { my: s.a, op: s.b } : { my: s.b, op: s.a }));
  return { e, won: e.winner === me, opp: me === 'A' ? e.B : e.A, sets };
}

/**
 * Match DNA snapshot for one player at `asOf` (exclusive). entries: that player's ledger entries (any order).
 * rankAt(pid, day) -> { rank } | { outside } | null (tour-specific). pre: Map(matchId -> rating prediction).
 */
export function buildMatchDna(pid, entries, asOf, { rankAt = () => null, pre = null, rating = null } = {}) {
  const ms = entries.filter((e) => e.day < asOf).sort((a, b) => (a.order < b.order ? -1 : 1)).map((e) => view(e, pid));
  const done = ms.filter((v) => v.e.status === 'completed');
  let w = 0; let setsW = 0; let setsP = 0; let gW = 0; let gP = 0; let straight = 0; let decW = 0; let decP = 0; let tbW = 0; let tbP = 0;
  let closeW = 0; let closeP = 0; let cbW = 0; let cbP = 0; let fsW = 0; let fsP = 0; let decDep = 0; let gdiff = 0; let sdiff = 0;
  let bagW = 0; let bagL = 0; let brW = 0; let brL = 0;
  for (const v of ms) {
    if (v.won) w += 1;
    for (const s of v.sets) {
      gW += s.my; gP += s.my + s.op;
      if (setDone({ a: s.my, b: s.op })) {
        setsP += 1; if (s.my > s.op) setsW += 1;
        if (isTiebreakSet({ a: s.my, b: s.op })) { tbP += 1; if (s.my > s.op) tbW += 1; }
        if (s.my === 6 && s.op === 0) bagW += 1; if (s.op === 6 && s.my === 0) bagL += 1;
        if (s.my === 6 && s.op === 1) brW += 1; if (s.op === 6 && s.my === 1) brL += 1;
      }
    }
  }
  for (const v of done) {
    const my = v.sets.filter((s) => s.my > s.op).length;
    const op = v.sets.filter((s) => s.op > s.my).length;
    const games = v.sets.reduce((t, s) => t + s.my - s.op, 0);
    gdiff += games; sdiff += my - op;
    if (v.won && op === 0) straight += 1;
    const deciding = v.e.bestOf && v.sets.length === v.e.bestOf;
    if (deciding) { decP += 1; if (v.won) decW += 1; if (v.won) decDep += 1; }
    if (deciding || Math.abs(games) <= 2) { closeP += 1; if (v.won) closeW += 1; }
    const first = v.sets[0];
    if (first) { if (first.my < first.op) { cbP += 1; if (v.won) cbW += 1; } else if (first.my > first.op) { fsP += 1; if (v.won) fsW += 1; } }
  }
  const wins = done.filter((v) => v.won).length;
  const m = {};
  m.match_win_rate = metric('match_win_rate', w, ms.length, ms.length, asOf);
  m.set_win_rate = metric('set_win_rate', setsW, setsP, ms.length, asOf);
  m.game_win_rate = metric('game_win_rate', gW, gP, ms.length, asOf);
  m.straight_sets_win_rate = metric('straight_sets_win_rate', straight, wins, done.length, asOf);
  m.avg_game_diff = metric('avg_game_diff', gdiff, done.length, done.length, asOf);
  m.avg_set_diff = metric('avg_set_diff', sdiff, done.length, done.length, asOf);
  m.deciding_set_win_rate = metric('deciding_set_win_rate', decW, decP, decP, asOf);
  m.tiebreak_win_rate = metric('tiebreak_win_rate', tbW, tbP, ms.length, asOf);
  m.close_match_win_rate = metric('close_match_win_rate', closeW, closeP, closeP, asOf);
  m.comeback_win_rate = metric('comeback_win_rate', cbW, cbP, cbP, asOf);
  m.first_set_conversion = metric('first_set_conversion', fsW, fsP, fsP, asOf);
  m.deciding_set_dependence = metric('deciding_set_dependence', decDep, wins, wins, asOf);
  // opponent quality: only matches with a valid list in force at match time
  const tiers = { 10: [0, 0], 25: [0, 0], 50: [0, 0], 100: [0, 0] };
  let out100 = [0, 0];
  let rankSum = 0; let rankN = 0; let wae = 0; let waeN = 0;
  for (const v of ms) {
    const r = rankAt(v.opp, v.e.rank_day);
    if (r?.rank) {
      rankSum += r.rank; rankN += 1;
      for (const t of [10, 25, 50, 100]) if (r.rank <= t) { tiers[t][1] += 1; if (v.won) tiers[t][0] += 1; }
      if (r.rank > 100) { out100[1] += 1; if (!v.won) out100[0] += 1; }
    } else if (r?.outside >= 100) { out100[1] += 1; if (!v.won) out100[0] += 1; }
    const p = pre?.get(v.e.id);
    if (p && v.e.status === 'completed' && p.na >= 10 && p.nb >= 10) { const pw = v.e.A === pid ? p.p : 1 - p.p; wae += (v.won ? 1 : 0) - pw; waeN += 1; }
  }
  for (const t of [10, 25, 50, 100]) m[`top${t}_win_rate`] = metric(`top${t}_win_rate`, tiers[t][0], tiers[t][1], tiers[t][1], asOf, { record: { W: tiers[t][0], L: tiers[t][1] - tiers[t][0] } });
  m.outside100_loss_rate = metric('outside100_loss_rate', out100[0], out100[1], out100[1], asOf, { record: { losses: out100[0], matches: out100[1] } });
  m.avg_opponent_rank = metric('avg_opponent_rank', rankSum, rankN, rankN, asOf);
  m.wins_above_expectation = metric('wins_above_expectation', wae, waeN, waeN, asOf);
  // form (informational; dated, never compared)
  const recent = ms.slice(-20);
  const rec = (k) => { const s = ms.slice(-k); return { W: s.filter((v) => v.won).length, L: s.filter((v) => !v.won).length, from: s[0]?.e.day ?? null, to: s.at(-1)?.e.day ?? null }; };
  let streak = 0;
  for (let i = ms.length - 1; i >= 0 && ms[i].won === ms.at(-1).won; i -= 1) streak += 1;
  const yearAgo = new Date(Date.parse(asOf) - 365 * 86400e3).toISOString().slice(0, 10);
  let longest = 0; let run = 0;
  for (const v of ms.filter((x) => x.e.day >= yearAgo)) { run = v.won ? run + 1 : 0; longest = Math.max(longest, run); }
  const rsets = recent.flatMap((v) => v.sets.filter((s) => setDone({ a: s.my, b: s.op })));
  const form = {
    last5: rec(5), last10: rec(10), last20: rec(20),
    rolling20: { matches: recent.length, set_win_rate: rsets.length ? r4(rsets.filter((s) => s.my > s.op).length / rsets.length) : null, game_win_rate: (() => { const g = recent.reduce((t, v) => t + v.sets.reduce((u, s) => u + s.my + s.op, 0), 0); return g ? r4(recent.reduce((t, v) => t + v.sets.reduce((u, s) => u + s.my, 0), 0) / g) : null; })() },
    current_streak: ms.length ? { result: ms.at(-1).won ? 'W' : 'L', length: streak } : null,
    longest_win_streak_52w: longest,
    counts: { bagels_won: bagW, bagels_lost: bagL, breadsticks_won: brW, breadsticks_lost: brL, retirements_in_sample: ms.filter((v) => v.e.status === 'retired').length }
  };
  const surfaces = {};
  for (const v of ms) { const s = v.e.surface || 'unknown'; surfaces[s] = surfaces[s] || { W: 0, L: 0 }; surfaces[s][v.won ? 'W' : 'L'] += 1; }
  return {
    definition_version: MATCH_DNA_VERSION, as_of: asOf, metrics: m, form, surface_record: surfaces, rating,
    sample: { matches: ms.length, completed: done.length, first_day: ms[0]?.e.day ?? null, last_day: ms.at(-1)?.e.day ?? null, sources: [...new Set(ms.map((v) => v.e.source))].sort(), with_opponent_rank: rankN }
  };
}

// ---- population (same tour, same as_of) ------------------------------------------------------------------
export const PERCENTILE_MIN_PEERS = 10;   // Level 2: a percentile needs >= 10 medium/high peers
export const COMPARATIVE_MIN = 30;        // Level 3, PER METRIC: a comparison is published at >= 30 qualified players
const usable = (m) => m && m.value != null && m.comparable && ['medium', 'high'].includes(m.confidence);

/**
 * Mutates each snapshot's metrics: percentile (or null), population_qualified, comparative_published; and the
 * rating's percentile among established active players. Returns { metric: qualified } for the report.
 * Established rating = >= 20 rated matches and a match in the 365 days before as_of; published ratings only.
 */
export function applyPopulation(group, { asOf, ratingPublished = false } = {}) {
  const out = {};
  for (const key of Object.keys(MATCH_DEFINITIONS)) {
    const vals = group.map((g) => g.metrics[key]).filter(usable).map((m) => m.value).sort((a, b) => a - b);
    out[key] = vals.length;
    for (const g of group) {
      const m = g.metrics[key];
      if (!m) continue;
      m.population_qualified = vals.length;
      m.comparative_published = m.comparable && vals.length >= COMPARATIVE_MIN;
      m.percentile = usable(m) && vals.length >= PERCENTILE_MIN_PEERS ? pct(vals, m.value, m.lower_is_better) : null;
    }
  }
  const yearAgo = new Date(Date.parse(asOf) - 365 * 86400e3).toISOString().slice(0, 10);
  const est = (g) => g.metrics._rating && g.metrics._rating.rated_matches >= 20 && (g.provenance.sample.last_day || '') >= yearAgo;
  const rv = group.filter(est).map((g) => g.metrics._rating.value).sort((a, b) => a - b);
  out.pbe_rating = rv.length;
  for (const g of group) {
    const r = g.metrics._rating;
    if (!r) continue;
    r.population_established = rv.length;
    r.established = est(g);
    r.percentile = ratingPublished && est(g) && rv.length >= COMPARATIVE_MIN ? pct(rv, r.value, false) : null;
  }
  return out;
}

function pct(sorted, v, lowerIsBetter) {
  let below = 0;
  for (const x of sorted) if (x < v) below += 1; else break;
  const p = Math.round((below / sorted.length) * 100);
  return lowerIsBetter ? 100 - p : p;
}

/** The player's last `limit` ledger matches before as_of, with the opponent's rank at match time. */
export function recentMatches(pid, entries, asOf, { rankAt = () => null, limit = 40 } = {}) {
  return entries.filter((e) => e.day < asOf).sort((a, b) => (a.order < b.order ? 1 : -1)).slice(0, limit).map((e) => {
    const me = e.A === pid ? 'A' : 'B';
    const opp = me === 'A' ? e.B : e.A;
    const r = rankAt(opp, e.rank_day);
    return { match_id: e.id, day: e.day, opponent: opp, won: e.winner === me, status: e.status, round: e.round, surface: e.surface,
      score: e.sets.map((x) => (me === 'A' ? `${x.a}-${x.b}` : `${x.b}-${x.a}`)).join(' ') + (e.status === 'retired' ? ' ret.' : ''),
      opponent_rank: r?.rank ? { rank: r.rank, list_date: r.list_date } : r?.outside ? { outside: r.outside, list_date: r.list_date } : null };
  });
}
