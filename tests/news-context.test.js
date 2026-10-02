// Newsroom V4.1 context contract (2026-10-02, owner brief "THE DATA EXISTS BUT BRIEFS ARE TOO THIN").
// Failing production case: Munar d. No. 10 Fritz, Tokyo ATP 500 R1 — published as a brief whose prose was result +
// ranking + "It was Munar's 3rd win of the tournament" while the frozen packet held draw path, comeback, Match DNA,
// recent form and the next opponent. Real frozen packet: tests/fixtures/news/munar-fritz-tokyo-2026-packet.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compose, drawPathSplit, tierLabel } from '../workers/tennis-news/src/compose.js';
import { runGates, contextFailures, contextFamilies } from '../workers/tennis-news/src/gates.js';
import { buildPlan } from '../workers/tennis-news/src/plan.js';
import { classifyEvent, classifyStory, hasKind, kindsOf } from '../workers/tennis-news/src/classify.js';
import { allowedSectionIds, buildInput, adopt } from '../workers/tennis-news/src/editorial.js';

const PACKET = JSON.parse(fs.readFileSync(new URL('./fixtures/news/munar-fritz-tokyo-2026-packet.json', import.meta.url), 'utf8'));
const PUBLISHED = JSON.parse(fs.readFileSync(new URL('./fixtures/news/munar-fritz-tokyo-2026-published.json', import.meta.url), 'utf8'));
const text = (a) => a.sections.filter((s) => s.id !== 'method').flatMap((s) => s.paragraphs).join(' ');

test('thin_context gate: the published Munar–Fritz brief is caught; the recomposed story passes every gate', () => {
  assert.deepEqual(contextFamilies(PACKET).map((f) => f.family), ['draw_path', 'match_development', 'match_dna', 'recent_form']);
  assert.equal(contextFailures(PUBLISHED, PACKET)[0]?.gate, 'thin_context');
  for (const storyClass of ['brief', 'full']) {
    const a = compose(PACKET, { storyClass });
    const g = runGates(a, PACKET, { plan: buildPlan(PACKET, a) });
    assert.ok(g.pass, `${storyClass}: ${JSON.stringify(g.failures)}`);
  }
});

test('Munar–Fritz acceptance: qualifying path, comeback, tier, seeding, pre-match comparison, next — no banned claims', () => {
  const a = compose(PACKET, { storyClass: 'brief' });
  const t = text(a);
  assert.match(t, /No\. 66[^.]*No\. 10/, 'why No. 66 over No. 10');
  assert.match(t, /two qualifying wins, over Marcos Giron and Aleksandar Kovacevic/);
  assert.match(t, /lost the opening-set tiebreak and then won the next two sets/, 'secondary comeback used');
  assert.match(t, /\(ATP 500\)/, 'frozen reviewed tier surfaced');
  assert.match(t, /No\. 3 seed/);
  assert.match(t, /4-20 against top-10 opponents/);
  assert.match(t, /Fritz came in with the stronger stored match-win profile: 62\.1% of 528/);
  assert.match(t, /Munar plays Jaime Faria in round 2/);
  assert.doesNotMatch(t, /\b3rd win\b|win of the tournament/, 'never the ambiguous Nth-win line');
  assert.doesNotMatch(t, /\b22%|probabilit|expected|favou?rite|underdog|odds\b/i, 'no model probability prose');
  assert.doesNotMatch(t, /\b(fatigue|injur|tired|nerves|confidence|clutch|historic|career-best|first ever)\b/i);
});

test('draw path: qualifying and main-draw wins are separated; never "Nth win of the tournament"', () => {
  assert.deepEqual([drawPathSplit(PACKET).qual.length, drawPathSplit(PACKET).main.length], [2, 0]);
  const later = { ...PACKET, match: { ...PACKET.match, round: '2', round_label: 'round 2' }, draw_path: { matches: [...PACKET.draw_path.matches, { ...PACKET.draw_path.matches[0], round: '1', round_label: 'round 1', opponent: [{ id: 'x', name: 'Taylor Fritz' }] }] } };
  const t = text(compose(later, { storyClass: 'brief' }));
  assert.match(t, /It was Munar's 2nd main-draw win at Kinoshita Group Japan Open Tennis Championships, after two qualifying wins\./);
  assert.doesNotMatch(t, /3rd win/);
});

test('secondary kinds: hasKind reads kind + facts.secondary_kinds; comeback context applies when comeback is secondary', () => {
  assert.deepEqual(kindsOf(PACKET.event), ['upset', 'comeback', 'seed_upset']);
  assert.equal(hasKind(PACKET, 'comeback'), true);
  assert.equal(hasKind(PACKET, 'marathon'), false);
  const noSecondary = { ...PACKET, event: { ...PACKET.event, facts: { ...PACKET.event.facts, secondary_kinds: [] } } };
  assert.doesNotMatch(text(compose(noSecondary, { storyClass: 'brief' })), /opening-set tiebreak/, 'no comeback prose without comeback evidence');
});

test('tier: frozen facts.edition_tier surfaces when the source level is null; never inferred from the name', () => {
  assert.equal(PACKET.tournament.level, null);
  assert.equal(tierLabel(PACKET), 'ATP 500');
  const noTier = { ...PACKET, event: { ...PACKET.event, facts: { ...PACKET.event.facts, edition_tier: null } } };
  assert.equal(tierLabel(noTier), null);
  assert.doesNotMatch(text(compose(noTier, { storyClass: 'brief' })), /ATP 500/);
});

test('classifier 1.1.0: No. 66 over top-10 No. 10 at a 500 is full (facts only); evidence still caps; small events unchanged', () => {
  const ev = { kind: 'upset', facts: PACKET.event.facts };
  assert.equal(classifyEvent(ev).surface, 'full');
  assert.equal(classifyStory(ev, PACKET).surface, 'full');
  assert.equal(classifyStory(ev, { match: PACKET.match, participants: PACKET.participants, event: PACKET.event, tournament: { ...PACKET.tournament } }).surface === 'full', false, 'thin packet caps the class');
  const at250 = { kind: 'upset', facts: { ...PACKET.event.facts, edition_tier: 'ATP 250' } };
  assert.equal(classifyEvent(at250).surface, 'brief');
  const top50Winner = { kind: 'upset', facts: { ...PACKET.event.facts, winner_rank: 40 } };
  assert.equal(classifyEvent(top50Winner).surface, 'brief', 'winner inside the top 50: unchanged');
  const qual = { kind: 'upset', facts: { ...PACKET.event.facts, round: 'Q-2', secondary_kinds: [] } };
  assert.equal(classifyEvent(qual).surface, 'wire');
});

test('editorial contract: a brief may use every context family the packet proves (not only the baseline sections)', () => {
  const base = compose(PACKET, { storyClass: 'brief' });
  const thinBase = { ...base, sections: base.sections.filter((s) => ['what_happened', 'method'].includes(s.id)) };
  const ids = allowedSectionIds(PACKET, thinBase);
  for (const id of ['why_it_mattered', 'analysis', 'match_development', 'player_read', 'path', 'next']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('method'));
  assert.ok(!ids.includes('h2h'), 'no h2h section without stored meetings');
  assert.match(buildInput(PACKET, thinBase), /ALLOWED SECTION IDS: .*path/);
  const draft = adopt({ headline: 'H', dek: 'D', sections: [{ id: 'path', heading: 'Path', paragraphs: ['x'] }, { id: 'method', heading: 'm', paragraphs: ['y'] }, { id: 'odds', heading: 'o', paragraphs: ['z'] }] }, thinBase, PACKET);
  assert.deepEqual(draft.sections.map((s) => s.id), ['path', 'method'], 'packet-family ids adopted; method stays code-owned; unknown ids dropped');
});
