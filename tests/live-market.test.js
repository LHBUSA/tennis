// Tennis LIVE MARKET lifecycle (src/ui/live-market.js) on REAL production market entries captured 2026-10-03:
//   00a0f4e8 Rybakina v Charaeva — SETTLED (Charaeva YES; first observed with Rybakina at 94.5¢ mid-match)
//   aec200d8 Munar v Jacquet     — open, pre-match
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveMarketPanel, marketState } from '../src/ui/live-market.js';

const ev = (id) => JSON.parse(readFileSync(new URL(`./fixtures/kalshi/event-${id}.json`, import.meta.url), 'utf8')).event;
const SETTLED = ev('00a0f4e8-67cb-593c-a77b-65b62d709937');
const OPEN = ev('aec200d8-9150-548e-8600-e8b0f4cc0905');
const name = (s) => (s === 'A' ? 'Player A' : 'Player B');

test('open market: LIVE MARKET (green dot) only while the match is in play; pre-match otherwise', () => {
  const live = liveMarketPanel(OPEN, { status: 'in_progress' }, { name, nowMs: Date.parse(OPEN.kalshi.observed_at) + 42e3 });
  assert.match(live, /LIVE MARKET/); assert.match(live, /lm-dot/); assert.match(live, /Updated 42s ago/);
  assert.match(live, /58\.5¢/); assert.match(live, /42\.5¢/); assert.match(live, /View market →/); assert.match(live, /href="https:\/\/kalshi\.com\//);
  const pre = liveMarketPanel(OPEN, { status: 'scheduled' }, { name });
  assert.match(pre, /MARKET OPEN · PRE-MATCH/); assert.doesNotMatch(pre, /LIVE MARKET|lm-dot/);
  assert.doesNotMatch(live, /Market Pulse|intelligence/i, 'Kalshi is the market, PBE is the intelligence');
});

test('settled market: never LIVE; shared close history + settlement + our result as a separate fact', () => {
  const h = liveMarketPanel(SETTLED, { status: 'completed', winner_side: 'B', score: '3-6 6-3 2-6' }, { name });
  assert.equal(marketState(SETTLED, { status: 'completed' }).key, 'settled');
  assert.match(h, /MARKET SETTLED/); assert.doesNotMatch(h, /LIVE MARKET|lm-dot/);
  assert.match(h, /How the market closed/); assert.match(h, /Settled YES/); assert.match(h, /Settled NO/);
  assert.match(h, /First observed/); assert.doesNotMatch(h, />Opened|Opening price/, '"first observed" is never called an open');
  assert.match(h, /Final match result/); assert.match(h, /Player B<\/b> def\. Player A <span class="tabnum">6-3 3-6 6-2<\/span>/, 'score is written from the winner side');
});

test('closed but not settled: CLOSED · AWAITING SETTLEMENT only when the match is final; never a fabricated settlement', () => {
  const closed = { ...SETTLED, market: { ...SETTLED.market, lifecycle: 'CLOSED' }, market_history: { ...SETTLED.market_history, lifecycle: 'CLOSED', status_label: 'Market closed', outcomes: SETTLED.market_history.outcomes.map((o) => ({ ...o, settlement: null })) } };
  assert.match(liveMarketPanel(closed, { status: 'completed', winner_side: 'B' }, { name }), /MARKET CLOSED · AWAITING SETTLEMENT/);
  assert.doesNotMatch(liveMarketPanel(closed, { status: 'completed', winner_side: 'B' }, { name }), /Settled YES|MARKET SETTLED/);
  assert.match(liveMarketPanel(closed, { status: 'in_progress' }, { name }), /MARKET CLOSED</);
});

test('no market -> nothing (never an unrelated or stale market)', () => {
  assert.equal(liveMarketPanel(null, { status: 'in_progress' }), '');
  assert.equal(liveMarketPanel({ kalshi: null, market: { lifecycle: 'ACTIVE' } }, { status: 'in_progress' }), '');
  assert.equal(liveMarketPanel({ kalshi: { ...OPEN.kalshi, state: 'paused' }, market: OPEN.market }, { status: 'in_progress' }), '');
});

test('movement is drawn only from stored observations', () => {
  const live = liveMarketPanel(OPEN, { status: 'in_progress' }, { name });
  const n = (OPEN.movement?.kalshi?.a?.points || []).filter((p) => p.mid_bp != null).length;
  if (n >= 2) assert.match(live, new RegExp(`across ${n} observed snapshots`)); else assert.doesNotMatch(live, /kx__spark/);
});
