// WTA player aggregates lane (wta_records): /records (career by level / surface / tournament) and /year/{y}
// (season serve-return counts) for the players of the latest OFFICIAL WTA singles list (top 200), stored as
// reported in tennis_player_source_records. Past seasons are fetched once; the current season and /records are
// refreshed weekly. Comparison with our derived records: scripts/context/records-compare.sql (logs, never writes).

import * as rec from '../../providers/wta-records.js';
import { fetchRun } from './jobs.js';
import { mintPlayerId } from '../../shared/canonical/identity.js';

const ST = 'wr:state';
const TOP = 200;
const FIRST_SEASON = 2017; // earlier seasons return the player object only (outside the WTA's stats coverage)

async function queue(ctx) {
  const [snap] = await ctx.store.select('tennis_ranking_snapshots', 'select=snapshot_id,ranking_date&list_key=eq.wta_singles&source_family=eq.wta&row_count=gt.0&order=ranking_date.desc&limit=1');
  if (!snap) return [];
  return (await ctx.store.select('tennis_rankings', `select=provider_player_id,rank&snapshot_id=eq.${snap.snapshot_id}&rank=lte.${TOP}&order=rank.asc&limit=${TOP}`)).map((r) => r.provider_player_id);
}

async function store(ctx, pid, kind, period, rec0, run) {
  await ctx.store.upsert('tennis_player_source_records', [{ pbe_player_id: pid, provider: 'wta', kind, period, payload: rec0.payload, source_ref: run.capture?.url || null, capture_id: run.capture?.capture_id || null, source_synced_at: rec0.synced_at || null, observed_at: new Date().toISOString() }], { onConflict: 'pbe_player_id,provider,kind,period' });
}

/** Up to `budget` upstream requests. Per player: /records once a week, every past season once, the current season weekly. */
export async function wtaRecordsStep(ctx, { budget = 20 } = {}) {
  let st = (await ctx.kv.get(ST, 'json')) || { i: 0, q: [], built_at: null };
  if (!st.q.length || !st.built_at || Date.now() - Date.parse(st.built_at) > 7 * 86400e3) st = { i: 0, q: await queue(ctx), built_at: new Date().toISOString() };
  const year = new Date().getUTCFullYear();
  const out = { players: [], requests: 0 };
  while (st.i < st.q.length && out.requests < budget) {
    const wid = st.q[st.i];
    const pid = await mintPlayerId('wta', wid);
    const [player] = await ctx.store.select('tennis_players', `select=pbe_player_id&pbe_player_id=eq.${pid}`);
    if (!player) { st.i += 1; continue; } // not in the canonical graph: nothing to attach to (never minted here)
    const have = new Map((await ctx.store.select('tennis_player_source_records', `select=kind,period,observed_at&pbe_player_id=eq.${pid}&provider=eq.wta`)).map((r) => [`${r.kind}|${r.period}`, r.observed_at]));
    const fresh = (k) => have.has(k) && Date.now() - Date.parse(have.get(k)) < 7 * 86400e3;
    const pending = [];
    if (!fresh('career_records|career')) pending.push(['career_records', 'career', rec.playerRecords, { id: wid }]);
    for (let y = FIRST_SEASON; y <= year; y += 1) if (y === year ? !fresh(`season_stats|${y}`) : !have.has(`season_stats|${y}`) && !have.has(`season_stats|${y}:absent`)) pending.push(['season_stats', String(y), rec.playerYear, { id: wid, year: y }]);
    const done = { player: wid, fetched: 0, stored: 0, absent: 0 };
    for (const [kind, period, adapter, params] of pending) {
      if (out.requests >= budget) break;
      const r = await fetchRun(ctx, adapter, params);
      out.requests += 1; done.fetched += 1;
      if (r.state === 'PASS' && r.records?.length) { await store(ctx, pid, kind, period, r.records[0], r); done.stored += 1; }
      else if (r.state === 'DEGRADED' && r.error === 'zero_records' && kind === 'season_stats') {
        // outside the WTA's coverage for that player: remembered as absent so it is not refetched, never stored as zero
        await ctx.store.upsert('tennis_player_source_records', [{ pbe_player_id: pid, provider: 'wta', kind, period: `${period}:absent`, payload: {}, source_ref: r.capture?.url || null, capture_id: r.capture?.capture_id || null, observed_at: new Date().toISOString() }], { onConflict: 'pbe_player_id,provider,kind,period' });
        done.absent += 1;
      } else if (r.state !== 'PASS') throw new Error(`wta records ${wid} ${kind} ${period}: ${r.state} ${r.error || ''}`.trim());
    }
    out.players.push(done);
    if (done.fetched === pending.length) st.i += 1; // all of this player's items handled
    await ctx.kv.put(ST, JSON.stringify(st));
  }
  return { ...out, position: st.i, queue: st.q.length, done: st.i >= st.q.length };
}
