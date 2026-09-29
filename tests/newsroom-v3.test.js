// Tennis Newsroom V3 (docs/NEWSROOM_V3.md): editorial classes instead of one materiality bar, evidence-capped depth,
// Match DNA v2 in the frozen packet (strictly before the match), additive-value gates, in-place story upgrades and the
// deterministic live wire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvent, classifyStory, evidenceDimensions, tierOf } from '../workers/tennis-news/src/classify.js';
import { compose } from '../workers/tennis-news/src/compose.js';
import { buildPlan, glanceCells, intelligence } from '../workers/tennis-news/src/plan.js';
import { runGates, additiveValueFailures } from '../workers/tennis-news/src/gates.js';
import { matchDnaBefore, expectationBefore, roundLabel } from '../workers/tennis-news/src/packet.js';
import { upgradeArticle, withClass } from '../workers/tennis-news/src/index.js';
import { wireCard, wireCopy } from '../workers/tennis-api/src/news.js';
import { rankingProvenance } from '../workers/tennis-news/src/tour.js';
import { MemStore } from './helpers/memstore.js';

const ev = (kind, facts = {}) => ({ kind, facts });
const cls = (kind, facts) => classifyEvent(ev(kind, facts)).surface;

test('owner principles: every legitimate ATP/WTA tour singles title is at least a brief; tier sets depth', () => {
  assert.equal(cls('title', { event_type: 'WS', level: 'WTA 250', round: 'M-F' }), 'brief');
  assert.equal(cls('title', { event_type: 'MS', source_family: 'espn', tour: 'atp', edition_tier: 'ATP 250', round: 'F' }), 'brief');
  assert.equal(cls('title', { event_type: 'MS', source_family: 'espn', tour: 'atp', round: 'F' }), 'brief', 'ATP league edition with no registry tier: tour title, brief');
  assert.equal(cls('title', { event_type: 'MS', edition_tier: 'ATP 500', round: 'F' }), 'full');
  assert.equal(cls('title', { event_type: 'WS', level: 'WTA 500', round: 'M-F' }), 'full');
  assert.equal(cls('title', { event_type: 'MS', edition_tier: 'ATP Masters 1000', round: 'F' }), 'deep');
  assert.equal(cls('title', { event_type: 'WS', level: 'Grand Slam', round: 'M-F' }), 'deep');
  assert.equal(cls('title', { event_type: 'WS', level: 'WTA 125', round: 'M-F' }), 'brief');
  assert.equal(cls('title', { event_type: 'WS', competition_key: 'itf_women', round: 'F' }), 'wire');
  assert.equal(cls('doubles_title', { event_type: 'WD', level: 'WTA 125', round: 'M-F' }), 'wire');
  assert.equal(cls('doubles_title', { event_type: 'WD', level: 'WTA 1000', round: 'M-F' }), 'brief');
  assert.equal(tierOf({ level: 'Grand Slam' }), 'slam');
  assert.equal(tierOf({}), null, 'unknown stays unknown');
});

test('owner principles: routine comebacks / deciding tiebreaks / R1 upsets are wire; real significance upgrades', () => {
  assert.equal(cls('comeback', { event_type: 'WS', level: 'WTA 250', round: 'M-1', loser_rank: 60 }), 'wire');
  assert.equal(cls('deciding_tiebreak', { event_type: 'MS', edition_tier: 'ATP 250', round: '1' }), 'wire');
  assert.equal(cls('upset', { event_type: 'MS', edition_tier: 'ATP 250', round: '1', loser_rank: 46, winner_rank: 73 }), 'wire', 'No. 73 over No. 46 in R1');
  assert.equal(cls('upset', { event_type: 'WS', level: 'WTA 250', round: 'M-1', loser_rank: 8, winner_rank: 90 }), 'brief', 'top-10 upset: brief minimum');
  assert.equal(cls('upset', { event_type: 'MS', edition_tier: 'ATP Masters 1000', round: 'S', loser_rank: 4, winner_rank: 40 }), 'full', 'late-round top-10 upset at a 1000');
  assert.equal(cls('upset', { event_type: 'WS', level: 'Grand Slam', round: 'M-F', loser_rank: 2, winner_rank: 30 }), 'deep');
  assert.equal(cls('deciding_tiebreak', { event_type: 'WS', level: 'WTA 1000', round: 'M-S' }), 'brief', 'semifinal at a 1000: significant');
  // one story per match: the highest class among the match's kinds wins
  assert.equal(classifyEvent(ev('comeback', { event_type: 'WS', level: 'WTA 250', round: 'M-F', secondary_kinds: ['title'] })).surface, 'brief');
});

test('owner principles: ranking moves by tier crossed', () => {
  assert.equal(cls('new_no1', { list: 'atp_singles' }), 'deep');
  assert.equal(cls('enters_top10', { list: 'wta_singles' }), 'full');
  assert.equal(cls('enters_top20', { list: 'wta_singles' }), 'brief');
  assert.equal(cls('enters_top50', { list: 'wta_singles', previous_rank: 55 }), 'wire');
  assert.equal(cls('enters_top50', { list: 'wta_singles', previous_rank: 130 }), 'brief', 'unusually strong context');
  assert.equal(cls('enters_top100', { list: 'atp_singles', previous_rank: 104 }), 'wire');
});

test('detection state: brief+ is queued for an article, everything else is a wire item (no 60 bar)', () => {
  const t = withClass({ kind: 'title', materiality: 58, facts: { event_type: 'WS', level: 'WTA 250', round: 'M-F' } }, '2026-09-29T00:00:00Z');
  assert.equal(t.state, 'detected'); assert.equal(t.editorial_class, 'brief');
  const c = withClass({ kind: 'comeback', materiality: 34, facts: { event_type: 'WS', level: 'WTA 250', round: 'M-1' } }, '2026-09-29T00:00:00Z');
  assert.equal(c.state, 'wire'); assert.equal(c.class_history[0].stage, 'detect');
  assert.equal(withClass({ kind: 'upset', state: 'duplicate', facts: {} }, 'x').state, 'duplicate');
});

// ---- packets --------------------------------------------------------------------------------------------
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = (id, name, last, rank) => ({ id, slug: name.toLowerCase().replace(/ /g, '-'), name, last_name: last, nationality: 'ESP', photo: null, rank: rank ? { rank, list_date: '2026-09-21', list: 'wta_singles', source_family: 'wta' } : null });
const MD = (as_of, W, L, extra = {}) => ({ as_of, definition_version: 2, tour: 'WTA', rating: { value: 2100, percentile: 90, rated_matches: 200, published: true, provisional: false }, metrics: { match_win_rate: { label: 'Match win %', value: W / (W + L), pct: Math.round((W / (W + L)) * 1000) / 10, sample_matches: W + L, confidence: 'high', record: { W, L }, percentile: 88 }, top10_win_rate: { label: 'vs top 10', value: 0.4, pct: 40, sample_matches: 20, confidence: 'high', record: { W: 8, L: 12 } }, set_win_rate: { value: 0.6, pct: 60, confidence: 'high' }, deciding_set_win_rate: { value: 0.55, pct: 55, confidence: 'high', record: { W: 11, L: 9 } }, tiebreak_win_rate: { value: 0.5, pct: 50, confidence: 'high' } }, windows: { '52w': { weeks: 52, from: '2025-09-28', W: 40, L: 15, wae: 0.05 } }, surface: { surface: 'hard', as_of, record: { W: 90, L: 30 }, metrics: {}, rating: null }, ...extra });
function packet({ kind = 'title', level = 'WTA 500', round = 'M-F', stats = true, md = true, exp = true } = {}) {
  const A = uuid(1);
  const B = uuid(2);
  const p = {
    version: 'tennis-packet/3.0.0', built_at: '2026-09-29T12:00:00Z',
    event: { kind, event_id: `${kind}:0123456789ab`, materiality: 63, facts: { event_type: 'WS', level, round }, occurred_at: '2026-09-28T08:00:00Z' },
    provenance: { upstream: [{ family: 'wta', classification: 'official', what: 'match result and set scores' }, { family: 'wta', classification: 'official', what: 'match statistics' }] },
    match: { id: uuid(101), event_type: 'WS', round, round_label: roundLabel(round), format: 'BO3_TB7', best_of: 3, status: 'completed', winner_side: 'A', score: '6-4 7-6(5)', sets: [{ A: 6, B: 4, tb: null }, { A: 7, B: 6, tb: { A: 7, B: 5 } }], duration_s: 6300, duration: { hours: 1, minutes: 45 }, started_at: '2026-09-28T08:00:00Z', date: '2026-09-28' },
    participants: { A: { key: `S:${A}`, seed: 3, entry: null, players: [P(A, 'Ana Alta', 'ALTA', 12)] }, B: { key: `S:${B}`, seed: 1, entry: null, players: [P(B, 'Bea Baja', 'BAJA', 4)] } },
    tournament: { edition_id: 'e', slug: 'singapore', name: 'Singapore Open', year: 2026, level, surface: 'hard', indoor: false, city: 'Singapore', start_date: '2026-09-21', end_date: '2026-09-28', source_family: 'wta' },
    tour: 'wta', match_source: { source_family: 'wta', classification: 'official', name: 'WTA' },
    ranking_provenance: { ...rankingProvenance('wta_singles', 'wta', 1500), list_date: '2026-09-21' },
    draw_path: { player_id: A, matches: [{ match_id: uuid(90), result: 'W', opponent: [{ name: 'Cara Cero' }], score: '6-2 6-2', round_label: 'semifinal', date: '2026-09-27' }] },
    recent_form: { [A]: [{ match_id: uuid(80), result: 'W', date: '2026-09-10' }], [B]: [] },
    h2h: { player_id: A, opponent_id: B, prior_meetings: [{ match_id: uuid(70), result: 'L', score: '4-6 4-6', tournament: 'Tokyo', year: 2025, date: '2025-10-01' }], wins: 0, losses: 1, coverage_from: '2024-12-29' },
    canonical_signature: `${kind}:${uuid(101)}`
  };
  if (stats) p.stats = { A: { first_serve_won: { n: 40, d: 55, pct: 72.7 }, second_serve_won: { n: 15, d: 30, pct: 50 }, service_points_won: { n: 55, d: 85, pct: 64.7 }, first_return_won: { n: 20, d: 60, pct: 33.3 }, return_points_won: { n: 35, d: 90, pct: 38.9 }, break_points_converted: { n: 3, d: 7, pct: 42.9 } }, B: { first_serve_won: { n: 40, d: 60, pct: 66.7 }, second_serve_won: { n: 10, d: 30, pct: 33.3 }, service_points_won: { n: 55, d: 90, pct: 61.1 }, first_return_won: { n: 15, d: 55, pct: 27.3 }, return_points_won: { n: 30, d: 85, pct: 35.3 }, break_points_converted: { n: 1, d: 5, pct: 20 } } };
  if (md) p.match_dna = { [A]: MD('2026-09-20', 150, 60), [B]: MD('2026-09-20', 300, 80) };
  if (exp) p.expectation = { model: 'PBE Rating (overall, chronological Elo, method v1)', as_of: '2026-09-20', winner_rating: 2100, loser_rating: 2250, winner_pre_match_pct: 30, result_vs_expectation: 0.7, winner_was_rating_underdog: true, winner_id: A, loser_id: B };
  return p;
}

test('classifyStory: evidence caps depth; a tour singles title never drops below brief; dims are packet-derived', () => {
  const rich = packet();
  const d = evidenceDimensions(rich);
  for (const k of ['result', 'set_detail', 'match_statistics', 'ranking_context', 'match_dna', 'pre_match_expectation', 'recent_form', 'h2h', 'draw_path', 'tournament_context', 'surface_context']) assert.ok(d.includes(k), k);
  const e = { kind: 'title', facts: { event_type: 'WS', level: 'WTA 500', round: 'M-F' } };
  assert.equal(classifyStory(e, rich).surface, 'full');
  const thin = { version: 'x', event: rich.event, match: { ...rich.match, sets: [{ A: 6, B: 0, tb: null }] }, participants: { A: { players: [{ id: 'a' }] }, B: { players: [{ id: 'b' }] } } };
  const s = classifyStory(e, thin);
  assert.equal(s.surface, 'brief', 'title floor holds even with a thin packet');
  const up = classifyStory({ kind: 'upset', facts: { event_type: 'MS', edition_tier: 'ATP Masters 1000', round: 'S', loser_rank: 4 } }, { ...thin, match: rich.match, stats: rich.stats });
  assert.equal(up.surface, 'brief', 'a full-significance upset with 2 dimensions is capped to brief');
  assert.ok(up.capped_by_evidence);
  assert.equal(classifyStory({ kind: 'upset', facts: { event_type: 'MS', edition_tier: 'ATP 250', round: '2', loser_rank: 15 } }, thin).surface, 'wire');
});

test('packet v3: Match DNA and the rating expectation are read strictly BEFORE the match day', async () => {
  const qs = [];
  const BUILT = '2026-09-27T04:00:00Z'; // the snapshot row was built before the match started (2026-09-28)
  const store = { async select(t, q) { qs.push(q); if (/metrics->_rating/.test(q)) return [{ pbe_player_id: 'w', as_of: '2026-09-27', built_at: BUILT, r: { value: 2000, published: true } }, { pbe_player_id: 'l', as_of: '2026-09-27', built_at: BUILT, r: { value: 2200, published: true } }]; return [{ as_of: '2026-09-27', built_at: BUILT, metrics: { _tour: 'ATP', _rating: { value: 2000, published: true, percentile: 80, rated_matches: 90 }, match_win_rate: { value: 0.7, confidence: 'high', record: { W: 70, L: 30 }, sample_matches: 100, comparative_published: true, percentile: 85 } } }]; } };
  const md = await matchDnaBefore(store, 'w', '2026-09-28', 'hard');
  assert.ok(qs.every((q) => /as_of=lt\.2026-09-28/.test(q)), 'never as_of <= match day');
  assert.equal(md.metrics.match_win_rate.pct, 70);
  assert.equal(md.rating.value, 2000);
  const e = await expectationBefore(store, 'w', 'l', '2026-09-28');
  assert.equal(e.winner_pre_match_pct, 24); assert.equal(e.winner_was_rating_underdog, true);
  // a snapshot DATED before the match but BUILT after it started (a later backfill build): descriptive metrics stay, the
  // rating and the expectation are withheld — their validation status is not the one in force at the time (owner rule)
  const late = { async select(t, q) { const rows = await store.select(t, q); return rows.map((r) => ({ ...r, built_at: '2026-09-28T15:00:00Z' })); } };
  const mdLate = await matchDnaBefore(late, 'w', '2026-09-28', 'hard', '2026-09-28T09:00:00Z');
  assert.equal(mdLate.metrics.match_win_rate.pct, 70);
  assert.equal(mdLate.rating, null);
  assert.equal(mdLate.rating_validated_at_the_time, false);
  assert.match(mdLate.rating_note, /built after the event started/);
  assert.equal(await expectationBefore(late, 'w', 'l', '2026-09-28', '2026-09-28T09:00:00Z'), null);
  // an unvalidated rating yields no expectation
  const s2 = { async select() { return [{ pbe_player_id: 'w', as_of: '2026-09-27', built_at: BUILT, r: { value: 2000, published: false } }, { pbe_player_id: 'l', as_of: '2026-09-27', built_at: BUILT, r: { value: 2200, published: true } }]; } };
  assert.equal(await expectationBefore(s2, 'w', 'l', '2026-09-28'), null);
  // gates hold a snapshot dated on/after the match day
  const p = packet();
  const a = compose(p, { storyClass: 'full' });
  p.match_dna[Object.keys(p.match_dna)[0]].as_of = '2026-09-28';
  assert.ok(runGates(a, p, { plan: buildPlan(p, a) }).failures.some((f) => f.gate === 'match_dna_after_event'));
});

test('composition depth follows the class; baseline prose passes every gate including additive value', () => {
  for (const storyClass of ['brief', 'full', 'deep']) {
    const p = packet();
    const a = compose(p, { storyClass });
    const plan = buildPlan(p, a);
    const g = runGates(a, p, { plan });
    assert.ok(g.pass, `${storyClass}: ${JSON.stringify(g.failures)}`);
    const ids = a.sections.map((s) => s.id);
    if (storyClass === 'brief') { assert.ok(!ids.includes('player_read') && !ids.includes('h2h') && !ids.includes('path')); }
    else { assert.ok(ids.includes('player_read'), 'Match DNA section'); assert.ok(ids.includes('path')); }
    assert.equal(a.sections.at(-1).heading, 'Source & method');
  }
  // no empty or weak section: without Match DNA there is no "what the result says" section
  const nomd = packet({ md: false, exp: false });
  assert.ok(!compose(nomd, { storyClass: 'full' }).sections.some((s) => s.id === 'player_read'));
});

test('additive-value gates: restating the headline, repeating a point or reading out a chart is held', () => {
  const p = packet();
  const a = compose(p, { storyClass: 'full' });
  const plan = buildPlan(p, a);
  const restate = { ...a, sections: [{ id: 'why_it_mattered', heading: 'x', paragraphs: [`${a.headline} ${a.dek}`] }, ...a.sections] };
  assert.ok(additiveValueFailures(restate, plan).some((f) => f.gate === 'restate_headline'));
  const para = 'Alta held her serve with authority across both sets and kept Baja under pressure on every return game she played.';
  const dup = { ...a, sections: [{ id: 'analysis', heading: 'x', paragraphs: [para, `${para} `] }, ...a.sections] };
  assert.ok(additiveValueFailures(dup, plan).some((f) => f.gate === 'duplicate_point'));
  const narrate = { ...a, sections: [{ id: 'match_data', heading: 'x', paragraphs: ['Alta won 72.7% on first serve, Baja 66.7%; second serve 50% against 33.3%, service points 64.7% to 61.1%.'] }, ...a.sections] };
  assert.ok(additiveValueFailures(narrate, plan).some((f) => f.gate === 'chart_narration'));
});

test('at-a-glance and PBE Intelligence: 3-5 non-empty cells; model values labelled; counterpoint from the packet', () => {
  const p = packet();
  const cells = glanceCells(p);
  assert.ok(cells.length >= 3 && cells.length <= 5);
  assert.ok(cells.every((c) => c.value && c.value !== 'null' && c.value !== 'undefined'));
  assert.ok(cells.some((c) => c.label === 'Pre-match rating model' && c.value === '30%' && c.kind === 'model'));
  const intel = intelligence(p);
  assert.match(intel.takeaway, /lower-rated player/);
  assert.match(intel.counterpoint, /leads their meetings in our archive, 1-0/);
  assert.equal(intelligence(packet({ md: false, exp: false })), null, 'nothing distinctive -> no module');
  const plan = buildPlan(p, compose(p));
  assert.ok(plan.glance && plan.intelligence);
  assert.ok(plan.modules.find((m) => m.id === 'charts').data.charts.some((c) => c.id === 'match_dna_comparison'));
});

test('lifecycle: an upgrade keeps article id, slug and first_published_at; records the revision and the prior packet', async () => {
  const s = new MemStore();
  const id = uuid(500);
  await s.insert('tennis_articles', [{ article_id: id, slug: 'alta-wins-the-singapore-title-abc123', status: 'published', story_class: 'brief', headline: 'Alta wins the Singapore Open title', published_at: '2026-09-28T10:00:00Z', first_published_at: '2026-09-28T10:00:00Z', revisions: [] }]);
  await s.insert('tennis_article_evidence', [{ article_id: id, packet: { version: 'old' }, frozen_at: '2026-09-28T10:00:00Z' }]);
  const p = packet();
  const art = compose(p, { storyClass: 'full' });
  const rev = await upgradeArticle(s, s.rows('tennis_articles')[0], { article: art, ed: { origin: 'baseline', gate: { pass: true }, attempts: [], usage: { input_tokens: 0, output_tokens: 0 } }, plan: buildPlan(p, art), packet: p, storyClass: 'full', dimensions: ['result', 'match_statistics'], now: '2026-09-29T09:00:00Z' });
  const row = s.rows('tennis_articles')[0];
  assert.equal(row.article_id, id); assert.equal(row.slug, 'alta-wins-the-singapore-title-abc123');
  assert.equal(row.first_published_at, '2026-09-28T10:00:00Z'); assert.equal(row.published_at, '2026-09-28T10:00:00Z');
  assert.equal(row.story_class, 'full'); assert.equal(row.revised_at, '2026-09-29T09:00:00Z');
  assert.equal(row.revisions.length, 1); assert.equal(rev.from_class, 'brief'); assert.equal(rev.to_class, 'full');
  assert.deepEqual(row.revisions[0].prior_packet, { version: 'old' }, 'the prior frozen evidence is kept in the revision');
  assert.equal(s.rows('tennis_article_evidence')[0].packet.version, 'tennis-packet/3.0.0');
  assert.equal(s.rows('tennis_articles').length, 1, 'never a second URL');
});

test('live wire: deterministic fact cards, inward links article > match > tournament > player, no materiality', () => {
  const W = { id: uuid(1), slug: 'carlos-alcaraz', name: 'Carlos Alcaraz' };
  const L = { id: uuid(2), slug: 'x-y', name: 'Xavi Ybarra' };
  const match = { id: uuid(101), event_type: 'MS', round: 'Q', status: 'completed', winner_side: 'A', sets: [{ A: 6, B: 4 }, { A: 7, B: 6, tb: { A: 7, B: 5 } }], sides: { A: { players: [W], seed: 1 }, B: { players: [L], seed: null } }, tournament: { slug: 'japan-open', year: 2026, tournament: 'Japan Open', level: null } };
  const e = { event_id: 'upset:1', kind: 'upset', state: 'wire', occurred_at: '2026-09-29T05:00:00Z', detected_at: '2026-09-29T07:00:00Z', materiality: 44, evidence: { facts: { loser_rank: 9 } } };
  const c = wireCard(e, { match });
  assert.equal(c.headline, 'Carlos Alcaraz defeats No. 9 Xavi Ybarra at Japan Open');
  assert.equal(c.summary, 'Quarterfinal: Carlos Alcaraz won 6-4 7-6(5).', "an unprefixed ESPN 'Q' is a quarterfinal, never qualifying");
  assert.deepEqual(c.links.map((l) => l.rel), ['match', 'tournament', 'player', 'player']);
  assert.equal(c.desk, 'atp'); assert.equal(c.tour, 'atp'); assert.equal(c.state, 'wire');
  assert.ok(!('materiality' in c), 'materiality is never a consumer field');
  const withStory = wireCard({ ...e, state: 'published' }, { match, article: { slug: 's-1', story_class: 'brief' } });
  assert.equal(withStory.links[0].rel, 'article'); assert.equal(withStory.state, 'story');
  const rk = wireCopy({ kind: 'enters_top20', evidence: { facts: { list: 'atp_singles', tier: 20, rank: 18, previous_rank: 23, list_date: '2026-09-28' } } }, { player: { name: 'Jakub Mensik' } });
  assert.equal(rk.headline, 'Jakub Mensik moves into the top 20 of the ATP singles list');
  assert.doesNotMatch(`${rk.headline} ${rk.summary}`, /official/i);
  const wo = wireCopy({ kind: 'walkover', evidence: { facts: {} } }, { match: { ...match, status: 'walkover', sets: [] } });
  assert.match(wo.summary, /The source gives no reason/);
});

test('round labels handle both notations (WTA prefixed, ESPN/Slam unprefixed)', () => {
  assert.equal(roundLabel('M-S'), 'semifinal');
  assert.equal(roundLabel('S'), 'semifinal');
  assert.equal(roundLabel('Q'), 'quarterfinal');
  assert.equal(roundLabel('Q-2'), 'qualifying round 2');
  assert.equal(roundLabel('2'), 'round 2');
  assert.equal(roundLabel('M-1'), 'round 1');
});

test('correction: a pre-match rating from a snapshot built after the event is withheld; built-before stays', async () => {
  const { correctPacket } = await import('../workers/tennis-news/src/correct.js');
  const packet = { match_dna: { w: { as_of: '2026-09-01', rating: { value: 2600, published: true }, rating_trajectory: { series: [] }, metrics: { match_win_rate: { pct: 70 } } } }, expectation: { as_of: '2026-09-01', winner_id: 'w', loser_id: 'l', winner_pre_match_pct: 24 } };
  const after = { async select() { return [{ built_at: '2026-09-27T13:46:42Z' }]; } };
  const r = await correctPacket(after, packet, '2026-09-26T09:43:57Z');
  assert.deepEqual(r.changes.sort(), ['expectation', 'match_dna.w.rating']);
  assert.equal(r.packet.match_dna.w.rating, null);
  assert.equal(r.packet.match_dna.w.metrics.match_win_rate.pct, 70, 'descriptive point-in-time metrics are kept');
  assert.equal(r.packet.expectation, undefined);
  assert.ok(packet.expectation, 'the original packet object is not mutated');
  const before = { async select() { return [{ built_at: '2026-09-02T04:00:00Z' }]; } };
  assert.deepEqual((await correctPacket(before, packet, '2026-09-26T09:43:57Z')).changes, []);
});

test('detection candidates: selected by match time and keyset-paged — a bulk historical rewrite cannot crowd out fresh finals', async () => {
  const { detectionCandidates } = await import('../workers/tennis-news/src/index.js');
  const qs = [];
  // 1,200 ids to page through (the old query stopped at an arbitrary 400)
  const ids = Array.from({ length: 1200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const store = { async select(t, q) {
    qs.push(q);
    if (/^select=match_id(&|,tennis_tournament_editions!inner)/.test(q)) {
      if (/tennis_tournament_editions!inner/.test(q)) return [];
      const after = /match_id=gt\.([0-9a-f-]+)/.exec(q)?.[1];
      const lim = Number(/limit=(\d+)/.exec(q)[1]);
      return ids.filter((x) => !after || x > after).slice(0, lim).map((match_id) => ({ match_id }));
    }
    const inIds = (/match_id=in\.\(([^)]*)\)/.exec(q)?.[1] || '').split(',').map((x) => x.replace(/"/g, '')).filter(Boolean);
    return inIds.map((match_id) => ({ match_id, event_type: 'WS', tennis_tournament_editions: {}, tennis_sets: [], tennis_match_participants: [] }));
  } };
  const now = new Date('2026-09-29T12:00:00Z');
  const rows = await detectionCandidates(store, now, { page: 500 });
  assert.equal(rows.length, 1200, 'every candidate, never an arbitrary 400');
  const sel = qs.filter((q) => /^select=match_id(&|,tennis_tournament_editions!inner)/.test(q));
  assert.ok(sel.every((q) => /order=match_id\.asc/.test(q)), 'deterministic keyset order');
  assert.ok(sel[0].includes('or=(started_at.gte.2026-09-26T12:00:00.000Z,scheduled_at.gte.2026-09-26T12:00:00.000Z)'), 'timed rows bounded by match time (72 h)');
  assert.ok(qs.some((q) => /started_at=is\.null&scheduled_at=is\.null&tennis_tournament_editions\.end_date=gte\.2026-09-26/.test(q)), 'untimed rows bounded by edition end date');
});

test('gate precision (canary 2026-09-29): true packet facts pass; the real violations are still held', async () => {
  const { runGates: gates } = await import('../workers/tennis-news/src/gates.js');
  const p = packet();
  const A = p.participants.A.players[0].id;
  const B = p.participants.B.players[0].id;
  const art = (...paras) => ({ headline: 'Alta beats Baja for the Singapore Open title', dek: 'Ana Alta won 6-4 7-6(5) in the final.', primary_player_id: A, player_ids: [A, B],
    sections: [{ heading: 'What happened', paragraphs: ['Ana Alta beat Bea Baja 6-4 7-6(5) to win the Singapore Open title on hard courts, closing the final in straight sets.', ...paras] }] });
  const fails = (a) => gates(a, p).failures.map((f) => f.gate);
  // true facts that were held before
  assert.ok(!fails(art('Alta carried a 67-107 record against top-50 opponents in our archive into the week.')).includes('unsupported_market'), 'W-L record is not odds');
  assert.ok(!fails(art('Her pre-match record in our archive framed the result.')).includes('unsupported_first_or_record'));
  assert.ok(!fails(art('Bea Baja reached the final as the top seed but could not hold her serve late in the second set.')).includes('wrong_winner'), 'the losing finalist did reach the final');
  // still held
  assert.ok(fails(art('Alta was a -110 favourite with the books.')).includes('unsupported_market'));
  assert.ok(fails(art('Alta set a record with the win.')).includes('unsupported_first_or_record'));
  assert.ok(fails(art('Bea Baja beat Alta in the opening set only to fade.')).includes('wrong_winner'));
  assert.ok(fails(art('Bea Baja reached the quarterfinals of the doubles event.')).includes('wrong_winner'), 'a different round is not this match');
  const nf = gates(art('Over her last 10 matches, Alta had built steady form.'), p).failures.filter((f) => f.gate === 'numeric_grounding');
  assert.equal(nf.length, 0, 'a form window size is not a statistic');
  assert.ok(gates(art('Alta hit 17 aces in the final.'), p).failures.some((f) => f.gate === 'numeric_grounding'), 'an unsupported number is still held');
});
