// Home: what is happening in tennis right now, men and women. Hero -> live strip -> live -> latest
// intelligence (newsroom) -> men's tennis | women's tennis -> latest results -> player intelligence ->
// coverage. Every module is real data or states why it is empty.

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { emptyModule } from '../ui/state.js';
import { avatar } from '../ui/avatar.js';
import { matchList, tournamentRow, rankingTable, fmtDate } from '../ui/render.js';
import { featuredList, replayList } from './men.js';
import { card } from './news.js';

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
        <p class="hero-sub">Men’s and women’s tennis — live WTA scores, Grand Slam match data, point-by-point PBEcast replays and player analytics, built on a data graph PropBetEdge collects, normalizes and owns.</p>
        <div class="hero-cta"><a class="btn" href="/live">Live now</a><a class="btn ghost" href="/men">Men’s tennis</a><a class="btn ghost" href="/rankings/women">Women’s rankings</a><a class="btn ghost" href="/news">News</a><a class="btn ghost" href="/players">Explore players</a></div>
        <p class="hero-strip" data-strip>Checking live matches…</p>
      </div>
    </section>
    <div class="page">
      <section data-live></section>
      <section class="mod" data-news><header class="mod-h"><h2>Latest tennis intelligence</h2><a class="mod-k" href="/news">All news →</a></header><p class="loading">Loading…</p></section>
      <div class="split-2 home-mw">
        <section class="mod"><header class="mod-h"><h2>Men’s tennis</h2><a class="mod-k" href="/men">Grand Slams →</a></header><div class="mod-b" data-men><p class="loading">Loading…</p></div></section>
        <section class="mod"><header class="mod-h"><h2>Women’s tennis</h2><a class="mod-k" href="/rankings/women">WTA →</a></header><div class="mod-b" data-women><p class="loading">Loading…</p></div></section>
      </div>
      <section data-results></section>
      <section class="mod"><header class="mod-h"><h2>Player intelligence</h2><span class="mod-k">Tennis DNA · head-to-head · form · surface</span></header><div class="mod-b" data-intel><p class="loading">Loading…</p></div></section>
      <section class="mod"><header class="mod-h"><h2>Coverage today</h2></header><div class="mod-b"><p><b>Women:</b> WTA Tour, WTA 125 and Grand Slam events — live, results, statistics and official WTA rankings. <b>Men:</b> Grand Slam coverage — Australian Open (complete, with point-by-point), Wimbledon archive and Roland-Garros. ATP Tour, ATP Challenger, ITF and official ATP rankings are not yet acquirable — we show nothing rather than something unsourced. <a href="/sources">Sources →</a></p></div></section>
    </div>`);
  const $ = (s) => root.querySelector(s);
  let tours = [];
  let wta = null;
  const drawWomen = () => {
    const el = $('[data-women]');
    if (!el) return;
    render(el, html`${wta?.data ? html`${rankingTable({ ...wta.data, rows: (wta.data.rows || []).slice(0, 10) }, { compact: true })}<p class="note">Official WTA list dated ${fmtDate(wta.data.ranking_date)} · <a href="/rankings/women">Full rankings →</a></p>` : wta ? emptyModule(wta.meta, 'No complete ranking list archived yet.') : html`<p class="loading">Loading…</p>`}
      <h3 class="sub-h">Current tournaments</h3>${tours.length ? html`<div class="trs">${tours.slice(0, 4).map(tournamentRow)}</div>` : html`<p class="note">No covered tournament is in progress today.</p>`}`);
  };
  const refresh = async () => {
    let t;
    try { t = await api('/v1/today', { signal: ctl.signal }); } catch { return; }
    const d = t.data;
    render($('[data-strip]'), d ? html`${d.live.length ? html`<i class="dot"></i>` : ''}<b>${d.live.length ? `LIVE NOW · ${d.live.length} MATCH${d.live.length === 1 ? '' : 'ES'}` : 'NO MATCH LIVE RIGHT NOW'}</b><span>· ${d.tournaments.length} tournament${d.tournaments.length === 1 ? '' : 's'} in progress</span>` : html`Live data unavailable right now.`);
    if (!d) return;
    render($('[data-live]'), d.live.length ? html`<h2 class="sec">Live now <small>WATCH PBECAST for the live court</small></h2>${matchList(d.live.slice(0, 6))}` : d.upcoming.length ? html`<h2 class="sec">Up next</h2>${matchList(d.upcoming.slice(0, 6))}` : '');
    tours = d.tournaments;
    drawWomen();
    render($('[data-results]'), d.latest_results.length ? html`<h2 class="sec">Latest results <small>tournaments in progress</small></h2>${matchList(d.latest_results.slice(0, 9))}` : '');
  };
  refresh();
  const timer = setInterval(refresh, 60000);
  const rankP = api('/v1/rankings?tour=wta&type=singles&limit=10', { signal: ctl.signal }).then((r) => { wta = r; drawWomen(); return r; }).catch(() => null);
  const menP = api('/v1/men', { signal: ctl.signal }).then((r) => {
    const el = $('[data-men]');
    const m = r.data;
    if (!el) return r;
    if (!m) { render(el, emptyModule(r.meta, 'Men’s coverage is unavailable right now.')); return r; }
    const res = m.recent.flatMap((x) => x.matches.filter((mm) => mm.event_type === 'MS')).slice(0, 3);
    render(el, html`<p class="note home-men-t"><b>${m.totals.matches.toLocaleString('en-US')}</b> men’s Grand Slam matches · <b>${m.totals.point_by_point.toLocaleString('en-US')}</b> with point-by-point</p>
      ${res.length ? html`<h3 class="sub-h">Recent Grand Slam results</h3>${matchList(res)}` : ''}
      ${m.featured.length ? html`<h3 class="sub-h">Top available players <small class="note">recent Slam finals and semifinals</small></h3>${featuredList(m.featured.slice(0, 4))}` : ''}
      ${m.replays.length ? html`<h3 class="sub-h">Latest PBEcast replays</h3>${replayList(m.replays.slice(0, 3))}` : ''}
      <p class="note"><a href="/tournaments/australian-open/2026/mens-singles">Australian Open</a> · <a href="/men">Wimbledon archive</a> · <a href="/men">Roland-Garros</a> · ATP Tour and ATP rankings not yet available.</p>`);
    return r;
  }).catch(() => null);
  Promise.all([rankP, menP]).then(([w, mn]) => {
    const women = (w?.data?.rows || []).slice(0, 4).map((x) => x.player);
    const men = (mn?.data?.featured || []).slice(0, 4).map((x) => x.player);
    const el = $('[data-intel]');
    if (!el) return;
    const top = [...men, ...women];
    render(el, top.length ? html`<ul class="plist">${top.map((p) => html`<li><a href="/players/${p.slug}">${avatar(p, { px: 40 })}<span>${p.name}</span></a></li>`)}</ul><p class="note" style="margin-top:10px">Profiles combine stored results, surface records, head-to-head, Grand Slam history and <a href="/dna">Tennis DNA</a>; women’s profiles add the official WTA ranking history PropBetEdge archives.</p>` : html`<p class="note">No players yet.</p>`);
  });
  api('/v1/news?limit=5', { signal: ctl.signal }).then((r) => {
    const el = $('[data-news]');
    if (!el) return;
    const list = r.data?.articles || [];
    render(el, html`<header class="mod-h"><h2>Latest tennis intelligence</h2><a class="mod-k" href="/news">All news →</a></header>${list.length ? html`${card(list[0], true)}${list.length > 1 ? html`<div class="nw-grid">${list.slice(1, 5).map((a) => card(a))}</div>` : ''}` : html`<p class="note">No story is published yet. The newsroom publishes only when a real event in our data passes every factual check — a quiet day publishes nothing. <a href="/news">Newsroom →</a></p>`}`);
  }).catch(() => {});
  return () => { ctl.abort(); clearInterval(timer); };
}
