// Premium account surface + native /all-access page (owner decisions 2026-10-05): presentation-only
// Platinum, a real local page, separate link constants, outages never sold to, PBE Picks never live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOCAL_ALL_ACCESS_PATH, NETWORK_ALL_ACCESS_URL, ALL_ACCESS_CHECKOUT_URL, PLATINUM_TRUTH, OFFER_LINE,
  classifyAccount, accountView, designation, chipHref, accessPanelHtml, accountPanelHtml, allAccessPageHtml,
} from '../src/lib/all-access.js';
import { ALL_ACCESS_OFFER, ALL_ACCESS_URL, deriveMembership, STATES } from '../src/lib/pbe-membership.js';
import { NETWORK } from '../src/data/network.js';
import { resolveRoute, STATIC_ROUTES } from '../src/lib/routes.js';

const FAMILY = JSON.parse(readFileSync(new URL('../src/data/family.json', import.meta.url), 'utf8'));
const STRIPE = 'https://buy.stripe.com/8x2eVdgmOaqy4pv8Ez7wA0N';
const body = (membership, extra = {}) => ({ authenticated: false, reason: 'no_session', membership, ...extra });
const acct = (status, b) => classifyAccount(status, b);
const ANON = acct(200, body(deriveMembership({ sport: 'tennis' })));
const SIGNED = acct(200, body(deriveMembership({ sport: 'tennis', email: 'reader@example.com' }), { authenticated: true, reason: 'no_all_access' }));
const PLAT = acct(200, body(deriveMembership({ sport: 'tennis', entitled: true, accessSource: 'all_access', productKey: 'pbe_all_access', email: 'platinum@example.com', currentPeriodEnd: '2026-11-05T00:00:00Z', hasBilling: true }), { authenticated: true, reason: 'all_access' }));
const OWNER = acct(200, body(deriveMembership({ sport: 'tennis', entitled: true, accessSource: 'owner', email: 'owner@example.com' }), { authenticated: true, reason: 'owner' }));
const VIEWS = { signed_out: ANON, signed_in: SIGNED, all_access: PLAT, owner: OWNER, check: acct(0, null) };
const text = (h) => String(h).replace(/<[^>]+>/g, ' ');

test('three link jobs, three constants; checkout + price unchanged', () => {
  assert.equal(LOCAL_ALL_ACCESS_PATH, '/all-access');
  assert.equal(NETWORK_ALL_ACCESS_URL, ALL_ACCESS_URL);
  assert.equal(ALL_ACCESS_CHECKOUT_URL, STRIPE);
  assert.equal(ALL_ACCESS_OFFER.checkoutUrl, STRIPE);
  assert.equal(ALL_ACCESS_OFFER.price, '$29/month');
  assert.deepEqual(STATES, ['free', 'sport_pro', 'all_access', 'owner'], 'backend states unchanged');
});

test('outage classification: no answer, timeout, non-200, bad shape and tennis-api auth failures are access checks', () => {
  for (const [s, b] of [[0, null], [500, null], [503, { error: 'x' }], [200, null], [200, {}], [200, body({ state: 'free' }, { reason: 'auth_unavailable' })], [200, body({ state: 'free' }, { reason: 'auth_denied' })]]) {
    const a = acct(s, b);
    assert.equal(a.outage, true, `${s} ${JSON.stringify(b)}`);
    assert.equal(accountView(a), 'check');
    assert.equal(a.membership.entitled, false, 'an outage never grants');
  }
  assert.equal(accountView(ANON), 'signed_out');
  assert.equal(accountView(SIGNED), 'signed_in');
  assert.equal(accountView(PLAT), 'all_access');
  assert.equal(accountView(OWNER), 'owner');
});

test('designations: Platinum for all_access, Verified Owner, never FREE or SUBSCRIBED', () => {
  assert.equal(designation('all_access').badge, '◆ PLATINUM');
  assert.equal(designation('all_access').eyebrow, 'Tennis · Platinum Member');
  assert.equal(PLATINUM_TRUTH, 'PropBetEdge All Access · 10 sports + Predictions');
  assert.equal(designation('owner').badge, 'VERIFIED OWNER');
  for (const [v, a] of Object.entries(VIEWS)) {
    const all = text(accountPanelHtml(v, a)) + text(allAccessPageHtml(v, a)) + JSON.stringify(designation(v));
    assert.doesNotMatch(all, /\bFREE\b|SUBSCRIBED/, v);
    assert.doesNotMatch(all, /Platinum plan/i, v);
  }
});

test('Platinum, owner and access check show no purchase CTA; prospects buy only through the explicit button', () => {
  for (const v of ['all_access', 'owner', 'check']) {
    for (const h of [accountPanelHtml(v, VIEWS[v]), accessPanelHtml(v, VIEWS[v], { surface: 'page' })]) {
      assert.doesNotMatch(String(h), /buy\.stripe|Get All Access|data-acct-cta="checkout"/, v);
    }
  }
  for (const v of ['signed_out', 'signed_in']) {
    const h = String(accountPanelHtml(v, VIEWS[v]));
    const stripe = [...h.matchAll(/<a [^>]*href="(https:\/\/buy\.stripe[^"]*)"[^>]*>([^<]*)</g)];
    assert.equal(stripe.length, 1, v);
    assert.equal(stripe[0][2], 'Get All Access');
    assert.ok(stripe[0][1].startsWith(STRIPE));
  }
  assert.match(String(accessPanelHtml('signed_in', SIGNED)), /SIGNED IN<b>reader@example\.com<\/b>/);
});

test('PBE Picks is never presented as live or unlocked', () => {
  for (const [v, a] of Object.entries(VIEWS)) {
    const h = String(accountPanelHtml(v, a)) + String(allAccessPageHtml(v, a));
    assert.doesNotMatch(h, /<a [^>]*href="\/pbe-picks"/, v);
    if (/PBE Picks/.test(h)) assert.match(h, /<li class="is-pending"><div><i><\/i><b>PBE Picks<\/b><span>Not live yet<\/span>/, v);
  }
});

test('informational links stay on the site: header chip, footer, panel, page', () => {
  assert.equal(chipHref('all_access'), '/all-access');
  assert.equal(chipHref('owner'), '/all-access');
  assert.equal(chipHref('signed_out'), '#membership-signin');
  const shell = readFileSync(new URL('../src/ui/shell.js', import.meta.url), 'utf8');
  assert.doesNotMatch(shell, /learnUrl/);
  assert.match(shell, /LOCAL_ALL_ACCESS_PATH/, 'Tennis informational All Access links stay local');
  assert.match(String(accountPanelHtml('signed_out', ANON)), /href="\/all-access">What’s included in All Access/);
  for (const [v, a] of Object.entries(VIEWS)) assert.doesNotMatch(String(accountPanelHtml(v, a)) + String(allAccessPageHtml(v, a)), /propbetedge\.ai\/pro/, v);
  const membership = readFileSync(new URL('../src/lib/membership.js', import.meta.url), 'utf8');
  assert.doesNotMatch(membership, /SUBSCRIBED|Every PropBetEdge Pro sport|Tennis and Soccer|every current and future/i);
});

test('the network comes from the registry: 10 sports + PropBetEdge Predictions, Predictions never a sport', () => {
  assert.equal(OFFER_LINE, '10 sports + PropBetEdge Predictions');
  assert.equal(NETWORK.sports.length, FAMILY.sports.length);
  const page = String(allAccessPageHtml('signed_out', ANON));
  for (const s of FAMILY.sports) assert.match(page, new RegExp(`<b>${s.key === 'f1' ? 'F1 Intelligence' : s.label}</b>`), s.key);
  assert.match(page, /You are here<\/em><small>Tennis Intelligence/);
  assert.match(page, /<span>Intelligence<\/span><b>◆ Command Center<\/b><b>◆ Compare<\/b><b>◆ Predictions<\/b>/);
  assert.doesNotMatch(page, /11 sports|eleven sports/i);
  const plat = String(allAccessPageHtml('all_access', PLAT));
  assert.equal((plat.match(/Open →/g) || []).length, (FAMILY.sports.length - 1) * 2 + FAMILY.products.length, 'every other sport launches from the launcher and the grid; Predictions from the launcher (plus its own card)');
});

test('/all-access is a real indexable route with its content prerendered; no redirect constructs', () => {
  const r = resolveRoute('/all-access');
  assert.equal(r.id, 'all-access');
  assert.ok(STATIC_ROUTES.some((x) => x.path === '/all-access' && x.index));
  const pre = readFileSync(new URL('../scripts/prerender.mjs', import.meta.url), 'utf8');
  assert.match(pre, /if \(r\.path === '\/all-access'\) page = page\.replace\('<div id="app"><\/div>'/);
  const page = readFileSync(new URL('../src/pages/all-access.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/lib/all-access.js', import.meta.url), 'utf8');
  assert.doesNotMatch(page.replace(/\/\/.*$/gm, ''), /location\.(href|assign|replace)\s*[=(]|http-equiv|<iframe|propbetedge\.ai\/pro/);
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(!(vercel.redirects || []).some((x) => /all-access/.test(x.source)), 'no redirect for /all-access');
});
