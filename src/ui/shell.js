// Site chrome: header + primary nav + mobile drawer + PropBetEdge network footer.

import { html } from '../lib/dom.js';
import { NETWORK, CURRENT_SPORT, PROPBETEDGE_X_URL, PROPBETEDGE_X_HANDLE } from '../data/network.js';
import { ALL_ACCESS_OFFER } from '../lib/pbe-membership.js';

export const PRIMARY_NAV = [
  { href: '/', label: 'Today', id: 'today' },
  { href: '/live', label: 'Live', id: 'live' },
  { href: '/pbecast', label: 'PBEcast', id: 'pbecast' },
  { href: '/news', label: 'News', id: 'news' },
  { href: '/players', label: 'Players', id: 'players' },
  { href: '/tournaments', label: 'Tournaments', id: 'tournaments' },
  { href: '/dna', label: 'Tennis DNA', id: 'dna' }
];

export const MORE_NAV = [
  { href: '/schedule', label: 'Schedule', note: 'Today, tomorrow and this week — men, women and mixed', id: 'schedule' },
  { href: '/rankings', label: 'Rankings', note: 'Official WTA lists, archived weekly; ATP status', id: 'rankings' },
  { href: '/methodology', label: 'Methodology', note: 'Tennis DNA formulas, samples, as-of rules' },
  { href: '/sources', label: 'Sources', note: 'Where every number comes from' },
  { href: '/credits', label: 'Photo credits', note: 'Every player photo, its author and license' }
];

const NAV_GROUP = { men: 'players', 'player-sub': 'players', player: 'players', match: 'more', matches: 'more', schedule: 'more', rankings: 'more', 'rankings-list': 'more', labs: 'more', 'news-desk': 'news', 'news-article': 'news', 'pbecast-hub': 'pbecast', tournament: 'tournaments', 'tournament-sub': 'tournaments', 'dna-player': 'dna', pbecast: 'pbecast', h2h: 'players', venue: 'tournaments' };

export function shellHtml() {
  return html`
  <header class="hdr" data-hdr>
    <div class="hdr-in">
      <a class="brand" href="/" aria-label="PropBetEdge Tennis — home">
        <picture><source srcset="/brand/pbe-mark-40.webp 1x, /brand/pbe-mark-80.webp 2x" type="image/webp"><img src="/brand/pbe-mark-40.webp" width="73" height="40" alt="PropBetEdge"></picture>
        <span class="brand-sep" aria-hidden="true"></span>
        <span class="brand-text"><b>TENNIS</b><i>Intelligence</i></span>
      </a>
      <nav class="nav" aria-label="Primary">
        ${PRIMARY_NAV.map((n) => html`<a href="${n.href}" data-nav="${n.id}">${n.label}</a>`)}
        <a href="/labs" data-nav="more">More</a>
      </nav>
      <a class="hdr-search" href="/search" aria-label="Search players and tournaments"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></a>
      <button class="menu-btn" type="button" aria-expanded="false" aria-controls="drawer" data-menu><span></span><span></span><span></span><em class="sr">Menu</em></button>
    </div>
  </header>
  <div class="drawer" id="drawer" hidden data-drawer>
    <nav aria-label="Mobile">
      ${PRIMARY_NAV.map((n) => html`<a href="${n.href}" data-nav="${n.id}">${n.label}</a>`)}
      <a href="/search">Search</a>
      <p class="drawer-h">More</p>
      ${MORE_NAV.map((n) => html`<a href="${n.href}">${n.label}</a>`)}
    </nav>
  </div>
  <main id="main" class="main" tabindex="-1"></main>
  ${footerHtml()}`;
}

export function footerHtml() {
  return html`<footer class="ftr">
    <div class="ftr-in">
      <div class="ftr-brand">
        <img src="/brand/pbe-mark-80.webp" width="110" height="60" alt="PropBetEdge" loading="lazy">
        <p class="ftr-net-name"><b>PropBetEdge</b> Sports Intelligence Network</p>
        <p>PropBetEdge Tennis is independent tennis intelligence built on PropBetEdge’s own data graph. Not affiliated with, endorsed by or licensed by the ATP, WTA, ITF, any Grand Slam or any tournament.</p>
        <p class="ftr-data">Data · <a href="https://propsports.proptechusa.ai" target="_blank" rel="noopener">PropSports</a> · <a href="/sources">Source details</a></p>
        <a class="ftr-x" href="${PROPBETEDGE_X_URL}" target="_blank" rel="noopener noreferrer" aria-label="Follow PropBetEdge on X (${PROPBETEDGE_X_HANDLE})"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.9 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>${PROPBETEDGE_X_HANDLE}</a>
      </div>
      <nav class="ftr-sports" aria-label="PropBetEdge network">
        <p>Network</p>
        <ul>${NETWORK.sports.map((s) => html`<li><a href="${s.href}" ${s.key === CURRENT_SPORT ? html`aria-current="page"` : ''}><b>${s.label}</b><span>${s.name}</span></a></li>`)}</ul>
      </nav>
      <nav class="ftr-links" aria-label="More">
        <p>Tennis</p>
        ${PRIMARY_NAV.slice(1).map((n) => html`<a href="${n.href}">${n.label}</a>`)}
        ${MORE_NAV.map((n) => html`<a href="${n.href}">${n.label}</a>`)}
      </nav>
      <nav class="ftr-links" aria-label="PropBetEdge">
        <p>PropBetEdge</p>
        <a class="ftr-aa" href="${ALL_ACCESS_OFFER.learnUrl}" data-pbe-footer-all-access>All Access · ${ALL_ACCESS_OFFER.price}</a>
        <a href="${NETWORK.news.href}">${NETWORK.news.label}</a>
        <a href="${NETWORK.learn.href}">${NETWORK.learn.label}</a>
        <a href="${NETWORK.store.href}">${NETWORK.store.label}</a>
        <a href="${NETWORK.discord.href}" rel="noopener">${NETWORK.discord.label}</a>
      </nav>
    </div>
  </footer>`;
}

export function markActiveNav(root, routeId) {
  const group = NAV_GROUP[routeId] || routeId;
  for (const a of root.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === group) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

export function wireDrawer(root) {
  const btn = root.querySelector('[data-menu]');
  const drawer = root.querySelector('[data-drawer]');
  const set = (open) => {
    btn.setAttribute('aria-expanded', String(open));
    drawer.hidden = !open;
    document.documentElement.classList.toggle('drawer-open', open);
  };
  btn.addEventListener('click', () => set(drawer.hidden));
  drawer.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  return set;
}
