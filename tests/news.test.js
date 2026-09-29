// Newsroom fixtures (brief §22): detection, packet-grounded prose, gates, model fallback, dedupe, quiet day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMatchEvents, detectRankingEvents, GATED_KINDS } from '../workers/tennis-news/src/detect.js';
import { compose } from '../workers/tennis-news/src/compose.js';
import { buildPlan } from '../workers/tennis-news/src/plan.js';
import { runGates, allowedNumbers, numberTokens } from '../workers/tennis-news/src/gates.js';
import { editorialize, redactSecrets, buildInput } from '../workers/tennis-news/src/editorial.js';
import { statLines } from '../workers/tennis-news/src/packet.js';

const A = { id: '00000000-0000-5000-8000-00000000000a', slug: 'ann-alpha', name: 'Ann Alpha', last_name: 'ALPHA', nationality: 'ITA', photo: { player_id: '00000000-0000-5000-8000-00000000000a', square: 'x' }, rank: { rank: 87, list_date: '2026-09-14', list: 'wta_singles' } };
const B = { id: '00000000-0000-5000-8000-00000000000b', slug: 'bea-beta', name: 'Bea Beta', last_name: 'BETA', nationality: 'USA', photo: null, rank: { rank: 6, list_date: '2026-09-14', list: 'wta_singles' } };
const statsA = { service_points: 70, first_serves_in: 45, first_serve_points_won: 33, second_serve_points_won: 13, aces: 6, double_faults: 2, break_points_faced: 6, break_points_saved: 4, total_points_won: 78 };
const statsB = { service_points: 74, first_serves_in: 48, first_serve_points_won: 31, second_serve_points_won: 10, aces: 3, double_faults: 5, break_points_faced: 9, break_points_saved: 5, total_points_won: 66 };

function upsetPacket(over = {}) {
  return {
    version: 'tennis-packet/1.0.0', built_at: '2026-09-20T12:00:00Z',
    event: { kind: 'upset', event_id: 'upset:abcdef123456', materiality: 82, facts: { winner_rank: 87, loser_rank: 6, list_date: '2026-09-14' }, occurred_at: '2026-09-19T10:00:00Z' },
    provenance: { data_brand: 'DATA · PropSports', data_url: 'https://propsports.proptechusa.ai', upstream: [{ family: 'wta', what: 'match result' }] },
    match: { id: '11111111-1111-5111-8111-111111111111', event_type: 'WS', round: 'M-Q', round_label: 'quarterfinal', format: 'BO3_TB7', best_of: 3, status: 'completed', winner_side: 'A', score: '4-6 7-6(5) 6-3', sets: [{ A: 4, B: 6, tb: null }, { A: 7, B: 6, tb: { A: 7, B: 5 } }, { A: 6, B: 3, tb: null }], duration_s: 9420, duration: { hours: 2, minutes: 37 }, started_at: '2026-09-19T10:00:00Z', date: '2026-09-19' },
    participants: { A: { key: 'S:a', seed: null, entry: 'Q', players: [A] }, B: { key: 'S:b', seed: 2, entry: null, players: [B] } },
    tournament: { edition_id: 'e', slug: 'test-open', name: 'Test Open', year: 2026, level: 'WTA 500', surface: 'hard', indoor: false, city: 'Testville', country: 'USA', start_date: '2026-09-14', end_date: '2026-09-21' },
    stats: statLines(statsA, statsB),
    canonical_signature: 'upset:11111111-1111-5111-8111-111111111111',
    ...over
  };
}

test('detection: a legitimate upset from ranks in force on the match date; one kind per fact', async () => {
  const m = { id: 'm1', event_type: 'WS', round: 'M-Q', status: 'completed', winner_side: 'A', best_of: 3, sets: [{ A: 6, B: 4 }, { A: 6, B: 3 }], duration_s: 5000, edition: { level: 'WTA 1000', start_date: '2026-09-14' }, sides: { A: { players: [{ id: 'a' }], rank: 87, list_date: '2026-09-14' }, B: { players: [{ id: 'b' }], rank: 6, list_date: '2026-09-14', seed: 2 } } };
  const evs = await detectMatchEvents(m);
  const up = evs.find((e) => e.kind === 'upset');
  assert.ok(up && up.materiality >= 60);
  assert.equal(up.event_id, (await detectMatchEvents(m)).find((e) => e.kind === 'upset').event_id, 'deterministic id: reruns never duplicate');
  assert.ok(!evs.some((e) => /first/.test(e.kind)), 'no "first" kinds without career-complete history');
  assert.ok(GATED_KINDS.first_title && GATED_KINDS.career_high);
});

test('detection: marathon, retirement (no reason), quiet day = nothing', async () => {
  const base = { id: 'm2', event_type: 'WS', round: 'M-2', winner_side: 'A', best_of: 3, edition: { level: 'WTA 500' }, sides: { A: { players: [{ id: 'a' }], rank: 20 }, B: { players: [{ id: 'b' }], rank: 15 } } };
  const mar = await detectMatchEvents({ ...base, status: 'completed', sets: [{ A: 7, B: 6, tb: true }, { A: 6, B: 7, tb: true }, { A: 7, B: 5 }], duration_s: 3 * 3600 + 1200 });
  assert.ok(mar.some((e) => e.kind === 'marathon'));
  const ret = await detectMatchEvents({ ...base, status: 'retired', retired_side: 'B', sets: [{ A: 6, B: 2 }, { A: 2, B: 1 }], duration_s: 3000 });
  const r = ret.find((e) => e.kind === 'retirement');
  assert.ok(r);
  assert.deepEqual(Object.keys(r.facts), ['retired_side'], 'a retirement carries no reason field');
  assert.deepEqual(await detectMatchEvents({ ...base, status: 'scheduled', winner_side: null }), [], 'quiet day: an unfinished match is never a story');
  assert.deepEqual(await detectMatchEvents({ ...base, status: 'completed', sets: [{ A: 6, B: 4 }, { A: 6, B: 4 }], duration_s: 4000 }), [], 'routine result: no story');
});

test('detection: ranking milestone from two consecutive official lists', async () => {
  const evs = await detectRankingEvents({ listKey: 'wta_singles', prevDate: '2026-09-14', nextDate: '2026-09-21', prev: new Map([['p', 12], ['q', 1]]), next: new Map([['p', 9], ['q', 1]]) });
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, 'enters_top10');
  assert.equal(evs[0].facts.previous_rank, 12);
});

test('baseline article: every number grounded, packet sections only, charts from packet values', () => {
  const p = upsetPacket();
  const a = compose(p);
  const g = runGates(a, p);
  assert.equal(g.pass, true, JSON.stringify(g.failures));
  assert.match(a.headline, /Alpha beats No\. 6 Beta/);
  const plan = buildPlan(p, a);
  const serve = plan.modules.find((m) => m.id === 'charts').data.charts.find((c) => c.id === 'serve_comparison');
  const allowed = allowedNumbers(p);
  for (const row of serve.series) for (const k of ['w', 'l']) assert.ok(allowed.has(String(row[k])), `chart value ${row[k]} is a packet value`);
  assert.ok(plan.omitted.some((o) => o.id === 'h2h'), 'empty modules are omitted with a reason, not padded');
});

const withProse = (a, text) => ({ ...a, sections: [{ id: 'what_happened', heading: 'What happened', paragraphs: [text] }, ...a.sections.slice(1)] });

test('gates HOLD: fabricated number, bad score, wrong winner, medical claim, quote, odds, first-title claim', () => {
  const p = upsetPacket();
  const a = compose(p);
  const cases = {
    numeric_grounding: 'Alpha hit 14 aces in the win over Beta in the quarterfinal of the Test Open.',
    wrong_winner: 'Beta beat Alpha in the quarterfinal of the Test Open in a long match on hard courts.',
    unsupported_medical: 'Beta struggled with a shoulder injury as Alpha won the quarterfinal of the Test Open.',
    unsupported_quote: 'Alpha said “I felt great today” after winning the quarterfinal of the Test Open.',
    unsupported_market: 'Alpha, the underdog, won the quarterfinal of the Test Open over Beta on hard courts.',
    unsupported_first_or_record: 'Alpha reached her first semifinal by winning the quarterfinal of the Test Open.',
    unsupported_mentality: 'Alpha showed great belief to win the quarterfinal of the Test Open against Beta.'
  };
  for (const [gate, text] of Object.entries(cases)) {
    const g = runGates(withProse(a, text), p);
    assert.equal(g.pass, false, gate);
    assert.ok(g.failures.some((f) => f.gate === gate), `${gate}: got ${g.failures.map((f) => f.gate)}`);
  }
  const bad = upsetPacket();
  bad.match = { ...bad.match, score: '6-4 6-3' };
  assert.ok(runGates(compose(bad), bad).failures.some((f) => f.gate === 'score_mismatch'), 'bad score');
});

test('gates HOLD: current ranking / future DNA in a historical story; wrong player photo; duplicate event', () => {
  const later = upsetPacket();
  later.participants.B.players = [{ ...B, rank: { rank: 1, list_date: '2026-09-28', list: 'wta_singles' } }];
  assert.ok(runGates(compose(later), later).failures.some((f) => f.gate === 'ranking_after_event'));
  const dna = upsetPacket({ dna: { [A.id]: { as_of: '2026-09-25', metrics: {} } } });
  assert.ok(runGates(compose(dna), dna).failures.some((f) => f.gate === 'dna_after_event'));
  const photo = upsetPacket();
  photo.participants.A.players = [{ ...A, photo: { player_id: B.id, square: 'x' } }];
  assert.ok(runGates(compose(photo), photo).failures.some((f) => f.gate === 'wrong_photo'));
  const p = upsetPacket();
  assert.ok(runGates(compose(p), p, { existingSignatures: new Set([p.canonical_signature]) }).failures.some((f) => f.gate === 'duplicate'));
});

test('hybrid editorial: model prose that passes is used; a hallucinating model falls back to the baseline; no key = baseline', async () => {
  const p = upsetPacket();
  const baseline = compose(p);
  const gate = (x) => runGates(x, p);
  const good = { headline: 'Qualifier Alpha beats No. 6 Beta in the Test Open quarterfinal', dek: 'Alpha, ranked No. 87 when the tournament began, won 4-6, 7-6(5), 6-3 in 2 hours 37 minutes.', sections: [
    { id: 'what_happened', heading: 'What happened', paragraphs: ['Ann Alpha came through qualifying and beat Bea Beta, the No. 2 seed, 4-6, 7-6(5), 6-3 in the quarterfinal of the Test Open. On the official list in force when the tournament began, Alpha was No. 87 and Beta No. 6.'] },
    { id: 'match_data', heading: 'The serve story', paragraphs: ['Alpha won 73.3% of her first-serve points (33 of 45) and converted 4 of 9 break points. Beta saved 5 of the 9 she faced but won 64.6% behind her first serve (31 of 48).', 'Across the match Alpha won 78 points to 66.'] },
    { id: 'why_it_mattered', heading: 'Why it mattered', paragraphs: ['A qualifier removing a top seed at a WTA 500 event reshapes the bottom half of the draw, and the numbers show the win was built on serve rather than on errors from the other side.'] }
  ] };
  const fakeFetch = (body) => async () => new Response(JSON.stringify({ status: 'completed', model: 'gpt-5.6-sol', output: [{ content: [{ type: 'output_text', text: JSON.stringify(body) }] }], usage: { input_tokens: 1000, output_tokens: 500 } }), { status: 200 });
  const ok = await editorialize({ packet: p, baseline, gate, apiKey: 'test', model: 'gpt-5.6-sol', fetchImpl: fakeFetch(good) });
  assert.equal(ok.origin, 'model', JSON.stringify(ok.attempts));
  assert.equal(ok.article.sections.at(-1).id, 'method', 'the method section stays code-owned');
  const hallucinated = { ...good, sections: [{ id: 'what_happened', heading: 'x', paragraphs: ['Alpha fired 19 aces and Beta, nursing a wrist injury, faded late in the Test Open quarterfinal.'] }] };
  const fb = await editorialize({ packet: p, baseline, gate, apiKey: 'test', model: 'gpt-5.6-sol', attempts: 2, fetchImpl: fakeFetch(hallucinated) }); // explicit admin repair: 2 attempts (automatic runs: 1)
  assert.equal(fb.origin, 'baseline', 'model output failing gates is never published; the fact-safe baseline is used');
  assert.equal(fb.attempts.length, 2, 'one corrective retry when a repair explicitly allows it');
  const none = await editorialize({ packet: p, baseline, gate, apiKey: null, model: 'gpt-5.6-sol' });
  assert.equal(none.origin, 'baseline');
  assert.match(none.attempts[0].skipped, /OPENAI_API_KEY/);
  assert.ok(!buildInput(p, baseline).includes('square'), 'media paths never reach the model');
  assert.equal(redactSecrets('openai 401: Incorrect API key provided: sk-proj-abcdefghijklmnop.'), 'openai 401: Incorrect API key provided: <redacted>.');
});

test('number tokenizer: scores split, percentages kept, commas stripped', () => {
  assert.deepEqual(numberTokens('won 6-4, 7-6(5) with 73.3% and 1,204 points'), ['6', '4', '7', '6', '5', '73.3', '1204']);
});
