// Canonical participant model. A match is participant A vs participant B; a participant is a team of
// one (singles) or two (doubles, mixed doubles). Doubles are NEVER collapsed into single-player rows.
// Contract: docs/TENNIS_DATA_MODEL.md §Participants.

export const EVENT_TYPES = Object.freeze({
  MS: { key: 'MS', label: "Men's Singles", size: 1, genders: ['M'] },
  WS: { key: 'WS', label: "Women's Singles", size: 1, genders: ['F'] },
  MD: { key: 'MD', label: "Men's Doubles", size: 2, genders: ['M', 'M'] },
  WD: { key: 'WD', label: "Women's Doubles", size: 2, genders: ['F', 'F'] },
  XD: { key: 'XD', label: 'Mixed Doubles', size: 2, genders: ['F', 'M'] }
});

export class ParticipantError extends Error {
  constructor(code, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Deterministic participant key. Members are ordered by canonical player UUID, so
 * pair(A,B) and pair(B,A) are the same team. `S:<uuid>` for singles, `D:<uuid>+<uuid>` for pairs.
 */
export function participantKey(playerIds) {
  const ids = [...playerIds].map(String);
  for (const id of ids) if (!UUID.test(id)) throw new ParticipantError('member_not_canonical_uuid', id);
  if (new Set(ids).size !== ids.length) throw new ParticipantError('duplicate_member', ids.join(','));
  if (ids.length === 1) return `S:${ids[0]}`;
  if (ids.length === 2) return `D:${ids.sort().join('+')}`;
  throw new ParticipantError('invalid_team_size', String(ids.length));
}

/**
 * Build a participant for an event. `members`: [{ player_id, gender }]. Gender is only used to
 * validate the event (a mixed team must be one woman and one man); it is never inferred from a name —
 * a missing gender fails validation rather than guessing.
 */
export function makeParticipant(eventType, members) {
  const ev = EVENT_TYPES[eventType];
  if (!ev) throw new ParticipantError('unknown_event_type', eventType);
  if (!Array.isArray(members) || members.length !== ev.size) throw new ParticipantError('wrong_team_size', `${eventType} needs ${ev.size}`);
  const genders = members.map((m) => m.gender);
  if (genders.some((g) => g !== 'M' && g !== 'F')) throw new ParticipantError('member_gender_unknown', eventType);
  if ([...genders].sort().join() !== [...ev.genders].sort().join()) throw new ParticipantError('gender_mismatch', `${eventType}: ${genders.join('/')}`);
  const key = participantKey(members.map((m) => m.player_id));
  const ordered = [...members].sort((a, b) => (a.player_id < b.player_id ? -1 : 1));
  return Object.freeze({
    participant_key: key,
    kind: ev.size === 1 ? 'singles' : 'pair',
    event_type: eventType,
    members: Object.freeze(ordered.map((m, i) => Object.freeze({ player_id: m.player_id, slot: i + 1 })))
  });
}

export const isSameTeam = (a, b) => a.participant_key === b.participant_key;

/** A match row: exactly two distinct participants of the same event type, no shared player. */
export function makeMatchSides(eventType, sideA, sideB) {
  const a = makeParticipant(eventType, sideA);
  const b = makeParticipant(eventType, sideB);
  if (isSameTeam(a, b)) throw new ParticipantError('same_participant_both_sides');
  const shared = a.members.filter((m) => b.members.some((n) => n.player_id === m.player_id));
  if (shared.length) throw new ParticipantError('player_on_both_sides', shared[0].player_id);
  return { A: a, B: b };
}

/** Pair snapshot identity: player_a + player_b + as_of + definition_version (ordered). */
export function pairSnapshotKey(playerX, playerY, asOf, definitionVersion) {
  const key = participantKey([playerX, playerY]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new ParticipantError('invalid_as_of', asOf);
  return `${key}@${asOf}#v${Number(definitionVersion)}`;
}
