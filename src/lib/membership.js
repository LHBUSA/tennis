import { readMembership, ALL_ACCESS_OFFER } from './pbe-membership.js';
import { membershipApi, requestMagic } from '../data/api.js';

export async function getMembership({ signal } = {}) {
  const body = await membershipApi({ signal });
  return readMembership(body?.membership, 'tennis');
}

export function applyMembershipChrome(root, m) {
  const label = m?.state === 'owner' ? 'OWNER' : m?.state === 'all_access' ? 'ALL ACCESS ACTIVE' : 'ALL ACCESS';
  for (const el of root.querySelectorAll('[data-membership-chip]')) {
    el.textContent = label;
    el.dataset.state = m?.state || 'free';
    if (m?.state === 'owner' || m?.state === 'all_access') {
      el.href = '/';
      el.setAttribute('aria-label', m?.state === 'owner' ? 'Owner access active' : 'All Access active');
    }
  }
}

export function premiumRoute(route) {
  const id = route?.id || '';
  if (['matchups', 'matchup', 'players-to-watch', 'dna'].includes(id)) return true;
  return id === 'player-sub' && /\/dna\/?$/.test(location.pathname);
}

export function premiumGateHtml(m, route) {
  const back = encodeURIComponent(location.href);
  const title = route?.id === 'dna' || route?.id === 'player-sub'
    ? 'Unlock Tennis DNA'
    : route?.id === 'matchups' || route?.id === 'matchup'
      ? 'Unlock Matchup Intelligence'
      : route?.id === 'players-to-watch'
        ? 'Unlock Player Signals'
        : 'Unlock Tennis Pro Intelligence';
  const member = m?.email ? `<p class="progate-member">Signed in as <b>${escapeHtml(m.email)}</b></p>` : '';
  return `<section class="progate" aria-labelledby="progate-title">
    <div class="progate-kicker">PropBetEdge Tennis · All Access</div>
    <h1 id="progate-title">${title}</h1>
    <p class="progate-lede">News, scores, schedules, rankings, tournament pages and core player profiles stay free. All Access unlocks the proprietary intelligence layer built on top of that data.</p>
    <div class="progate-grid">
      <div><b>Matchup DNA</b><span>Win probabilities, rating edges, surface context, form and validation history.</span></div>
      <div><b>Full Tennis DNA</b><span>Player ratings, technical serve/return profiles, confidence and comparative leaderboards.</span></div>
      <div><b>Player signals</b><span>Risers, fallers, emerging players and ranking-vs-rating gaps.</span></div>
      <div><b>Pro model layers</b><span>Future proprietary probabilities, edges and validated decision models unlock automatically with All Access.</span></div>
    </div>
    ${member}
    <div class="progate-actions">
      <a class="btn primary" href="${ALL_ACCESS_OFFER.checkoutUrl}" target="_blank" rel="noopener">Get All Access · ${ALL_ACCESS_OFFER.price}</a>
      <button class="btn" type="button" data-pro-signin>Sign in / restore access</button>
    </div>
    <p class="progate-promo">${ALL_ACCESS_OFFER.promoLine}. All Access covers every current and future PropBetEdge Pro sport.</p>
    <form class="progate-form" data-pro-form hidden>
      <label>Email used for All Access<input name="email" type="email" autocomplete="email" required></label>
      <input type="hidden" name="return_to" value="${escapeHtml(decodeURIComponent(back))}">
      <button class="btn primary" type="submit">Email me a sign-in link</button>
      <p class="note" data-pro-status></p>
    </form>
    <p class="progate-free">Always free: <a href="/live">scores & live</a> · <a href="/pbecast">PBEcast</a> · <a href="/news">Newsroom</a> · <a href="/schedule">Schedule</a> · <a href="/rankings">Rankings</a> · <a href="/players">Players</a> · <a href="/tournaments">Tournaments</a>. The homepage also keeps a limited Tennis DNA preview so readers can see the intelligence before upgrading.</p>
  </section>`;
}

export function wirePremiumGate(root) {
  const open = root.querySelector('[data-pro-signin]');
  const form = root.querySelector('[data-pro-form]');
  if (!open || !form) return;
  open.addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('input[name="email"]')?.focus();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = form.querySelector('[data-pro-status]');
    const fd = new FormData(form);
    if (status) status.textContent = 'Sending secure sign-in link…';
    const body = await requestMagic(fd.get('email'), location.href);
    if (status) status.textContent = body?.message || (body?.ok ? 'Check your inbox for the sign-in link.' : 'Could not send sign-in link.');
  });
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
