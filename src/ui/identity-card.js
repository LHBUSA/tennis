// Player identity card used whenever no APPROVED photo exists (docs/MEDIA.md). Initials + nation +
// data styling — never another athlete's photo, never an AI likeness.

import { html } from '../lib/dom.js';
import { normalizeName } from '../../workers/shared/canonical/identity.js';

/** "Félix Auger-Aliassime" -> "FA"; single names -> first two letters. Accents folded for the glyphs. */
export function initials(name) {
  const parts = normalizeName(name).split(' ').filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function identityCard({ name, nation = null, size = 'card' }) {
  return html`<figure class="idcard is-${size}" aria-label="${name}">
    <span class="idcard-ini" aria-hidden="true">${initials(name)}</span>
    ${nation ? html`<figcaption class="idcard-nat">${nation}</figcaption>` : ''}
  </figure>`;
}
