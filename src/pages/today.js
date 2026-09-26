// Home / Today. Real modules from /v1/today and /v1/rankings; modules whose product does not exist yet
// (picks, newsroom, Breakout Watch, doubles pairs, track record) say so.

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { emptyModule, moduleCard, freshnessBadge } from '../ui/state.js';
import { matchList, tournamentRow, rankingTable, fmtDate } from '../ui/render.js';
import { ALL_ACCESS_OFFER } from '../lib/pbe-membership.js';
import registry from '../../data/source-registry/sources.json';
import { coverageMatrix } from './coverage.js';

const LATER = [
  ['picks', 'Today’s PBE Picks', 'The PBE Tennis model is not trained or validated. No picks exist, and none will be shown before out-of-sample validation.'],
  ['news', 'Latest News', 'The newsroom publishes only from verified evidence once its factual gates exist. Nothing yet — no filler.'],
  ['breakout', 'Breakout Watch', 'Methodology and historical backtest first.'],
  ['track', 'Track Record', 'Nothing graded — no picks have been locked.']
];

export function mount(root) {
  const ctl = new AbortController();
  const o = ALL_ACCESS_OFFER;
  render(root, html`
    <section class="hero">
      <div class="hero-in">
        <p class="eyebrow">Men’s · Women’s · Singles · Doubles · Mixed</p>
        <h1><span>PropBetEdge</span> Tennis</h1>
        <p class="hero-sub">Global tennis intelligence built on a data graph we collect, normalize and own.</p>
        <p class="hero-status" data-strip>Checking live matches…</p>
        <div class="hero-cta"><a class="btn" href="/live">Live now</a><a class="btn ghost" href="/rankings/women">Rankings</a><a class="btn ghost" href="/sources">Sources</a></div>
      </div>
      <svg class="hero-court" viewBox="0 0 400 220" aria-hidden="true"><rect x="10" y="10" width="380" height="200" rx="2"/><line x1="200" y1="10" x2="200" y2="210"/><line x1="10" y1="35" x2="390" y2="35"/><line x1="10" y1="185" x2="390" y2="185"/><line x1="95" y1="35" x2="95" y2="185"/><line x1="305" y1="35" x2="305" y2="185"/><line x1="95" y1="110" x2="305" y2="110"/></svg>
    </section>
    <div class="page">
      <div class="home">
        <div class="home-main">
          ${moduleCard({ title: 'Live Now', id: 'm-live', body: html`<p class="loading">Loading…</p>` })}
          ${moduleCard({ title: 'Latest Results', id: 'm-results', body: html`<p class="loading">Loading…</p>` })}
        </div>
        <aside class="home-side">
          ${moduleCard({ title: 'Current Tournaments', id: 'm-tours', body: html`<p class="loading">Loading…</p>` })}
          ${moduleCard({ title: 'WTA Top 10', kicker: 'Rankings', id: 'm-rank', body: html`<p class="loading">Loading…</p>` })}
        </aside>
      </div>
      <div class="mods grid">${LATER.map(([k, t, n]) => moduleCard({ title: t, id: `m-${k}`, body: emptyModule({ freshness: 'NOT_CONFIGURED' }, n) }))}</div>
      ${moduleCard({ title: 'What PropBetEdge can acquire today', kicker: 'Source audit', id: 'coverage', body: coverageMatrix(registry) })}
      <section class="aa">
        <div><p class="eyebrow">PropBetEdge Network</p><h2>All Access</h2><p>${o.tagline} ${o.price}. Tennis is planned to join All Access; Tennis Pro features are not live yet.</p></div>
        <a class="btn" href="${o.learnUrl}">What’s included</a>
      </section>
    </div>`);

  const put = (id, content) => { const b = root.querySelector(`#${id} .mod-b`); if (b) render(b, content); };
  const refresh = async () => {
    let t;
    try { t = await api('/v1/today', { signal: ctl.signal }); } catch { return; }
    const d = t.data;
    const strip = root.querySelector('[data-strip]');
    if (strip) render(strip, d ? html`${freshnessBadge(t.meta)} <b>LIVE NOW · ${d.live.length} MATCH${d.live.length === 1 ? '' : 'ES'}</b> across ${d.tournaments.length} tournament${d.tournaments.length === 1 ? '' : 's'} in progress. Coverage today: WTA Tour, WTA 125, Grand Slams — ATP, Challenger and ITF are not yet acquirable.` : html`${freshnessBadge(t.meta)} Live data unavailable right now.`);
    if (!d) { for (const id of ['m-live', 'm-results', 'm-tours']) put(id, emptyModule(t.meta, 'Data unavailable.')); return; }
    put('m-live', d.live.length ? matchList(d.live.slice(0, 6)) : html`<p class="note">No matches in progress right now.</p>`);
    put('m-results', d.latest_results.length ? matchList(d.latest_results.slice(0, 8)) : html`<p class="note">No completed matches today yet.</p>`);
    put('m-tours', d.tournaments.length ? html`<div class="trs">${d.tournaments.map(tournamentRow)}</div>` : html`<p class="note">No covered tournament is in progress today.</p>`);
  };
  refresh();
  const timer = setInterval(refresh, 60000);
  api('/v1/rankings?tour=wta&type=singles&limit=10', { signal: ctl.signal }).then((r) => put('m-rank', r.data ? html`${rankingTable(r.data)}<p class="note">List dated ${fmtDate(r.data.ranking_date)} · <a href="/rankings/women">Full rankings →</a></p>` : emptyModule(r.meta, 'No complete ranking list archived yet.'))).catch(() => {});
  return () => { ctl.abort(); clearInterval(timer); };
}
