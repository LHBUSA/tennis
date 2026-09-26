// Site chrome: header + primary nav + mobile drawer + network footer.

import { html } from '../lib/dom.js';
import { NETWORK, CURRENT_SPORT } from '../data/network.js';
import { ALL_ACCESS_OFFER } from '../lib/pbe-membership.js';

export const PRIMARY_NAV = [
  { href: '/', label: 'Today', id: 'today' },
  { href: '/live', label: 'Live', id: 'live' },
  { href: '/pbe-picks', label: 'PBE Picks', id: 'pbe-picks' },
  { href: '/matches', label: 'Matches', id: 'matches' },
  { href: '/players', label: 'Players', id: 'players' },
  { href: '/tournaments', label: 'Tournaments', id: 'tournaments' },
  { href: '/rankings', label: 'Rankings', id: 'rankings' },
  { href: '/tenniscast', label: 'TennisCast', id: 'tenniscast' },
  { href: '/news', label: 'News', id: 'news' }
];

export const LABS_NAV = [
  { href: '/tournaments', label: 'Draw Explorer', note: 'Bracket progression per event' },
  { href: '/labs#h2h', label: 'H2H Lab', note: 'Head-to-head with surface and recency context' },
  { href: '/methodology', label: 'Tennis DNA', note: 'Serve, return and pressure definitions' },
  { href: '/labs#surface', label: 'Surface Lab', note: 'Opponent-adjusted strength by surface' },
  { href: '/labs#serve', label: 'Serve Lab', note: 'Hold, first-strike and pressure serve' },
  { href: '/labs#return', label: 'Return Lab', note: 'Return points, breaks and conversion' },
  { href: '/doubles', label: 'Doubles Lab', note: 'Pairs as first-class participants' },
  { href: '/breakout-watch', label: 'Breakout Watch', note: 'ITF → Challenger/WTA 125 → tour' },
  { href: '/track-record', label: 'Track Record', note: 'Every graded PBE pick' },
  { href: '/methodology', label: 'Methodology', note: 'Formulas, samples, as-of rules' },
  { href: '/sources', label: 'Sources', note: 'Audited sources and canary results' }
];

const NAV_GROUP = { 'player-sub': 'players', player: 'players', match: 'matches', tournament: 'tournaments', 'tournament-sub': 'tournaments', 'rankings-list': 'rankings', 'news-desk': 'news' };

export function shellHtml() {
  return html`
  <header class="hdr" data-hdr>
    <div class="hdr-in">
      <a class="brand" href="/" aria-label="PropBetEdge Tennis home">
        <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="28" height="28"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M6.2 8.4c5.6 3.4 5.6 11.8 0 15.2M25.8 8.4c-5.6 3.4-5.6 11.8 0 15.2" fill="none" stroke="currentColor" stroke-width="2"/></svg></span>
        <span class="brand-text"><b>PROPBETEDGE</b><i>TENNIS</i></span>
      </a>
      <nav class="nav" aria-label="Primary">
        ${PRIMARY_NAV.map((n) => html`<a href="${n.href}" data-nav="${n.id}">${n.label}</a>`)}
        <a href="/labs" data-nav="labs">More</a>
      </nav>
      <button class="menu-btn" type="button" aria-expanded="false" aria-controls="drawer" data-menu><span></span><span></span><span></span><em class="sr">Menu</em></button>
    </div>
  </header>
  <div class="drawer" id="drawer" hidden data-drawer>
    <nav aria-label="Mobile">
      <p class="drawer-h">Navigate</p>
      ${PRIMARY_NAV.map((n) => html`<a href="${n.href}" data-nav="${n.id}">${n.label}</a>`)}
      <p class="drawer-h">Labs</p>
      ${LABS_NAV.map((n) => html`<a href="${n.href}">${n.label}</a>`)}
    </nav>
  </div>
  <main id="main" class="main" tabindex="-1"></main>
  ${footerHtml()}`;
}

export function footerHtml() {
  const o = ALL_ACCESS_OFFER;
  return html`<footer class="ftr">
    <div class="ftr-in">
      <div class="ftr-brand">
        <b>PROPBETEDGE TENNIS</b>
        <p>Independent tennis intelligence built on PropBetEdge’s own data graph. Not affiliated with, endorsed by or licensed by the ATP, WTA, ITF, any Grand Slam or any tournament.</p>
        <p class="ftr-aa">Tennis is planned for <a href="${o.learnUrl}">PropBetEdge All Access</a> (${o.tagline}) Tennis Pro features are not live yet.</p>
      </div>
      <nav class="ftr-net" aria-label="PropBetEdge network">
        <p>PropBetEdge Network</p>
        <ul>${NETWORK.sports.map((s) => html`<li><a href="${s.href}" ${s.key === CURRENT_SPORT ? html`aria-current="page"` : ''}><b>${s.label}</b><span>${s.name}</span></a></li>`)}</ul>
      </nav>
      <nav class="ftr-links" aria-label="More">
        <a href="${NETWORK.news.href}">${NETWORK.news.label}</a>
        <a href="${NETWORK.learn.href}">${NETWORK.learn.label}</a>
        <a href="${NETWORK.store.href}">${NETWORK.store.label}</a>
        <a href="${NETWORK.discord.href}" rel="noopener">${NETWORK.discord.label}</a>
        <a href="/sources">Sources</a>
        <a href="/methodology">Methodology</a>
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
