// PropBetEdge Tennis analytics — consent-gated by the shared network privacy runtime.
// No Google script or analytics cookie is created until analytics consent is granted.

export const GA_ID = 'G-BRS48R8PG9';
export const GA_SURFACE = 'tennis';
export const PROD_HOST = 'tennis.propbetedge.ai';

export const EVENTS = Object.freeze([
  'tennis_match_open', 'tennis_live_open', 'tennis_player_open', 'tennis_tournament_open', 'tennis_rankings_open',
  'tennis_pbecast_open', 'tennis_pbecast_replay_open', 'tennis_broadcast_click', 'tennis_share', 'tennis_search',
  'tennis_dna_open', 'tennis_schedule_open', 'tennis_watch_click', 'tennis_news_open',
  'pbecast_fullscreen', 'pbecast_key_moment_jump', 'pbecast_replay_speed', 'preferred_source_click'
]);
const ALLOWED_PARAMS = new Set(['tour', 'tournament_id', 'match_id', 'player_id', 'surface', 'match_status', 'pbecast_mode', 'broadcast_provider', 'provider', 'territory', 'distribution_type', 'route', 'method', 'speed', 'moment', 'event_type', 'results', 'sport']);

let lastPageKey = '';

export const isProductionHost = (hostname = '') => String(hostname).toLowerCase() === PROD_HOST;

function privacy(win) { return win?.PBEPrivacy || null; }

export function initAnalytics({ win = window } = {}) {
  if (!isProductionHost(win?.location?.hostname)) return false;
  const p = privacy(win);
  if (!p) return false;
  p.initAnalytics({ surface: GA_SURFACE, analytics: true, sendPageView: false });
  return p.analyticsAllowed();
}

export function setRouteContext({ routeId = null, path = null, win = window } = {}) {
  const p = privacy(win);
  if (!p?.analyticsAllowed() || typeof win?.gtag !== 'function') return false;
  win.gtag('set', { pbe_surface: GA_SURFACE, pbe_route_id: routeId, pbe_route_path: path });
  return true;
}

export function trackPageView({ routeId = null, path = null, win = window, doc = document } = {}) {
  if (!isProductionHost(win?.location?.hostname)) return false;
  const pagePath = win.location.pathname;
  const key = `${pagePath}|${doc.title}`;
  if (key === lastPageKey) return false;
  const p = privacy(win);
  if (!p) return false;
  const params = { page_title: doc.title, page_location: `${win.location.origin}${pagePath}`, page_path: pagePath, pbe_surface: GA_SURFACE, pbe_route_type: 'path', ...(routeId ? { pbe_route_id: routeId } : {}), ...(path ? { pbe_route_path: path } : {}) };
  if (p.analyticsAllowed()) {
    lastPageKey = key;
    return p.track('page_view', params);
  }
  p.whenAnalyticsAllowed(() => {
    if (key === lastPageKey) return;
    lastPageKey = key;
    p.track('page_view', params);
  });
  return false;
}

export function track(name, params = {}, { win = window } = {}) {
  if (!EVENTS.includes(name)) return false;
  const clean = { pbe_surface: GA_SURFACE };
  for (const [k, v] of Object.entries(params)) {
    if (ALLOWED_PARAMS.has(k) && v !== undefined && v !== null && String(v).length <= 100) clean[k] = typeof v === 'number' ? v : String(v);
  }
  const p = privacy(win);
  if (!p || !isProductionHost(win?.location?.hostname)) return false;
  return p.track(name, clean);
}

export const __test = { reset() { lastPageKey = ''; }, ALLOWED_PARAMS };
