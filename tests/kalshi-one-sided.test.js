// Owner P0 2026-10-04: Kalshi vanished from a Tennis match at 99/1 while Polymarket kept rendering. The vendored shared
// client (propbetedge-workers 64ca257) keeps the full card for a one-sided book: real Bid / Ask / Last, "—" for the
// missing side, no Mid-market, link kept; compact line stays absent. Exact production shape: Muchova vs Samsonova.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kalshiCard, kalshiLine } from '../src/vendor/kalshi/kalshi-market-ui.js';

const URL_ = 'https://kalshi.com/markets/kxwtamatch/wta-tennis-match/kxwtamatch-26oct03mucsam';
const o = (role, abbr, ticker, bid, ask, last) => ({ role, abbr, kalshi_name: abbr, contract: `${abbr} wins`, market_ticker: ticker, state: 'open', result: null, best_yes_bid_bp: bid, best_yes_ask_bp: ask, last_price_bp: last, mid_bp: null, volume: 2602928.95, open_interest: 1267498.06, spread_bp: null, displayable: false, renderable: true, one_sided: true });
const entry = {
  event: { sport: 'tennis', canonical_event_id: '56c34d10-b5b9-59b4-a21d-791232bce29e' },
  kalshi: { source: 'kalshi', market_url: URL_, event_ticker: 'KXWTAMATCH-26OCT03MUCSAM', state: 'open', freshness: 'live', age_seconds: 20, mid_available: false, book: 'one_sided',
    outcomes: [o('a', 'Karolina Muchova', 'KXWTAMATCH-26OCT03MUCSAM-MUC', 9900, null, 9900), o('b', 'Liudmila Samsonova', 'KXWTAMATCH-26OCT03MUCSAM-SAM', null, 100, 100)] },
};

test('Muchova-Samsonova 99/1 renders the full Kalshi card in Tennis (vendored shared client)', () => {
  const html = kalshiCard(entry, { placement: 'tennis-match' });
  assert.ok(html.includes('Market Pulse') && html.includes(URL_));
  const panels = html.split('class="kx__panel"').slice(1);
  assert.match(panels[0], /<dt>Bid<\/dt><dd>99¢<\/dd>[\s\S]*<dt>Ask<\/dt><dd>—<\/dd>[\s\S]*<dt>Last<\/dt><dd>99¢<\/dd>/);
  assert.match(panels[1], /<dt>Bid<\/dt><dd>—<\/dd>[\s\S]*<dt>Ask<\/dt><dd>1¢<\/dd>[\s\S]*<dt>Last<\/dt><dd>1¢<\/dd>/);
  assert.ok(html.includes('Mid-market unavailable at this observation · one-sided book'));
  assert.ok(!/kx__pxl">Mid-market</.test(html) && !/99\.5¢|0\.5¢/.test(html));
  assert.equal(kalshiLine(entry), '');
});

test('an older API without `renderable` keeps the previous behaviour (fail closed)', () => {
  const old = { ...entry, kalshi: { ...entry.kalshi, outcomes: entry.kalshi.outcomes.map(({ renderable, ...x }) => x) } };
  assert.equal(kalshiCard(old, { placement: 't' }), '');
});
