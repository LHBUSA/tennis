// Matchup Model V2 — RESEARCH-ONLY daily player state for the prospective shadow (docs/MATCHUP_MODEL_V2_RESEARCH.md).
// Called by the DNA v2 build once per tour, after the tour's rating run, from the data already in memory. It writes one
// R2 object (research/mm2/state/<tour>.json) and never touches a snapshot, rating, summary or API output; any failure
// is reported to KV mm2:state:<tour> and swallowed.
import { tourStates } from '../../shared/research/mm2-profile.js';

export async function writeMm2State(ctx, tour, byPlayer, run, asOf) {
  const bucket = ctx.env?.TENNIS_SOURCE;
  if (!bucket) return;
  const t0 = Date.now();
  try {
    const s = tourStates(byPlayer, run, asOf);
    const body = JSON.stringify({ ...s, tour, built_at: new Date().toISOString() });
    await bucket.put(`research/mm2/state/${tour}.json`, body, { httpMetadata: { contentType: 'application/json' } });
    await ctx.kv?.put(`mm2:state:${tour}`, JSON.stringify({ at: new Date().toISOString(), cutoff: asOf, players: Object.keys(s.players).length, bytes: body.length, ms: Date.now() - t0 }));
  } catch (e) {
    await ctx.kv?.put(`mm2:state:${tour}`, JSON.stringify({ at: new Date().toISOString(), error: String(e?.message || e).slice(0, 300) })).catch(() => {});
  }
}
