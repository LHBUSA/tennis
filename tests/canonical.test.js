// Participant abstraction, identity graph, change ledger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeParticipant, makeMatchSides, participantKey, pairSnapshotKey } from '../workers/shared/canonical/participant.js';
import { normalizeName, aliasKeys, feedNameKey, resolveIdentity, externalKey, uuidv5, mintPlayerId } from '../workers/shared/canonical/identity.js';
import { diffRecord } from '../workers/shared/change-ledger.js';
import { startMatch, applyPoint } from '../workers/shared/canonical/scoring.js';

// Synthetic test UUIDs (not real players).
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M = (n) => ({ player_id: U(n), gender: 'M' });
const F = (n) => ({ player_id: U(n), gender: 'F' });

test('singles participant is a team of one', () => {
  const p = makeParticipant('MS', [M(1)]);
  assert.equal(p.kind, 'singles');
  assert.equal(p.participant_key, `S:${U(1)}`);
  assert.throws(() => makeParticipant('MS', [M(1), M(2)]), /wrong_team_size/);
  assert.throws(() => makeParticipant('WS', [M(1)]), /gender_mismatch/);
});

test('doubles pair key is order-independent (A+B == B+A)', () => {
  const ab = makeParticipant('MD', [M(7), M(3)]);
  const ba = makeParticipant('MD', [M(3), M(7)]);
  assert.equal(ab.participant_key, ba.participant_key);
  assert.equal(ab.participant_key, `D:${U(3)}+${U(7)}`);
  assert.deepEqual(ab.members.map((m) => m.slot), [1, 2]);
  assert.equal(pairSnapshotKey(U(7), U(3), '2026-09-26', 1), pairSnapshotKey(U(3), U(7), '2026-09-26', 1));
});

test('mixed doubles requires one woman and one man; unknown gender fails closed', () => {
  assert.equal(makeParticipant('XD', [M(1), F(2)]).event_type, 'XD');
  assert.throws(() => makeParticipant('XD', [M(1), M(2)]), /gender_mismatch/);
  assert.throws(() => makeParticipant('XD', [M(1), { player_id: U(2) }]), /member_gender_unknown/);
});

test('match sides: distinct teams, no player on both sides; scoring is team-size agnostic', () => {
  const sides = makeMatchSides('WD', [F(1), F(2)], [F(3), F(4)]);
  assert.notEqual(sides.A.participant_key, sides.B.participant_key);
  assert.throws(() => makeMatchSides('WD', [F(1), F(2)], [F(2), F(4)]), /player_on_both_sides/);
  assert.throws(() => makeMatchSides('WD', [F(1), F(2)], [F(2), F(1)]), /same_participant_both_sides/);
  let s = startMatch('DOUBLES_TOUR', 'A');
  for (let i = 0; i < 4; i++) s = applyPoint(s, 'A');
  assert.deepEqual(s.sets[0].games, { A: 1, B: 0 });
  assert.throws(() => participantKey(['not-a-uuid']), /member_not_canonical_uuid/);
});

test('normalizeName folds accents, hyphens, apostrophes', () => {
  assert.equal(normalizeName('Félix Auger-Aliassime'), 'felix auger aliassime');
  assert.equal(normalizeName('Iga Świątek'), 'iga swiatek');
  assert.equal(normalizeName('Łukasz Kubot'), 'lukasz kubot');
  assert.equal(normalizeName("O’Connell"), 'oconnell');
  assert.equal(normalizeName('Björn  Borg'), 'bjorn borg');
  assert.equal(normalizeName('Holger Vitus Nødskov Rune'), 'holger vitus nodskov rune');
});

test('alias keys cover feed spellings but never resolve alone', () => {
  const keys = aliasKeys({ first_name: 'Jannik', last_name: 'Sinner' });
  assert.ok(keys.includes('sinner j'));
  assert.ok(keys.includes('j sinner'));
  assert.equal(feedNameKey('Sinner, Jannik'), 'sinner jannik');
  assert.ok(keys.includes(feedNameKey('Sinner, Jannik')));
});

test('identity resolution is deterministic and conservative', () => {
  const index = {
    byExternal: new Map([[externalKey('wta', '100'), U(10)]]),
    players: [
      { pbe_player_id: U(10), full_name: 'Anna Example', dob: '2000-01-01', nationality: 'CZE' },
      { pbe_player_id: U(11), full_name: 'Maria Sample', dob: '1999-05-05', nationality: 'ESP' },
      { pbe_player_id: U(12), full_name: 'Maria Sample', dob: '2003-02-02', nationality: 'ARG' }
    ]
  };
  assert.deepEqual(resolveIdentity({ provider: 'WTA', provider_id: '100', full_name: 'whatever' }, index).pbe_player_id, U(10));
  assert.equal(resolveIdentity({ provider: 'itf', provider_id: '9', full_name: 'Anna Example' }, index).status, 'unresolved', 'name alone is never identity');
  const byDob = resolveIdentity({ provider: 'itf', provider_id: '9', full_name: 'ANNA EXAMPLE', dob: '2000-01-01', nationality: 'CZE' }, index);
  assert.equal(byDob.status, 'resolved');
  assert.equal(byDob.method, 'name_dob');
  assert.equal(resolveIdentity({ full_name: 'Maria Sample', dob: '1990-01-01' }, index).reason, 'dob_conflict');
  assert.equal(resolveIdentity({ full_name: 'Anna Example', dob: '2000-01-01', nationality: 'SVK' }, index).reason, 'nationality_conflict');
  assert.equal(resolveIdentity({ full_name: 'Nobody Here', dob: '2000-01-01' }, index).reason, 'no_candidate');
});

test('uuidv5 matches the RFC test vector; player ids are stable', async () => {
  assert.equal(await uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
  assert.equal(await mintPlayerId('WTA', '320760'), await mintPlayerId('wta', ' 320760 '));
  assert.notEqual(await mintPlayerId('wta', '1'), await mintPlayerId('atp', '1'));
});

test('change ledger classifies meaningful mutations', () => {
  const prev = { id: 'm1', scheduled_at: '2026-09-27T05:00:00Z', status: 'scheduled', side_b_key: 'S:x', score: null };
  const next = { id: 'm1', scheduled_at: '2026-09-27T07:30:00Z', status: 'scheduled', side_b_key: 'S:y', score: null };
  const kinds = diffRecord('match', prev, next).map((c) => c.kind);
  assert.deepEqual(kinds.sort(), ['opponent_changed', 'schedule_time_changed']);
  const corr = diffRecord('match', { id: 'm1', status: 'completed', score: '6-4 6-4' }, { id: 'm1', status: 'completed', score: '6-4 7-5' });
  assert.equal(corr[0].kind, 'score_correction');
  assert.equal(diffRecord('draw_entry', { id: 'e', entry_type: null }, { id: 'e', entry_type: 'LL' })[0].kind, 'lucky_loser_entry');
  assert.equal(diffRecord('match', { id: 'm', status: 'in_progress' }, { id: 'm', status: 'retired' })[0].kind, 'retirement');
  assert.equal(diffRecord('ranking', null, { id: 'r' })[0].kind, 'created');
  assert.deepEqual(diffRecord('ranking', { id: 'r', rank: 5, points: 100 }, { id: 'r', rank: 5, points: 100 }), []);
});
