// Homepage V2 selection helpers (src/lib/home.js): real values only, truthful empties, ATP/WTA parity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tourTag, tournamentName, roundShort, liveGroups, nextMatch, orderTournaments, latestSlams, heroPick, playersToWatch } from '../src/lib/home.js';

const T = (slug, name, extra = {}) => ({ slug, year: 2026, name, tournament: name, ...extra });

test('names: source location tails removed, casing slip fixed, sponsor-free names untouched', () => {
  assert.equal(tournamentName(T('us-open', 'US Open - New York, NY, USA')), 'US Open');
  assert.equal(tournamentName(T('adana', 'Adana Open - Adana, TUR')), 'Adana Open');
  assert.equal(tournamentName({ tournament: 'Us Open' }), 'US Open');
  assert.equal(tournamentName(T('jo', 'Kinoshita Group Japan Open Tennis Championships')), 'Kinoshita Group Japan Open Tennis Championships');
  assert.equal(tourTag('atp'), 'ATP'); assert.equal(tourTag('wta-125'), 'WTA 125'); assert.equal(tourTag('itf'), null, 'never guessed');
  assert.deepEqual(['1', 'M-4', 'Q-2', 'S', 'F'].map(roundShort), ['R1', 'R4', 'Q2', 'SF', 'F']);
});

test('live status: grouped per tournament, busiest first; nothing live -> [] (no fake ticker)', () => {
  const a = T('adana', 'Adana Open - Adana, TUR');
  const c = T('china-open', 'China Open');
  const g = liveGroups([{ tournament: a, round: 'M-2' }, { tournament: c, round: '1' }, { tournament: c, round: '1' }]);
  assert.deepEqual(g.map((x) => [x.name, x.count, x.rounds.join()]), [['China Open', 2, 'R1'], ['Adana Open', 1, 'R2']]);
  assert.deepEqual(liveGroups([]), []);
});

test('next match: only a real clock time, soonest first; date-only source times are skipped', () => {
  const now = Date.parse('2026-09-30T00:00:00Z');
  const m = nextMatch([{ status: 'scheduled', scheduled_at: '2026-09-30' }, { id: 'b', status: 'scheduled', scheduled_at: '2026-09-30T03:00:00Z' }, { id: 'a', status: 'scheduled', scheduled_at: '2026-09-30T02:00:00Z' }], { now });
  assert.equal(m.id, 'a');
  assert.equal(nextMatch([{ status: 'scheduled', scheduled_at: '2026-09-30' }], { now }), null);
});

test('tournaments: live first with live counts, then most recent start; slams limited to the latest 3', () => {
  const x = orderTournaments([T('a', 'A', { start_date: '2026-09-28' }), T('b', 'B', { start_date: '2026-09-21' })], [{ tournament: T('b', 'B') }]);
  assert.deepEqual(x.map((t) => [t.slug, t.live_count]), [['b', 1], ['a', 0]]);
  const s = latestSlams([{ start_date: '2026-01-18' }, { start_date: '2026-08-30' }, { start_date: '2026-05-24' }, { start_date: '2026-06-29' }]);
  assert.deepEqual(s.map((e) => e.start_date), ['2026-08-30', '2026-06-29', '2026-05-24']);
});

test('hero: only an approved-photo featured player, alternating the first two by UTC day; none -> null (court art)', () => {
  const ph = { portrait: 'p.webp', credit: 'x' };
  const f = [{ player: { slug: 'z', name: 'Z', photo: ph }, note: 'Champion · Us Open 2026' }, { player: { slug: 'r', name: 'R', photo: ph }, note: 'Champion · Us Open 2026' }];
  const d0 = heroPick(f, { now: 0 });
  const d1 = heroPick(f, { now: 86400e3 });
  assert.notEqual(d0.player.slug, d1.player.slug);
  assert.equal(d0.note, 'Champion · US Open 2026');
  assert.equal(heroPick([{ player: { slug: 'n', name: 'N', photo: null } }]), null);
  assert.equal(heroPick([]), null);
});

test('players to watch: featured first, then ATP and WTA interleaved; ATP rank carries its secondary-source label', () => {
  const p = (id, g) => ({ id, slug: id, name: id, gender: g });
  const out = playersToWatch([{ player: p('zv', 'M'), note: 'Champion' }], [{ rank: 1, player: p('si', 'M') }, { rank: 2, player: p('zv', 'M') }], [{ rank: 1, player: p('sa', 'F') }], { limit: 12 });
  assert.deepEqual(out.map((x) => x.player.id), ['zv', 'si', 'sa']);
  assert.match(out[1].note, /secondary-source/);
  assert.equal(out[2].note, 'WTA No. 1');
});
