// Boot + path router. Each page module exports mount(root, ctx) -> unmount(); the router always
// unmounts before mounting the next page, so no fetch or listener outlives its page.

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { render } from './lib/dom.js';
import { resolveRoute } from './lib/routes.js';
import { routeMeta } from './seo/meta.js';
import { shellHtml, markActiveNav, wireDrawer } from './ui/shell.js';

const PAGES = {
  today: () => import('./pages/today.js'),
  sources: () => import('./pages/sources.js'),
  methodology: () => import('./pages/methodology.js'),
  labs: () => import('./pages/labs.js'),
  'not-found': () => import('./pages/not-found.js')
};
const lp = (name) => () => import('./pages/live-pages.js').then((m) => ({ mount: m[name] }));
Object.assign(PAGES, {
  live: lp('live'), tenniscast: lp('live'), matches: lp('matches'), match: lp('match'),
  tournaments: lp('tournaments'), tournament: lp('tournament'), 'tournament-sub': lp('tournament'),
  rankings: lp('rankings'), 'rankings-list': lp('rankings'),
  players: lp('players'), player: lp('player'), 'player-sub': lp('player'), h2h: lp('h2h')
});
const dataPage = () => import('./pages/data-page.js');

const app = document.getElementById('app');
render(app, shellHtml());
const main = document.getElementById('main');
const closeDrawer = wireDrawer(app);
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
}

async function go(pathname, { push = false } = {}) {
  const r = resolveRoute(pathname);
  if (push) history.pushState({}, '', r.path + location.hash);
  const mine = ++seq;
  const mod = await (PAGES[r.id] || dataPage)();
  if (mine !== seq) return;
  if (unmount) unmount();
  setMeta(routeMeta(r));
  markActiveNav(app, r.id);
  closeDrawer(false);
  unmount = mod.mount(main, r);
  if (push) window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  if (url.pathname === location.pathname && url.hash) return;
  e.preventDefault();
  go(url.pathname, { push: true }).then(() => { if (url.hash) document.getElementById(url.hash.slice(1))?.scrollIntoView(); });
});
window.addEventListener('popstate', () => go(location.pathname));
go(location.pathname);
