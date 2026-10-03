// Tennis LIVE MARKET lifecycle (src/ui/live-market.js) on REAL production market entries captured 2026-10-03:
//   00a0f4e8 Rybakina v Charaeva — SETTLED (Charaeva YES; first observed with Rybakina at 94.5¢ mid-match)
//   aec200d8 Munar v Jacquet     — open, pre-match
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveMarketPanel, marketState, tickerMarketText, tickerMarketHtml, patchTickerMarket } from '../src/ui/live-market.js';

const ev = (id) => JSON.parse(readFileSync(new URL(`./fixtures/kalshi/event-${id}.json`, import.meta.url), 'utf8')).event;
const SETTLED = ev('00a0f4e8-67cb-593c-a77b-65b62d709937');
const OPEN = ev('aec200d8-9150-548e-8600-e8b0f4cc0905');
const name = (s) => (s === 'A' ? 'Player A' : 'Player B');

test('open market: lifecycle label + the FULL shared Market Pulse card (MLB standard, owner 2026-10-03)', () => {
  const live = liveMarketPanel(OPEN, { status: 'in_progress' }, { name, compact: true });
  assert.match(live, /LIVE MARKET/); assert.match(live, /class="lm-dot"/);
  assert.match(live, /Market Pulse/); assert.match(live, /Mid-market/); assert.match(live, /Updated /);
  assert.match(live, /<dt>Bid<\/dt>/); assert.match(live, /<dt>Ask<\/dt>/);
  assert.match(live, /58\.5¢/); assert.match(live, /42\.5¢/);
  assert.match(live, /View market on Kalshi ↗/); assert.match(live, /href="https:\/\/kalshi\.com\//); assert.match(live, /rel="noopener noreferrer sponsored"/);
  assert.match(live, /kx--compact/, 'PBEcast layout');
  const pre = liveMarketPanel(OPEN, { status: 'scheduled' }, { name });
  assert.match(pre, /MARKET OPEN · PRE-MATCH/); assert.doesNotMatch(pre, /LIVE MARKET|class="lm-dot"/);
  const still = liveMarketPanel(OPEN, { status: 'completed', winner_side: 'A' }, { name });
  assert.match(still, /MATCH FINAL · MARKET STILL TRADING/); assert.match(still, /Market Pulse/);
  assert.doesNotMatch(still, /LIVE MARKET/, 'a final match never labels its quote live');
});

test('settled market: never LIVE; shared close history + settlement + our result as a separate fact', () => {
  const h = liveMarketPanel(SETTLED, { status: 'completed', winner_side: 'B', score: '3-6 6-3 2-6' }, { name });
  assert.equal(marketState(SETTLED, { status: 'completed' }).key, 'settled');
  assert.match(h, /MARKET SETTLED/); assert.doesNotMatch(h, /LIVE MARKET|class="lm-dot"/);
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
  if (n < 2) assert.doesNotMatch(live, /kx__spark"/);
  const none = liveMarketPanel({ ...OPEN, movement: null }, { status: 'in_progress' }, { name });
  assert.doesNotMatch(none, /<svg class="kx__spark/, 'no stored observations -> no sparkline');
});

test('live-rail market line: exact match + both players by id, side A first; else no line', () => {
  const m = { id: OPEN.event.canonical_event_id, status: 'in_progress', sides: { A: { players: [{ id: OPEN.kalshi.outcomes.find((o) => o.role === 'a').team_id, name: 'Jaume Munar', last_name: 'Munar' }] }, B: { players: [{ id: OPEN.kalshi.outcomes.find((o) => o.role === 'b').team_id, name: 'Kyrian Jacquet', last_name: 'Jacquet' }] } } };
  const fresh = { ...OPEN, kalshi: { ...OPEN.kalshi, freshness: 'live' } };
  assert.equal(tickerMarketText(fresh, m), 'Munar 58.5¢ · Jacquet 42.5¢');
  assert.equal(tickerMarketText(fresh, { ...m, status: 'completed' }), '', 'decided match -> no line');
  assert.equal(tickerMarketText(fresh, { ...m, id: 'other' }), '', 'never another match');
  assert.equal(tickerMarketText(fresh, { ...m, sides: { A: m.sides.B, B: m.sides.A } }), '', 'players must be the card own, in order');
  assert.equal(tickerMarketText({ ...fresh, kalshi: { ...fresh.kalshi, freshness: 'stale' } }, m), '', 'a stale quote is never shown');
  assert.equal(tickerMarketText(null, m), '');
  assert.equal(tickerMarketHtml(''), '');
  assert.doesNotMatch(tickerMarketHtml('x'), /<a /, 'the line is never a link (the card click stays PBEcast)');
});
