// Production-path release canary (V4 gate, owner 2026-09-29): ONE routed call on a stored frozen packet, trigger 'canary',
// through route() -> Responses -> gates -> model_call telemetry -> premium KV counter. Never writes articles/evidence/events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routedCanary } from '../workers/tennis-news/src/index.js';
import { poolKey } from '../workers/tennis-news/src/ai-router.js';
import { statLines } from '../workers/tennis-news/src/packet.js';
import { MemKV } from './helpers/memstore.js';

const P = (id, name, rank) => ({ id, slug: name.toLowerCase().replace(' ', '-'), name, last_name: name.split(' ')[1].toUpperCase(), nationality: 'ITA', photo: null, rank: { rank, list_date: '2026-09-14', list: 'wta_singles' } });
const packet = {
  version: 'tennis-packet/1.0.0', built_at: '2026-09-20T12:00:00Z',
  event: { kind: 'upset', event_id: 'upset:abcdef123456', materiality: 82, facts: { winner_rank: 87, loser_rank: 6, list_date: '2026-09-14' }, occurred_at: '2026-09-19T10:00:00Z' },
  provenance: { data_brand: 'DATA · PropSports', data_url: 'https://propsports.proptechusa.ai', upstream: [{ family: 'wta', what: 'match result' }] },
  match: { id: '11111111-1111-5111-8111-111111111111', event_type: 'WS', round: 'M-Q', round_label: 'quarterfinal', format: 'BO3_TB7', best_of: 3, status: 'completed', winner_side: 'A', score: '4-6 7-6(5) 6-3', sets: [{ A: 4, B: 6, tb: null }, { A: 7, B: 6, tb: { A: 7, B: 5 } }, { A: 6, B: 3, tb: null }], duration_s: 9420, duration: { hours: 2, minutes: 37 }, started_at: '2026-09-19T10:00:00Z', date: '2026-09-19' },
  participants: { A: { key: 'S:a', seed: null, entry: 'Q', players: [P('00000000-0000-5000-8000-00000000000a', 'Ann Alpha', 87)] }, B: { key: 'S:b', seed: 2, entry: null, players: [P('00000000-0000-5000-8000-00000000000b', 'Bea Beta', 6)] } },
  tournament: { edition_id: 'e', slug: 'test-open', name: 'Test Open', year: 2026, level: 'WTA 500', surface: 'hard', indoor: false, city: 'Testville', country: 'USA', start_date: '2026-09-14', end_date: '2026-09-21' },
  stats: statLines({ service_points: 70, first_serves_in: 45, first_serve_points_won: 33, second_serve_points_won: 13, aces: 6, double_faults: 2, break_points_faced: 6, break_points_saved: 4, total_points_won: 78 }, { service_points: 74, first_serves_in: 48, first_serve_points_won: 31, second_serve_points_won: 10, aces: 3, double_faults: 5, break_points_faced: 9, break_points_saved: 5, total_points_won: 66 }),
  canonical_signature: 'upset:11111111-1111-5111-8111-111111111111'
};
const USAGE = { input_tokens: 5000, input_tokens_details: { cached_tokens: 1200 }, output_tokens: 1800, output_tokens_details: { reasoning_tokens: 700 } };

function harness({ storyClass = 'full' } = {}) {
  const writes = [];
  const inserts = [];
  const store = {
    async select(t) {
      if (t === 'tennis_news_events') return [{ event_id: 'upset:abcdef123456', kind: 'upset', facts: packet.event.facts, state: 'published' }];
      if (t === 'tennis_articles') return [{ article_id: 'art-1', slug: 'alpha-beats-beta', story_class: storyClass, tennis_article_evidence: { packet, frozen_at: '2026-09-20T12:00:00Z' } }];
      return [];
    },
    async insert(table, rows) { if (table === 'tennis_news_pipeline_events') inserts.push(...rows); else writes.push(['insert', table]); },
    async upsert(...a) { writes.push(['upsert', ...a]); }, async req(...a) { writes.push(['req', ...a]); }, async del(...a) { writes.push(['del', ...a]); }
  };
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const draft = { headline: 'x', dek: 'y', sections: [{ id: 'what_happened', heading: 'x', paragraphs: ['Alpha fired 19 aces and Beta, nursing a wrist injury, faded late.'] }] };
    return new Response(JSON.stringify({ id: 'resp_canary_1', status: 'completed', model: 'gpt-5.6-sol-2026-09-01', output: [{ content: [{ type: 'output_text', text: JSON.stringify(draft) }] }], usage: USAGE }), { status: 200 });
  };
  return { store, writes, inserts, calls, fetchStub, kv: new MemKV() };
}

async function withFetch(stub, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('routed canary: one call, model_call row (trigger canary), premium counter += input+output, no article writes', async () => {
  const h = harness();
  const env = { OPENAI_API_KEY: 'test', TENNIS_STATE: h.kv };
  const out = await withFetch(h.fetchStub, () => routedCanary(env, h.store, { eventId: 'upset:abcdef123456' }));
  assert.equal(h.calls.length, 1, 'exactly one model call');
  assert.equal(h.calls[0].body.model, 'gpt-5.6-sol');
  assert.equal(out.routing.lane, 'STANDARD_EDITORIAL');
  assert.equal(out.model_calls, 1);
  assert.equal(out.draft.published, false);
  assert.deepEqual(h.writes, [], 'no article / evidence / event writes');
  assert.equal(h.inserts.length, 1);
  const d = h.inserts[0].detail;
  assert.equal(h.inserts[0].stage, 'cost');
  assert.equal(h.inserts[0].article_id, 'art-1');
  assert.deepEqual([d.kind, d.sport, d.trigger, d.routing_lane, d.pool, d.response_id, d.input_tokens, d.cached_input_tokens, d.output_tokens, d.reasoning_tokens], ['model_call', 'tennis', 'canary', 'STANDARD_EDITORIAL', 'premium', 'resp_canary_1', 5000, 1200, 1800, 700]);
  for (const k of ['routing_reason', 'model', 'latency_ms', 'nominal_standard_cost', 'router_version', 'attempt', 'status']) assert.ok(k in d, k);
  assert.equal(Number(await h.kv.get(poolKey('premium'))), 6800, 'premium counter = input + output tokens');
  assert.equal(out.pool_after.premium_today - out.pool_before.premium_today, 6800);
  assert.equal(Number(await h.kv.get(poolKey('canary-premium'))) || 0, 0, 'not the offline canary counter');
});

test('routed canary ?dry=1: routing only, zero model calls, zero telemetry, counter unchanged', async () => {
  const h = harness();
  const out = await withFetch(h.fetchStub, () => routedCanary({ OPENAI_API_KEY: 'test', TENNIS_STATE: h.kv }, h.store, { eventId: 'upset:abcdef123456', dry: true }));
  assert.equal(out.dry, true);
  assert.equal(out.routing.lane, 'STANDARD_EDITORIAL');
  assert.equal(h.calls.length, 0);
  assert.equal(h.inserts.length, 0);
  assert.equal(Number(await h.kv.get(poolKey('premium'))) || 0, 0);
});

test('routed canary refuses any lane but STANDARD_EDITORIAL (wire class -> deterministic -> 0 calls)', async () => {
  const h = harness({ storyClass: 'wire' });
  const out = await withFetch(h.fetchStub, () => routedCanary({ OPENAI_API_KEY: 'test', TENNIS_STATE: h.kv }, h.store, { eventId: 'upset:abcdef123456' }));
  assert.match(out.refused, /DETERMINISTIC/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.inserts.length, 0);
});

test('routed canary is admin-only (404 without the bearer token)', async () => {
  const worker = (await import('../workers/tennis-news/src/index.js')).default;
  const res = await worker.fetch(new Request('https://x/v1/news/canary-routed?event_id=a', { method: 'POST' }), { NEWS_ADMIN_TOKEN: 'secret-token' });
  assert.equal(res.status, 404);
});
