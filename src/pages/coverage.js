// Coverage matrix rendered from the committed source registry (data/source-registry/sources.json).

import { html } from '../lib/dom.js';

export const COVERAGE_ROWS = [
  ['rankings_singles', 'Rankings · singles'], ['rankings_doubles', 'Rankings · doubles'], ['calendar', 'Calendar'], ['draws', 'Draws'],
  ['schedule', 'Order of play'], ['live_state', 'Live state'], ['point_by_point', 'Point-by-point'], ['match_stats', 'Match stats'],
  ['player_bio', 'Player profiles'], ['player_identity', 'Identity crosswalk'], ['history', 'History'], ['player_media', 'Licensed photos']
];

const RANK = { PASS: 4, DEGRADED: 3, UNVERIFIED: 2, BLOCKED_BY_ACCESS_CONTROL: 1, NOT_AVAILABLE: 0, COMMERCIAL_REFERENCE_ONLY: -1 };

/** Best verdict per (family, capability) from the registry. */
export function coverage(registry) {
  const families = [...new Set(registry.sources.filter((s) => s.verdict !== 'COMMERCIAL_REFERENCE_ONLY').map((s) => s.family))];
  const cell = {};
  for (const s of registry.sources) {
    if (s.verdict === 'COMMERCIAL_REFERENCE_ONLY') continue;
    for (const c of s.capabilities || []) {
      const k = `${s.family}|${c}`;
      if (!cell[k] || RANK[s.verdict] > RANK[cell[k]]) cell[k] = s.verdict;
    }
  }
  return { families, cell };
}

const SHORT = { PASS: 'PASS', DEGRADED: 'PART', UNVERIFIED: '?', BLOCKED_BY_ACCESS_CONTROL: 'BLOCK', NOT_AVAILABLE: '—' };

export function coverageMatrix(registry) {
  const { families, cell } = coverage(registry);
  const fam = Object.fromEntries((registry.families || []).map((f) => [f.key, f.label]));
  return html`<div class="cov-wrap"><table class="cov">
    <thead><tr><th scope="col">Capability</th>${families.map((f) => html`<th scope="col">${fam[f] || f.toUpperCase()}</th>`)}</tr></thead>
    <tbody>${COVERAGE_ROWS.map(([k, label]) => html`<tr><th scope="row">${label}</th>${families.map((f) => {
      const v = cell[`${f}|${k}`] || 'NOT_AVAILABLE';
      return html`<td class="v-${v.toLowerCase()}" title="${v}">${SHORT[v] || v}</td>`;
    })}</tr>`)}</tbody>
  </table></div>
  <p class="note">From the committed source audit (${registry.updated_at}). PASS = proven by a real canary request; PART = partial or degraded; BLOCK = the source refused automated access and we do not evade it; ? = not yet verified. <a href="/sources">Full audit →</a></p>`;
}
