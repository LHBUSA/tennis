// Network-standard share bar: X, LinkedIn, Copy Link. Nothing else (network decision).
import { html } from '../lib/dom.js';

export const X_INTENT = 'https://x.com/intent/post';
export const LINKEDIN_SHARE = 'https://www.linkedin.com/sharing/share-offsite/';

/** Pure: share URLs for a page (tests cover the encoding). */
export function shareLinks({ url, text }) {
  const u = new URL(url);
  const x = `${X_INTENT}?text=${encodeURIComponent(text)}&url=${encodeURIComponent(u.toString())}`;
  const li = `${LINKEDIN_SHARE}?url=${encodeURIComponent(u.toString())}`;
  return { x, linkedin: li, copy: u.toString() };
}

export function shareBar({ url, text, label = 'Share' }) {
  const l = shareLinks({ url, text });
  return html`<div class="share" role="group" aria-label="${label}">
    <span class="share-l">${label}</span>
    <a class="share-b" href="${l.x}" target="_blank" rel="noopener noreferrer" aria-label="Share on X"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.9 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg><span>X</span></a>
    <a class="share-b" href="${l.linkedin}" target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.7h.1c.5-1 1.8-2 3.8-2 4 0 4.8 2.6 4.8 6V21h-4v-5.4c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V21h-4V9Z"/></svg><span>LinkedIn</span></a>
    <button class="share-b" type="button" data-copy="${l.copy}" aria-label="Copy link"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M9 15 15 9M10.5 6.5l1.8-1.8a4 4 0 0 1 5.7 5.7l-1.8 1.8M13.5 17.5l-1.8 1.8a4 4 0 0 1-5.7-5.7l1.8-1.8"/></svg><span data-copy-label>Copy link</span></button>
  </div>`;
}

/** Delegated copy handler; installed once by main.js. */
export function wireCopy(root) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const lbl = b.querySelector('[data-copy-label]');
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      if (lbl) lbl.textContent = 'Copied';
    } catch {
      if (lbl) lbl.textContent = 'Copy failed';
    }
    setTimeout(() => { if (lbl) lbl.textContent = 'Copy link'; }, 1800);
  });
}
