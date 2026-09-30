import { readMembership, ALL_ACCESS_OFFER } from './pbe-membership.js';
import { membershipApi, requestMagic } from '../data/api.js';

export async function getMembership({ signal } = {}) {
  const body = await membershipApi({ signal });
  return readMembership(body?.membership, 'tennis');
}

export function applyMembershipChrome(root, m) {
  const entitled = Boolean(m?.entitled);
  const owner = m?.state === 'owner';
  const label = owner ? 'OWNER' : entitled ? 'SUBSCRIBED' : 'ALL ACCESS · SIGN IN';

  for (const el of root.querySelectorAll('[data-membership-chip]')) {
    el.textContent = label;
    el.dataset.state = m?.state || 'free';
    el.setAttribute('aria-label', owner ? 'Owner access and benefits' : entitled ? 'All Access subscription and benefits' : 'All Access or subscriber sign in');
    if (entitled) {
      el.href = '#membership-benefits';
      el.removeAttribute('target');
    } else {
      el.href = '#membership-signin';
      el.removeAttribute('target');
    }
  }

  for (const el of root.querySelectorAll('[data-pbe-footer-all-access]')) {
    if (entitled) {
      el.textContent = owner ? 'OWNER · Benefits' : 'SUBSCRIBED · All Access benefits';
      el.href = '#membership-benefits';
    }
  }

  mountMembershipPanel(m);
  for (const el of root.querySelectorAll('[data-membership-chip],[data-pbe-footer-all-access]')) {
    el.addEventListener('click', (e) => {
      if (!el.hash?.startsWith('#membership-')) return;
      e.preventDefault();
      openMembershipPanel(m, el.hash === '#membership-signin');
    });
  }
}

function mountMembershipPanel(m) {
  document.querySelector('[data-membership-panel]')?.remove();
  const entitled = Boolean(m?.entitled);
  const owner = m?.state === 'owner';
  const period = m?.current_period_end ? new Date(m.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const panel = document.createElement('div');
  panel.className = 'member-panel';
  panel.hidden = true;
  panel.dataset.membershipPanel = '';
  panel.innerHTML = `<div class="member-panel-backdrop" data-member-close></div>
    <section class="member-card" role="dialog" aria-modal="true" aria-labelledby="member-title">
      <button class="member-close" type="button" data-member-close aria-label="Close">×</button>
      <div class="member-kicker">${owner ? 'PropBetEdge Owner Access' : entitled ? 'PropBetEdge All Access' : 'PropBetEdge All Access'}</div>
      <h2 id="member-title">${owner ? 'Owner access is active.' : entitled ? 'You’re subscribed.' : 'Already subscribed?'}</h2>
      ${entitled ? `<p class="member-status">${owner ? 'OWNER' : 'ALL ACCESS ACTIVE'}${m?.email ? ` · ${escapeHtml(m.email)}` : ''}</p>
        <div class="member-benefits">
          <div><b>Tennis Pro intelligence</b><span>Full Tennis DNA, player DNA, Matchup Intelligence and win probabilities, player signals and future proprietary models.</span></div>
          <div><b>Every PropBetEdge Pro sport</b><span>MLB, NFL, NBA, NHL, WNBA, UFC, Tennis and Soccer under the network All Access entitlement.</span></div>
          <div><b>Future Pro sports included</b><span>New PropBetEdge Pro sports and premium model layers unlock under All Access as they launch.</span></div>
          <div><b>Free layer stays free</b><span>Scores, live coverage, PBEcast, news, schedules, rankings and public discovery remain open to everyone.</span></div>
        </div>
        ${!owner && period ? `<p class="member-renewal">${m.cancel_at_period_end ? 'Access active through' : 'Current period through'} <b>${period}</b>.</p>` : ''}
        <div class="member-actions">
          <a class="btn primary" href="/dna">Open Tennis Pro</a>
          ${!owner && m?.manage_url ? `<a class="btn" href="${m.manage_url}" target="_blank" rel="noopener">Manage subscription</a>` : ''}
        </div>` : `<p class="member-copy">All Access subscribers should never have to buy again. Sign in with the email used for your subscription and Tennis will restore your network entitlement.</p>
        <form class="member-signin" data-member-signin>
          <label>Subscription email<input name="email" type="email" autocomplete="email" required></label>
          <button class="btn primary" type="submit">Restore my access</button>
          <p class="note" data-member-status></p>
        </form>
        <p class="member-new">New to All Access? <a href="${ALL_ACCESS_OFFER.checkoutUrl}" target="_blank" rel="noopener">See All Access · ${ALL_ACCESS_OFFER.price}</a></p>`}
    </section>`;
  document.body.appendChild(panel);
  panel.querySelectorAll('[data-member-close]').forEach((el) => el.addEventListener('click', () => { panel.hidden = true; document.documentElement.classList.remove('member-open'); }));
  panel.querySelector('[data-member-signin]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = panel.querySelector('[data-member-status]');
    const email = new FormData(e.currentTarget).get('email');
    if (status) status.textContent = 'Sending secure sign-in link…';
    const body = await requestMagic(email, location.href);
    if (status) status.textContent = body?.message || (body?.ok ? 'Check your inbox. The link will return you here with access restored.' : 'Could not send sign-in link.');
  });
}

function openMembershipPanel(_m, focusSignin = false) {
  const panel = document.querySelector('[data-membership-panel]');
  if (!panel) return;
  panel.hidden = false;
  document.documentElement.classList.add('member-open');
  if (focusSignin) setTimeout(() => panel.querySelector('input[name="email"]')?.focus(), 0);
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
