// Player image resolver for the UI: approved photo (from tennis-api, provenance in tennis_player_media)
// or a deterministic branded monogram. Never a broken image, never a guessed photo, never a hotlink.

import { html, raw } from '../lib/dom.js';
import { normalizeName } from '../../workers/shared/canonical/identity.js';

export function initials(name) {
  const parts = normalizeName(name).split(' ').filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Monogram as an inline SVG data URI — deterministic, cacheable, no network. */
export function monogramSrc(name) {
  const ini = initials(name) || '·';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#0f4d38"/><path d="M0 84h120M60 84v36" stroke="#f3f6f1" stroke-opacity=".16" stroke-width="2"/><text x="60" y="70" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="800" font-size="46" fill="#f3f6f1" letter-spacing="1">${ini}</text><circle cx="98" cy="22" r="6" fill="#d9b44a"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * <img> for a player. size: 'thumb' (lists), 'square' (cards), 'portrait' (profile hero).
 * `eager` only for above-the-fold heroes. Explicit dimensions always (no layout shift).
 */
export function avatar(player, { size = 'thumb', px = 40, eager = false, cls = '' } = {}) {
  const name = player?.name || 'Player';
  const photo = player?.photo;
  const src = photo ? (size === 'portrait' ? photo.portrait || photo.square : size === 'square' ? photo.square : photo.thumb) : null;
  const w = px;
  const h = size === 'portrait' ? Math.round(px * 1.25) : px;
  const alt = photo ? `${name}` : '';
  return html`<img class="av ${photo ? 'is-photo' : 'is-mono'} ${cls}" src="${src || monogramSrc(name)}" width="${w}" height="${h}" alt="${alt}" ${photo ? raw(`title="Photo: ${String(photo.credit || '').replace(/"/g, '&quot;')}"`) : raw('aria-hidden="true"')} loading="${eager ? 'eager' : 'lazy'}" decoding="async" data-mono="${monogramSrc(name)}">`;
}

/** If an approved image ever fails to load, fall back to the monogram (never a broken icon). */
export function wireImageFallback(root) {
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (img?.tagName === 'IMG' && img.classList.contains('av') && img.dataset.mono && img.src !== img.dataset.mono) {
      img.src = img.dataset.mono;
      img.classList.remove('is-photo');
      img.classList.add('is-mono');
    }
  }, true);
}

/** IOC/ITF 3-letter code chip (flag emoji are not rendered on Windows; codes are unambiguous). */
export const nat = (code) => (code ? html`<abbr class="nat" title="${code}">${code}</abbr>` : '');
