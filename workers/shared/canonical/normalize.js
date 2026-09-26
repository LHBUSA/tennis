// SourceMatch -> CanonicalMatch. The ONLY place provider-neutral source records become canonical rows.
// Downstream code never learns whether a match came from the WTA API, a Slam feed or anything else.

import { makeMatchSides } from './participant.js';
import { mintPlayerId } from './identity.js';
import { validateScore, formatScore } from './scoring.js';

export const NORMALIZATION_VERSION = '1';

/**
 * Founding-id resolver: a player's canonical UUID is minted from their TOUR id (atp:/wta:). Slam feeds
 * embed tour ids, so a Wimbledon row and a WTA API row for the same player land on the same UUID with
 * no name matching. Anything without a tour id is unresolved (-> identity queue), never guessed.
 */
export async function tourIdResolver(member) {
  const tour = member.provider === 'wta' || member.provider === 'atp' ? { provider: member.provider, provider_id: member.provider_id } : member.tour_id;
  if (!tour?.provider_id) return { status: 'unresolved', reason: 'no_tour_id', member };
  return { status: 'resolved', pbe_player_id: await mintPlayerId(tour.provider, tour.provider_id), method: 'founding', external: `${tour.provider}:${String(tour.provider_id).toUpperCase()}` };
}

export async function normalizeMatch(sm, { resolve = tourIdResolver } = {}) {
  const problems = [...(sm.warnings || [])];
  if (!sm.event_type) problems.push('no_event_type');
  const sides = {};
  const identities = [];
  for (const side of ['A', 'B']) {
    const members = [];
    for (const m of sm.sides?.[side] || []) {
      const r = await resolve(m);
      identities.push({ side, source: m, ...r });
      if (r.status !== 'resolved') { problems.push(`unresolved_identity:${m.provider}:${m.provider_id}`); continue; }
      members.push({ player_id: r.pbe_player_id, gender: m.gender });
    }
    sides[side] = members;
  }
  let participants = null;
  if (!problems.some((p) => p.startsWith('unresolved_identity') || p === 'no_event_type')) {
    try {
      const built = makeMatchSides(sm.event_type, sides.A, sides.B);
      participants = { A: built.A.participant_key, B: built.B.participant_key, members: { A: built.A.members, B: built.B.members } };
    } catch (e) {
      problems.push(`participant_invalid:${e.code || e.message}`);
    }
  }
  let validation = null;
  const terminal = ['completed', 'retired', 'walkover'].includes(sm.status);
  if (terminal && sm.format_key) {
    const end = sm.status === 'retired' ? 'retirement' : sm.status === 'walkover' ? 'walkover' : 'completed';
    validation = validateScore({ sets: sm.sets, end_reason: end }, sm.format_key);
    if (!validation.ok) problems.push(...validation.errors.map((e) => `score_invalid:${e}`));
    if (end === 'completed' && validation.winner && sm.winner_side && validation.winner !== sm.winner_side) problems.push('winner_disagrees_with_score');
  } else if (terminal) {
    problems.push('score_unvalidated:no_format');
  }
  const canonical = participants && !problems.some((p) => /^(score_invalid|winner_disagrees|participant_invalid)/.test(p));
  return {
    normalization_version: NORMALIZATION_VERSION,
    canonical: !!canonical,
    problems,
    match: {
      external: { provider: sm.provider, id: sm.provider_match_id },
      event_type: sm.event_type,
      stage: sm.stage,
      round_code: sm.round_code,
      format_key: sm.format_key,
      status: sm.status,
      winner_side: sm.winner_side,
      end_reason: sm.end_reason,
      score_text: sm.sets?.length || sm.status === 'walkover' ? formatScore(sm.sets || [], sm.end_reason) : null,
      sets: sm.sets,
      live: sm.live,
      participants,
      duration_s: sm.duration_s ?? null,
      source_updated_at: sm.source_updated_at ?? null
    },
    identities
  };
}
