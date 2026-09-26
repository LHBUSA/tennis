// Home / Today. Everything below the hero is either real (the audited coverage map, the live All Access
// offer) or an API-backed module that states its own availability.

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { emptyModule, moduleCard } from '../ui/state.js';
import { ALL_ACCESS_OFFER } from '../lib/pbe-membership.js';
import registry from '../../data/source-registry/sources.json';
import { coverageMatrix } from './coverage.js';

const MODULES = [
  { key: 'live', title: 'Live Now', endpoint: '/v1/live', note: 'No live source is connected yet.' },
  { key: 'picks', title: 'Today’s PBE Picks', endpoint: '/v1/pbe-picks', note: 'The PBE Tennis model is not validated. No picks exist.' },
  { key: 'tournaments', title: 'Current Tournaments', endpoint: '/v1/tournaments', note: 'The tournament calendar is not in production yet.' },
  { key: 'results', title: 'Latest Results', endpoint: '/v1/matches?status=final', note: 'No results are stored yet.' },
  { key: 'news', title: 'Latest News', endpoint: '/v1/news', note: 'The newsroom publishes only from verified evidence. Nothing yet.' },
  { key: 'movers', title: 'Rankings Movers', endpoint: '/v1/rankings?view=movers', note: 'Movers need two archived weekly snapshots.' },
  { key: 'breakout', title: 'Breakout Watch', endpoint: '/v1/breakout-watch', note: 'Methodology and backtest first.' },
  { key: 'doubles', title: 'Doubles Spotlight', endpoint: '/v1/doubles/pairs/spotlight', note: 'No doubles results stored yet.' },
  { key: 'track', title: 'Track Record', endpoint: '/v1/track-record', note: 'Nothing graded — no picks have been locked.' }
];

export function mount(root) {
  const ctl = new AbortController();
  const o = ALL_ACCESS_OFFER;
  render(root, html`
    <section class="hero">
      <div class="hero-in">
        <p class="eyebrow">Men’s · Women’s · Singles · Doubles · Mixed</p>
        <h1><span>PropBetEdge</span> Tennis</h1>
        <p class="hero-sub">Global tennis intelligence — every professional tour, every surface, every match — built on a data graph we collect, normalize and own.</p>
        <p class="hero-status"><b>Build status:</b> foundation. The scoring engine, identity model and source audit are in place; no match, player or ranking data is published yet, so nothing below pretends otherwise.</p>
        <div class="hero-cta"><a class="btn" href="/sources">See the source audit</a><a class="btn ghost" href="/methodology">Tennis DNA definitions</a></div>
      </div>
      <svg class="hero-court" viewBox="0 0 400 220" aria-hidden="true"><rect x="10" y="10" width="380" height="200" rx="2"/><line x1="200" y1="10" x2="200" y2="210"/><line x1="10" y1="35" x2="390" y2="35"/><line x1="10" y1="185" x2="390" y2="185"/><line x1="95" y1="35" x2="95" y2="185"/><line x1="305" y1="35" x2="305" y2="185"/><line x1="95" y1="110" x2="305" y2="110"/></svg>
    </section>
    <div class="page">
      <div class="mods grid">${MODULES.map((m) => moduleCard({ title: m.title, id: `m-${m.key}`, body: html`<p class="loading">Checking source…</p>` }))}</div>
      ${moduleCard({ title: 'What PropBetEdge can acquire today', kicker: 'Source audit', id: 'coverage', body: coverageMatrix(registry) })}
      <section class="aa">
        <div><p class="eyebrow">PropBetEdge Network</p><h2>All Access</h2><p>${o.tagline} ${o.price}. Tennis is planned to join All Access; Tennis Pro features are not live yet.</p></div>
        <a class="btn" href="${o.learnUrl}">What’s included</a>
      </section>
    </div>`);
  MODULES.forEach(async (m) => {
    let res;
    try { res = await api(m.endpoint, { signal: ctl.signal }); } catch { return; }
    const body = root.querySelector(`#m-${m.key} .mod-b`);
    if (body && (res.data == null || (Array.isArray(res.data) && !res.data.length))) render(body, emptyModule(res.meta, m.note));
  });
  return () => ctl.abort();
}
