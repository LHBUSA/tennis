// Editorial overhaul (owner brief 2026-10-03, "Prose leads. Data supports."): story angle, editorial acceptance gate,
// narrative adoption and the preview frame. Real frozen packet: Munar d. No. 10 Fritz, Tokyo ATP 500 R1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { storyAngle, storyTier, setStory, turningPoints, availableVisuals, PROSE_TARGETS } from '../workers/tennis-news/src/angle.js';
import { editorialGate, proseWords, stockPhrases, shingles, inlineVisuals } from '../workers/tennis-news/src/editorial-gate.js';
import { runGates } from '../workers/tennis-news/src/gates.js';
import { compose } from '../workers/tennis-news/src/compose.js';
import { buildPlan } from '../workers/tennis-news/src/plan.js';
import { adopt, buildInput, SCHEMA } from '../workers/tennis-news/src/editorial.js';
import { classifyEvent } from '../workers/tennis-news/src/classify.js';
import { publicationGate } from '../workers/tennis-news/src/overhaul.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/news/${f}`, import.meta.url), 'utf8'));
const PACKET = read('munar-fritz-tokyo-2026-packet.json');
const PUBLISHED = read('munar-fritz-tokyo-2026-published.json');
const GOOD = read('munar-fritz-narrative-v5.json');
const base = compose(PACKET, { storyClass: 'full' });
const PLAN = buildPlan(PACKET, base);

test('story angle: decided from the evidence (comeback after a lost tiebreak), turning points from the stored sets only', () => {
  const a = storyAngle(PACKET, PLAN, 'full');
  assert.equal(a.type, 'recap');
  assert.equal(a.tier, 'feature');
  assert.equal(a.angle.id, 'comeback');
  assert.ok(a.secondary.some((x) => x.id === 'upset'));
  assert.deepEqual(setStory(PACKET).map((s) => [s.score, s.winner, s.margin]), [['6-7(7)', 'L', 'tiebreak'], ['6-4', 'W', 'narrow'], ['6-3', 'W', 'clear']]);
  const tp = turningPoints(PACKET);
  assert.ok(tp.some((x) => /tiebreak/.test(x.what) && x.at === 'set 1'));
  assert.ok(tp.some((x) => /other way/.test(x.what) && x.at === 'set 2'));
  assert.ok(tp.every((x) => x.basis === 'set scores'), 'no observed games in this packet: nothing claims a break or a run');
  assert.ok(a.visuals.suggested.length >= 2 && a.visuals.suggested.every((v) => availableVisuals(PLAN).has(v)));
  assert.ok(!availableVisuals(PLAN).has('scoreboard'), 'the scoreboard is placed by layout, never attached by the writer');
});

test('tiers: features vs news vs doubles vs rankings', () => {
  assert.equal(storyTier(PACKET, 'brief'), 'feature', 'top-10 upset is a feature even as a brief');
  assert.equal(storyTier({ ...PACKET, event: { kind: 'upset', facts: { loser_rank: 40 } } }, 'brief'), 'news');
  assert.equal(storyTier({ match: { event_type: 'WD', sets: [] }, event: { kind: 'doubles_title' } }, 'brief'), 'doubles');
  assert.equal(storyTier({ player: {}, event: { kind: 'enters_top20' } }, 'brief'), 'ranking');
  assert.equal(PROSE_TARGETS.feature.min, 650);
});

test('editorial gate: the published Munar story (143 words around ten modules) fails for the reasons the owner named', () => {
  const g = editorialGate(PUBLISHED, PACKET, { plan: PLAN, storyClass: 'full' });
  assert.equal(g.pass, false);
  const ids = new Set(g.failures.map((f) => f.gate));
  for (const id of ['thin_prose', 'mostly_structured', 'chart_without_interpretation', 'template_headings']) assert.ok(ids.has(id), id);
  assert.ok(g.metrics.prose_words < 250);
});

test('editorial gate + factual gates: a real narrative rewrite of the same packet passes both', () => {
  const art = { ...GOOD, sections: GOOD.sections };
  const e = editorialGate(art, PACKET, { plan: PLAN, storyClass: 'full' });
  assert.ok(e.pass, JSON.stringify(e.failures));
  assert.ok(e.metrics.prose_words >= 650 && e.metrics.prose_words <= 1150, String(e.metrics.prose_words));
  assert.equal(e.metrics.layout, 'narrative');
  assert.equal(e.metrics.interpreted_visuals, 3);
  const f = runGates(art, PACKET, { plan: PLAN });
  assert.ok(f.pass, JSON.stringify(f.failures));
  const both = publicationGate(PACKET, { plan: PLAN, storyClass: 'full' })(art);
  assert.ok(both.pass && both.editorial.pass);
});

test('editorial gate: each named failure is caught', () => {
  const mut = (fn) => { const a = structuredClone(GOOD); fn(a); return editorialGate(a, PACKET, { plan: PLAN, storyClass: 'full' }).failures.map((f) => f.gate); };
  assert.ok(mut((a) => { a.sections[0].paragraphs[0] = 'Jaume Munar beat Taylor Fritz 6-7(7), 6-4, 6-3 in round 1 of the Tokyo event, and it was a big result for him in the opening round.'; }).includes('template_intro'));
  assert.ok(mut((a) => { a.sections[2].paragraphs[1] += ' He attacked the Fritz backhand all afternoon.'; }).includes('unsupported_tactical'));
  assert.ok(mut((a) => { a.sections[1].visual_note = 'The sets.'; }).includes('chart_without_interpretation'));
  assert.ok(mut((a) => { a.sections[3].heading = a.sections[2].heading; }).includes('duplicate_heading'));
  assert.ok(mut((a) => { a.sections[1].heading = 'What happened'; a.sections[2].heading = 'Why it mattered'; }).includes('template_headings'));
  assert.ok(mut((a) => { a.sections[4].paragraphs.push(a.sections[0].paragraphs[0]); }).includes('conclusion_repeats_opening'));
  assert.ok(mut((a) => { a.sections[1].paragraphs = ['Munar won.']; }).includes('rhythm'));
  assert.ok(mut((a) => { a.sections[2].paragraphs.push('Fritz recorded 62.1%. Munar recorded 45.3%. Fritz had 528. Munar had 309.'); }).includes('database_writing'));
  assert.ok(mut((a) => { for (const s of a.sections) s.paragraphs = s.paragraphs.map((p) => p.replace(/set/g, 'part').replace(/tiebreak/g, 'decider')); }).includes('recap_no_development'));
});

test('repeated phrasing: a frame shared with several other stories is flagged; compliance wording never is', () => {
  const frame = 'The clearest separation came on return points, where the gap told the story of the final.';
  const corpus = [1, 2, 3].map((i) => ({ slug: `s${i}`, shingles: shingles(`${frame} Other words ${i}.`) }));
  const art = structuredClone(GOOD);
  art.sections[2].paragraphs.push(frame);
  assert.ok(stockPhrases(art, corpus).length >= 3);
  const compliance = [1, 2, 3].map((i) => ({ slug: `c${i}`, shingles: shingles(`On the ATP singles list in the PropBetEdge archive in force when the tournament began, Player ${i} was there.`) }));
  assert.equal(stockPhrases(GOOD, compliance).length, 0);
});

test('adopt: narrative sections keep visual + note; unknown visuals and scoreboard are dropped; layout marked', () => {
  const out = adopt({ headline: 'H x', dek: 'D', sections: [{ id: 'lead', heading: '', paragraphs: ['p'], visual: 'scoreboard', visual_note: '' }, { id: 'unfolded', heading: 'Sets', paragraphs: ['q'], visual: 'set_by_set', visual_note: 'note' }, { id: 'why', heading: 'W', paragraphs: ['r'], visual: 'odds_chart', visual_note: 'x' }] }, base, PACKET, { plan: PLAN });
  assert.equal(out.layout, 'narrative/1');
  assert.equal(out.sections[0].visual, undefined);
  assert.equal(out.sections[1].visual, 'set_by_set');
  assert.equal(out.sections[2].visual, undefined);
  assert.equal(out.sections.at(-1).id, 'method');
  assert.deepEqual(SCHEMA.properties.sections.items.required, ['id', 'heading', 'paragraphs', 'visual', 'visual_note']);
  const input = buildInput(PACKET, base, null, { plan: PLAN });
  assert.match(input, /STORY ANGLE/);
  assert.match(input, /WORD TARGET: 650-1150/);
  assert.match(input, /WHERE THE MATCH SWUNG/);
  assert.ok(!/FACT-SAFE BASELINE/.test(input), 'the templated baseline is no longer shown to the writer');
});

test('legacy layout: visual blocks counted from the plan (no interpretation possible)', () => {
  const iv = inlineVisuals(PUBLISHED, PLAN);
  assert.equal(iv.layout, 'legacy');
  assert.ok(iv.ids.length >= 5);
  assert.equal(proseWords(PUBLISHED) < 200, true);
});

test('preview class rule: late rounds of tour events and 500+ quarterfinals only', () => {
  const ev = (round, extra = {}) => ({ kind: 'preview', facts: { event_type: 'MS', tour: 'atp', source_family: 'espn', edition_tier: 'ATP 500', round, ...extra } });
  assert.equal(classifyEvent(ev('Q')).surface, 'full');
  assert.equal(classifyEvent(ev('S')).surface, 'full');
  assert.equal(classifyEvent(ev('2')).surface, 'wire');
  assert.equal(classifyEvent(ev('Q-2')).surface, 'wire', 'qualifying is never previewed');
  assert.equal(classifyEvent(ev('Q', { edition_tier: null, source_family: 'wta', tour: 'wta', event_type: 'WS', level: 'WTA 250' })).surface, 'wire', '250 quarterfinal without a top-10 player');
  assert.equal(classifyEvent(ev('Q', { edition_tier: null, source_family: 'wta', tour: 'wta', event_type: 'WS', level: 'WTA 250', a_rank: 8 })).surface, 'full');
});

test('preview gates: a prediction is held; the preview frame is never publishable on its own', () => {
  const pv = { ...structuredClone(PACKET), preview: true, event: { kind: 'preview', facts: { round: 'Q' } }, match: { ...PACKET.match, status: 'scheduled', winner_side: null, sets: [] } };
  delete pv.expectation; delete pv.draw_path;
  pv.paths = { A: { matches: [] }, B: { matches: PACKET.draw_path.matches } };
  const frame = compose(pv, { storyClass: 'full' });
  assert.equal(frame.story_type, 'preview');
  const plan = buildPlan(pv, frame);
  assert.equal(plan.layout, 'narrative/1');
  assert.ok(plan.module_ids.includes('preview_card'));
  const g = publicationGate(pv, { plan, storyClass: 'full' })(frame);
  assert.equal(g.pass, false, 'thin frame');
  assert.ok(g.failures.some((f) => f.gate === 'thin_prose'));
  const art = { ...frame, sections: [{ id: 'lead', heading: '', paragraphs: ['Fritz will win this match comfortably, and the question is only by how much the ranking gap shows.'] }, ...frame.sections.slice(1)] };
  assert.ok(runGates(art, pv, { plan }).failures.some((f) => f.gate === 'unsupported_prediction'));
});

test('overhaul queue: waits (pops nothing) once the premium budget for the UTC day is used', async () => {
  const { processOverhaulQueue } = await import('../workers/tennis-news/src/index.js');
  const { poolKey } = await import('../workers/tennis-news/src/ai-router.js');
  const m = new Map([['news:overhaul:queue', JSON.stringify([{ type: 'rewrite', id: 'x', attempts: 2 }])], [poolKey('premium'), '250000']]);
  const kv = { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } };
  const r = await processOverhaulQueue({ TENNIS_STATE: kv }, null);
  assert.match(r.waiting, /budget/);
  assert.equal(JSON.parse(m.get('news:overhaul:queue')).length, 1, 'item kept for the next day');
  assert.equal(await processOverhaulQueue({ TENNIS_STATE: { get: async () => null, put: async () => {} } }, null), null, 'empty queue: nothing to do');
});

test('voice rules (coordinator review 2026-10-03): the real phrases from the first rewrites are rejected', async () => {
  const { META_LANGUAGE, ARCHIVE_TIC, SCAFFOLD, CLUNKY_SCORE, statCount } = await import('../workers/tennis-news/src/editorial-gate.js');
  for (const t of ['The available source contains no point-by-point or serve statistics, so the set scores place a necessary limit on the description.', "Shapovalov's earlier Tokyo matches are not included in the supplied path record.", 'His recent hard-court evidence is more limited in the supplied surface labels.', 'The scores alone cannot establish a technical cause.', 'Alcaraz brings two documented tournament wins.']) assert.match(t, META_LANGUAGE, t);
  const tic = 'On the ATP singles list in the PropBetEdge archive in force at the start of the tournament, Fritz was No. 10. He had won 13.8% of the contests in our archive. His archived match-win rate was 45.3%, and the stored records leaned to Fritz.';
  assert.ok(tic.match(ARCHIVE_TIC).length > 2);
  for (const t of ['That result matters for the preview because Alcaraz has already had to respond.', 'That comparison describes a substantial difference in how often each has converted appearances.', 'Those figures did not dictate this match, but they explain why Munar had to survive the opener.']) assert.match(t, SCAFFOLD, t);
  for (const t of ['That contest also ran beyond the standard finishing threshold before the opener went to Fritz.', "the tiebreak recorded as 7-9 from Munar's side"]) assert.match(t, CLUNKY_SCORE, t);
  assert.ok(statCount('Before the match, he had won 13.8% of contests after losing the opening set; Fritz converted at 86%. His match-win rate was 62.1% to 45.3%, deciding sets 38.3% to 56.7%, and he was 4-20 against top-10 players at 16.7%.') > 3);
  assert.equal(statCount('Munar won the second set 6-4 and the third 6-3, after Fritz took a 9-7 tiebreak.'), 0, 'scores are not statistics');
  const art = structuredClone(GOOD);
  art.sections[2].paragraphs.push('Those figures did not dictate this match, but they explain why Munar had to survive the opener. His archived and stored records in our archive say so.');
  const ids = editorialGate(art, PACKET, { plan: PLAN, storyClass: 'full' }).failures.map((f) => f.gate);
  for (const id of ['self_explaining', 'archive_tic']) assert.ok(ids.includes(id), id);
});
