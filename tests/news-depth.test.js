// Tennis newsroom V4 depth (packet 4.0.0 / plan 4.0.0 / compose 4.0.0 / gates 4.0.0): evidence families, the pure data
// modules, graceful thin degradation, the intelligence gates and the front-end renderer. Rich = Slam-style stats with
// per-set totals + a complete point-by-point sequence; thin = a secondary-source result with no statistics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statLines, perSetLines, developmentFrom } from '../workers/tennis-news/src/packet.js';
import { buildModules, buildPlan } from '../workers/tennis-news/src/plan.js';
import { compose } from '../workers/tennis-news/src/compose.js';
import { runGates, intelligenceFailures } from '../workers/tennis-news/src/gates.js';
import { depthInserts } from '../src/ui/news-modules.js';

const A = { id: 'pa', slug: 'ann-alpha', name: 'Ann Alpha', last_name: 'ALPHA', rank: { rank: 87, list_date: '2026-09-14', list: 'wta_singles' } };
const B = { id: 'pb', slug: 'bea-beta', name: 'Bea Beta', last_name: 'BETA', rank: { rank: 6, list_date: '2026-09-14', list: 'wta_singles' } };
const set = (n, o) => ({ set_no: n, ...o });
const statsA = { service_points: 70, first_serves_in: 45, first_serve_points_won: 33, second_serve_points_won: 13, aces: 6, double_faults: 2, break_points_faced: 6, break_points_saved: 4, total_points_won: 78, service_games: 11, winners: 31, unforced_errors: 24, net_points: 14, net_points_won: 10,
  per_set: [set(1, { total_points_won: 30, break_points_faced: 3, break_points_saved: 3, service_points: 30, first_serve_points_won: 14, second_serve_points_won: 6 }), set(2, { total_points_won: 48, break_points_faced: 3, break_points_saved: 1, service_points: 40, first_serve_points_won: 19, second_serve_points_won: 7 })] };
const statsB = { service_points: 74, first_serves_in: 48, first_serve_points_won: 31, second_serve_points_won: 10, aces: 3, double_faults: 5, break_points_faced: 9, break_points_saved: 5, total_points_won: 66, service_games: 11, winners: 19, unforced_errors: 37, net_points: 9, net_points_won: 4,
  per_set: [set(1, { total_points_won: 22, break_points_faced: 4, break_points_saved: 2, service_points: 32, first_serve_points_won: 16, second_serve_points_won: 5 }), set(2, { total_points_won: 44, break_points_faced: 5, break_points_saved: 3, service_points: 42, first_serve_points_won: 15, second_serve_points_won: 5 })] };

// a complete observed sequence for 6-3 6-4 (19 games): A breaks in set 1 game 4, set 2 game 3 and 7; B breaks set 2 game 6
function games() {
  const g = [];
  const seq = [['A', 'A'], ['B', 'B'], ['A', 'A'], ['B', 'A'], ['A', 'A'], ['B', 'B'], ['A', 'A'], ['B', 'B'], ['A', 'A'],
    ['A', 'A'], ['B', 'B'], ['A', 'A'], ['B', 'B'], ['A', 'A'], ['B', 'A'], ['A', 'B'], ['B', 'B'], ['A', 'A'], ['B', 'A']];
  seq.forEach(([server, winner], i) => { const s = i < 9 ? 1 : 2; g.push({ set: s, game: s === 1 ? i + 1 : i - 8, server, winner, result: server === winner ? 'hold' : 'break' }); });
  return g;
}

function rich(over = {}) {
  return {
    version: 'tennis-packet/4.0.0', built_at: '2026-09-20T12:00:00Z',
    event: { kind: 'upset', event_id: 'upset:x', materiality: 82, facts: { winner_rank: 87, loser_rank: 6, list_date: '2026-09-14' }, occurred_at: '2026-09-19T10:00:00Z' },
    provenance: { data_brand: 'DATA · PropSports', data_url: 'https://propsports.proptechusa.ai', upstream: [{ family: 'wta', what: 'match result' }] },
    match: { id: 'm-rich', event_type: 'WS', round: 'M-Q', round_label: 'quarterfinal', format: 'BO3_TB7', best_of: 3, status: 'completed', winner_side: 'A', score: '6-3 6-4', sets: [{ A: 6, B: 3, tb: null }, { A: 6, B: 4, tb: null }], duration_s: 5400, duration: { hours: 1, minutes: 30 }, started_at: '2026-09-19T10:00:00Z', date: '2026-09-19' },
    participants: { A: { key: 'S:a', players: [A] }, B: { key: 'S:b', seed: 2, players: [B] } },
    tournament: { edition_id: 'e', slug: 'test-open', name: 'Test Open', year: 2026, level: 'WTA 500', surface: 'hard', start_date: '2026-09-14', end_date: '2026-09-21' },
    stats: statLines(statsA, statsB),
    stats_by_set: perSetLines(statsA, statsB),
    match_development: developmentFrom(games(), { source: 'point_by_point', totalGames: 19 }),
    recent_form: { pa: [{ result: 'W', opponent: [{ name: 'Cat Gamma' }], tournament: 'Other Open', year: 2026, round_label: 'final', score: '6-1 6-1' }] },
    next: { match_id: 'm-next', round_label: 'semifinal', opponent: [{ id: 'pc', slug: 'cat-gamma', name: 'Cat Gamma' }] },
    canonical_signature: 'upset:m-rich',
    ...over
  };
}
// thin: secondary-source result, no statistics, no observed games, no form
const thin = () => rich({ stats: null, stats_by_set: null, match_development: null, recent_form: null, next: null, participants: { A: { key: 'S:a', players: [{ ...A, rank: null }] }, B: { key: 'S:b', players: [{ ...B, rank: null }] } } });
const ids = (r) => r.modules.map((m) => m.id);

test('families: serve/return games and per-set lines come from stored totals only', () => {
  const s = statLines(statsA, statsB);
  assert.deepEqual([s.A.service_games_held.n, s.A.service_games_held.d], [9, 11], 'held = service games − breaks conceded');
  assert.deepEqual([s.A.return_games_won.n, s.A.return_games_won.d], [4, 11]);
  assert.equal(s.A.break_chances, 9); assert.equal(s.A.winners, 31); assert.equal(s.B.unforced_errors, 37);
  const bare = statLines({ ...statsA, service_games: undefined, winners: undefined, unforced_errors: undefined, net_points: undefined }, statsB);
  assert.equal(bare.A.service_games_held, null, 'no service-games count → no holds (never estimated)');
  assert.equal(bare.A.winners, null); assert.equal(bare.A.net_points_won, null);
  const ps = perSetLines(statsA, statsB);
  assert.deepEqual(ps.map((r) => [r.set, r.breaks.A, r.breaks.B]), [[1, 2, 0], [2, 2, 2]]);
  assert.equal(perSetLines({ ...statsA, per_set: null }, statsB), null);
  assert.equal(perSetLines(statsA, { ...statsB, per_set: [statsB.per_set[0]] }), null, 'mismatched sets → nothing');
});

test('development: complete sequences give totals + runs; partial sequences never do', () => {
  const d = developmentFrom(games(), { source: 'point_by_point', totalGames: 19 });
  assert.equal(d.complete, true);
  assert.deepEqual(d.breaks_total, { A: 3, B: 1 });
  assert.deepEqual(d.first_break, { set: 1, game: 4, by: 'A', server: 'B' });
  assert.deepEqual(d.longest_run, { side: 'A', games: 3, from_set: 1, to_set: 1 }, 'set 1 games 3-5');
  const runG = games(); runG[5] = { ...runG[5], winner: 'A', result: 'break' };
  // A now wins set 1 games 3-7: 5 straight (game 4 break, 5 hold, 6 break, 7 hold)
  assert.equal(developmentFrom(runG, { source: 'point_by_point', totalGames: 19 }).longest_run.games, 5);
  assert.equal(developmentFrom(games().slice(0, 2), { source: 'point_by_point', totalGames: 19 }).longest_run, null, 'short sequences: no run');
  const part = developmentFrom(games().slice(6), { source: 'observed_score', totalGames: 19 });
  assert.equal(part.complete, false); assert.equal(part.longest_run, null); assert.equal(part.breaks_total, null, 'partial live coverage never claims match totals');
  assert.equal(part.first_break, null, 'unobserved games may hold an earlier break'); assert.ok(part.breaks.length);
  assert.equal(developmentFrom([], { source: 'observed_score', totalGames: 19 }), null);
});

test('buildModules (rich): every module present, values copied from the packet', () => {
  const r = buildModules(rich());
  assert.deepEqual(ids(r), ['key_numbers', 'set_by_set', 'serve_profile', 'return_pressure', 'match_development', 'player_context']);
  const get = (id) => r.modules.find((m) => m.id === id).data;
  assert.ok(get('key_numbers').tiles.some((t) => t.label === 'Winners' && t.w === 31 && t.l === 19));
  assert.deepEqual(get('set_by_set').rows.map((x) => [x.set, x.games.w, x.games.l, x.breaks.w, x.breaks.l, x.breaks.source]), [[1, 6, 3, 2, 0, 'match statistics'], [2, 6, 4, 2, 2, 'match statistics']]);
  assert.ok(get('serve_profile').rows.find((x) => x.key === 'service_games_held').w.n === 9);
  assert.ok(get('return_pressure').rows.length >= 3);
  assert.deepEqual(get('match_development').first_break, { set: 1, game: 4, by: 'W' });
  assert.equal(get('player_context').players.W.rank.rank, 87);
  // pure + deterministic
  assert.deepEqual(buildModules(rich()), r);
  // plan carries them alongside the V3 modules
  const plan = buildPlan(rich(), compose(rich()));
  for (const id of ids(r)) assert.ok(plan.modules.some((m) => m.id === id), id);
});

test('buildModules (thin): nothing invented; every missing module is omitted with a reason', () => {
  const r = buildModules(thin());
  assert.deepEqual(ids(r), ['set_by_set'], 'only the set scores exist');
  assert.ok(!r.modules[0].data.rows.some((x) => x.breaks || x.points_won), 'no per-set breaks/points without stats or observed games');
  for (const id of ['key_numbers', 'serve_profile', 'return_pressure', 'match_development', 'player_context']) assert.ok(r.omitted.find((o) => o.id === id)?.reason, id);
  const wo = buildModules(rich({ match: { ...rich().match, status: 'walkover', sets: [] } }));
  assert.ok(!ids(wo).some((id) => ['key_numbers', 'serve_profile', 'return_pressure', 'set_by_set'].includes(id)), 'walkover: no match modules');
  assert.deepEqual(buildModules({ event: { kind: 'enters_top10' } }).omitted[0].id, 'match_modules');
  // partial live coverage: breaks are listed, but no per-set counts and no run
  const part = buildModules(rich({ stats: null, stats_by_set: null, match_development: developmentFrom(games().slice(6), { source: 'observed_score', totalGames: 19 }) }));
  const dev = part.modules.find((m) => m.id === 'match_development').data;
  assert.equal(dev.complete, false); assert.equal(dev.longest_run, null);
  assert.ok(!part.modules.find((m) => m.id === 'set_by_set').data.rows.some((x) => x.breaks));
});

test('compose: "How the match turned" only from observed games, never from the final score', () => {
  const full = compose(rich(), { storyClass: 'full' });
  const s = full.sections.find((x) => x.id === 'match_development');
  assert.ok(s, 'rich story gets the development section');
  assert.match(s.paragraphs[0], /first break of serve went to Alpha in set 1, game 4/);
  assert.match(s.paragraphs[0], /Alpha broke serve 3 times and Beta once/);
  assert.equal(runGates(full, rich()).failures.length, 0, JSON.stringify(runGates(full, rich()).failures));
  assert.ok(!compose(thin(), { storyClass: 'full' }).sections.some((x) => x.id === 'match_development'), 'no observed games → no section');
  assert.ok(!compose(rich(), { storyClass: 'brief' }).sections.some((x) => x.id === 'match_development'), 'briefs stay short');
  const md = full.sections.find((x) => x.id === 'match_data');
  assert.match(md.paragraphs.join(' '), /held 9 of 11 service games/);
});

test('gates: invented tennis intelligence is held', () => {
  const g = (text, p) => intelligenceFailures(text, p).map((f) => f.gate);
  assert.deepEqual(g('She rode the momentum home.', rich()), ['unsupported_momentum'], '"momentum" is never provable');
  assert.deepEqual(g('The turning point came late.', thin()), ['unsupported_momentum']);
  assert.deepEqual(g('The turning point came late.', rich()), []);
  assert.deepEqual(g('She won five straight games.', rich()), ['run_claim'], 'no such run in the sequence');
  assert.deepEqual(g('She took the opening break.', rich()), []);
  assert.deepEqual(g('She took the opening break.', rich({ match_development: developmentFrom(games().slice(6), { source: 'observed_score', totalGames: 19 }) })), ['sequence_claim'], 'partial coverage cannot prove which break came first');
  assert.deepEqual(g('She won three straight games.', rich()), [], 'the observed run passes');
  assert.deepEqual(g('She won three straight games.', rich({ match_development: developmentFrom(games().slice(1), { source: 'observed_score', totalGames: 19 }) })), ['run_claim'], 'partial coverage cannot prove a run');
  assert.deepEqual(g('Her first-serve percentage decided it.', thin()), ['unsupported_stat_family']);
  assert.deepEqual(g('She broke serve twice.', thin()), ['unsupported_stat_family']);
  assert.deepEqual(g('She hit 40 winners.', rich({ stats: statLines({ ...statsA, winners: undefined }, { ...statsB, winners: undefined }) })), ['unsupported_stat_family']);
  assert.deepEqual(g('Alpha never dropped serve.', rich()), ['clean_hold_claim'], 'both players were broken');
  assert.deepEqual(g('Alpha did not face a break point.', rich()), ['clean_hold_claim']);
  assert.deepEqual(g('Beta saved every break point.', rich()), ['clean_hold_claim']);
  // a true clean-hold claim passes
  const clean = rich({ stats: statLines({ ...statsA, break_points_faced: 0, break_points_saved: 0 }, statsB) });
  assert.deepEqual(g('Alpha never dropped serve and did not face a break point.', clean), []);
  // wired into runGates
  const a = compose(rich());
  a.sections[0].paragraphs = [...a.sections[0].paragraphs, 'Alpha seized the momentum.'];
  assert.ok(runGates(a, rich()).failures.some((f) => f.gate === 'unsupported_momentum'));
});

test('renderer: modules render in-narrative, accessible, linked; thin stories render nothing new', () => {
  const p = rich();
  const art = compose(p, { storyClass: 'full' });
  const plan = buildPlan(p, art);
  const sections = art.sections;
  const out = depthInserts(plan.modules, { what_happened: ['<score>'], match_data: ['<charts>'] }, { sections, parts: p.participants, W: 'A', charts: [{ id: 'serve_comparison' }, { id: 'match_dna_comparison' }], chart: (c) => `<chart ${c.id}>` });
  const str = (k) => (out[k] || []).map(String).join('');
  assert.match(str('what_happened'), /^<score>.*data-module="key_numbers"/s, 'scoreboard stays first');
  assert.match(str('match_development'), /data-module="set_by_set".*data-module="match_development"/s);
  assert.match(str('match_data'), /<caption>Serve profile<\/caption>.*<th scope="row">Service games held/s);
  assert.doesNotMatch(str('match_data'), /serve_comparison/, 'the serve table supersedes the serve chart');
  assert.match(str('match_data'), /match_dna_comparison/, 'other data charts are kept');
  const ctxHome = ['player_read', 'surface', 'why_it_mattered'].find((id) => sections.some((s) => s.id === id)) || 'player_read';
  assert.match(str(ctxHome), /href="\/players\/ann-alpha".*href="\/players\/ann-alpha\/dna"/s, 'player + Tennis DNA links');
  assert.match(Object.values(out).flat().map(String).join(''), /href="\/matches\/m-next".*|href="\/players\/cat-gamma"/s);
  const tp = thin();
  const thinOut = depthInserts(buildPlan(tp, compose(tp)).modules, { what_happened: ['<score>'] }, { sections: compose(tp).sections, parts: tp.participants, W: 'A' });
  assert.deepEqual(Object.keys(thinOut).filter((k) => k !== 'what_happened' && k !== 'match_development'), [], 'thin: no stat modules');
  assert.doesNotMatch(Object.values(thinOut).flat().map(String).join(''), /Serve profile|Return pressure|Match control/);
  // escaping: names are data, never markup
  const evil = rich({ participants: { A: { players: [{ ...A, name: '<img src=x onerror=1>' }] }, B: { players: [B] } } });
  assert.doesNotMatch(depthInserts(buildPlan(evil, compose(evil)).modules, {}, { parts: evil.participants, W: 'A' }).player_read?.map(String).join('') || '', /<img/);
});
