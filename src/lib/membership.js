import { PICKS_LIVE } from '../pages/picks-flag.js';
import { ALL_ACCESS_OFFER } from './pbe-membership.js';
import { membershipResult, requestMagic } from '../data/api.js';
import { ACCOUNT_TIMEOUT_MS, LOCAL_ALL_ACCESS_PATH, OFFER_LINE, accountPanelHtml, accountView, chipHref, classifyAccount, designation } from './all-access.js';

/* One membership read per page load: the header chip, the account panel, premium gates and the
   /all-access page share it. Refresh = a fresh read (the panel and page reload the page for it). */
let accountPromise = null;
export function getAccount({ fresh = false } = {}) {
  if (fresh || !accountPromise) {
    accountPromise = membershipResult({ timeoutMs: ACCOUNT_TIMEOUT_MS }).then(({ status, body }) => classifyAccount(status, body));
  }
  return accountPromise;
}

/** The server's membership verdict (premium gating). An outage reads as not entitled: nothing is granted. */
export async function getMembership() {
  return (await getAccount()).membership;
}

export function applyMembershipChrome(root, acct) {
  const view = accountView(acct);
  const d = designation(view);
  const owner = view === 'owner';
  for (const el of root.querySelectorAll('[data-membership-chip]')) {
    el.textContent = d.chip;
    el.dataset.state = view;
    el.href = chipHref(view);
    el.removeAttribute('target');
    el.setAttribute('aria-label', view === 'all_access' ? 'Platinum member: your PropBetEdge network' : owner ? 'Verified owner: your PropBetEdge network' : view === 'check' ? 'Account: access check' : view === 'signed_in' ? 'Your PropBetEdge Tennis account' : 'All Access or member sign in');
  }
  for (const el of root.querySelectorAll('[data-pbe-footer-all-access]')) {
    el.href = LOCAL_ALL_ACCESS_PATH;
    if (view === 'all_access') el.textContent = '◆ Platinum · Your network';
    else if (owner) el.textContent = 'Verified Owner · Network';
  }
  mountMembershipPanel(view, acct);
  for (const el of root.querySelectorAll('[data-membership-chip]')) {
    el.addEventListener('click', (e) => {
      if (!el.hash?.startsWith('#membership-')) return;
      e.preventDefault();
      openMembershipPanel(el.hash === '#membership-signin');
    });
  }
}

/** Account-surface listeners, delegated on one container (panel or /all-access page). */
export function wireAccountSurface(container, { onClose } = {}) {
  const onClick = (e) => {
    if (e.target.closest('[data-member-close]')) { onClose?.(); return; }
    if (e.target.closest('[data-acct-refresh]')) { location.reload(); }
  };
  const onSubmit = async (e) => {
    const form = e.target.closest('[data-member-signin]');
    if (!form) return;
    e.preventDefault();
    const status = form.querySelector('[data-member-status]');
    const email = new FormData(form).get('email');
    if (status) status.textContent = 'Sending secure sign-in link…';
    const body = await requestMagic(email, location.href);
    if (status) status.textContent = body?.message || (body?.ok ? 'Check your inbox. The link will return you here with access restored.' : 'Could not send sign-in link.');
  };
  container.addEventListener('click', onClick);
  container.addEventListener('submit', onSubmit);
  return () => { container.removeEventListener('click', onClick); container.removeEventListener('submit', onSubmit); };
}

function mountMembershipPanel(view, acct) {
  document.querySelector('[data-membership-panel]')?.remove();
  const panel = document.createElement('div');
  panel.className = 'member-panel';
  panel.hidden = true;
  panel.dataset.membershipPanel = '';
  panel.dataset.acctView = view;
  panel.innerHTML = String(accountPanelHtml(view, acct));
  document.body.appendChild(panel);
  wireAccountSurface(panel, { onClose: () => { panel.hidden = true; document.documentElement.classList.remove('member-open'); } });
  if (!escapeWired) {
    escapeWired = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = document.querySelector('[data-membership-panel]');
      if (open && !open.hidden) { open.hidden = true; document.documentElement.classList.remove('member-open'); }
    });
  }
}
let escapeWired = false;

function openMembershipPanel(focusSignin = false) {
  const panel = document.querySelector('[data-membership-panel]');
  if (!panel) return;
  panel.hidden = false;
  document.documentElement.classList.add('member-open');
  if (focusSignin && matchMedia('(min-width: 901px)').matches) setTimeout(() => panel.querySelector('input[name="email"]')?.focus(), 0);
}

export function premiumRoute(route) {
  const id = route?.id || '';
  if (['matchups', 'matchup', 'players-to-watch', 'dna'].includes(id)) return true;
  // PBE Picks (pending pre-match sides) are All Access once visible (preview before owner activation); Track Record is public
  if (id === 'pbe-picks') return PICKS_LIVE || new URLSearchParams(location.search).get('preview') === 'picker';
  return id === 'player-sub' && /\/dna\/?$/.test(location.pathname);
}

/** The gate for a premium route. An outage renders the access check, never a sales screen. */
export function premiumGateHtml(m, route, acct = null) {
  if (acct?.outage) {
    return `<section class="progate" aria-labelledby="progate-title">
    <div class="progate-kicker">PropBetEdge Tennis · Access check</div>
    <h1 id="progate-title">Access check temporarily unavailable</h1>
    <p class="progate-lede">Membership verification did not answer. Nothing about your membership has changed; this page unlocks as soon as verification answers. Every public Tennis page keeps working.</p>
    <div class="progate-actions"><button class="btn primary" type="button" data-acct-refresh>Retry verified access</button></div>
  </section>`;
  }
  const back = encodeURIComponent(location.href);
  const title = route?.id === 'dna' || route?.id === 'player-sub'
    ? 'Unlock Tennis DNA'
    : route?.id === 'matchups' || route?.id === 'matchup'
      ? 'Unlock Matchup Intelligence'
      : route?.id === 'players-to-watch'
        ? 'Unlock Player Signals'
        : route?.id === 'pbe-picks'
          ? 'Unlock PBE Picks'
          : 'Unlock Tennis Pro Intelligence';
  // PBE Picks teaser: what a member sees, never a value (side, probability and market numbers stay behind the gate)
  const picksTeaser = route?.id === 'pbe-picks' ? '<p class="progate-lede">Locked pre-match calls with the chosen side, model probability, why, prediction-market benchmarks at the lock and the full ATP / WTA record. Resolved results are public on the Track Record.</p>' : '';
  const member = m?.email ? `<p class="progate-member">Signed in as <b>${escapeHtml(m.email)}</b> · All Access isn’t active on this account.</p>` : '';
  return `<section class="progate" aria-labelledby="progate-title">
    <div class="progate-kicker">PropBetEdge Tennis · All Access</div>
    <h1 id="progate-title">${title}</h1>
    ${picksTeaser}
    <p class="progate-lede">News, scores, schedules, rankings, tournament pages and core player profiles stay free. All Access unlocks the proprietary intelligence layer built on top of that data.</p>
    <div class="progate-grid">
      <div><b>Matchup DNA</b><span>Win probabilities, rating edges, surface context, form and validation history.</span></div>
      <div><b>Full Tennis DNA</b><span>Player ratings, technical serve/return profiles, confidence and comparative leaderboards.</span></div>
      <div><b>Player signals</b><span>Risers, fallers, emerging players and ranking-vs-rating gaps.</span></div>
      <div><b>The whole network</b><span>${OFFER_LINE} on the same membership.</span></div>
    </div>
    ${member}
    <div class="progate-actions">
      <a class="btn primary" href="${ALL_ACCESS_OFFER.checkoutUrl}" target="_blank" rel="noopener">Get All Access · ${ALL_ACCESS_OFFER.price}</a>
      <button class="btn" type="button" data-pro-signin>Sign in / restore access</button>
      <a class="btn line" href="${LOCAL_ALL_ACCESS_PATH}">What’s included</a>
    </div>
    <p class="progate-promo">${ALL_ACCESS_OFFER.promoLine}. PropBetEdge All Access: ${OFFER_LINE}.</p>
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
  root.querySelector('[data-acct-refresh]')?.addEventListener('click', () => location.reload());
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
