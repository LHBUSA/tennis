// Issue #15: a held story is retried IN PLACE from its original frozen packet. Same article id and slug, frozen evidence
// never rewritten or deleted, original hold + gate results kept in the revision trail, first publish = the real retry
// time; a failed retry changes nothing; requeue never deletes a frozen article. Real factual + editorial gates throughout.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { retryHeldArticle, holdReason } from '../workers/tennis-news/src/index.js';
import { droughtStatus, reasonFamilies, publicDrought, checkDrought, DROUGHT_KEY } from '../workers/tennis-news/src/watchdog.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/news/${f}`, import.meta.url), 'utf8'));
const PACKET = read('munar-fritz-tokyo-2026-packet.json');
const GOOD = read('munar-fritz-narrative-v5.json');
const THIN = read('munar-fritz-tokyo-2026-published.json');
const draft = (a) => ({ headline: a.headline, dek: a.dek, sections: a.sections.filter((s) => s.id !== 'method').map(({ id, heading = '', paragraphs, visual = '', visual_note = '' }) => ({ id, heading, paragraphs, visual, visual_note })) });

const ARTICLE_ID = '11111111-2222-4333-8444-555555555555';
const FROZEN_AT = '2026-10-08T09:14:00Z';
const ORIGINAL_HOLD = 'model_failed_then_baseline_not_v5: model=[thin_prose]; baseline=[thin_prose,mostly_structured]';
const ORIGINAL_GATES = { gates_version: 'x', gate: { pass: false, failures: [{ gate: 'thin_prose' }] }, attempts: [{ attempt: 1, pass: false }] };

function fakeStore() {
  const evidence = { packet: structuredClone(PACKET), frozen_at: FROZEN_AT };
  const article = { article_id: ARTICLE_ID, event_id: 'ev-1', slug: 'munar-beats-fritz-abc123', status: 'held', story_class: 'full', headline: 'Baseline headline', deck: 'Baseline deck', body: { sections: [] }, gate_results: ORIGINAL_GATES, hold_reason: ORIGINAL_HOLD, content_plan: { media: null, evidence_dimensions: ['result', 'sets'] }, first_published_at: null, published_at: null, revised_at: null, revisions: [] };
  const event = { event_id: 'ev-1', state: 'held', article_id: ARTICLE_ID, state_reason: ORIGINAL_HOLD };
  const log = [];
  const filters = (path) => Object.fromEntries(path.split('?')[1].split('&').map((kv) => kv.split('=')).map(([k, ...v]) => [k, v.join('=')]));
  return {
    article, evidence, event, log,
    async select(table, q) {
      log.push(['select', table, q]);
      if (table === 'tennis_articles' && q.includes(`article_id=eq.${ARTICLE_ID}`)) return [{ ...structuredClone(article), tennis_article_evidence: [structuredClone(evidence)] }];
      return [];
    },
    async insert(table, rows) { log.push(['insert', table, rows]); return rows; },
    async del(table, q) { log.push(['del', table, q]); throw new Error('delete must never happen'); },
    async req(method, path, { body } = {}) {
      log.push([method, path, body]);
      const [table] = path.split('?');
      const f = filters(path);
      if (table === 'tennis_articles' && method === 'PATCH') {
        if (f.status === 'eq.held' && article.status !== 'held') return [];
        Object.assign(article, body);
        return [structuredClone(article)];
      }
      if (table === 'tennis_news_events' && method === 'PATCH') { if (f.state === 'eq.held' && event.state === 'held') Object.assign(event, body); return null; }
      if (table === 'tennis_article_evidence') throw new Error('frozen evidence must never be rewritten');
      return null;
    }
  };
}

const kv = () => { const m = new Map(); return { get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, m }; };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function modelReturns(drafts) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /openai/);
    calls.push(JSON.parse(init.body));
    const d = drafts[calls.length - 1];
    return new Response(JSON.stringify({ status: 'completed', model: 'gpt-5.6-sol', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(d) }] }], usage: { input_tokens: 1000, output_tokens: 1000 } }), { status: 200 });
  };
  return calls;
}
const ENV = () => ({ OPENAI_API_KEY: 'test-key', NEWS_PUBLISH_ENABLED: 'true', TENNIS_STATE: kv() });
const EV = { event_id: 'ev-1', article_id: ARTICLE_ID, materiality: 80, kind: 'upset' };

test('retry in place: thin first draft is corrected, publishes under the SAME id/slug, frozen packet untouched, original hold preserved', async () => {
  const store = fakeStore();
  const calls = modelReturns([draft(THIN), draft(GOOD)]);
  const before = Date.now();
  const r = await retryHeldArticle(ENV(), store, EV, { attempts: 2 });
  assert.equal(r.state, 'published', JSON.stringify(r.attempts?.map((a) => a.failures)));
  assert.equal(calls.length, 2, 'one corrective second call');
  assert.match(calls[1].input, /REBUILD and EXPAND/);
  assert.equal(r.article_id, ARTICLE_ID);
  assert.equal(store.article.article_id, ARTICLE_ID);
  assert.equal(store.article.slug, 'munar-beats-fritz-abc123');
  assert.equal(store.article.status, 'published');
  assert.equal(store.article.prose_origin, 'model');
  assert.ok(store.article.gate_results.gate.pass);
  // frozen evidence: never patched, never deleted
  assert.ok(!store.log.some(([m, t]) => (m === 'del') || (typeof t === 'string' && t.startsWith('tennis_article_evidence'))));
  assert.deepEqual(store.evidence.packet, PACKET);
  assert.equal(store.evidence.frozen_at, FROZEN_AT);
  // original failure + gate results preserved in the revision trail
  const rev = store.article.revisions.at(-1);
  assert.equal(rev.type, 'held_article_recovery');
  assert.equal(rev.original_hold_reason, ORIGINAL_HOLD);
  assert.deepEqual(rev.original_gate_results, ORIGINAL_GATES);
  assert.equal(rev.frozen_at, FROZEN_AT);
  assert.ok(rev.packet_hash);
  // first publish = actual retry time (no backdating to the event or the freeze)
  const fp = Date.parse(store.article.first_published_at);
  assert.ok(fp >= before && fp <= Date.now(), store.article.first_published_at);
  assert.equal(store.article.first_published_at, store.article.published_at);
  assert.ok(store.article.first_published_at > FROZEN_AT);
  assert.equal(store.event.state, 'published');
  assert.equal(store.event.article_id, ARTICLE_ID);
});

test('retry in place: two failing drafts leave the held article, its hold reason and evidence exactly as they were', async () => {
  const store = fakeStore();
  const snapshot = structuredClone(store.article);
  modelReturns([draft(THIN), draft(THIN)]);
  const r = await retryHeldArticle(ENV(), store, EV, { attempts: 2 });
  assert.equal(r.state, 'held');
  assert.match(r.reason, /^model_failed_then_baseline_not_v5: model=\[[^\]]*thin_prose/);
  assert.deepEqual(store.article, snapshot);
  assert.deepEqual(store.evidence.packet, PACKET);
  assert.ok(!store.log.some(([m]) => m === 'PATCH' || m === 'del'));
  assert.ok(store.log.some(([m, t, rows]) => m === 'insert' && t === 'tennis_news_pipeline_events' && rows.some((x) => x.detail?.retry_held)), 'failed retry is audited');
});

test('retry in place: never runs on a published story, never without the frozen packet', async () => {
  const store = fakeStore();
  store.article.status = 'published';
  assert.equal((await retryHeldArticle(ENV(), store, EV)).status, 409);
  const s2 = fakeStore();
  s2.evidence.packet = null;
  const r2 = await retryHeldArticle(ENV(), s2, EV);
  assert.equal(r2.status, 409);
  assert.match(r2.error, /frozen packet unavailable/);
});

test('retry in place: shadow mode never publishes even on a gate pass', async () => {
  const store = fakeStore();
  modelReturns([draft(GOOD)]);
  const r = await retryHeldArticle({ ...ENV(), NEWS_PUBLISH_ENABLED: 'false' }, store, EV);
  assert.equal(r.state, 'held');
  assert.equal(store.article.status, 'held');
});

test('hold reason: model vs baseline families recorded; no model draft is never called a model failure', () => {
  const g = { pass: false, failures: [{ gate: 'thin_prose' }, { gate: 'mostly_structured' }] };
  assert.equal(holdReason({ attempts: [{ attempt: 1, pass: false, failures: [{ gate: 'repeated_phrasing' }] }, { attempt: 2, pass: false, failures: [{ gate: 'thin_prose' }] }], gate: g }), 'model_failed_then_baseline_not_v5: model=[repeated_phrasing,thin_prose]; baseline=[thin_prose,mostly_structured]');
  assert.match(holdReason({ attempts: [{ skipped: 'deterministic lane: tennis premium soft cap reached' }], gate: g }), /^no_model_draft_then_baseline_not_v5: deterministic lane: tennis premium soft cap reached; baseline=\[thin_prose,mostly_structured\]$/);
  assert.match(holdReason({ attempts: [{ attempt: 1, error: 'openai 500' }], gate: g }), /^no_model_draft_then_baseline_not_v5: model_error;/);
});

test('requeue never deletes a frozen held article; article-less holds requeue', async () => {
  const reqs = [];
  globalThis.fetch = async (url, init = {}) => {
    reqs.push({ url: String(url), method: init.method || 'GET' });
    if ((init.method || 'GET') === 'GET') return new Response(JSON.stringify([{ event_id: 'ev-frozen', article_id: ARTICLE_ID }, { event_id: 'ev-bare', article_id: null }]), { status: 200 });
    return new Response(null, { status: 204 });
  };
  const env = { NEWS_ADMIN_TOKEN: 'adm', TENNIS_MODEL_SUPABASE_URL: 'https://tkmlnhmylqnttmnsnief.supabase.co', TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY: 'k' };
  const res = await worker.fetch(new Request('https://x/v1/news/requeue?reason=gates%25', { method: 'POST', headers: { authorization: 'Bearer adm' } }), env);
  const body = await res.json();
  assert.equal(body.data.requeued, 1);
  assert.deepEqual(body.data.retry_in_place, ['ev-frozen']);
  assert.ok(!reqs.some((r) => r.method === 'DELETE'), 'no DELETE');
  assert.ok(!reqs.some((r) => r.url.includes('ev-frozen') && r.method === 'PATCH'), 'frozen hold untouched');
  assert.ok(reqs.some((r) => r.url.includes('ev-bare') && r.method === 'PATCH'));
});

// ---- drought watchdog ----
const NOW = new Date('2026-10-09T20:30:00Z');
const ev = (state, h, reason = null) => ({ event_id: `${state}-${h}`, state, detected_at: new Date(NOW.getTime() - h * 3600e3).toISOString(), state_reason: reason });

test('drought: eligible stories repeatedly held with zero publication raises ALERT with counts, families and runbook', () => {
  const r = droughtStatus({ now: NOW, lastPublishedAt: '2026-10-06T07:19:30Z', events: [ev('wire', 1), ev('wire', 2), ev('duplicate', 3), ev('held', 4, ORIGINAL_HOLD), ev('held', 6, 'gates: thin_prose, database_writing'), ev('held', 9, 'model_failed_then_baseline_not_v5: model=[stat_overload]; baseline=[thin_prose]')] });
  assert.equal(r.status, 'ALERT');
  assert.deepEqual(r.counts, { wire: 2, duplicate: 1, eligible: 3, held: 3, published: 0, pending: 0 });
  assert.equal(r.top_baseline_failures[0].gate, 'thin_prose');
  assert.equal(r.top_baseline_failures[0].count, 3);
  assert.deepEqual(r.top_model_failures.map((x) => x.gate).sort(), ['stat_overload', 'thin_prose']);
  assert.ok(r.hours_since_publish > 80);
  assert.ok(r.first_event_at < r.last_event_at);
  assert.match(r.runbook, /IN PLACE/);
});

test('drought: quiet wire-only days, a single hold, or any publication in the window never alert', () => {
  assert.equal(droughtStatus({ now: NOW, lastPublishedAt: null, events: [ev('wire', 1), ev('wire', 5), ev('duplicate', 2)] }).status, 'OK');
  assert.equal(droughtStatus({ now: NOW, lastPublishedAt: '2026-10-06T07:19:30Z', events: [ev('held', 2, ORIGINAL_HOLD)] }).status, 'OK');
  assert.equal(droughtStatus({ now: NOW, lastPublishedAt: '2026-10-09T15:00:00Z', events: [ev('held', 2), ev('held', 3)] }).status, 'OK');
  assert.equal(droughtStatus({ now: NOW, lastPublishedAt: '2026-10-06T07:19:30Z', events: [ev('held', 30), ev('held', 40)] }).status, 'OK', 'holds outside the window');
});

test('drought: reason parser, public view hides the per-story list, KV record keeps since_at and throttles', async () => {
  assert.deepEqual(reasonFamilies('gates: a, b'), { model: [], baseline: ['a', 'b'] });
  assert.deepEqual(reasonFamilies('model_failed_then_baseline_not_v5: model=[x,y]; baseline=[z]'), { model: ['x', 'y'], baseline: ['z'] });
  assert.equal(publicDrought(null), null);
  assert.equal(publicDrought({ status: 'ALERT', held: [1] }).held, undefined);
  const store = { async select(t) { return t === 'tennis_news_events' ? [ev('held', 2, ORIGINAL_HOLD), ev('held', 3, ORIGINAL_HOLD)] : [{ first_published_at: '2026-10-06T07:19:30Z' }]; } };
  const env = { TENNIS_STATE: kv() };
  const err = console.error; console.error = () => {};
  try {
    const a = await checkDrought(env, store, { now: NOW });
    assert.equal(a.status, 'ALERT');
    assert.equal(a.since_at, NOW.toISOString());
    assert.equal((await checkDrought(env, store, { now: new Date(NOW.getTime() + 10 * 60e3) })).skipped, 'throttled');
    const later = new Date(NOW.getTime() + 31 * 60e3);
    const b = await checkDrought(env, store, { now: later });
    assert.equal(b.status, 'ALERT');
    assert.equal(b.since_at, NOW.toISOString(), 'alert start is kept across checks');
    assert.equal(JSON.parse(env.TENNIS_STATE.m.get(DROUGHT_KEY)).checked_at, later.toISOString());
  } finally { console.error = err; }
});

// ---- prompt alignment (#15 canaries) ----
import { correctionHints } from '../workers/tennis-news/src/editorial.js';
import { overusedFrames } from '../workers/tennis-news/src/overhaul.js';
import { stockPhrases, shingles } from '../workers/tennis-news/src/editorial-gate.js';

test('writer is warned about every frame the repeated_phrasing gate can reject (gate: shared by 2 stories)', () => {
  const a = { sections: [{ id: 'lead', paragraphs: ['Her return points won rate was 52 percent compared with Svitolina in the semifinal.'] }] };
  const corpus = [a, a].map((x) => ({ shingles: shingles(x.sections[0].paragraphs[0]) }));
  const flagged = stockPhrases(a, corpus).map((x) => x.phrase);
  assert.ok(flagged.length > 0);
  const warned = new Set(overusedFrames(corpus));
  for (const f of flagged) assert.ok(warned.has(f), `gate frame not in the writer's avoid list: ${f}`);
});

test('correction hints: only for the gates that failed; none for others', () => {
  const h = correctionHints('- self_explaining: x\n- repeated_phrasing: "a b c" (2)\n- thin_prose: short');
  assert.match(h, /^HOW TO FIX THEM:/);
  assert.match(h, /self_explaining:/);
  assert.match(h, /repeated_phrasing:/);
  assert.doesNotMatch(h, /wrong_winner|meta_language/);
  assert.equal(correctionHints('- thin_prose: short'), '');
});
