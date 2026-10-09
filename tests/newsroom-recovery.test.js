// Issue #15: newsroom correction is bounded, edits the rejected draft, and cannot bypass the gates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorialize } from '../workers/tennis-news/src/editorial.js';

const baseline = { headline: 'Evidence only', dek: 'Verified result', sections: [{ id: 'lead', heading: '', paragraphs: ['Evidence only.'] }] };
const packet = { event: { kind: 'upset' }, match: { score: '6-4 6-3', winner_side: 'A', sets: [{ A: 6, B: 4 }, { A: 6, B: 3 }] }, participants: { A: { players: [{ name: 'A' }] }, B: { players: [{ name: 'B' }] } }, tournament: { name: 'Test Open' } };
const fail = { headline: 'Short version', dek: 'Verified result', sections: [{ id: 'lead', heading: '', paragraphs: ['Insufficient.'], visual: '', visual_note: '' }] };
const pass = { headline: 'Full story', dek: 'Verified result', sections: [{ id: 'lead', heading: '', paragraphs: ['A substantial narrative built entirely from the frozen packet.'], visual: '', visual_note: '' }] };
function makeFetch(drafts) {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ status: 'completed', model: 'gpt-5.6-sol', output: [{ content: [{ type: 'output_text', text: JSON.stringify(drafts[requests.length-1]) }] }], usage: { input_tokens: 100, output_tokens: 100 } }), { status: 200 });
  };
  return { fetchImpl, requests };
}
const routing = { lane: 'STANDARD_EDITORIAL', model: 'gpt-5.6-sol', pool: 'premium', max_output_tokens: 6000, reasoning_effort: 'medium' };
const gate = (draft) => draft.headline === 'Full story' ? { pass: true, failures: [] } : { pass: false, failures: [{ gate: 'thin_prose', detail: 'narrative below required length' }] };

test('failed production first draft retries exactly once with explicit rewrite instructions, then publishes only a gate PASS', async () => {
  const { fetchImpl, requests } = makeFetch([fail, pass]);
  let checks = 0;
  const ed = await editorialize({ packet, baseline, gate, apiKey: 'test', routing, attempts: 2, fetchImpl, canRetry: async () => { checks++; return true; } });
  assert.equal(ed.origin, 'model');
  assert.equal(ed.article.headline, 'Full story');
  assert.equal(ed.attempts.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(checks, 1);
  assert.match(requests[1].input, /thin_prose/);
  assert.match(requests[1].input, /REBUILD and EXPAND/);
});

test('success uses only one model call, no wasted correction', async () => {
  const { fetchImpl, requests } = makeFetch([pass]);
  const ed = await editorialize({ packet, baseline, gate, apiKey: 'test', routing, attempts: 2, fetchImpl, canRetry: async () => { throw Error('must not call'); } });
  assert.equal(ed.origin, 'model');
  assert.equal(requests.length, 1);
});

test('budget guard blocks second transport and preserves fail-closed HOLD', async () => {
  const { fetchImpl, requests } = makeFetch([fail]);
  const ed = await editorialize({ packet, baseline, gate, apiKey: 'test', routing, attempts: 2, fetchImpl, canRetry: async () => false });
  assert.equal(requests.length, 1);
  assert.equal(ed.origin, null);
  assert.ok(ed.attempts.some(x => x.skipped === 'correction_budget_guard'));
});

test('two invalid model drafts cannot pass by retrying', async () => {
  const { fetchImpl, requests } = makeFetch([fail, fail]);
  const ed = await editorialize({ packet, baseline, gate, apiKey: 'test', routing, attempts: 2, fetchImpl });
  assert.equal(requests.length, 2);
  assert.equal(ed.origin, null);
  assert.equal(ed.gate.pass, false);
});
