// PropBetEdge Tennis premium account surface + native /all-access page (owner decisions 2026-10-05).
// PURE (no DOM, no fetch): the browser panel, the /all-access page module, the prerender script and
// the tests all render from these functions. Every state renders FROM the membership verdict tennis-api
// returns; nothing here decides or widens access.
//
// Three link jobs, three constants:
//   LOCAL_ALL_ACCESS_PATH    the native /all-access page on this site (all informational navigation)
//   NETWORK_ALL_ACCESS_URL   propbetedge.ai/pro, reference only
//   ALL_ACCESS_CHECKOUT_URL  the canonical Stripe link (explicit GET ALL ACCESS only)
// "Platinum" is presentation for the all_access state; the contract state stays all_access.
// Tennis has no sport plan: All Access and owner are the only grants.

import { html, raw } from './dom.js';
import { ALL_ACCESS_OFFER, ALL_ACCESS_URL, readMembership } from './pbe-membership.js';
import { NETWORK, CURRENT_SPORT } from '../data/network.js';

export const LOCAL_ALL_ACCESS_PATH = '/all-access';
export const NETWORK_ALL_ACCESS_URL = ALL_ACCESS_URL;
export const ALL_ACCESS_CHECKOUT_URL = ALL_ACCESS_OFFER.checkoutUrl;
export const PLATINUM_TRUTH = 'PropBetEdge All Access · 10 sports + Predictions';
export const OFFER_LINE = `${NETWORK.sports.length} sports + PropBetEdge Predictions`;
export const ACCOUNT_TIMEOUT_MS = 8000;

/* tennis-api answers these when its auth binding is missing, throws or answers non-200: an OUTAGE,
   never a free reader. (A billing-ledger outage inside auth-magic is reported as no_all_access and
   cannot be told apart from "not subscribed" here — platform packet issue 1.) */
const OUTAGE_REASONS = new Set(['auth_unavailable', 'auth_denied']);

/** The browser's /v1/membership read -> one account record. status 0 = no answer (network, timeout). */
export function classifyAccount(status, body) {
  if (status !== 200 || !body || typeof body !== 'object' || !body.membership) return { outage: true, authenticated: false, reason: status ? `http_${status}` : 'no_answer', membership: readMembership(null, 'tennis') };
  if (OUTAGE_REASONS.has(body.reason)) return { outage: true, authenticated: false, reason: body.reason, membership: readMembership(null, 'tennis') };
  return { outage: false, authenticated: body.authenticated === true, reason: body.reason || null, membership: readMembership(body.membership, 'tennis') };
}

/** One view per verdict: signed_out | signed_in | all_access | owner | check. Never FREE. */
export function accountView(acct) {
  if (!acct || acct.outage) return 'check';
  const m = acct.membership || {};
  if (m.entitled && m.state === 'owner') return 'owner';
  if (m.entitled) return 'all_access';
  if (acct.authenticated && m.email) return 'signed_in';
  return 'signed_out';
}

export function designation(view) {
  if (view === 'all_access') return { chip: '◆ Platinum', badge: '◆ PLATINUM', eyebrow: 'Tennis · Platinum Member', status: 'Platinum Access Active', tone: 'platinum' };
  if (view === 'owner') return { chip: 'Verified Owner', badge: 'VERIFIED OWNER', eyebrow: 'Tennis · Verified Owner', status: 'Owner access · no subscription required', tone: 'owner' };
  if (view === 'signed_in') return { chip: 'Account', badge: 'SIGNED IN', eyebrow: 'Signed in', status: null, tone: 'signed' };
  if (view === 'check') return { chip: 'Access check', badge: 'ACCESS CHECK', eyebrow: 'Tennis · Access check', status: null, tone: 'check' };
  return { chip: 'All Access · Sign in', badge: null, eyebrow: 'PropBetEdge Tennis · Member access', status: null, tone: 'prospect' };
}

/** Where the header chip goes: members to their network page, everyone else opens the account panel. */
export function chipHref(view) {
  return view === 'all_access' || view === 'owner' ? LOCAL_ALL_ACCESS_PATH : view === 'signed_out' ? '#membership-signin' : '#membership-account';
}

/* What All Access actually unlocks on Tennis (src/lib/membership.js premiumRoute). Official PBE Picks are live (tennis#14). */
export const TENNIS_UNLOCKS = Object.freeze([
  { key: 'dna', label: 'Tennis DNA', sub: 'Ratings, technical profiles, leaderboards', href: '/dna' },
  { key: 'player-dna', label: 'Player DNA', sub: 'Every player’s DNA tab', href: '/players' },
  { key: 'matchups', label: 'Matchup DNA', sub: 'Win probability + edges this week', href: '/matchups' },
  { key: 'watch', label: 'Players to Watch', sub: 'Risers, fallers, rating gaps', href: '/players-to-watch' },
  { key: 'picks', label: 'PBE Picks', sub: 'ATP + WTA picks, locked before play and tracked', href: '/pbe-picks' },
  { key: 'track-record', label: 'Track Record', sub: 'Every settled pick — right, missed and void', href: '/track-record' }
]);
export const TENNIS_PENDING = Object.freeze([]);
export const TENNIS_FREE = Object.freeze([
  ['Live scores', '/live'], ['PBEcast', '/pbecast'], ['Newsroom', '/news'], ['Schedule', '/schedule'],
  ['Rankings', '/rankings'], ['Players', '/players'], ['Tournaments', '/tournaments']
]);

const sportName = (s) => (s.key === 'f1' ? 'F1 Intelligence' : s.label);
const checkoutFor = (email) => (email ? `${ALL_ACCESS_CHECKOUT_URL}?prefilled_email=${encodeURIComponent(email)}` : ALL_ACCESS_CHECKOUT_URL);

function story(view) {
  const member = view === 'all_access' || view === 'owner';
  const d = designation(view);
  const title = view === 'all_access' ? raw('Every point,<br><em>unlocked.</em>')
    : view === 'owner' ? raw('Owner access<br><em>is active.</em>')
      : view === 'check' ? raw('Your access<br><em>is protected.</em>')
        : raw('Every point<br><em>changes the match.</em>');
  const copy = view === 'check'
    ? 'While verification is unavailable, nothing about your membership changes, and every public Tennis page keeps working.'
    : member ? 'Tennis DNA, Matchup DNA and Players to Watch are open on this account, with the rest of the PropBetEdge network on the same membership.'
      : 'Live scores and PBEcast stay free. All Access adds the intelligence layer: Tennis DNA, Matchup DNA win probabilities and Players to Watch.';
  return html`<div class="acct-story is-${member ? 'member' : view === 'check' ? 'check' : 'prospect'}${view === 'all_access' ? ' is-platinum' : ''}">
    <ul class="acct-chips" aria-hidden="true"><li><i></i>Match DNA · ATP + WTA</li><li><i></i>Matchup DNA · weekly</li>${member ? html`<li class="is-on"><i></i>Unlocked</li>` : ''}</ul>
    <div class="acct-story-copy"><span class="acct-eyebrow">${member || view === 'check' ? d.eyebrow : 'PropBetEdge Tennis · All Access'}</span><h2 class="acct-title">${title}</h2><p>${copy}</p></div>
  </div>`;
}

function grid(unlocked) {
  return html`<section class="acct-caps${unlocked ? ' is-unlocked' : ''}" aria-label="${unlocked ? 'Unlocked on this account' : 'What All Access unlocks on Tennis'}">
    <h3>${unlocked ? 'Unlocked on this account' : 'What All Access unlocks on Tennis'}</h3>
    <ul>${TENNIS_UNLOCKS.map((c) => html`<li>${unlocked ? html`<a href="${c.href}"><i></i><b>${c.label}</b><span>${c.sub}</span></a>` : html`<div><i></i><b>${c.label}</b><span>${c.sub}</span></div>`}</li>`)}${TENNIS_PENDING.map((c) => html`<li class="is-pending"><div><i></i><b>${c.label}</b><span>${c.sub}</span></div></li>`)}</ul>
  </section>`;
}

function verified(view, m) {
  const d = designation(view);
  const period = m?.current_period_end ? new Date(m.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null;
  return html`<section class="acct-verified is-${d.tone}" aria-label="Verified account">
    <div class="acct-verified-top"><span>Verified account</span><b class="acct-badge is-${d.tone}">${d.badge}</b></div>
    ${m?.email ? html`<div class="acct-email">${m.email}</div>` : ''}
    <div class="acct-verified-meta"><span>${d.status}</span>${view === 'all_access' ? html`<span>${PLATINUM_TRUTH}</span>` : ''}${view === 'all_access' && period ? html`<span>${m.cancel_at_period_end ? 'Access through' : 'Current period through'} ${period}</span>` : ''}</div>
  </section>`;
}

function offer(email) {
  return html`<div class="acct-offer">
    <div class="acct-price"><b>$29</b><span>/month</span><small>${ALL_ACCESS_OFFER.promoLine}</small></div>
    <div class="acct-incl"><div><span>Sports · ${NETWORK.sports.length}</span><ul>${NETWORK.sports.map((s) => html`<li class="${s.key === CURRENT_SPORT ? 'is-here' : ''}">${sportName(s)}</li>`)}</ul></div>
      <div class="is-intel"><span>Intelligence</span>${NETWORK.products.map((p) => html`<b>◆ ${p.name}</b>`)}</div></div>
    <a class="acct-cta" href="${checkoutFor(email)}" rel="noopener" data-acct-cta="checkout" data-pbe-placement="all_access_checkout">Get All Access</a>
  </div>`;
}

function signinForm() {
  return html`<form class="acct-signin" data-member-signin>
    <label>Email used for All Access<input name="email" type="email" autocomplete="email" required></label>
    <button class="acct-btn" type="submit">Email me a secure sign-in link</button>
    <p class="acct-note" data-member-status role="status" aria-live="polite"></p>
  </form>`;
}

/** Right-hand panel body for one view (account panel and /all-access share it). */
export function accessPanelHtml(view, acct, { surface = 'panel' } = {}) {
  const m = acct?.membership || {};
  const d = designation(view);
  if (view === 'loading') {
    return html`<div class="acct-body" data-acct-view="loading" aria-busy="true"><span class="acct-eyebrow">PropBetEdge All Access</span><h3 class="acct-head">Checking your access…</h3><p class="acct-lede">${OFFER_LINE} · $29/month.</p></div>`;
  }
  if (view === 'check') {
    return html`<div class="acct-body" data-acct-view="check">
      <span class="acct-eyebrow">${d.eyebrow}</span>
      <h3 class="acct-head">Access check temporarily unavailable.</h3>
      <p class="acct-lede">Membership verification did not answer. Nothing about your membership has changed, and every public Tennis page keeps working.</p>
      <div class="acct-protect"><b>Your account is not being treated as unsubscribed.</b> Pricing and upgrade prompts stay hidden until verification answers cleanly.</div>
      <div class="acct-actions"><button class="acct-cta" type="button" data-acct-refresh>Retry verified access</button></div>
    </div>`;
  }
  if (view === 'all_access' || view === 'owner') {
    const owner = view === 'owner';
    return html`<div class="acct-body" data-acct-view="${view}">
      <span class="acct-eyebrow is-member">${owner ? 'PropBetEdge · Verified Owner' : 'PropBetEdge All Access · Platinum Member'}</span>
      <h3 class="acct-head is-member">${owner ? 'Owner access is active.' : raw('Your network<br>is unlocked.')}</h3>
      ${verified(view, m)}
      ${surface === 'page' ? launcher(owner) : grid(true)}
      <div class="acct-actions">
        <a class="acct-cta" href="/dna">Open Tennis DNA</a>
        ${!owner && m.show_manage && m.manage_url ? html`<a class="acct-btn" href="${m.manage_url}" target="_blank" rel="noopener">Manage membership ↗</a>` : ''}
        <button class="acct-btn" type="button" data-acct-refresh>Refresh verified access</button>
        ${surface === 'panel' ? html`<a class="acct-btn" href="${LOCAL_ALL_ACCESS_PATH}">Your network →</a>` : ''}
      </div>
      <p class="acct-secure is-member">◆ ${owner ? 'Verified owner · no checkout, no subscription required' : `Platinum Access Active · ${PLATINUM_TRUTH}`}</p>
    </div>`;
  }
  if (view === 'signed_in') {
    return html`<div class="acct-body" data-acct-view="signed_in">
      <div class="acct-identity"><i></i>SIGNED IN<b>${m.email}</b></div>
      <span class="acct-eyebrow">Account ready</span>
      <h3 class="acct-head">All Access isn’t active on this account.</h3>
      <p class="acct-lede">Tennis intelligence is part of PropBetEdge All Access: ${OFFER_LINE}, one membership.</p>
      ${offer(m.email)}
      <div class="acct-actions">${surface === 'panel' ? html`<a class="acct-btn" href="${LOCAL_ALL_ACCESS_PATH}">View All Access</a>` : ''}<button class="acct-btn" type="button" data-acct-refresh>Refresh access</button></div>
    </div>`;
  }
  return html`<div class="acct-body" data-acct-view="signed_out">
    <span class="acct-eyebrow">PropBetEdge All Access</span>
    <h3 class="acct-head">${raw(`${OFFER_LINE}.<br>One membership.`)}</h3>
    ${offer(null)}
    <div class="acct-or"><span>Already a member?</span></div>
    ${signinForm()}
    ${surface === 'panel' ? html`<p class="acct-more"><a href="${LOCAL_ALL_ACCESS_PATH}">What’s included in All Access →</a></p>` : ''}
    <p class="acct-secure">◆ Secure checkout by Stripe · Passwordless PropBetEdge access</p>
  </div>`;
}

function launcher(owner) {
  return html`<section class="acct-network" aria-label="PropBetEdge network">
    <h3>${owner ? 'The full network · unlocked' : 'Your network · unlocked'}</h3>
    <ul>${NETWORK.sports.map((s) => html`<li>${s.key === CURRENT_SPORT ? html`<span class="is-here" aria-current="page"><b>${sportName(s)}</b><em>You are here</em></span>` : html`<a href="${s.href}" rel="noopener"><b>${sportName(s)}</b><em>Open →</em></a>`}</li>`)}</ul>
    ${NETWORK.products.map((p) => html`<a class="acct-predictions" href="${p.href}" rel="noopener"><span>Intelligence</span><b>◆ ${p.name}</b><em>Open →</em></a>`)}
  </section>`;
}

/** The account panel (header chip / footer): story + access panel. */
export function accountPanelHtml(view, acct) {
  return html`<div class="member-panel-backdrop" data-member-close></div>
    <section class="acct-shell" role="dialog" aria-modal="true" aria-label="PropBetEdge Tennis account">
      <button class="acct-close" type="button" data-member-close aria-label="Close account">×</button>
      ${story(view)}
      <div class="acct-panel">${accessPanelHtml(view, acct, { surface: 'panel' })}${view === 'all_access' || view === 'owner' || view === 'check' ? '' : grid(false)}</div>
    </section>`;
}

/** The /all-access page body (SPA mount and the static prerender). */
export function allAccessPageHtml(view, acct) {
  const member = view === 'all_access' || view === 'owner';
  return html`<div class="aap" data-aap>
    <div class="acct-shell is-page">
      ${pageStory(view)}
      <div class="acct-panel" data-aap-panel>${accessPanelHtml(view, acct, { surface: 'page' })}</div>
    </div>
    <section class="aap-section" aria-labelledby="aap-network">
      <p class="aap-k">The PropBetEdge network</p>
      <h2 id="aap-network">Ten sport desks. One intelligence product.</h2>
      <p class="aap-lede">Every desk is built for how its sport actually works. Features vary by sport; each one lists only what it ships.</p>
      <ul class="aap-grid">${NETWORK.sports.map((s) => html`<li class="${s.key === CURRENT_SPORT ? 'is-here' : ''}">${s.key === CURRENT_SPORT ? html`<span aria-current="page"><b>${sportName(s)}</b><em>You are here</em><small>${s.name}</small></span>` : html`<a href="${s.href}" rel="noopener"><b>${sportName(s)}</b><em>Open →</em><small>${s.name}</small></a>`}</li>`)}</ul>
      ${NETWORK.products.map((p) => html`<a class="aap-intel" href="${p.href}" rel="noopener"><span>Intelligence product · not a sport</span><b>◆ ${p.name}</b><small>Independent, source-backed forecasts with model probability, market comparison and a scored record.</small></a>`)}
    </section>
    <section class="aap-section" aria-labelledby="aap-tennis">
      <p class="aap-k">Through the Tennis lens</p>
      <h2 id="aap-tennis">What the Tennis desk brings to All Access.</h2>
      ${grid(member)}
      <p class="aap-free">Always free: ${TENNIS_FREE.map(([label, href], i) => html`${i ? ' · ' : ''}<a href="${href}">${label}</a>`)}.</p>
      <p class="aap-fine">PropBetEdge Tennis is independent and not affiliated with the ATP, WTA, ITF or any tournament. Intelligence is evidence, not a guarantee.</p>
    </section>
  </div>`;
}

function pageStory(view) {
  const member = view === 'all_access' || view === 'owner';
  const title = view === 'all_access' ? raw('Every point,<br><em>every desk.</em>')
    : view === 'owner' ? raw('Every desk,<br><em>verified.</em>')
      : view === 'check' ? raw('Your access<br><em>is protected.</em>')
        : raw('Match intelligence is one desk.<br><em>All Access goes much further.</em>');
  const eyebrow = view === 'all_access' ? 'Tennis · Platinum Member' : view === 'owner' ? 'Tennis · Verified Owner' : view === 'check' ? 'PropBetEdge All Access · Access check' : 'PropBetEdge Network · All Access';
  const copy = view === 'check' ? 'While verification is unavailable, nothing about your membership changes, and public Tennis intelligence keeps working.'
    : member ? 'Tennis and every other PropBetEdge desk are open on this account. Launch any product from here.'
      : 'Tennis DNA and Matchup DNA are how PropBetEdge reads a match. All Access brings the same evidence-first intelligence to every sport in the network, plus PropBetEdge Predictions.';
  return html`<div class="acct-story is-page is-${member ? 'member' : view === 'check' ? 'check' : 'prospect'}${view === 'all_access' ? ' is-platinum' : ''}">
    <ul class="acct-chips" aria-hidden="true"><li><i></i>${NETWORK.sports.length} sports · one membership</li><li><i></i>Predictions · included</li><li><i></i>Tennis · you are here</li>${member ? html`<li class="is-on"><i></i>Unlocked</li>` : ''}</ul>
    <div class="acct-story-copy"><span class="acct-eyebrow">${eyebrow}</span><h1 class="acct-title">${title}</h1><p>${copy}</p></div>
  </div>`;
}
