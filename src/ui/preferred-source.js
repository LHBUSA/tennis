// Google Preferred Sources — PropBetEdge network control (reference: LHBUSA/propbetedge-news-site
// src/components/preferred-source.js, 753069e). Our own markup, never Google's auto-rendered button, so the
// CTA is visible on first paint and nothing depends on when an async third-party script runs.
//
// Source policy (google.com/preferences/source, checked 2026-09-30):
//   eligible:   propbetedge.ai, mlb.propbetedge.ai, ufc.propbetedge.ai -> Google SDK on that host
//   not listed: nfl/nba/wnba/nhl/tennis/soccer.propbetedge.ai        -> deeplink to propbetedge.ai
// tennis.propbetedge.ai is not listed, so this site never loads publisher.js: the control is a link to the
// parent source's preferences page and one delegated listener records the click.

import { html } from '../lib/dom.js';
import { track } from '../analytics.js';

const PARENT_SOURCE = 'propbetedge.ai';
const ELIGIBLE_SOURCES = new Set(['propbetedge.ai', 'mlb.propbetedge.ai', 'ufc.propbetedge.ai']);
const SPORT = 'tennis';

let installed = false;

export function preferredSourceTarget(host = typeof location === 'undefined' ? PARENT_SOURCE : location.hostname) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (ELIGIBLE_SOURCES.has(h)) return { source: h, sdk: true };
  return { source: PARENT_SOURCE, sdk: false };
}

export const preferredSourceDeeplink = (source = preferredSourceTarget().source) =>
  `https://www.google.com/preferences/source?q=${encodeURIComponent(source)}`;

/** surface: 'footer' | 'article'. The href is the working control; JS only adds analytics. */
export function preferredSourceHtml({ surface = 'footer' } = {}) {
  const label = 'Add PropBetEdge as a preferred source in Google Search (opens Google)';
  const link = (text) => html`<a class="psrc-btn" href="${preferredSourceDeeplink()}" target="_blank" rel="noopener" aria-label="${label}" data-pbe-preferred-source data-surface="${surface}" data-sport="${SPORT}">${text}</a>`;
  if (surface === 'article') {
    return html`<aside class="psrc psrc--article" aria-labelledby="psrc-article-h">
      <div class="psrc-copy"><strong id="psrc-article-h">Enjoy PropBetEdge reporting?</strong><span>Make us a preferred source in Google.</span></div>
      ${link('Add PropBetEdge')}
    </aside>`;
  }
  return html`<div class="psrc psrc--${surface}">
    <div class="psrc-copy"><span class="psrc-eyebrow">Google Search</span><strong>Make PropBetEdge a preferred source</strong><span>See more PropBetEdge reporting in Google.</span></div>
    ${link('Add as preferred source')}
  </div>`;
}

/** Idempotent; one delegated listener covers every control rendered now or after any SPA render. */
export function wirePreferredSource(doc = document) {
  if (installed || !doc) return;
  installed = true;
  doc.addEventListener('click', (e) => {
    const el = e.target?.closest?.('[data-pbe-preferred-source]');
    if (!el) return;
    track('preferred_source_click', { surface: el.dataset.surface || 'footer', sport: el.dataset.sport || SPORT, method: 'deeplink_fallback' });
  });
}
