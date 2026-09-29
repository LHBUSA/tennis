// Tennis DNA v2 build (Match DNA + PBE Rating). docs/TENNIS_DNA_CONTRACT.md §v2.
// Reads the canonical singles ledger + ranking lists, runs the chronological rating per tour with a walk-forward
// backtest, and writes tennis_dna_snapshots (definition_version 2, surface 'all') and tennis_surface_ratings
// (method_version 1). v1 snapshots are never touched. Deterministic: same store -> same rows.

import { atpTierIndex, TIER_KEY } from '../../shared/atp-tiers.js';
import { inList } from '../../shared/store/postgrest.js';
import { loadTourLedger, cachedRankRows } from './dna-cache.js';
import { ledgerEntry, byOrder, rankIndex, ratingRun, backtest, buildMatchDna, populationIndex, applyPopulationOne, slimForPopulation, recentMatches, buildProfile, PROFILE_VERSION, MATCH_DNA_VERSION, RATING_METHOD_VERSION } from '../../shared/dna/match-dna.js';

const BUILDER = 'tennis-ingest dna-v2-job 1.0';
// rating history is stored for players active in the 365 days before as_of (inactive careers keep their splits)
const yearBefore = (asOf) => new Date(Date.parse(asOf) - 365 * 86400e3).toISOString().slice(0, 10);
// burn-in seasons before evaluation starts (ATP ledger from 2007; WTA from 2020)
const BACKTEST_FROM = { ATP: '2012-01-01', WTA: '2023-01-01' };
const MIN_EVAL = 500;
// surface Match DNA (as_of = the build's first date only): a player needs >= 5 matches on the surface
export const SURFACES = ['hard', 'clay', 'grass'];
const SURFACE_MIN_MATCHES = 5;

async function all(store, table, query, page = 1000) {
  const out = [];
  for (let off = 0; ; off += page) {
    const rows = await store.select(table, `${query}&limit=${page}&offset=${off}`);
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

export async function loadRankLists(ctx, listKey, { mode = 'auto' } = {}) {
  const store = ctx.store;
  const snaps = await all(store, 'tennis_ranking_snapshots', `select=snapshot_id,ranking_date,row_count,source_family&list_key=eq.${listKey}&row_count=gt.0&order=ranking_date.asc`);
  // an official list within 6 days of a secondary (espn) list replaces it: official precedence at match time
  const official = snaps.filter((s) => s.source_family !== 'espn').map((s) => Date.parse(s.ranking_date));
  const keep = snaps.filter((s) => s.source_family !== 'espn' || !official.some((d) => Math.abs(d - Date.parse(s.ranking_date)) <= 6 * 86400e3));
  // batches whose row counts sum to <= 1000 (one page each); a list larger than a page is paged on its own.
  // (Before 2026-09-28 six lists shared one 1000-row page: the ~1,570-row official WTA lists were truncated.)
  const fetchRanks = async (list) => {
    const out = new Map(list.map((s) => [s.snapshot_id, []]));
    const batches = [];
    let cur = [];
    let rows = 0;
    for (const s of list) {
      if (s.row_count > 1000) { batches.push([s]); continue; }
      if (rows + s.row_count > 1000) { batches.push(cur); cur = []; rows = 0; }
      cur.push(s); rows += s.row_count;
    }
    if (cur.length) batches.push(cur);
    for (const b of batches) {
      for (const r of await all(store, 'tennis_rankings', `select=snapshot_id,pbe_player_id,rank&snapshot_id=${inList(b.map((s) => s.snapshot_id))}&pbe_player_id=not.is.null&order=snapshot_id.asc,rank.asc,pbe_player_id.asc`)) out.get(r.snapshot_id).push([r.pbe_player_id, r.rank]);
    }
    return out;
  };
  const { ranks, info } = await cachedRankRows(ctx, listKey, keep, fetchRanks, { mode });
  const lists = keep.map((s) => ({ date: s.ranking_date, size: s.row_count, ranks: new Map(ranks.get(s.snapshot_id)), source: s.source_family }));
  lists.info = info;
  return lists;
}

/**
 * Build and store v2 snapshots for `asOfs` (default: today). Returns a summary incl. the backtest.
 * write=false computes everything and returns the summary only (research / dry run).
 */
export async function buildDnaV2(ctx, { asOfs = [new Date().toISOString().slice(0, 10)], write = true, mode = 'auto' } = {}) {
  const t0 = Date.now();
  const store = ctx.store;
  const phase = {};
  let tp = Date.now();
  const mark = (k) => { phase[k] = Date.now() - tp; tp = Date.now(); };
  let gender = new Map((await all(store, 'tennis_players', 'select=pbe_player_id,gender&status=eq.active&order=pbe_player_id.asc')).map((p) => [p.pbe_player_id, p.gender]));
  const tourOf = (pid) => (gender.get(pid) === 'M' ? 'ATP' : gender.get(pid) === 'F' ? 'WTA' : null);
  // opponent handedness for the vs-left/right split: stored bio only (unsourced = unknown, never guessed)
  const hand = new Map((await all(store, 'tennis_players', 'select=pbe_player_id,plays&plays=in.(left,right)&order=pbe_player_id.asc')).map((p) => [p.pbe_player_id, p.plays]));
  let editions = new Map((await all(store, 'tennis_tournament_editions', 'select=edition_id,start_date,end_date,competition_key,level,year&order=edition_id.asc')).map((e) => [e.edition_id, e]));
  // ESPN ATP editions carry no level: the reviewed ATP tier registry (workers/shared/atp-tiers.js) classifies the ones it
  // lists, in memory only, for the tournament-level split. Unlisted / unreviewed seasons stay unclassified.
  const tiers = await atpTierIndex();
  for (const [id, e] of editions) if (!e.competition_key && tiers.has(id)) editions.set(id, { ...e, competition_key: TIER_KEY[tiers.get(id).tier] });
  mark('players_editions');
  const lists = { ATP: await loadRankLists(ctx, 'atp_singles', { mode }), WTA: await loadRankLists(ctx, 'wta_singles', { mode }) };
  const inputs = { rank_lists: { ATP: lists.ATP.info, WTA: lists.WTA.info }, ledger: {} };
  mark('rank_lists');
  // rank peaks: per player a flat [rank, listNo, rank, listNo, ...] in list order (ATP lists, then WTA lists)
  // (list descriptors only: a tour's rank maps are released once that tour is built)
  const allLists = [];
  for (const [tour, ls] of Object.entries(lists)) for (const l of ls) allLists.push({ l: { date: l.date, source: l.source }, tour });
  const peaks = new Map();
  let li = 0;
  for (const ls of Object.values(lists)) for (const l of ls) { for (const [pid, rank] of l.ranks) { let a = peaks.get(pid); if (!a) { a = []; peaks.set(pid, a); } a.push(rank, li); } li += 1; }
  // best (lowest) rank on any list dated before as_of, earliest date on a tie — first seen wins otherwise
  const peakBefore = (pid, asOf) => {
    const a = peaks.get(pid);
    if (!a) return null;
    let best = null;
    for (let i = 0; i < a.length; i += 2) {
      const { l, tour } = allLists[a[i + 1]];
      if (!(l.date < asOf)) continue;
      if (!best || a[i] < best.rank || (a[i] === best.rank && l.date < best.date)) best = { rank: a[i], date: l.date, source: l.source, tour };
    }
    return best;
  };
  const summary = { builder: BUILDER, definition_version: MATCH_DNA_VERSION, rating_method_version: RATING_METHOD_VERSION, as_of: asOfs, ledger: 0, tours: {} };
  let snapshotCount = 0;
  const ratingRows = [];
  for (const tour of ['ATP', 'WTA']) {
    // one tour in memory at a time: its ledger is loaded here and released when the tour is done
    const tl = Date.now();
    const { entries: L, info } = await loadTourLedger(ctx, tour, { tourOf, editions, mode });
    inputs.ledger[tour] = info;
    phase[`ledger_${tour}`] = Date.now() - tl;
    if (tour === 'WTA') { editions = null; gender = null; } // needed only to build ledgers
    summary.ledger += L.length;
    L.sort(byOrder);
    for (let i = 0; i < L.length; i += 1) L[i].seq = i;
    const rankAt = rankIndex(lists[tour]);
    const runs = { standard: ratingRun(L, { variant: 'standard' }), margin: ratingRun(L, { variant: 'margin' }) };
    const bt = backtest(L, runs, rankAt, { from: BACKTEST_FROM[tour] });
    // choose the variant with the lower out-of-sample log loss; publish only if it beats the coin AND (where a
    // large enough same-match ranking comparison exists) the ranking model
    const variant = (bt.margin.log_loss ?? 9) < (bt.standard.log_loss ?? 9) ? 'margin' : 'standard';
    const b = bt[variant];
    const beatsCoin = b.matches >= MIN_EVAL && b.log_loss < b.coin_log_loss;
    // publication needs an out-of-sample win over the ranking model on the same matches (no benchmark -> held)
    const rankOk = !!b.vs_rank && b.vs_rank.matches >= MIN_EVAL && b.vs_rank.rating_log_loss < b.vs_rank.rank_log_loss;
    const published = beatsCoin && rankOk;
    const surfacePublished = published && !!b.surface_blend && b.surface_blend.matches >= MIN_EVAL && b.surface_blend.blended_log_loss < b.surface_blend.overall_log_loss;
    const run = runs[variant];
    runs[variant === 'margin' ? 'standard' : 'margin'] = null; // the losing variant's predictions are no longer needed
    summary.tours[tour] = { mismatched_rows: L.mismatched, matches: L.length, first_day: L[0]?.day ?? null, last_day: L.at(-1)?.day ?? null, ranking_lists: lists[tour].length, variant, published, surface_published: surfacePublished, backtest: bt };
    const byPlayer = new Map();
    for (const e of L) for (const pid of [e.A, e.B]) { if (!byPlayer.has(pid)) byPlayer.set(pid, []); byPlayer.get(pid).push(e); }
    // one player's full snapshot at asOf (deterministic; computed twice in the two-pass build below)
    const snapshotOf = (pid, entries, asOf) => {
      // rating as of D = the pre-match rating of the player's first match on/after D, else the final rating
      const next = entries.filter((e) => e.day >= asOf).sort(byOrder)[0];
      const pr = next ? run.pre.get(next) : null;
      const fin = run.ratings.get(pid);
      const value = pr ? (next.A === pid ? pr.ra : pr.rb) : fin?.r;
      const n = pr ? (next.A === pid ? pr.na : pr.nb) : fin?.n;
      const rating = n ? { value: Math.round(value), rated_matches: n, method_version: RATING_METHOD_VERSION, variant, published, provisional: n < 20 } : null;
      const dna = buildMatchDna(pid, entries, asOf, { rankAt, pre: run.pre, rating });
      dna.form.rank_peak = peakBefore(pid, asOf);
      if (!dna.sample.matches) return null;
      return { next, n, rating, snap: { pbe_player_id: pid, as_of: asOf, surface: 'all', definition_version: MATCH_DNA_VERSION, metrics: { ...dna.metrics, _form: dna.form, _surface_record: dna.surface_record, _rating: rating, _tour: tour }, provenance: { builder: BUILDER, ledger_rule: 'singles completed+retired, dated, same tour', sample: dna.sample, rank_lists: lists[tour].length } } };
    };
    // Players to Watch inputs (as_of = the build's first date): rating now vs 30 / 90 days earlier by the same
    // rule as a snapshot's rating (pre-match rating of the first match on/after the date, else the final rating)
    const watchRows = [];
    const ratingAt = (pid, sorted, day, sf = null) => {
      const next = sorted.find((e) => e.day >= day && (!sf || e.surface === sf));
      if (next && !sf) { const p = run.pre.get(next); return { r: next.A === pid ? p.ra : p.rb, n: next.A === pid ? p.na : p.nb }; }
      if (next) { const p = run.pre.surface(next); return p ? { r: next.A === pid ? p.sra : p.srb, n: next.A === pid ? p.nsa : p.nsb } : null; }
      const f = sf ? run.surface.get(`${pid}|${sf}`) : run.ratings.get(pid);
      return f?.n ? { r: f.r, n: f.n } : null;
    };
    const watchRow = (pid, entries, asOf, x) => {
      const sorted = [...entries].sort(byOrder);
      const past = sorted.filter((e) => e.day < asOf);
      const ago = (d) => new Date(Date.parse(asOf) - d * 86400e3).toISOString().slice(0, 10);
      const r30 = ratingAt(pid, sorted, ago(30));
      const r90 = ratingAt(pid, sorted, ago(90));
      const surf = {};
      for (const sf of SURFACES) {
        const now = ratingAt(pid, sorted, asOf, sf);
        const then = ratingAt(pid, sorted, ago(90), sf);
        const played = past.filter((e) => e.surface === sf && e.day >= ago(90)).length;
        if (now && then) surf[sf] = { now: Math.round(now.r), then: Math.round(then.r), n_now: now.n, n_then: then.n, matches_90d: played };
      }
      const rk = rankAt(pid, asOf);
      return { pid, rating: x.rating.value, n: x.rating.rated_matches, first_day: past[0]?.day ?? null, last_day: past.at(-1)?.day ?? null,
        m30: past.filter((e) => e.day >= ago(30)).length, m90: past.filter((e) => e.day >= ago(90)).length,
        r30: r30 && { r: Math.round(r30.r), n: r30.n }, r90: r90 && { r: Math.round(r90.r), n: r90.n }, surf,
        rank: rk?.rank ? { rank: rk.rank, list_date: rk.list_date } : null };
    };
    for (const asOf of asOfs) {
      // pass 1: the same-tour, same-as_of population from one slim record per player
      const slim = [];
      for (const [pid, entries] of byPlayer) {
        const x = snapshotOf(pid, entries, asOf);
        if (!x) continue;
        slim.push(slimForPopulation(x.snap));
        if (asOf === asOfs[0] && x.rating) watchRows.push(watchRow(pid, entries, asOf, x));
        if (asOf === asOfs[0] && x.rating) {
          ratingRows.push({ pbe_player_id: pid, surface: 'overall', as_of: asOf, method_version: RATING_METHOD_VERSION, rating: x.rating.value, uncertainty: null, sample_matches: x.n, provenance: { variant, published, tour, builder: BUILDER } });
          if (!x.next) for (const sf of ['hard', 'clay', 'grass']) { const r = run.surface.get(`${pid}|${sf}`); if (r?.n) ratingRows.push({ pbe_player_id: pid, surface: sf, as_of: asOf, method_version: RATING_METHOD_VERSION, rating: Math.round(r.r), uncertainty: null, sample_matches: r.n, provenance: { variant, published: surfacePublished, tour, builder: BUILDER, note: 'surface rating from matches whose surface is stored; blend 50/50 with overall for prediction' } }); }
        }
      }
      const idx = populationIndex(slim, { asOf });
      if (asOf === asOfs[0]) summary.tours[tour].population = idx.counts;
      snapshotCount += slim.length;
      if (!write) continue; // a dry run needs the population summary only
      // pass 2: rebuild each snapshot, apply the population, write in batches of 200 (one batch held at a time)
      let batch = [];
      const flush = async () => { if (write && batch.length) await store.upsert('tennis_dna_snapshots', batch, { onConflict: 'pbe_player_id,as_of,surface,definition_version' }); batch = []; };
      for (const [pid, entries] of byPlayer) {
        const x = snapshotOf(pid, entries, asOf);
        if (!x) continue;
        applyPopulationOne(x.snap, idx, { ratingPublished: published });
        x.snap.metrics._recent = recentMatches(pid, entries, asOf, { rankAt, limit: 40 });
        x.snap.metrics._profile = buildProfile(pid, entries, asOf, { pre: run.pre, hand, rating: x.rating, history: !!x.rating && x.rating.rated_matches >= 20 && x.snap.provenance.sample.last_day >= yearBefore(asOf) });
        batch.push(x.snap);
        if (batch.length >= 200) await flush();
      }
      await flush();
    }
    // surface Match DNA: the same definitions over the player's matches on ONE sourced surface (a match's surface
    // is its edition's, never inferred); own tour x surface population and gates; the surface PBE Rating with
    // the surface model's own publication status; wins above expectation against the surface-blend prediction
    // only where that model is published for the tour, else against the overall rating
    if (write && asOfs.length) {
      const asOf = asOfs[0];
      const surfPre = surfacePublished ? { get: (e) => { const x = run.pre.get(e); return x && x.ps != null && x.nsa >= 5 && x.nsb >= 5 ? { ...x, p: x.ps } : x; } } : run.pre;
      for (const sf of SURFACES) {
        const surfaceSnap = (pid, entries) => {
          const se = entries.filter((e) => e.surface === sf);
          if (se.filter((e) => e.day < asOf).length < SURFACE_MIN_MATCHES) return null;
          const r = run.surface.get(`${pid}|${sf}`);
          const rating = r?.n ? { value: Math.round(r.r), rated_matches: r.n, method_version: RATING_METHOD_VERSION, variant, published: surfacePublished, provisional: r.n < 20, surface: sf } : null;
          const dna = buildMatchDna(pid, se, asOf, { rankAt, pre: surfPre, rating });
          if (!dna.sample.matches) return null;
          return { se, snap: { pbe_player_id: pid, as_of: asOf, surface: sf, definition_version: MATCH_DNA_VERSION, metrics: { ...dna.metrics, _form: dna.form, _rating: rating, _tour: tour, _surface: sf }, provenance: { builder: BUILDER, ledger_rule: `singles completed+retired, dated, same tour, edition surface = ${sf}`, sample: dna.sample, rank_lists: lists[tour].length, wae_basis: surfacePublished ? 'surface_blend' : 'overall_rating' } } };
        };
        const slim = [];
        for (const [pid, entries] of byPlayer) { const x = surfaceSnap(pid, entries); if (x) slim.push(slimForPopulation(x.snap)); }
        const idx = populationIndex(slim, { asOf });
        summary.tours[tour].surfaces = { ...(summary.tours[tour].surfaces || {}), [sf]: { players: slim.length, population: idx.counts } };
        snapshotCount += slim.length;
        let batch = [];
        const flush = async () => { if (batch.length) await store.upsert('tennis_dna_snapshots', batch, { onConflict: 'pbe_player_id,as_of,surface,definition_version' }); batch = []; };
        for (const [pid, entries] of byPlayer) {
          const x = surfaceSnap(pid, entries);
          if (!x) continue;
          applyPopulationOne(x.snap, idx, { ratingPublished: surfacePublished });
          x.snap.metrics._recent = recentMatches(pid, x.se, asOf, { rankAt, limit: 20 });
          const sr = x.snap.metrics._rating;
          x.snap.metrics._profile = buildProfile(pid, x.se, asOf, { pre: surfPre, run: run.pre, hand, rating: sr, surface: sf, history: !!sr && sr.rated_matches >= 20 && x.snap.provenance.sample.last_day >= yearBefore(asOf) });
          batch.push(x.snap);
          if (batch.length >= 200) await flush();
        }
        await flush();
      }
    }
    if (asOfs.length) summary.tours[tour].watch = playersToWatch(watchRows, asOfs[0], { published, surfacePublished });
    lists[tour] = null; // this tour's rank maps are no longer needed
  }
  mark('compute_and_snapshot_writes');
  summary.snapshots = snapshotCount;
  summary.ratings = ratingRows.length;
  if (write) {
    for (let i = 0; i < ratingRows.length; i += 500) await store.upsert('tennis_surface_ratings', ratingRows.slice(i, i + 500), { onConflict: 'pbe_player_id,surface,as_of,method_version' });
    await writeWatch(ctx.kv, summary, asOfs[0]);
    await ctx.kv.put('dna:v2:summary', JSON.stringify({ ...summary, built_at: new Date().toISOString() }));
  }
  if (write) mark('rating_writes');
  summary.phase_ms = phase;
  summary.inputs = inputs;
  summary.ms = Date.now() - t0;
  return summary;
}

// ---- Players to Watch (Phase 6) -------------------------------------------------------------------------
// Every list ranks stored PBE Rating movements (no editorial judgement). A player qualifies only with an
// established rating (>= 20 rated matches) and a match in the last 60 days, plus the minimum samples named per list.
export const WATCH = Object.freeze({ top: 10, recent_days: 60, min_rated: 20, rise_min_matches_90d: 5, surface_min_rated: 10, surface_min_matches_90d: 3, emerging_years: 3, rank_scope: 200 });

export function playersToWatch(rows, asOf, { published = false, surfacePublished = false } = {}) {
  const ago = (d) => new Date(Date.parse(asOf) - d * 86400e3).toISOString().slice(0, 10);
  const active = rows.filter((r) => r.n >= WATCH.min_rated && (r.last_day || '') >= ago(WATCH.recent_days));
  const by = (f, dir = -1) => (a, b) => dir * (f(a) - f(b)) || (String(a.r?.pid ?? a.pid) < String(b.r?.pid ?? b.pid) ? -1 : 1);
  const top = (xs) => xs.slice(0, WATCH.top);
  const row = (r, extra) => ({ pbe_player_id: r.pid, rating: r.rating, rated_matches: r.n, rank: r.rank, last_match: r.last_day, ...extra });
  const d30 = active.filter((r) => r.r30 && r.r30.n >= WATCH.min_rated && r.m30 >= 1).map((r) => ({ r, d: r.rating - r.r30.r }));
  const d90 = active.filter((r) => r.r90 && r.r90.n >= WATCH.min_rated && r.m90 >= WATCH.rise_min_matches_90d).map((r) => ({ r, d: r.rating - r.r90.r }));
  // rating vs ranking on the SAME set: active established players holding a rank within the top rank_scope on the
  // list in force at as_of; both orders are positions inside that set (players missing from our ledger cannot inflate
  // a gap). gap = ranking position - rating position.
  const set = active.filter((r) => r.rank?.rank && r.rank.rank <= WATCH.rank_scope);
  const rankPos = new Map([...set].sort((a, b) => a.rank.rank - b.rank.rank || (a.pid < b.pid ? -1 : 1)).map((r, i) => [r.pid, i + 1]));
  const ratingPos = new Map([...set].sort(by((r) => r.rating)).map((r, i) => [r.pid, i + 1]));
  const ranked = set.map((r) => ({ r, rr: ratingPos.get(r.pid), kp: rankPos.get(r.pid), gap: rankPos.get(r.pid) - ratingPos.get(r.pid) }));
  const surfaces = {};
  for (const sf of ['hard', 'clay', 'grass']) {
    const xs = active.map((r) => ({ r, s: r.surf[sf] })).filter((x) => x.s && x.s.n_then >= WATCH.surface_min_rated && x.s.matches_90d >= WATCH.surface_min_matches_90d).map((x) => ({ ...x, d: x.s.now - x.s.then }));
    surfaces[sf] = top(xs.filter((x) => x.d > 0).sort(by((x) => x.d))).map((x) => row(x.r, { surface_rating: x.s.now, surface_rating_90d_ago: x.s.then, change: x.d, surface_matches_90d: x.s.matches_90d }));
  }
  const emergingFrom = ago(WATCH.emerging_years * 365);
  return {
    as_of: asOf, rating_published: published, surface_rating_published: surfacePublished, population: active.length, rules: WATCH,
    biggest_30d_change: {
      risers: top(d30.filter((x) => x.d > 0).sort(by((x) => x.d))).map((x) => row(x.r, { rating_30d_ago: x.r.r30.r, change: x.d, matches_30d: x.r.m30 })),
      fallers: top(d30.filter((x) => x.d < 0).sort(by((x) => x.d, 1))).map((x) => row(x.r, { rating_30d_ago: x.r.r30.r, change: x.d, matches_30d: x.r.m30 }))
    },
    fastest_rising_90d: top(d90.filter((x) => x.d > 0).sort(by((x) => x.d))).map((x) => row(x.r, { rating_90d_ago: x.r.r90.r, change: x.d, matches_90d: x.r.m90 })),
    surface_risers_90d: surfaces,
    ranking_comparison_set: set.length,
    outperforming_ranking: top(ranked.filter((x) => x.gap > 0).sort(by((x) => x.gap))).map((x) => row(x.r, { rating_position: x.rr, ranking_position: x.kp, ranking_gap: x.gap })),
    underperforming_ranking: top(ranked.filter((x) => x.gap < 0).sort(by((x) => x.gap, 1))).map((x) => row(x.r, { rating_position: x.rr, ranking_position: x.kp, ranking_gap: x.gap })),
    emerging: top(active.filter((r) => (r.first_day || '') >= emergingFrom).sort(by((r) => r.rating))).map((r) => row(r, { first_ledger_match: r.first_day }))
  };
}

/** KV: the current lists (rebuilt daily) and the weekly edition, frozen on Mondays and never rewritten. */
export async function writeWatch(kv, summary, asOf) {
  const watch = { as_of: asOf, built_at: new Date().toISOString(), profile_version: PROFILE_VERSION, tours: {} };
  for (const [t, x] of Object.entries(summary.tours)) { watch.tours[t] = x.watch || null; delete x.watch; }
  await kv.put('dna:v2:watch:current', JSON.stringify(watch));
  if (new Date(`${asOf}T00:00:00Z`).getUTCDay() !== 1) return;
  if (await kv.get(`dna:v2:watch:week:${asOf}`)) return;
  await kv.put(`dna:v2:watch:week:${asOf}`, JSON.stringify(watch));
  const weeks = JSON.parse((await kv.get('dna:v2:watch:weeks')) || '[]');
  await kv.put('dna:v2:watch:weeks', JSON.stringify([asOf, ...weeks.filter((w) => w !== asOf)].slice(0, 104)));
}
