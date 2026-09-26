// PropBetEdge Tennis GA4 — same network property and pattern as LHBUSA/wnba src/analytics.js and
// propbetedge.ai: one Measurement ID (G-BRS48R8PG9), first-party bundled module (strict CSP, no inline
// script), active ONLY on the production hostname (localhost + Vercel previews never report),
// cookie_domain .propbetedge.ai so network sessions do not become self-referrals, send_page_view:false
// and the router emits exactly one page_view per route. pbe_surface = 'tennis' segments Tennis traffic.
//
// Events carry stable internal ids and public sports facts only: no emails, tokens, API keys, query
// strings or search text. Never one event per live point/score update — user interactions only.

export const GA_ID = 'G-BRS48R8PG9';
export const GA_SURFACE = 'tennis';
export const PROD_HOST = 'tennis.propbetedge.ai';

export const EVENTS = Object.freeze([
  'tennis_match_open', 'tennis_live_open', 'tennis_player_open', 'tennis_tournament_open', 'tennis_rankings_open',
  'tennis_pbecast_open', 'tennis_pbecast_replay_open', 'tennis_broadcast_click', 'tennis_share', 'tennis_search',
  'tennis_dna_open', 'tennis_schedule_open', 'tennis_watch_click',
  'pbecast_fullscreen', 'pbecast_key_moment_jump', 'pbecast_replay_speed'
]);
const ALLOWED_PARAMS = new Set(['tour', 'tournament_id', 'match_id', 'player_id', 'surface', 'match_status', 'pbecast_mode', 'broadcast_provider', 'provider', 'territory', 'distribution_type', 'route', 'method', 'speed', 'moment', 'event_type', 'results']);

let enabled = false;
let lastPageKey = '';
let clickInstalled = false;

export const isProductionHost = (hostname = '') => String(hostname).toLowerCase() === PROD_HOST;
function gtag(win, ...args) { if (typeof win?.gtag === 'function') win.gtag(...args); }

export function initAnalytics({ win = window, doc = document } = {}) {
  if (enabled || !isProductionHost(win?.location?.hostname)) return false;
  win.dataLayer = win.dataLayer || [];
  win.gtag = win.gtag || function () { win.dataLayer.push(arguments); }; // eslint-disable-line prefer-rest-params
  gtag(win, 'js', new Date());
  gtag(win, 'set', { pbe_surface: GA_SURFACE });
  gtag(win, 'config', GA_ID, { send_page_view: false, cookie_domain: '.propbetedge.ai', cookie_flags: 'SameSite=Lax;Secure' });
  if (!doc.querySelector(`script[data-pbe-ga4="${GA_ID}"]`)) {
    const s = doc.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
    s.dataset.pbeGa4 = GA_ID;
    s.crossOrigin = 'anonymous';
    doc.head.appendChild(s);
  }
  if (!clickInstalled) {
    clickInstalled = true;
    doc.addEventListener('click', (e) => {
      const a = e.target?.closest?.('a[href]');
      if (!a) return;
      try {
        const url = new URL(a.href, win.location.href);
        const cur = String(win.location.hostname).toLowerCase();
        const host = url.hostname.toLowerCase();
        if ((host === 'propbetedge.ai' || host.endsWith('.propbetedge.ai')) && host !== cur) gtag(win, 'event', 'pbe_network_click', { pbe_surface: GA_SURFACE, source_host: cur, target_host: host, link_url: `${url.origin}${url.pathname}` });
      } catch { /* non-http href */ }
    }, { capture: true });
  }
  enabled = true;
  return true;
}

/**
 * SPA navigations: the network GA4 property has Enhanced Measurement "page changes based on browser
 * history events" ON, so GA itself sends one page_view per pushState/popstate. Sending our own as well
 * double-counts (measured live 2026-09-26). The router therefore calls trackPageView() only for the
 * initial load and calls setRouteContext() BEFORE pushState, so GA's history page_view carries the new
 * route's title and our route dimensions.
 */
export function setRouteContext({ routeId = null, path = null, win = window } = {}) {
  if (!enabled || !isProductionHost(win?.location?.hostname)) return false;
  gtag(win, 'set', { pbe_surface: GA_SURFACE, pbe_route_id: routeId, pbe_route_path: path });
  return true;
}

/** Initial-load page_view (send_page_view is off in config). Query strings are never sent. */
export function trackPageView({ routeId = null, path = null, win = window, doc = document } = {}) {
  if (!enabled || !isProductionHost(win?.location?.hostname)) return false;
  const pagePath = win.location.pathname;
  const key = `${pagePath}|${doc.title}`;
  if (key === lastPageKey) return false;
  lastPageKey = key;
  gtag(win, 'event', 'page_view', { page_title: doc.title, page_location: `${win.location.origin}${pagePath}`, page_path: pagePath, pbe_surface: GA_SURFACE, pbe_route_type: 'path', ...(routeId ? { pbe_route_id: routeId } : {}), ...(path ? { pbe_route_path: path } : {}) });
  return true;
}

/** Tennis interaction events. Unknown event names and non-allowlisted params are dropped. */
export function track(name, params = {}, { win = window } = {}) {
  if (!EVENTS.includes(name)) return false;
  const clean = { pbe_surface: GA_SURFACE };
  for (const [k, v] of Object.entries(params)) if (ALLOWED_PARAMS.has(k) && v !== undefined && v !== null && String(v).length <= 100) clean[k] = typeof v === 'number' ? v : String(v);
  if (!enabled || !isProductionHost(win?.location?.hostname)) return false;
  gtag(win, 'event', name, clean);
  return true;
}

export const __test = { reset() { enabled = false; lastPageKey = ''; clickInstalled = false; }, ALLOWED_PARAMS };
