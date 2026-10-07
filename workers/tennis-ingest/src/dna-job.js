// Daily Tennis DNA snapshot build (docs/TENNIS_DNA_CONTRACT.md). Singles only: WTA doubles statistics
// are team-level and never attributed to one player. as_of = today, exclusive (matches dated < today).
// Stored per player x surface (all/hard/clay/grass) x definition_version; the API and PBEcast read these
// rows — the browser never recomputes a profile.

import { buildDna, DEFINITION_VERSION } from '../../shared/dna/metric.js';
import { inList } from '../../shared/store/postgrest.js';

async function all(store, table, query, page = 1000) {
  const out = [];
  for (let off = 0; ; off += page) {
    const rows = await store.select(table, `${query}&limit=${page}&offset=${off}`);
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

// The only stats keys the v1 definitions read (shared/dna/metric.js DEFINITIONS). The stored jsonb also carries per-set
// splits and other totals: ~18.6 MB of JSON for 25k side rows (2026-10-07), all of it parsed and held for the whole build,
// which made this daily step a memory risk for the 128 MB isolate. Projecting the inputs in PostgREST (stats->key) gives
// buildDna exactly the values it read before (a missing key is null either way; tests/dna-v1-projection.test.js).
export const V1_STAT_KEYS = Object.freeze(['service_points', 'aces', 'double_faults', 'first_serves_in', 'first_serve_points_won', 'second_serve_points_won', 'service_games', 'break_points_faced', 'break_points_saved']);
export const V1_STATS_SELECT = `select=match_id,side,source_family,${V1_STAT_KEYS.map((k) => `${k}:stats->${k}`).join(',')}&order=match_id.asc`;
export const projectV1Stats = (r) => ({ match_id: r.match_id, side: r.side, source_family: r.source_family, stats: Object.fromEntries(V1_STAT_KEYS.map((k) => [k, r[k] ?? null])) });

export async function buildDnaSnapshots(ctx, { asOf = new Date().toISOString().slice(0, 10), asOfs = null, builder = 'tennis-ingest dna-job v1.1' } = {}) {
  const dates = asOfs || [asOf];
  const stats = (await all(ctx.store, 'tennis_match_stats', V1_STATS_SELECT)).map(projectV1Stats);
  const ids = [...new Set(stats.map((s) => s.match_id))];
  const meta = new Map();
  const parts = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    for (const m of await ctx.store.select('tennis_matches', `select=match_id,event_type,surface,started_at,source_updated_at,status,tennis_sets(games_a,games_b)&match_id=${inList(chunk)}`)) meta.set(m.match_id, m);
    for (const p of await ctx.store.select('tennis_match_participants', `select=match_id,side,participant_key&match_id=${inList(chunk)}`)) {
      if (!parts.has(p.match_id)) parts.set(p.match_id, {});
      parts.get(p.match_id)[p.side] = p.participant_key;
    }
  }
  const byMatch = new Map();
  for (const s of stats) { if (!byMatch.has(s.match_id)) byMatch.set(s.match_id, {}); byMatch.get(s.match_id)[s.side] = s; }
  // match date = the day play started when the source gives it; else the source's last update (never earlier than the match)
  const perPlayer = new Map();
  for (const [mid, sides] of byMatch) {
    const m = meta.get(mid);
    const pk = parts.get(mid);
    if (!m || !pk || !['MS', 'WS'].includes(m.event_type) || !sides.A || !sides.B || !(m.started_at || m.source_updated_at)) continue;
    const sets = m.tennis_sets || [];
    for (const side of ['A', 'B']) {
      const key = pk[side];
      if (!key?.startsWith('S:')) continue;
      const pid = key.slice(2);
      if (!perPlayer.has(pid)) perPlayer.set(pid, []);
      perPlayer.get(pid).push({ match_id: mid, match_date: (m.started_at || m.source_updated_at).slice(0, 10), surface: m.surface, sets_played: sets.length, games_played: sets.reduce((t, x) => t + x.games_a + x.games_b, 0), source_family: sides[side].source_family, side: sides[side].stats, opp: sides[side === 'A' ? 'B' : 'A'].stats });
    }
  }
  const rows = [];
  for (const day of dates) for (const [pid, list] of perPlayer) {
    const asOf = day;
    for (const surface of ['all', 'hard', 'clay', 'grass']) {
      const dna = buildDna(list, { asOf, surface: surface === 'all' ? null : surface });
      if (!dna.matches_considered) continue;
      rows.push({ pbe_player_id: pid, as_of: asOf, surface, definition_version: DEFINITION_VERSION, metrics: dna.metrics, provenance: { match_ids: list.filter((r) => r.match_date < asOf && (surface === 'all' || r.surface === surface)).map((r) => r.match_id), builder, matches_considered: dna.matches_considered } });
    }
  }
  for (let i = 0; i < rows.length; i += 300) await ctx.store.upsert('tennis_dna_snapshots', rows.slice(i, i + 300), { onConflict: 'pbe_player_id,as_of,surface,definition_version' });
  return { as_of: dates, players: perPlayer.size, snapshots: rows.length, stat_rows: stats.length };
}
