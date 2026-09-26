// Home: what is happening in tennis right now. Hero -> live strip -> live -> today -> tournaments ->
// rankings -> player intelligence. Every module is real data or states why it is empty.

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { emptyModule } from '../ui/state.js';
import { avatar } from '../ui/avatar.js';
import { matchList, tournamentRow, rankingTable, fmtDate } from '../ui/render.js';

export function mount(root) {
  const ctl = new AbortController();
  render(root, html`
    <section class="hero" aria-labelledby="hero-h">
      <picture class="hero-bg">
        <source media="(max-width: 600px)" type="image/avif" srcset="/brand/tennis-hero-mobile-900x1200.avif">
        <source media="(max-width: 600px)" type="image/webp" srcset="/brand/tennis-hero-mobile-900x1200.webp">
        <source type="image/avif" srcset="/brand/tennis-hero-1200.avif 1200w, /brand/tennis-hero-1600.avif 1600w, /brand/tennis-hero-2400.avif 2400w" sizes="100vw">
        <img src="/brand/tennis-hero-1600.webp" srcset="/brand/tennis-hero-1200.webp 1200w, /brand/tennis-hero-1600.webp 1600w, /brand/tennis-hero-2400.webp 2400w" sizes="100vw" width="1600" height="900" alt="" fetchpriority="high" decoding="async">
      </picture>
      <div class="hero-in">
        <p class="eyebrow">PropBetEdge Tennis</p>
        <h1 id="hero-h">Global Tennis Intelligence</h1>
        <p class="hero-sub">Live tennis intelligence, player analytics and match data — built on a data graph PropBetEdge collects, normalizes and owns.</p>
        <div class="hero-cta"><a class="btn" href="/live">Live now</a><a class="btn ghost" href="/schedule">Today’s matches</a><a class="btn ghost" href="/rankings/women">Player rankings</a><a class="btn ghost" href="/players">Explore players</a></div>
        <p class="hero-strip" data-strip>Checking live matches…</p>
      </div>
    </section>
    <div class="page">
      <section data-live></section>
      <div class="grid-2">
        <section class="mod"><header class="mod-h"><h2>Current tournaments</h2></header><div class="mod-b" data-tours><p class="loading">Loading…</p></div></section>
        <section class="mod"><header class="mod-h"><h2>WTA rankings</h2><span class="mod-k">Top 10</span></header><div class="mod-b" data-rank><p class="loading">Loading…</p></div></section>
      </div>
      <section data-results></section>
      <section class="mod"><header class="mod-h"><h2>Player intelligence</h2><span class="mod-k">Tennis DNA · head-to-head · form · surface · rank history</span></header><div class="mod-b" data-intel><p class="loading">Loading…</p></div></section>
      <section class="mod"><header class="mod-h"><h2>Coverage today</h2></header><div class="mod-b"><p>Live and results: <b>WTA Tour, WTA 125 and Grand Slam women’s events</b>; men’s Grand Slam results from Wimbledon and the Australian Open. ATP, Challenger and ITF live data are not yet acquirable — we show nothing rather than something unsourced. <a href="/sources">Sources →</a></p></div></section>
    </div>`);
  const $ = (s) => root.querySelector(s);
  const refresh = async () => {
    let t;
    try { t = await api('/v1/today', { signal: ctl.signal }); } catch { return; }
    const d = t.data;
    render($('[data-strip]'), d ? html`${d.live.length ? html`<i class="dot"></i>` : ''}<b>${d.live.length ? `LIVE NOW · ${d.live.length} MATCH${d.live.length === 1 ? '' : 'ES'}` : 'NO MATCH LIVE RIGHT NOW'}</b><span>· ${d.tournaments.length} tournament${d.tournaments.length === 1 ? '' : 's'} in progress</span>` : html`Live data unavailable right now.`);
    if (!d) return;
    render($('[data-live]'), d.live.length ? html`<h2 class="sec">Live now <small>WATCH PBECAST for the live court</small></h2>${matchList(d.live.slice(0, 6))}` : d.upcoming.length ? html`<h2 class="sec">Up next</h2>${matchList(d.upcoming.slice(0, 6))}` : '');
    render($('[data-tours]'), d.tournaments.length ? html`<div class="trs">${d.tournaments.map(tournamentRow)}</div>` : html`<p class="note">No covered tournament is in progress today.</p>`);
    render($('[data-results]'), d.latest_results.length ? html`<h2 class="sec">Latest results</h2>${matchList(d.latest_results.slice(0, 9))}` : '');
  };
  refresh();
  const timer = setInterval(refresh, 60000);
  api('/v1/rankings?tour=wta&type=singles&limit=10', { signal: ctl.signal }).then((r) => {
    render($('[data-rank]'), r.data ? html`${rankingTable(r.data, { compact: true })}<p class="note">Official list dated ${fmtDate(r.data.ranking_date)} · <a href="/rankings/women">Full rankings →</a></p>` : emptyModule(r.meta, 'No complete ranking list archived yet.'));
    const top = (r.data?.rows || []).slice(0, 4).map((x) => x.player);
    render($('[data-intel]'), top.length ? html`<ul class="plist">${top.map((p) => html`<li><a href="/players/${p.slug}">${avatar(p, { px: 40 })}<span>${p.name}</span></a></li>`)}</ul><p class="note" style="margin-top:10px">Profiles combine the official ranking history PropBetEdge archives, stored results, surface records, head-to-head and <a href="/dna">Tennis DNA</a>.</p>` : html`<p class="note">No players yet.</p>`);
  }).catch(() => {});
  return () => { ctl.abort(); clearInterval(timer); };
}
