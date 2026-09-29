// Tennis AI router (V4): explicit, deterministic, measurable model routing; trigger allow-list; soft caps; one automatic
// attempt; per-call telemetry with the network-wide field names; an offline canary that never writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, flagshipEligibility, aiConfig, poolOf, nominalStandardCost, callTelemetry, poolKey, addPoolTokens, poolUsage, isNewCanonicalStory, LANES } from '../workers/tennis-news/src/ai-router.js';
import { editorialize } from '../workers/tennis-news/src/editorial.js';
import { runCanary } from '../workers/tennis-news/src/canary.js';
import { compose } from '../workers/tennis-news/src/compose.js';
import { runGates } from '../workers/tennis-news/src/gates.js';
import { statLines } from '../workers/tennis-news/src/packet.js';
import { MemKV } from './helpers/memstore.js';

const A = { id: '00000000-0000-5000-8000-00000000000a', slug: 'ann-alpha', name: 'Ann Alpha', last_name: 'ALPHA', nationality: 'ITA', photo: null, rank: { rank: 87, list_date: '2026-09-14', list: 'wta_singles' } };
const B = { id: '00000000-0000-5000-8000-00000000000b', slug: 'bea-beta', name: 'Bea Beta', last_name: 'BETA', nationality: 'USA', photo: null, rank: { rank: 6, list_date: '2026-09-14', list: 'wta_singles' } };
const packet = (over = {}) => ({
  version: 'tennis-packet/1.0.0', built_at: '2026-09-20T12:00:00Z',
  event: { kind: 'upset', event_id: 'upset:abcdef123456', materiality: 82, facts: { winner_rank: 87, loser_rank: 6, list_date: '2026-09-14' }, occurred_at: '2026-09-19T10:00:00Z' },
  provenance: { data_brand: 'DATA · PropSports', data_url: 'https://propsports.proptechusa.ai', upstream: [{ family: 'wta', what: 'match result' }] },
  match: { id: '11111111-1111-5111-8111-111111111111', event_type: 'WS', round: 'M-Q', round_label: 'quarterfinal', format: 'BO3_TB7', best_of: 3, status: 'completed', winner_side: 'A', score: '4-6 7-6(5) 6-3', sets: [{ A: 4, B: 6, tb: null }, { A: 7, B: 6, tb: { A: 7, B: 5 } }, { A: 6, B: 3, tb: null }], duration_s: 9420, duration: { hours: 2, minutes: 37 }, started_at: '2026-09-19T10:00:00Z', date: '2026-09-19' },
  participants: { A: { key: 'S:a', seed: null, entry: 'Q', players: [A] }, B: { key: 'S:b', seed: 2, entry: null, players: [B] } },
  tournament: { edition_id: 'e', slug: 'test-open', name: 'Test Open', year: 2026, level: 'WTA 500', surface: 'hard', indoor: false, city: 'Testville', country: 'USA', start_date: '2026-09-14', end_date: '2026-09-21' },
  stats: statLines({ service_points: 70, first_serves_in: 45, first_serve_points_won: 33, second_serve_points_won: 13, aces: 6, double_faults: 2, break_points_faced: 6, break_points_saved: 4, total_points_won: 78 }, { service_points: 74, first_serves_in: 48, first_serve_points_won: 31, second_serve_points_won: 10, aces: 3, double_faults: 5, break_points_faced: 9, break_points_saved: 5, total_points_won: 66 }),
  canonical_signature: 'upset:11111111-1111-5111-8111-111111111111',
  ...over
});
const env = (x = {}) => ({ OPENAI_API_KEY: 'test', ...x });
const recordingFetch = (body) => { const calls = []; const f = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'resp_1', status: 'completed', model: calls.at(-1).model, output: [{ content: [{ type: 'output_text', text: JSON.stringify(body) }] }], usage: { input_tokens: 5000, input_tokens_details: { cached_tokens: 1200 }, output_tokens: 1800, output_tokens_details: { reasoning_tokens: 700 } } }), { status: 200 }); }; f.calls = calls; return f; };
const badDraft = { headline: 'x', dek: 'y', sections: [{ id: 'what_happened', heading: 'x', paragraphs: ['Alpha fired 19 aces and Beta, nursing a wrist injury, faded late.'] }] };

test('routing table: wire deterministic; routine -> Sol standard (premium, 6000 ceiling); flagship off by default', () => {
  const e = env();
  assert.equal(route({ storyClass: 'wire', publishArticle: false, env: e }).lane, LANES.DETERMINISTIC);
  const r = route({ storyClass: 'brief', event: { kind: 'comeback', facts: {} }, packet: packet(), dims: ['result', 'set_detail'], env: e });
  assert.deepEqual([r.lane, r.model, r.pool, r.max_output_tokens, r.reasoning_effort], [LANES.STANDARD, 'gpt-5.6-sol', 'premium', 6000, 'medium']);
  const deep = route({ storyClass: 'deep', env: e });
  assert.equal(deep.lane, LANES.STANDARD, 'flagship-eligible stays standard while TENNIS_AI_FLAGSHIP_ENABLED is off');
  assert.match(deep.reason, /flagship-eligible .* TENNIS_AI_FLAGSHIP_ENABLED is off/);
  const on = route({ storyClass: 'deep', env: env({ TENNIS_AI_FLAGSHIP_ENABLED: 'true', TENNIS_AI_FLAGSHIP_CLASSES: 'deep_class' }) });
  assert.deepEqual([on.lane, on.model, on.pool, on.max_output_tokens], [LANES.FLAGSHIP, 'gpt-6-astra', 'premium', 8000]);
  assert.equal(route({ storyClass: 'brief', env: {}, hasKey: false }).lane, LANES.DETERMINISTIC);
});

test('flagship eligibility is deterministic from stored facts only (no model decides)', () => {
  const cfg = aiConfig({});
  const major = packet({ tournament: { ...packet().tournament, level: 'Grand Slam' }, match: { ...packet().match, round: 'M-F' } });
  assert.equal(flagshipEligibility({ storyClass: 'full', event: { kind: 'title', facts: {} }, packet: major, cfg }).eligible, true);
  assert.equal(flagshipEligibility({ storyClass: 'brief', event: { kind: 'upset', facts: { level: 'ATP Masters 1000' } }, packet: packet(), dims: ['result', 'a', 'b', 'c', 'd', 'e', 'f'], cfg }).eligible, true);
  assert.equal(flagshipEligibility({ storyClass: 'brief', event: { kind: 'comeback', facts: {} }, packet: packet(), dims: ['result', 'set_detail'], cfg }).eligible, false, 'shallow routine recap');
  assert.equal(flagshipEligibility({ storyClass: 'brief', event: { kind: 'enters_top50', facts: {} }, dims: ['result', 'ranking'], cfg }).eligible, false, 'basic ranking note');
  assert.equal(flagshipEligibility({ storyClass: 'full', event: { kind: 'new_no1', facts: {} }, dims: ['result', 'a', 'b', 'c', 'd'], cfg }).eligible, true);
  // same inputs -> same answer
  const x = { storyClass: 'full', event: { kind: 'upset', facts: {} }, packet: packet(), dims: ['result', 'a', 'b'], cfg };
  assert.deepEqual(flagshipEligibility(x), flagshipEligibility(x));
});

test('pools are configuration: luna is PREMIUM, mini/nano are VOLUME; the volume lane is never chosen for prose', () => {
  const cfg = aiConfig({});
  assert.equal(poolOf('gpt-6-luna', cfg), 'premium');
  assert.equal(poolOf('gpt-5.4-mini', cfg), 'volume');
  assert.equal(poolOf('gpt-5.4-nano', cfg), 'volume');
  assert.equal(poolOf('gpt-5.4-mini', aiConfig({ TENNIS_AI_POOLS: '{"gpt-5.4-mini":"premium"}' })), 'premium', 'overridable');
  for (const storyClass of ['brief', 'full', 'deep']) assert.notEqual(route({ storyClass, env: env() }).lane, LANES.VOLUME);
});

test('soft caps: warn is flagged; at the Tennis premium cap prose falls back to the deterministic baseline', () => {
  const warn = route({ storyClass: 'full', env: env(), usage: { premium_today: 260000 } });
  assert.equal(warn.lane, LANES.STANDARD); assert.equal(warn.soft_cap, 'warn');
  const cap = route({ storyClass: 'deep', env: env({ TENNIS_AI_FLAGSHIP_ENABLED: 'true', TENNIS_AI_FLAGSHIP_CLASSES: 'deep_class' }), usage: { premium_today: 300000 } });
  assert.equal(cap.lane, LANES.DETERMINISTIC, 'flagship cannot fall back to standard: both are premium pool');
  assert.match(cap.reason, /soft cap reached/);
  assert.equal(route({ storyClass: 'full', env: env({ TENNIS_PREMIUM_DAILY_SOFT_CAP: '500000' }), usage: { premium_today: 300000 } }).lane, LANES.STANDARD, 'configurable');
});

test('TRIGGER ALLOW-LIST: legacy repair / upgrade / revision cannot reach premium model transport', async () => {
  for (const trigger of ['upgrade', 'revision', 'legacy_repair', 'correction', 'generator_version_change', 'visual_change', 'model_version_change']) {
    const r = route({ storyClass: 'deep', env: env({ TENNIS_AI_FLAGSHIP_ENABLED: 'true', TENNIS_AI_FLAGSHIP_CLASSES: 'deep_class' }), trigger });
    assert.equal(r.lane, LANES.DETERMINISTIC); assert.equal(r.reason, `trigger_not_eligible:${trigger}`); assert.equal(r.model, null);
    const p = packet();
    const f = recordingFetch(badDraft);
    const ed = await editorialize({ packet: p, baseline: compose(p), gate: (x) => runGates(x, p), apiKey: 'test', routing: r, fetchImpl: f });
    assert.equal(f.calls.length, 0, `${trigger}: zero model calls`);
    assert.equal(ed.origin, 'baseline', 'deterministic baseline prose, still through every gate');
  }
  for (const trigger of ['new', 'admin_reedit', 'canary']) assert.equal(route({ storyClass: 'full', env: env(), trigger }).lane, LANES.STANDARD);
  assert.equal(route({ storyClass: 'full', env: env({ TENNIS_AI_ELIGIBLE_TRIGGERS: 'new' }), trigger: 'admin_reedit' }).lane, LANES.DETERMINISTIC, 'configurable');
  assert.equal(isNewCanonicalStory(null), true); assert.equal(isNewCanonicalStory({ article_id: 'x' }), false);
});

test('automatic runs make ONE model call; a failed draft falls back to the baseline; telemetry has the network-wide fields', async () => {
  const p = packet();
  const f = recordingFetch(badDraft);
  const calls = [];
  const routing = route({ storyClass: 'brief', env: env(), dims: ['result', 'set_detail'] });
  const ed = await editorialize({ packet: p, baseline: compose(p), gate: (x) => runGates(x, p), apiKey: 'test', routing, fetchImpl: f, onCall: (c) => calls.push(c) });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].max_output_tokens, 6000); assert.equal(f.calls[0].model, 'gpt-5.6-sol'); assert.deepEqual(f.calls[0].reasoning, { effort: 'medium' });
  assert.equal(ed.origin, 'baseline');
  assert.equal(calls.length, 1);
  const row = callTelemetry({ eventId: 'upset:abc', articleId: 'art', storyClass: 'brief', routing, trigger: 'new', call: calls[0], cfg: aiConfig({}) });
  assert.equal(row.stage, 'cost');
  for (const k of ['routing_lane', 'routing_reason', 'model', 'pool', 'trigger', 'attempt', 'response_id', 'input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_tokens', 'latency_ms', 'status', 'nominal_standard_cost']) assert.ok(k in row.detail, k);
  assert.deepEqual([row.detail.input_tokens, row.detail.cached_input_tokens, row.detail.output_tokens, row.detail.reasoning_tokens, row.detail.response_id, row.detail.status], [5000, 1200, 1800, 700, 'resp_1', 'gate_failed']);
  assert.equal(row.detail.nominal_standard_cost, nominalStandardCost('gpt-5.6-sol', calls[0].usage, aiConfig({})));
  assert.equal(nominalStandardCost('gpt-6-astra', calls[0].usage, aiConfig({})), null, 'no invented rate: null until configured');
  assert.ok(!('actual_cost' in row.detail));
});

test('pool counters: Tennis share per pool per UTC day', async () => {
  const kv = new MemKV();
  const d = new Date('2026-09-29T12:00:00Z');
  await addPoolTokens(kv, 'premium', 6800, d); await addPoolTokens(kv, 'premium', 1000, d); await addPoolTokens(kv, 'none', 99, d);
  assert.deepEqual(await poolUsage(kv, d), { premium_today: 7800, volume_today: 0 });
  assert.equal(poolKey('premium', d), 'tennis:ai:tokens:premium:2026-09-29');
});

test('canary: identical inputs for both models, metrics returned, NOTHING written to the store', async () => {
  const p = packet();
  const writes = [];
  const store = {
    async select(t) { return t === 'tennis_articles' ? [{ article_id: 'art', slug: 'alpha-beats-beta', story_class: 'brief', desk: 'wta', story_type: 'upset', tennis_article_evidence: { packet: p, frozen_at: '2026-09-20T12:00:00Z' } }] : []; },
    async insert(...a) { writes.push(['insert', ...a]); }, async upsert(...a) { writes.push(['upsert', ...a]); }, async req(...a) { writes.push(['req', ...a]); }, async del(...a) { writes.push(['del', ...a]); }
  };
  const f = recordingFetch(badDraft);
  const kv = new MemKV();
  const out = await runCanary({ OPENAI_API_KEY: 'test', TENNIS_STATE: kv }, store, { eventId: 'upset:abcdef123456', models: ['gpt-5.6-sol', 'gpt-6-astra'], fetchImpl: f });
  assert.equal(writes.length, 0, 'the canary never writes');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].instructions, f.calls[1].instructions); assert.equal(JSON.stringify(f.calls[0].input), JSON.stringify(f.calls[1].input)); assert.equal(f.calls[0].max_output_tokens, f.calls[1].max_output_tokens);
  assert.deepEqual(out.results.map((r) => r.model).sort(), ['gpt-5.6-sol', 'gpt-6-astra']);
  for (const r of out.results) { assert.equal(r.gate.pass, false); assert.ok(r.gate.failures.length); assert.ok(Number.isInteger(r.words)); assert.ok('diagnostics' in r); }
  assert.ok(Number(await kv.get(poolKey('canary-premium'))) > 0, 'canary tokens are counted separately from the production soft cap');
  assert.equal(Number(await kv.get(poolKey('premium'))) || 0, 0);
});

test('flagship is released per eligibility class: enabled alone is not enough', async () => {
  const { route } = await import('../workers/tennis-news/src/ai-router.js');
  const args = { storyClass: 'deep', trigger: 'new', dims: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], packet: {}, event: {} };
  const off = route({ ...args, env: { TENNIS_AI_FLAGSHIP_ENABLED: 'true' } });
  assert.equal(off.lane, 'STANDARD_EDITORIAL');
  assert.match(off.reason, /not released in TENNIS_AI_FLAGSHIP_CLASSES/);
  const on = route({ ...args, env: { TENNIS_AI_FLAGSHIP_ENABLED: 'true', TENNIS_AI_FLAGSHIP_CLASSES: 'deep_class' } });
  assert.equal(on.lane, 'FLAGSHIP_EDITORIAL');
  assert.equal(on.model, 'gpt-6-astra');
  const other = route({ ...args, storyClass: 'full', env: { TENNIS_AI_FLAGSHIP_ENABLED: 'true', TENNIS_AI_FLAGSHIP_CLASSES: 'deep_class' } });
  assert.equal(other.lane, 'STANDARD_EDITORIAL', 'a rich_packet story is not released by deep_class');
});
