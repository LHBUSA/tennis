// Truthful state components: freshness badges and unavailable/not-configured module bodies.
// A module with no data says so — it never shows a sample, a skeleton pretending to load forever,
// or another day's data labeled as today's.

import { html } from '../lib/dom.js';

const LABEL = { CURRENT: 'Current', CACHED: 'Cached', STALE: 'Stale', UNAVAILABLE: 'Unavailable', ERROR: 'Error', NOT_CONFIGURED: 'Not connected' };

export function freshnessBadge(meta) {
  const f = meta?.freshness || 'UNAVAILABLE';
  const age = Number.isFinite(meta?.age_s) ? ` · ${ageText(meta.age_s)} old` : '';
  return html`<span class="fresh is-${f.toLowerCase()}" title="${meta?.semantics || ''}">${LABEL[f] || f}${age}</span>`;
}

export function ageText(s) {
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/**
 * 'error' when the API failed (store read failure, ERROR freshness, no response) — never shown as "nothing stored";
 * 'empty' only when the API answered successfully with no data (or isEmpty(data) says so); otherwise 'data'.
 */
export function resultState(res, isEmpty = null) {
  if (!res || res.ok === false || res.meta?.freshness === 'ERROR') return 'error';
  if (res.data == null) return 'empty';
  return isEmpty && isEmpty(res.data) ? 'empty' : 'data';
}

export function errorModule(meta, note) {
  return html`<div class="empty" role="alert">
    <p class="empty-h">${freshnessBadge(meta)} Could not load</p>
    <p>${note}</p>
  </div>`;
}

export function emptyModule(meta, note) {
  return html`<div class="empty">
    <p class="empty-h">${freshnessBadge(meta)} No data shown</p>
    <p>${note}</p>
  </div>`;
}

export function moduleCard({ title, kicker = '', body, id = '' }) {
  return html`<section class="mod" ${id ? html`id="${id}"` : ''}>
    <header class="mod-h">${kicker ? html`<span class="mod-k">${kicker}</span>` : ''}<h2>${title}</h2></header>
    <div class="mod-b">${body}</div>
  </section>`;
}
