// Matchup Model V2 — RESEARCH-ONLY prospective shadow (docs/MATCHUP_MODEL_V2_RESEARCH.md "Prospective shadow").
// For every NEWLY written pre-match snapshot (matchup-freeze/1), write one append-only research record before play:
// the champion probability exactly as frozen, Challenger B's probability from the frozen coefficients and the daily
// player state, and the feature hash. Nothing here is read by any API route or changes a published probability;
// records live under research/mm2/ in R2 and are graded offline (scripts/research/mm2/grade-shadow.mjs).
import { SHADOW_MODEL } from '../../shared/research/mm2-b-shadow.js';
import { featuresB, predictFrom, stateProfile, dayNum, STATE_VERSION } from '../../shared/research/mm2-profile.js';

export const SHADOW_VERSION = 'mm2-shadow/1';
export const SHADOW_PREFIX = 'research/mm2/shadow/';
export const STATE_KEY = (tour) => `research/mm2/state/${tour}.json`;
const INDEX_KEY = (day) => `research/mm2/shadow-index/${day}.json`;

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const r6 = (x) => Math.round(x * 1e6) / 1e6;

/** Pure: the shadow record for one frozen snapshot given the tour's player state (null fields + reason when it cannot be scored). */
export async function shadowRecord(snap, state, { now = new Date().toISOString() } = {}) {
  const p = snap.payload || {};
  const tour = p.tour;
  const m = p.match || {};
  const pid = (s) => (m.sides?.[s]?.players?.length === 1 ? m.sides[s].players[0].id : null);
  const champ = p.model?.status === 'published' ? p.model.probability : null;
  const base = { shadow_version: SHADOW_VERSION, research_only: true, match_id: snap.match_id, tour, scheduled_at: snap.scheduled_at, frozen_at: snap.frozen_at, snapshot_content_hash: snap.content_hash,
    champion: { model: 'PBE Rating', method_version: 1, probability: champ, basis: p.model?.basis ?? null }, model_version: SHADOW_MODEL.model_version, coef_hash: SHADOW_MODEL.coef_hash, feature_version: SHADOW_MODEL.feature_version, written_at: now };
  const coef = SHADOW_MODEL.tours[tour];
  const why = !champ ? `champion_not_published:${p.model?.status ?? 'none'}` : !coef ? 'tour_not_modelled' : !state || state.state_version !== STATE_VERSION ? 'no_player_state' : !pid('A') || !pid('B') ? 'not_singles' : null;
  const sa = why ? null : state.players[pid('A')];
  const sb = why ? null : state.players[pid('B')];
  const day = String(snap.scheduled_at || '').slice(0, 10);
  const reason = why || (!sa || !sb ? 'player_not_in_state' : !day ? 'no_scheduled_day' : dayNum(day) < dayNum(state.cutoff) ? 'state_newer_than_match' : null);
  if (reason) return { ...base, challenger: null, reason };
  const dn = dayNum(day);
  const sr = p.model.surface_ratings;
  const surf = sr?.used && sr.A && sr.B ? { sra: sr.A.value, srb: sr.B.value } : null;
  const f = featuresB(champ.A, surf, stateProfile(sa, dn), stateProfile(sb, dn));
  const fr = Object.fromEntries(SHADOW_MODEL.names.map((k) => [k, r6(f[k])]));
  const pA = predictFrom({ names: SHADOW_MODEL.names, coef: coef.coef }, f);
  return { ...base, challenger: { probability: { A: r6(pA), B: r6(1 - pA) } }, features: fr, feature_hash: await sha256(JSON.stringify(fr)), state_cutoff: state.cutoff, reason: null };
}

/**
 * After a freezer run: one write-once shadow record per newly written snapshot, plus the day's index (graded offline).
 * items: freezeUpcoming().items. Returns a small summary for KV.
 */
export async function shadowFrozen(bucket, items, { now = new Date().toISOString() } = {}) {
  const out = { at: now, considered: 0, written: 0, unscored: 0, exists: 0, errors: 0 };
  const fresh = (items || []).filter((x) => x.written && x.key);
  if (!bucket || !fresh.length) return out;
  const states = {};
  const stateOf = async (tour) => {
    if (!(tour in states)) { const o = await bucket.get(STATE_KEY(tour)); states[tour] = o ? JSON.parse(await o.text()) : null; }
    return states[tour];
  };
  const byDay = new Map();
  for (const it of fresh) {
    out.considered += 1;
    try {
      const o = await bucket.get(it.key);
      if (!o) continue;
      const snap = JSON.parse(await o.text());
      const rec = await shadowRecord(snap, await stateOf(snap.payload?.tour), { now });
      const key = `${SHADOW_PREFIX}${snap.match_id}/${snap.frozen_at}_${SHADOW_MODEL.model_version.replace('/', '-')}.json`;
      if (await bucket.head(key)) { out.exists += 1; continue; } // append-only: never overwrite
      await bucket.put(key, JSON.stringify(rec), { httpMetadata: { contentType: 'application/json' } });
      out.written += 1;
      if (!rec.challenger) out.unscored += 1;
      const d = snap.frozen_at.slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push({ key, ...rec });
    } catch (e) { out.errors += 1; out.last_error = String(e?.message || e).slice(0, 160); }
  }
  for (const [d, recs] of byDay) {
    const o = await bucket.get(INDEX_KEY(d));
    const prev = o ? JSON.parse(await o.text()) : [];
    const seen = new Set(prev.map((x) => x.key));
    await bucket.put(INDEX_KEY(d), JSON.stringify([...prev, ...recs.filter((x) => !seen.has(x.key))]), { httpMetadata: { contentType: 'application/json' } });
  }
  return out;
}
