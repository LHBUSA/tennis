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

// Tour-aware live state (2026-10-02): "only WTA live" must never read as "ATP not covered".
import { tourStatus, matchTour } from '../src/lib/home.js';
import { tourLines, castTourState, TOURS_PENDING } from '../src/ui/home.js';

const TNOW = Date.parse('2026-10-02T19:40:00Z');
const at = (h) => new Date(TNOW + h * 3600e3).toISOString();
const P = (n) => ({ players: [{ slug: n.toLowerCase(), name: n, last_name: n }] });
const M = (id, tour, event_type, status, h, extra = {}) => ({ id, tour, event_type, status, scheduled_at: h == null ? null : at(h), sides: { A: P(`${id}a`), B: P(`${id}b`) }, tournament: { name: tour === 'atp' ? 'China Open' : 'Adana Open - Adana, TUR', slug: 't', year: 2026, level: tour === 'atp' ? null : 'WTA 125' }, ...extra });
const ts = (live, up) => Object.fromEntries(tourStatus(live, up, { now: TNOW }).map((r) => [r.tour, r]));
const text = (x) => String(x).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('tour state: only WTA live -> ATP still listed with its next real start', () => {
  const s = ts([M('w1', 'wta-125', 'WS', 'in_progress', -1)], [M('a1', 'atp', 'MS', 'scheduled', 6), M('a0', 'atp', 'MD', 'scheduled', 5)]);
  assert.deepEqual([s.atp.live, s.wta.live], [0, 1]);
  assert.equal(s.atp.next[0].id, 'a0', 'soonest first');
  const out = text(tourLines(Object.values(s)));
  assert.match(out, /ATP No ATP matches live · next at /);
  assert.match(out, /WTA 1 match live 1 singles/);
});
test('tour state: only ATP live (ESPN rows) -> WTA listed; ATP counted from event/tour', () => {
  const s = ts([M('a1', 'atp', 'MS', 'in_progress', -1), M('a2', 'atp', 'MS', 'in_progress', -1), M('a3', 'atp', 'MD', 'in_progress', -1)], [M('w1', 'wta', 'WS', 'scheduled', 3)]);
  assert.deepEqual([s.atp.live, s.atp.singles, s.atp.doubles, s.wta.live], [3, 2, 1, 0]);
  assert.match(text(tourLines(Object.values(s))), /ATP 3 matches live 2 singles · 1 doubles.*WTA No WTA matches live · next at/);
});
test('tour state: ATP + WTA live together; doubles-only live', () => {
  const s = ts([M('a1', 'atp', 'MS', 'in_progress', -1), M('w1', 'wta', 'WD', 'in_progress', -1), M('w2', 'wta-125', 'WD', 'in_progress', -1)], []);
  assert.deepEqual([s.atp.live, s.wta.live, s.wta.singles, s.wta.doubles], [1, 2, 0, 2]);
  assert.match(text(tourLines(Object.values(s))), /WTA 2 matches live 2 doubles/);
});
test('tour state: neither live, both upcoming; one tour with nothing in the window says so (no guessed date)', () => {
  const both = ts([], [M('a1', 'atp', 'MS', 'scheduled', 2), M('w1', 'wta', 'WS', 'scheduled', 4)]);
  assert.ok(both.atp.next.length && both.wta.next.length);
  const one = ts([], [M('w1', 'wta', 'WS', 'scheduled', 4)]);
  const out = text(tourLines(Object.values(one)));
  assert.match(out, /ATP No ATP matches live · no scheduled match in current window/);
  assert.doesNotMatch(out, /ATP[^W]*next at/);
});
test('tour state: stale past rows, date-only rows, non-scheduled rows and mixed doubles never become "next" / never guessed', () => {
  const s = ts([M('x', null, 'XD', 'in_progress', -1, { tour: 'grand-slam', tournament: { level: 'Grand Slam' } })],
    [M('old', 'atp', 'MS', 'scheduled', -30), M('dateonly', 'wta', 'WS', 'scheduled', null), M('susp', 'atp', 'MS', 'suspended', 2)]);
  assert.deepEqual([s.atp.live, s.wta.live, s.atp.next.length, s.wta.next.length], [0, 0, 0, 0]);
});
test('tour state: /v1/live rows (no tour field) resolve by WTA level or event code', () => {
  assert.equal(matchTour({ event_type: 'WS', tournament: { level: 'WTA 125' } }), 'wta');
  assert.equal(matchTour({ event_type: 'MS', tournament: { level: null } }), 'atp');
  assert.equal(matchTour({ tour: 'grand-slam', event_type: 'WD' }), 'wta');
  assert.equal(matchTour({ tour: 'grand-slam', event_type: 'XD' }), null);
});
test('PBEcast top state: LIVE NOW ATP xN / WTA xN and UP NEXT per tour with Singles/Doubles; neither tour hidden', () => {
  const rows = tourStatus([M('w1', 'wta-125', 'WS', 'in_progress', -1)], [M('a1', 'atp', 'MD', 'scheduled', 2), M('a2', 'atp', 'MS', 'scheduled', 3)], { now: TNOW });
  const full = text(castTourState(rows));
  assert.match(full, /Live now ATP ×0 No ATP matches live WTA ×1 1 singles/);
  assert.match(full, /Up next ATP .*Doubles a1a vs a1b China Open.*Singles a2a vs a2b China Open WTA No scheduled match in current window/);
  const compact = text(castTourState(rows, { compact: true }));
  assert.doesNotMatch(compact, /a2a/, 'compact strip: one next match per tour');
  assert.match(text(castTourState(TOURS_PENDING, { compact: true, state: 'pending' })), /ATP … WTA …/);
  assert.match(text(tourLines(TOURS_PENDING, { state: 'pending' })), /ATP Checking… WTA Checking…/);
});
