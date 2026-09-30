// Boot + path router. Each page module exports mount(root, ctx) -> unmount(); the router always
// unmounts before mounting the next page. Page views: one GA page_view per navigation, emitted after
// the route's meta is applied (send_page_view is off in the GA config).

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/news.css';
import './styles/news-modules.css';
import './styles/theme.css';
import './styles/home.css';
import './styles/pbecast.css';
import './styles/pbecast-v2.css';
import './styles/pbecast-v3.css';
import './styles/pbecast-v4.css';
import { render } from './lib/dom.js';
import { resolveRoute } from './lib/routes.js';
import { routeMeta } from './seo/meta.js';
import { shellHtml, markActiveNav, wireDrawer, wireExplore } from './ui/shell.js';
import { wireLivePulse } from './ui/live-pulse.js';
import { wireCopy } from './ui/share.js';
import { wireImageFallback } from './ui/avatar.js';
import { initAnalytics, trackPageView, setRouteContext, track } from './analytics.js';
import { setPageSurface } from './lib/v4.js';
import { getMembership, premiumRoute, premiumGateHtml, wirePremiumGate } from './lib/membership.js';

const lp = (name) => () => import('./pages/live-pages.js').then((m) => ({ mount: m[name] }));
const PAGES = {
  today: () => import('./pages/today.js'),
  men: () => import('./pages/men.js'),
  sources: () => import('./pages/sources.js'),
  methodology: () => import('./pages/methodology.js'),
  labs: () => import('./pages/labs.js'),
  pbecast: () => import('./pages/pbecast.js'),
  'not-found': () => import('./pages/not-found.js'),
  news: () => import('./pages/news.js').then((x) => ({ mount: x.hub })), 'news-desk': () => import('./pages/news.js').then((x) => ({ mount: x.hub })), 'news-article': () => import('./pages/news.js').then((x) => ({ mount: x.article })),
  live: lp('live'), schedule: lp('schedule'), matches: lp('schedule'), match: lp('match'),
  tournaments: lp('tournaments'), tournament: lp('tournament'), 'tournament-sub': lp('tournament'), venue: lp('venue'),
  rankings: lp('rankingsHub'), 'rankings-list': lp('rankings'), players: lp('players'), player: lp('player'), 'player-sub': lp('player'), h2h: lp('h2h'),
  matchups: () => import('./pages/intel.js').then((m) => ({ mount: m.matchups })), matchup: () => import('./pages/intel.js').then((m) => ({ mount: m.matchup })), 'players-to-watch': () => import('./pages/intel.js').then((m) => ({ mount: m.watch })),
  dna: lp('dna'), 'pbecast-hub': lp('pbecastHub'), search: lp('search'), credits: lp('credits'), coverage: lp('coverage')
};
const dataPage = () => import('./pages/data-page.js');

const app = document.getElementById('app');
render(app, shellHtml());
const main = document.getElementById('main');
const closeDrawer = wireDrawer(app);
wireExplore(app);
wireLivePulse(app);
wireCopy(document);
wireImageFallback(document);
initAnalytics();
document.addEventListener('click', (e) => {
  const s = e.target.closest('.share-b');
  if (s) track('tennis_share', { method: s.dataset.copy ? 'copy' : /linkedin/i.test(s.href || '') ? 'linkedin' : 'x', route: location.pathname });
});
let unmount = null;
let seq = 0;

function setMeta(m) {
  document.title = m.title;
  const set = (sel, attr, v) => { const n = document.querySelector(sel); if (n) n.setAttribute(attr, v); };
  set('meta[name="description"]', 'content', m.description);
  set('meta[name="robots"]', 'content', m.robots);
  set('link[rel="canonical"]', 'href', m.canonical);
  set('meta[property="og:url"]', 'content', m.canonical);
  set('meta[property="og:title"]', 'content', m.title);
  set('meta[property="og:description"]', 'content', m.description);
  set('meta[name="twitter:title"]', 'content', m.title);
  set('meta[name="twitter:description"]', 'content', m.description);
}

async function go(pathname) {
  let r = resolveRoute(pathname);
  if (r.route.redirect) { r = resolveRoute(r.route.redirect); history.replaceState({}, '', r.path); }
  const mine = ++seq;
  if (premiumRoute(r)) {
    const membership = await getMembership();
    if (mine !== seq) return;
    if (!membership.entitled) {
      if (unmount) unmount();
      if (!(initial && r.route.ssr)) setMeta(routeMeta(r));
      markActiveNav(app, r.id);
      closeDrawer(false);
      document.documentElement.dataset.page = r.id;
      setPageSurface(null);
      render(main, premiumGateHtml(membership, r));
      wirePremiumGate(main);
      unmount = null;
      if (initial) { initial = false; setTimeout(() => trackPageView({ routeId: r.id, path: r.route.path }), 600); }
      return;
    }
  }
  const mod = await (PAGES[r.id] || dataPage)();
  if (mine !== seq) return;
  if (unmount) unmount();
  // edge-rendered routes (ssr) arrive with a data-backed head from tennis-web: on the first load that head is
  // authoritative (title, canonical, robots, OG) — overwriting it with route defaults would noindex real pages
  if (!(initial && r.route.ssr)) setMeta(routeMeta(r));
  markActiveNav(app, r.id);
  closeDrawer(false);
  // V4 visual system: page type drives band/backdrop intensity; the surface accent starts neutral and a page with a
  // sourced surface (tournament, match, article) sets it after its data loads
  document.documentElement.dataset.page = r.id;
  setPageSurface(null);
  unmount = mod.mount(main, r);
  if (initial) { initial = false; setTimeout(() => trackPageView({ routeId: r.id, path: r.route.path }), 600); }
}
let initial = true;

/** Before pushState: route title + GA route context, so GA's history page_view records this route. */
function prepareNavigation(pathname) {
  const r = resolveRoute(pathname);
  document.title = routeMeta(r).title;
  setRouteContext({ routeId: r.id, path: r.route.path });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || /^\/(brand|media|fonts|assets)\//.test(url.pathname)) return;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  e.preventDefault();
  prepareNavigation(url.pathname);
  history.pushState({}, '', url.pathname + url.search + url.hash);
  go(url.pathname).then(() => { window.scrollTo(0, 0); if (url.hash) document.getElementById(url.hash.slice(1))?.scrollIntoView(); });
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[action="/search"]');
  if (!f) return;
  e.preventDefault();
  const q = new FormData(f).get('q');
  prepareNavigation('/search');
  history.pushState({}, '', `/search?q=${encodeURIComponent(q)}`);
  go('/search');
});
window.addEventListener('popstate', () => go(location.pathname));
// (popstate: GA's history listener records the page_view; the title updates when the route mounts)
go(location.pathname);
