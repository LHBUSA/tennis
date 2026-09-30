// Shared horizontal rail (homepage rails, PBEcast live-match ticker). No native scrollbar: the track scrolls by touch,
// trackpad and keyboard; the edge with more content fades (more-start / more-end, set from the real scroll state);
// previous / next buttons appear only when the track overflows. Styles: src/styles/home.css (.hm-rail / .hm-track /
// .hm-nav / .hm-arrow).
//
// Auto-advance is opt-in per rail (data-auto="<ms>"): one card per tick, wrapping to the first card at the end. It never
// runs under prefers-reduced-motion, while the pointer is over the rail, while focus is inside it, for a while after any
// touch / wheel / key / arrow interaction, while the rail is off screen, or while the document is hidden. One timer per
// wired root (no requestAnimationFrame loop); each rail reports its state in data-auto-state (QA reads it).

import { html, raw } from '../lib/dom.js';

const ARROW = raw('<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>');
const IDLE_AFTER_INTERACTION_MS = 8000;

/** Previous / next buttons for a rail (hidden until wireRails finds the track overflowing). */
export const railNav = (label) => html`<div class="hm-nav" hidden><button type="button" class="hm-arrow prev" data-dir="-1" aria-label="Previous ${label}">${ARROW}</button><button type="button" class="hm-arrow" data-dir="1" aria-label="Next ${label}">${ARROW}</button></div>`;

/** Horizontal rail with working previous/next buttons (wired by wireRails). */
export function rail(items, { label, cls = '' } = {}) {
  if (!items?.length) return '';
  return html`<div class="hm-rail ${cls}" data-rail>
    <div class="hm-track" tabindex="0" role="region" aria-label="${label}">${items}</div>
    ${railNav(label)}
  </div>`;
}

const trackOf = (r) => r.querySelector('.hm-track');
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Width of one card step (first card + the track's column gap). */
function cardStep(t) {
  const first = t.firstElementChild;
  if (!first) return t.clientWidth;
  const gap = parseFloat(getComputedStyle(t).columnGap) || 0;
  return first.getBoundingClientRect().width + gap;
}

/**
 * Bring the current card (aria-current / .on) fully into view inside its own track WITHOUT scrolling the page.
 * Used on first render only; later re-renders restore the viewer's scroll position instead.
 */
export function revealCurrent(r) {
  const t = trackOf(r);
  const cur = t?.querySelector('[aria-current]')?.closest('.hm-track > *');
  if (!t || !cur) return;
  const left = cur.offsetLeft - t.offsetLeft;
  const right = left + cur.offsetWidth;
  if (left < t.scrollLeft || right > t.scrollLeft + t.clientWidth) t.scrollLeft = Math.max(0, left - 2);
}

/** One delegated listener set for every rail under root; nav visibility + disabled ends follow the real scroll state. */
export function wireRails(root, signal) {
  const seen = new WeakMap(); // rail -> { lastTouch, visible }
  const st = (r) => { let s = seen.get(r); if (!s) { s = { lastTouch: 0, visible: true }; seen.set(r, s); } return s; };
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((es) => { for (const e of es) st(e.target).visible = e.isIntersecting; }, { threshold: 0.2 })
    : null;
  const sync = (r) => {
    const t = trackOf(r);
    const nav = r.querySelector('.hm-nav');
    if (!t) return;
    if (r.dataset.auto && io && !st(r).observed) { io.observe(r); st(r).observed = true; }
    const over = t.scrollWidth - t.clientWidth > 4;
    const atStart = t.scrollLeft <= 2;
    const atEnd = t.scrollLeft >= t.scrollWidth - t.clientWidth - 2;
    if (nav) {
      nav.hidden = !over;
      const [p, n] = nav.querySelectorAll('button');
      p.disabled = atStart;
      n.disabled = atEnd;
    }
    r.classList.toggle('more-start', over && !atStart);
    r.classList.toggle('more-end', over && !atEnd);
  };
  const all = () => root.querySelectorAll('[data-rail]').forEach(sync);
  const touch = (e) => { const r = e.target.closest?.('[data-rail]'); if (r) st(r).lastTouch = Date.now(); };
  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('.hm-arrow');
    if (!b) return;
    const r = b.closest('[data-rail]');
    const t = r && trackOf(r);
    if (!t) return;
    st(r).lastTouch = Date.now();
    const page = r.dataset.auto ? cardStep(t) : Math.max(240, t.clientWidth * 0.85);
    t.scrollBy({ left: Number(b.dataset.dir) * page, behavior: reduced() ? 'auto' : 'smooth' });
  }, { signal });
  root.addEventListener('scroll', (e) => { const r = e.target.closest?.('[data-rail]'); if (r) sync(r); }, { capture: true, passive: true, signal });
  for (const ev of ['pointerdown', 'touchstart', 'wheel', 'keydown']) root.addEventListener(ev, touch, { capture: true, passive: true, signal });
  addEventListener('resize', all, { signal });
  const mo = new MutationObserver(all);
  mo.observe(root, { childList: true, subtree: true });
  signal?.addEventListener('abort', () => { mo.disconnect(); io?.disconnect(); });
  all();

  // ---- auto-advance (opt-in rails only)
  const why = (r, t) => {
    if (reduced()) return 'off-reduced-motion';
    if (t.scrollWidth - t.clientWidth <= 4) return 'off-no-overflow';
    if (typeof document !== 'undefined' && document.hidden) return 'paused-hidden';
    if (!st(r).visible) return 'paused-offscreen';
    if (r.matches(':hover')) return 'paused-hover';
    if (r.contains(document.activeElement)) return 'paused-focus';
    if (Date.now() - st(r).lastTouch < IDLE_AFTER_INTERACTION_MS) return 'paused-interaction';
    return 'running';
  };
  const tick = () => {
    for (const r of root.querySelectorAll('[data-rail][data-auto]')) {
      const t = trackOf(r);
      if (!t) continue;
      const s = st(r);
      const state = why(r, t);
      r.dataset.autoState = state;
      if (state !== 'running') { s.armedAt = 0; continue; }
      // one full interval of uninterrupted "running" before the first move (never on the initial render)
      const ms = Number(r.dataset.auto) || 4500;
      if (!s.armedAt) { s.armedAt = Date.now(); continue; }
      if (Date.now() - s.armedAt < ms - 50) continue;
      s.armedAt = Date.now();
      const atEnd = t.scrollLeft >= t.scrollWidth - t.clientWidth - 2;
      if (atEnd) t.scrollTo({ left: 0, behavior: 'smooth' });
      else t.scrollBy({ left: cardStep(t), behavior: 'smooth' });
      r.dataset.autoMoves = String(Number(r.dataset.autoMoves || 0) + 1);
    }
  };
  // state is re-evaluated on hover / focus changes too, so data-auto-state is never stale for long
  const refresh = (e) => { const r = e.target.closest?.('[data-rail][data-auto]'); if (r) { const t = trackOf(r); if (t) r.dataset.autoState = why(r, t); } };
  for (const ev of ['pointerover', 'pointerout', 'focusin', 'focusout']) root.addEventListener(ev, (e) => setTimeout(() => refresh(e), 0), { signal });
  const timer = setInterval(tick, 500);
  signal?.addEventListener('abort', () => clearInterval(timer));
}
