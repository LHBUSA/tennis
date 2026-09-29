// Header live pulse: a low-profile "N live" marker on every page, shown ONLY while the live feed (/v1/live — the API's
// latest observed in-progress state, every tour and event) reports matches in progress. Polls once a minute while the tab
// is visible; nothing live (or the feed unavailable) -> hidden, never a stale or guessed count.

import { api } from '../data/api.js';

export function wireLivePulse(root, { every = 60000 } = {}) {
  const el = root.querySelector('[data-live-pulse]');
  const n = root.querySelector('[data-live-n]');
  if (!el || !n) return () => {};
  let timer = null;
  const tick = async () => {
    let count = 0;
    try { const r = await api('/v1/live'); count = Array.isArray(r?.data) ? r.data.length : 0; } catch { count = 0; }
    el.hidden = count <= 0;
    n.textContent = count > 0 ? `${count} live` : '';
    el.setAttribute('aria-label', count > 0 ? `${count} match${count === 1 ? '' : 'es'} live now — live scores` : 'Live scores');
  };
  const start = () => { if (!timer) { tick(); timer = setInterval(tick, every); } };
  const stop = () => { clearInterval(timer); timer = null; };
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  if (!document.hidden) start();
  return stop;
}
