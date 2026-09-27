// Tennis DNA v2 build (Match DNA + PBE Rating). docs/TENNIS_DNA_CONTRACT.md §v2.
// Reads the canonical singles ledger + ranking lists, runs the chronological rating per tour with a walk-forward
// backtest, and writes tennis_dna_snapshots (definition_version 2, surface 'all') and tennis_surface_ratings
// (method_version 1). v1 snapshots are never touched. Deterministic: same store -> same rows.

import { inList } from '../../shared/store/postgrest.js';
import { ledgerEntry, rankIndex, ratingRun, backtest, buildMatchDna, applyPopulation, recentMatches, MATCH_DNA_VERSION, RATING_METHOD_VERSION } from '../../shared/dna/match-dna.js';

const BUILDER = 'tennis-ingest dna-v2-job 1.0';
// burn-in seasons before evaluation starts (ATP ledger from 2007; WTA from 2020)
const BACKTEST_FROM = { ATP: '2012-01-01', WTA: '2023-01-01' };
const MIN_EVAL = 500;

async function all(store, table, query, page = 1000) {
  const out = [];
  for (let off = 0; ; off += page) {
    const rows = await store.select(table, `${query}&limit=${page}&offset=${off}`);
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

/** Singles ledger via keyset pagination (match_id), compacted page by page. */
export async function loadLedger(store, tourOf, editions) {
  const out = [];
  let last = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const rows = await store.select('tennis_matches', `select=match_id,edition_id,event_type,round,format_key,status,winner_side,scheduled_at,started_at,surface,source_family,tennis_sets(set_no,games_a,games_b,tb_a,tb_b),tennis_match_participants(side,participant_key)&event_type=in.(MS,WS)&status=in.(completed,retired)&match_id=gt.${last}&order=match_id.asc&limit=1000`);
    for (const r of rows) {
      const side = (s) => { const p = (r.tennis_match_participants || []).find((x) => x.side === s)?.participant_key; return p && p.startsWith('S:') ? p.slice(2) : null; };
      const e = ledgerEntry({ ...r, sets: r.tennis_sets || [], A: side('A'), B: side('B'), edition: editions.get(r.edition_id) }, tourOf);
      if (e) out.push(e);
    }
    if (rows.length < 1000) break;
    last = rows.at(-1).match_id;
  }
  return out;
}

async function loadRankLists(store, listKey) {
  const snaps = await all(store, 'tennis_ranking_snapshots', `select=snapshot_id,ranking_date,row_count&list_key=eq.${listKey}&row_count=gt.0&order=ranking_date.asc`);
  const byId = new Map(snaps.map((s) => [s.snapshot_id, { date: s.ranking_date, size: s.row_count, ranks: new Map() }]));
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 6) {
    for (const r of await store.select('tennis_rankings', `select=snapshot_id,pbe_player_id,rank&snapshot_id=${inList(ids.slice(i, i + 6))}&pbe_player_id=not.is.null&limit=1000`)) byId.get(r.snapshot_id).ranks.set(r.pbe_player_id, r.rank);
  }
  return [...byId.values()];
}

/**
 * Build and store v2 snapshots for `asOfs` (default: today). Returns a summary incl. the backtest.
 * write=false computes everything and returns the summary only (research / dry run).
 */
export async function buildDnaV2(ctx, { asOfs = [new Date().toISOString().slice(0, 10)], write = true } = {}) {
  const t0 = Date.now();
  const store = ctx.store;
  const players = await all(store, 'tennis_players', 'select=pbe_player_id,gender&status=eq.active&order=pbe_player_id.asc');
  const gender = new Map(players.map((p) => [p.pbe_player_id, p.gender]));
  const tourOf = (pid) => (gender.get(pid) === 'M' ? 'ATP' : gender.get(pid) === 'F' ? 'WTA' : null);
  const editions = new Map((await all(store, 'tennis_tournament_editions', 'select=edition_id,start_date,end_date,competition_key,level,year&order=edition_id.asc')).map((e) => [e.edition_id, e]));
  const ledger = await loadLedger(store, tourOf, editions);
  const lists = { ATP: await loadRankLists(store, 'atp_singles'), WTA: await loadRankLists(store, 'wta_singles') };
  const summary = { builder: BUILDER, definition_version: MATCH_DNA_VERSION, rating_method_version: RATING_METHOD_VERSION, as_of: asOfs, ledger: ledger.length, tours: {} };
  const snapshots = [];
  const ratingRows = [];
  for (const tour of ['ATP', 'WTA']) {
    const L = ledger.filter((e) => e.tour === tour).sort((a, b) => (a.order < b.order ? -1 : 1));
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
    summary.tours[tour] = { matches: L.length, first_day: L[0]?.day ?? null, last_day: L.at(-1)?.day ?? null, ranking_lists: lists[tour].length, variant, published, surface_published: surfacePublished, backtest: bt };
    const byPlayer = new Map();
    for (const e of L) for (const pid of [e.A, e.B]) { if (!byPlayer.has(pid)) byPlayer.set(pid, []); byPlayer.get(pid).push(e); }
    for (const asOf of asOfs) {
      const group = [];
      for (const [pid, entries] of byPlayer) {
        // rating as of D = the pre-match rating of the player's first match on/after D, else the final rating
        const next = entries.filter((e) => e.day >= asOf).sort((a, b) => (a.order < b.order ? -1 : 1))[0];
        const pr = next ? run.pre.get(next.id) : null;
        const fin = run.ratings.get(pid);
        const value = pr ? (next.A === pid ? pr.ra : pr.rb) : fin?.r;
        const n = pr ? (next.A === pid ? pr.na : pr.nb) : fin?.n;
        if (!n) { /* unrated before asOf */ }
        const rating = n ? { value: Math.round(value), rated_matches: n, method_version: RATING_METHOD_VERSION, variant, published, provisional: n < 20 } : null;
        const dna = buildMatchDna(pid, entries, asOf, { rankAt, pre: run.pre, rating });
        if (!dna.sample.matches) continue;
        const snap = { pbe_player_id: pid, as_of: asOf, surface: 'all', definition_version: MATCH_DNA_VERSION, metrics: { ...dna.metrics, _form: dna.form, _surface_record: dna.surface_record, _rating: rating, _tour: tour, _recent: recentMatches(pid, entries, asOf, { rankAt, limit: 40 }) }, provenance: { builder: BUILDER, ledger_rule: 'singles completed+retired, dated, same tour', sample: dna.sample, rank_lists: lists[tour].length } };
        snapshots.push(snap);
        group.push(snap);
        if (asOf === asOfs[0] && rating) {
          ratingRows.push({ pbe_player_id: pid, surface: 'overall', as_of: asOf, method_version: RATING_METHOD_VERSION, rating: rating.value, uncertainty: null, sample_matches: n, provenance: { variant, published, tour, builder: BUILDER } });
          if (!next) for (const s of ['hard', 'clay', 'grass']) { const x = run.surface.get(`${pid}|${s}`); if (x?.n) ratingRows.push({ pbe_player_id: pid, surface: s, as_of: asOf, method_version: RATING_METHOD_VERSION, rating: Math.round(x.r), uncertainty: null, sample_matches: x.n, provenance: { variant, published: surfacePublished, tour, builder: BUILDER, note: 'surface rating from matches whose surface is stored; blend 50/50 with overall for prediction' } }); }
        }
      }
      // same-tour, same-as_of population: percentiles + per-metric comparative gates stored with each snapshot
      const pop = applyPopulation(group, { asOf, ratingPublished: published });
      if (asOf === asOfs[0]) summary.tours[tour].population = pop;
    }
  }
  summary.snapshots = snapshots.length;
  summary.ratings = ratingRows.length;
  if (write) {
    for (let i = 0; i < snapshots.length; i += 200) await store.upsert('tennis_dna_snapshots', snapshots.slice(i, i + 200), { onConflict: 'pbe_player_id,as_of,surface,definition_version' });
    for (let i = 0; i < ratingRows.length; i += 500) await store.upsert('tennis_surface_ratings', ratingRows.slice(i, i + 500), { onConflict: 'pbe_player_id,surface,as_of,method_version' });
    await ctx.kv.put('dna:v2:summary', JSON.stringify({ ...summary, built_at: new Date().toISOString() }));
  }
  summary.ms = Date.now() - t0;
  return summary;
}
