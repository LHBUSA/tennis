// /sources — the audited source registry + the latest committed canary run. Real content today.

import { html, render } from '../lib/dom.js';
import registry from '../../data/source-registry/sources.json';
import canary from '../../docs/evidence/source-canary-latest.json';
import { coverageMatrix } from './coverage.js';
import { TOUR_COVERAGE } from '../../workers/shared/tour-coverage.js';

const VERDICT_LABEL = { PASS: 'Pass', DEGRADED: 'Degraded', NOT_AVAILABLE: 'Not available', BLOCKED_BY_ACCESS_CONTROL: 'Blocked (not evaded)', UNVERIFIED: 'Unverified', COMMERCIAL_REFERENCE_ONLY: 'Commercial — reference only' };

export function mount(root) {
  const results = new Map((canary.results || []).map((r) => [r.key, r]));
  const fam = Object.fromEntries((registry.families || []).map((f) => [f.key, f.label]));
  const groups = [...new Set(registry.sources.map((s) => s.family))];
  render(root, html`<div class="page">
    <header class="page-h">
      <p class="eyebrow">Sources</p>
      <h1>Where the data comes from</h1>
      <p class="lede">PropBetEdge Tennis builds its own data layer from public, first-party tennis sources — no paid sports-data feed. Every source below was probed with real requests; nothing is marked PASS because documentation says it exists. Sources that refuse automated access are recorded and left alone.</p>
      <p class="note">Registry ${registry.updated_at} · Canary run ${canary.run_at || 'not yet run'}${canary.runner ? ` · ${canary.runner}` : ''}</p>
    </header>
    <section class="mod"><header class="mod-h"><h2>One product, every tour</h2></header><div class="mod-b"><div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Tour</th><th scope="col">Provenance</th><th scope="col">Tournaments &amp; results</th><th scope="col">Schedule</th><th scope="col">Live</th><th scope="col">Rankings</th></tr></thead>
      <tbody>${Object.values(TOUR_COVERAGE).map((t) => html`<tr><th scope="row">${t.label}</th><td>${t.registry_source || t.source}</td><td>${t.tournaments_results}</td><td>${t.schedule}</td><td>${t.live}</td><td>${t.rankings}</td></tr>`)}</tbody></table></div>
      <p class="note">ATP Tour data comes from a secondary source and is labelled that way everywhere; PropBetEdge has no official ATP feed. ATP Challenger and ITF are not yet covered.</p></div></section>
    <section class="mod" id="kalshi"><header class="mod-h"><h2>Prediction market</h2></header><div class="mod-b"><div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Source</th><th scope="col">What it is</th><th scope="col">Where it appears</th><th scope="col">How we show it</th></tr></thead>
      <tbody><tr><th scope="row">Kalshi</th><td>Prediction-market prices for ATP and WTA matches: a traded YES contract on “player wins the match” (Kalshi settles it once a ball has been played). These are <b>not sportsbook odds and not a PropBetEdge model</b>.</td><td>Match page (full card), PBEcast (one-line strip), schedule and live cards (compact line for matches not yet decided). A match Kalshi does not list shows nothing.</td><td>Every price links to that market on Kalshi. <b>Mid-market</b> = the midpoint of the best YES bid and best YES ask, shown only when both exist and the spread is 10¢ or less; otherwise the bid / ask pair is shown. Bid, ask and last trade are labelled separately. Movement and sparklines use only snapshots we actually observed — nothing is interpolated — and a change is measured only between two observed Mid-markets.</td></tr></tbody></table></div>
      <p class="note">Read by PropBetEdge’s own markets service on a fixed cadence; your browser never contacts Kalshi’s API. A price older than a few minutes is labelled delayed or stale, and a market is withdrawn after 30 minutes without a fresh read. Sportsbook odds are not captured for tennis.</p></div></section>
    <section class="mod"><header class="mod-h"><h2>Coverage</h2></header><div class="mod-b">${coverageMatrix(registry)}</div></section>
    ${groups.map((g) => html`<section class="mod src-group">
      <header class="mod-h"><h2>${fam[g] || g}</h2></header>
      <div class="mod-b"><ul class="src-list">${registry.sources.filter((s) => s.family === g).map((s) => {
        const r = results.get(s.key);
        return html`<li class="src">
          <div class="src-top"><b>${s.name}</b><span class="verdict v-${s.verdict.toLowerCase()}">${VERDICT_LABEL[s.verdict] || s.verdict}</span></div>
          <p class="src-caps">${(s.capabilities || []).join(' · ')}</p>
          ${s.notes ? html`<p class="src-notes">${s.notes}</p>` : ''}
          ${r ? html`<p class="src-canary">Canary: <b>${r.state}</b>${r.http_status ? ` · HTTP ${r.http_status}` : ''}${r.record_count != null ? ` · ${r.record_count} records` : ''}${r.latency_ms != null ? ` · ${r.latency_ms} ms` : ''}</p>` : ''}
          ${s.terms?.status ? html`<p class="src-terms">Terms: ${s.terms.status.replace(/_/g, ' ').toLowerCase()}${s.terms.url ? html` · <a href="${s.terms.url}" rel="noopener nofollow">terms</a>` : ''}</p>` : ''}
        </li>`;
      })}</ul></div>
    </section>`)}
  </div>`);
  return () => {};
}
