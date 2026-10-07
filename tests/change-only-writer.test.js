// Change-only writes (2026-10-07, tkmln write relief): the writer skips rows whose content did not change. PARITY: on
// recorded official-feed payloads re-polled tick by tick, the stored state after every tick is identical to the forced
// full write (the pre-change behaviour, kept as `full: true`), except updated_at, which now moves only when the match
// (row, sets or participants) changed or while it is in progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeMatches, sameValue, rowChanged, writerOpts } from '../workers/tennis-ingest/src/writer.js';
import { buildTicks, replay, stateOf, writeVolume, matchContent, EDITIONS } from './helpers/writer-ticks.js';

const TICKS = buildTicks();

test('parity: change-only and full writes leave the same stored state after every tick (recorded live + static payloads)', async () => {
  assert.ok(TICKS.length > 300, 'hundreds of re-polls, most of them repeating the previous payload');
  const full = [];
  const changeOnly = [];
  const a = await replay(writeMatches, TICKS, { opts: { full: true }, onTick: (s) => full.push(JSON.stringify(stateOf(s))) });
  const b = await replay(writeMatches, TICKS, { onTick: (s) => changeOnly.push(JSON.stringify(stateOf(s))) });
  for (let i = 0; i < TICKS.length; i += 1) assert.equal(changeOnly[i], full[i], `tick ${i}: stored state differs`);
  const st = stateOf(b);
  assert.ok(st.tennis_matches.length >= 10 && st.tennis_sets.length > 20 && st.tennis_match_events.length > 200 && st.tennis_source_changes.length > 100, 'the replay exercises matches, sets, live events and change rows');
  // the full write sends every row every tick; change-only sends what changed
  const va = writeVolume(a);
  const vb = writeVolume(b);
  for (const t of ['tennis_match_participants', 'tennis_sets', 'tennis_match_external_ids', 'tennis_participants', 'tennis_participant_members', 'tennis_draws', 'tennis_players']) assert.ok(vb[t] * 10 < va[t], `${t}: ${vb[t]} rows vs ${va[t]}`);
  assert.ok(vb.tennis_matches * 3 < va.tennis_matches, `tennis_matches: ${vb.tennis_matches} rows vs ${va.tennis_matches}`);
});

test('updated_at moves exactly when the match changed (row, sets, participants) or while it is in progress', async () => {
  // oracle for "written this pass" = the full write (it rewrites every accepted row; held rows are never written)
  const fullMoved = [];
  const fprev = new Map();
  await replay(writeMatches, TICKS, { opts: { full: true }, onTick: (s) => { const mv = new Set(); for (const m of s.rows('tennis_matches')) { if (fprev.get(m.match_id) !== m.updated_at) mv.add(m.match_id); fprev.set(m.match_id, m.updated_at); } fullMoved.push(mv); } });
  const last = new Map();
  const content = new Map();
  let moves = 0;
  let checks = 0;
  let fullWrites = 0;
  await replay(writeMatches, TICKS, {
    onTick: (s, t) => {
      for (const m of s.rows('tennis_matches')) {
        const c = matchContent(s, m.match_id);
        const moved = last.get(m.match_id) !== m.updated_at;
        const changed = content.get(m.match_id) !== c;
        const accepted = fullMoved[t.tick].has(m.match_id);
        if (accepted) fullWrites += 1;
        checks += 1;
        // a new or changed match, or an accepted in-progress observation (live heartbeat); never a held row
        assert.equal(moved, changed || (m.status === 'in_progress' && accepted), `tick ${t.tick} ${m.match_id} ${m.status}: moved=${moved} changed=${changed}`);
        if (moved) { moves += 1; assert.ok(accepted, 'never a row the full write would not have written'); }
        last.set(m.match_id, m.updated_at);
        content.set(m.match_id, c);
      }
    }
  });
  assert.ok(checks > 3000 && moves > 0 && moves * 4 < fullWrites, `${moves} row writes vs ${fullWrites} full-mode row writes in ${checks} row-ticks`);
});

test('a changed live score is written on the pass that observes it (no latency added)', async () => {
  // replay until the first tick where a live set score changes, then check the stored row carries it at once
  let seen = 0;
  await replay(writeMatches, TICKS.slice(0, 120), {
    onTick: (s, t) => {
      for (const g of t.groups) for (const r of g.records) {
        if (r.status !== 'in_progress' || s.rows('tennis_ingest_holds').some((h) => h.external_id === r.provider_match_id && !h.resolved_at)) continue; // held rows are never written
        const ext = s.rows('tennis_match_external_ids').find((e) => e.external_id === r.provider_match_id);
        const row = s.rows('tennis_matches').find((m) => m.match_id === ext?.match_id);
        if (!row) continue;
        const sets = s.rows('tennis_sets').filter((x) => x.match_id === row.match_id).sort((x, y) => x.set_no - y.set_no).map((x) => `${x.games_a}-${x.games_b}`);
        assert.deepEqual(sets, r.sets.map((x) => `${x.games.A}-${x.games.B}`), `tick ${t.tick}: stored sets lag the observed score`);
        assert.equal(JSON.stringify(row.live_state ?? null), JSON.stringify(r.live ?? null));
        seen += 1;
      }
    }
  });
  assert.ok(seen > 50);
});

test('the observation collector names every edition whose rows were confirmed, unchanged ones included', async () => {
  const observed = new Map();
  const t = TICKS.at(-1);
  await replay(writeMatches, [TICKS[0], t], { opts: { observed } });
  assert.deepEqual([...observed.keys()].sort(), Object.values(EDITIONS).map((e) => e.edition_id).sort());
  assert.deepEqual(writerOpts({ reconcile: true, observed }), { full: true, observed });
  assert.deepEqual(writerOpts({}), { full: false, observed: null });
});

test('sameValue / rowChanged compare stored content, never formats', () => {
  assert.ok(sameValue('scheduled_at', '2026-10-03T03:00:00+00:00', '2026-10-03T03:00:00.000Z'), 'timestamptz text vs ISO Z');
  assert.ok(!sameValue('scheduled_at', '2026-10-03T03:00:00+00:00', '2026-10-03T03:00:01Z'));
  assert.ok(sameValue('live_state', { server: 'A', points: { B: '15', A: '30' } }, { points: { A: '30', B: '15' }, server: 'A', gone: undefined }), 'jsonb key order / undefined');
  assert.ok(!sameValue('live_state', { points: { A: '30' } }, { points: { A: '40' } }));
  assert.ok(sameValue('seed', 4, '4') && sameValue('indoor', true, true) && sameValue('court', null, undefined));
  assert.ok(!sameValue('court', null, 'Court 1') && !sameValue('indoor', false, null));
  assert.ok(!rowChanged({ a: 1, b: 2, updated_at: 'x' }, { a: '1', updated_at: 'y' }, ['a', 'b']), 'only named columns, never updated_at');
  assert.ok(rowChanged(undefined, { a: 1 }, ['a']), 'a new row is a change');
});
