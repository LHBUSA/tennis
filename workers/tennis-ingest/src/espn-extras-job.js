// ESPN extras lane (espn_extras): for the resolved players of each tour's latest ESPN singles list (top 150),
// ESPN's own season statistics (singles W-L, titles, prize) and event log, for the current and previous season.
// Stored AS REPORTED in tennis_player_source_records (provider espn, kind season_record, period <year>); the
// event log is used only as a coverage check against the ESPN competitions we hold (never to create matches).
// Brackets are not available to us: www.espn.com drops our honest requests and site.api.espn.com answers 403.

import * as espn from '../../providers/espn.js';
import { fetchRun } from './jobs.js';
import { inList } from '../../shared/store/postgrest.js';

const ST = 'espnx:state';
const TOP = 150;

async function queue(ctx) {
  const q = [];
  for (const league of ['atp', 'wta']) {
    const [snap] = await ctx.store.select('tennis_ranking_snapshots', `select=snapshot_id&list_key=eq.${espn.LEAGUES[league].list_key}&source_family=eq.espn&row_count=gt.0&order=ranking_date.desc&limit=1`);
    if (!snap) continue;
    const rows = await ctx.store.select('tennis_rankings', `select=provider_player_id,pbe_player_id,rank&snapshot_id=eq.${snap.snapshot_id}&pbe_player_id=not.is.null&rank=lte.${TOP}&order=rank.asc&limit=${TOP}`);
    for (const r of rows) q.push({ league, espn_id: r.provider_player_id.replace(/^espn:/, ''), pid: r.pbe_player_id });
  }
  return q;
}

export async function espnExtrasStep(ctx, { budget = 30 } = {}) {
  let st = (await ctx.kv.get(ST, 'json')) || { i: 0, q: [], built_at: null };
  if (!st.q.length || !st.built_at || Date.now() - Date.parse(st.built_at) > 7 * 86400e3) st = { i: 0, q: await queue(ctx), built_at: new Date().toISOString() };
  const year = new Date().getUTCFullYear();
  const out = { players: [], requests: 0 };
  while (st.i < st.q.length && out.requests < budget) {
    const { league, espn_id, pid } = st.q[st.i];
    const A = league === 'wta' ? espn.WTA : espn.ATP;
    const done = { league, espn_id, seasons: [] };
    for (const season of [year - 1, year]) {
      const s = await fetchRun(ctx, A.seasonStats, { season, id: espn_id });
      out.requests += 1;
      if (s.state !== 'PASS' && !(s.state === 'DEGRADED' && s.error === 'zero_records') && s.http_status !== 404) throw new Error(`espn stats ${espn_id} ${season}: ${s.state} ${s.error || ''}`);
      // event log, every page
      const refs = [];
      for (let page = 1; page <= 12; page += 1) {
        const l = await fetchRun(ctx, A.eventLog, { season, id: espn_id, page });
        out.requests += 1;
        if (l.state !== 'PASS') { if (l.http_status === 404 || l.error === 'zero_records') break; throw new Error(`espn eventlog ${espn_id} ${season} p${page}: ${l.state} ${l.error || ''}`); }
        refs.push(...l.records[0].rows);
        if (page >= (l.records[0].page_count || 1)) break;
      }
      const played = refs.filter((r) => r.played);
      const keys = played.map((r) => `${r.event}:${r.competition}`);
      const have = new Set();
      for (let i = 0; i < keys.length; i += 80) for (const x of await ctx.store.select('tennis_match_external_ids', `select=external_id&provider=eq.espn&external_id=${inList(keys.slice(i, i + 80))}`)) have.add(x.external_id);
      const payload = { league, espn_id, stats: s.records?.[0] || null, eventlog: { listed: refs.length, played: played.length, held_in_graph: have.size, missing: keys.filter((k) => !have.has(k)).slice(0, 40) } };
      await ctx.store.upsert('tennis_player_source_records', [{ pbe_player_id: pid, provider: 'espn', kind: 'season_record', period: String(season), payload, source_ref: s.capture?.url || null, capture_id: s.capture?.capture_id || null, observed_at: new Date().toISOString() }], { onConflict: 'pbe_player_id,provider,kind,period' });
      done.seasons.push({ season, stats: !!payload.stats, played: played.length, held: have.size });
    }
    out.players.push(done);
    st.i += 1;
    await ctx.kv.put(ST, JSON.stringify(st));
  }
  return { ...out, position: st.i, queue: st.q.length, done: st.i >= st.q.length };
}
