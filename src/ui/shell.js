// Site chrome: header + primary nav + mobile drawer + PropBetEdge network footer.

import { html, raw } from '../lib/dom.js';
import { NETWORK, CURRENT_SPORT, PROPBETEDGE_X_URL, PROPBETEDGE_X_HANDLE } from '../data/network.js';
import { ALL_ACCESS_OFFER } from '../lib/pbe-membership.js';
import { preferredSourceHtml } from './preferred-source.js';

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
  { href: '/matchups', label: 'Matchups', note: 'This week’s singles matches with PBE Rating win probabilities', id: 'matchups' },
  { href: '/players-to-watch', label: 'Players to Watch', note: 'Weekly rating risers, fallers and emerging players', id: 'players-to-watch' },
  { href: '/schedule', label: 'Schedule', note: 'Today, tomorrow and this week — men, women and mixed', id: 'schedule' },
  { href: '/rankings', label: 'Rankings', note: 'ATP singles (secondary source) and official WTA lists, archived weekly', id: 'rankings' },
  { href: '/methodology', label: 'Methodology', note: 'Tennis DNA formulas, samples, as-of rules', id: 'methodology' },
  { href: '/sources', label: 'Sources', note: 'Where every number comes from', id: 'sources' },
  { href: '/credits', label: 'Photo credits', note: 'Every player photo, its author and license', id: 'credits' }
];

/** Desktop header: these primary items live in one "Explore" menu (the drawer and footer still list them directly). */
export const EXPLORE_NAV = [
  { href: '/players', label: 'Players', note: 'ATP and WTA profiles, Tennis DNA and form', id: 'players' },
  { href: '/tournaments', label: 'Tournaments', note: 'Draws, results and coverage for every event we hold', id: 'tournaments' }
];
const EXPLORE_IDS = new Set(EXPLORE_NAV.map((n) => n.id));
const CHEV = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Route -> the nav item that is its genuine parent (Players / Tournaments routes light up Explore on desktop). Unmapped routes fall back to their own id, so a utility page (Schedule,
 * Rankings, Matchups, Methodology…) is current only on its own drawer link and marks no desktop primary item.
 */
const NAV_GROUP = { men: 'players', player: 'players', 'player-sub': 'players', h2h: 'players', tournament: 'tournaments', 'tournament-sub': 'tournaments', venue: 'tournaments', 'dna-player': 'dna', 'news-desk': 'news', 'news-article': 'news', 'pbecast-hub': 'pbecast', pbecast: 'pbecast', 'rankings-list': 'rankings', matchup: 'matchups' };

export function shellHtml() {
  return html`
  <div class="tn-backdrop" aria-hidden="true"></div>
  <header class="hdr" data-hdr>
    <div class="hdr-in">
      <a class="brand" href="/" aria-label="PropBetEdge Tennis — home">
        <picture><source srcset="/brand/pbe-mark-40.webp 1x, /brand/pbe-mark-80.webp 2x" type="image/webp"><img src="/brand/pbe-mark-40.webp" width="73" height="40" alt="PropBetEdge"></picture>
        <span class="brand-sep" aria-hidden="true"></span>
        <span class="brand-text"><b>TENNIS</b><i>Intelligence</i></span>
      </a>
      <nav class="nav" aria-label="Primary">
        ${PRIMARY_NAV.filter((n) => !EXPLORE_IDS.has(n.id)).map((n) => html`${n.id === 'dna' ? exploreMenu() : ''}<a href="${n.href}" data-nav="${n.id}">${n.label}</a>`)}
      </nav>
      <a class="hdr-live" href="/live" hidden data-live-pulse><i aria-hidden="true"></i><span data-live-n></span><span class="hdr-live-w">live</span></a>
      <a class="hdr-access" href="#membership-signin" data-membership-chip>All Access · Sign in</a>
      <a class="hdr-search" href="/search" aria-label="Search players and tournaments"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></a>
      <button class="menu-btn" type="button" aria-expanded="false" aria-controls="drawer" data-menu><span></span><span></span><span></span><em class="sr">Menu</em></button>
    </div>
  </header>
  <div class="drawer" id="drawer" hidden data-drawer>
    <nav aria-label="Mobile">
      ${PRIMARY_NAV.map((n) => html`<a href="${n.href}" data-nav="${n.id}">${n.label}</a>`)}
      <a href="/search">Search</a>
      <a href="#membership-signin" data-membership-chip>All Access · Sign in</a>
      <p class="drawer-h">More</p>
      ${MORE_NAV.map((n) => html`<a href="${n.href}" data-nav="${n.id}">${n.label}</a>`)}
      <a href="/labs" data-nav="labs">Labs</a>
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
        <p>Intelligence</p>
        <ul class="ftr-products">${NETWORK.products.map((p) => html`<li><a href="${p.href}"><b>${p.name}</b></a></li>`)}</ul>
      </nav>
      <nav class="ftr-links" aria-label="More">
        <p>Tennis</p>
        ${PRIMARY_NAV.slice(1).map((n) => html`<a href="${n.href}">${n.label}</a>`)}
        ${MORE_NAV.map((n) => html`<a href="${n.href}">${n.label}</a>`)}
        <a href="/labs">Labs</a>
      </nav>
      <nav class="ftr-links" aria-label="PropBetEdge">
        <p>PropBetEdge</p>
        <a class="ftr-aa" href="${ALL_ACCESS_OFFER.learnUrl}" data-pbe-footer-all-access>All Access · ${ALL_ACCESS_OFFER.price}</a>
        <a href="${NETWORK.news.href}">${NETWORK.news.label}</a>
        <a href="${NETWORK.learn.href}">${NETWORK.learn.label}</a>
        <a href="https://propbetedge.ai/about">About PropBetEdge</a>
        <a href="https://propbetedge.ai/terms">Terms</a>
        <a href="https://propbetedge.ai/legal">Legal</a>
        <a href="https://propbetedge.ai/support">Support</a>
        <a href="https://propbetedge.ai/media">Media</a>
        <a href="https://propbetedge.ai/authors">Editorial Team</a>
        <a href="https://propbetedge.ai/authors/justin-erickson">Justin Erickson</a>
        <a href="https://propbetedge.ai/authors/propbetedge-editorial-team">PropBetEdge Editorial Team</a>
        <a href="https://propbetedge.ai/authors/ty-whitney">Ty Whitney</a>
        <a href="https://propbetedge.ai/authors/erik-schwartz">Erik Schwartz</a>
        <a href="https://propbetedge.ai/editorial-standards">Editorial Standards</a>
        <a href="${NETWORK.store.href}">${NETWORK.store.label}</a>
        <a href="${NETWORK.discord.href}" rel="noopener">${NETWORK.discord.label}</a>
      </nav>
    </div>
    <div class="ftr-psrc">${preferredSourceHtml({ surface: 'footer' })}</div>
  </footer>`;
}

function exploreMenu() {
  return html`<div class="nav-dd" data-dd><button type="button" class="nav-dd-btn" aria-expanded="false" aria-controls="nav-explore" aria-haspopup="true" data-dd-btn>Explore ${raw(CHEV)}</button>
    <div class="nav-dd-menu" id="nav-explore" hidden>${EXPLORE_NAV.map((n) => html`<a href="${n.href}" data-nav="${n.id}"><b>${n.label}</b><small>${n.note}</small></a>`)}</div></div>`;
}

export function markActiveNav(root, routeId) {
  const group = NAV_GROUP[routeId] || routeId;
  for (const a of root.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === group) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  root.querySelector('[data-dd-btn]')?.classList.toggle('is-current', EXPLORE_IDS.has(group));
}

/** Explore menu: click / Enter / Space toggles, ArrowDown opens on the first item, Escape and outside clicks close it. */
export function wireExplore(root) {
  const dd = root.querySelector('[data-dd]');
  if (!dd) return;
  const btn = dd.querySelector('[data-dd-btn]');
  const menu = dd.querySelector('.nav-dd-menu');
  const set = (open, focus = false) => {
    btn.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
    if (open && focus) menu.querySelector('a')?.focus();
  };
  btn.addEventListener('click', () => set(menu.hidden));
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); set(true, true); } });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('a')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  document.addEventListener('click', (e) => { if (!dd.contains(e.target)) set(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
  dd.addEventListener('focusout', (e) => { if (!dd.contains(e.relatedTarget)) set(false); });
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
