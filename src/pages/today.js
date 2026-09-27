// Home: one Tennis product, organized by what is happening — never by gender. Hero -> live / up next ->
// latest results (every event, labelled) -> PBEcast -> latest tennis intelligence -> featured players ->
// tournament coverage. Event type (men's/women's singles, doubles, mixed) is context on each card.
// Every module is real data or states why it is empty.

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { avatar } from '../ui/avatar.js';
import { matchList, tournamentRow, slamRow } from '../ui/render.js';
import { replayList } from './men.js';
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
        <div class="open-build">
          <span class="open-build__badge"><i aria-hidden="true"></i>OPEN BUILD</span>
          <span class="open-build__copy">Real data · real-time systems · daily updates</span>
        </div>
        <p class="eyebrow">PropBetEdge Tennis</p>
        <h1 id="hero-h">Global Tennis Intelligence</h1>
        <p class="hero-sub">Singles, doubles and mixed — live scores, Grand Slam match data, point-by-point PBEcast replays and player analytics, built on a data graph PropBetEdge collects, normalizes and owns.</p>
        <p class="open-build__note">Follow along as we build PropBetEdge Tennis in public. The data is real and live; the product is still being finished.</p>
        <div class="hero-cta"><a class="btn" href="/live">Live now</a><a class="btn ghost" href="/pbecast">PBEcast</a><a class="btn ghost" href="/news">News</a><a class="btn ghost" href="/players">Players</a><a class="btn ghost" href="/tournaments">Tournaments</a></div>
        <p class="hero-strip" data-strip>Checking live matches…</p>
      </div>
    </section>
    <div class="page">
      <section data-live></section>
      <section data-results></section>
      <section class="mod" data-pbecast><header class="mod-h"><h2>PBEcast</h2><a class="mod-k" href="/pbecast">All casts and replays →</a></header><p class="loading">Loading…</p></section>
      <section class="mod" data-news><header class="mod-h"><h2>Latest tennis intelligence</h2><a class="mod-k" href="/news">All news →</a></header><p class="loading">Loading…</p></section>
      <section class="mod"><header class="mod-h"><h2>Featured players</h2><a class="mod-k" href="/players">All players →</a></header><div class="mod-b" data-players><p class="loading">Loading…</p></div></section>
      <section class="mod"><header class="mod-h"><h2>Tournament coverage</h2><a class="mod-k" href="/tournaments">All tournaments →</a></header><div class="mod-b" data-tours><p class="loading">Loading…</p></div></section>
      <section class="mod"><header class="mod-h"><h2>Coverage today</h2></header><div class="mod-b"><p>WTA Tour, WTA 125 and Grand Slam events — live, results, statistics and official WTA rankings. Grand Slams add men’s singles, men’s doubles and mixed doubles: the Australian Open complete with point-by-point, the Wimbledon archive and Roland-Garros. ATP Tour results from 2007 and weekly ATP singles rankings (top 100–150) come from a secondary source, always behind official Grand Slam data. ATP Challenger, ITF and official ATP ranking feeds are not yet acquirable — we show nothing rather than something unsourced. <a href="/sources">Sources →</a></p></div></section>
    </div>`);
  const $ = (s) => root.querySelector(s);
  let today = null;
  let slams = null;
  let wta = null;
  const drawResults = () => {
    const el = $('[data-results]');
    if (!el) return;
    const cur = today?.latest_results || [];
    const finals = slams?.finals || [];
    render(el, cur.length || finals.length ? html`<h2 class="sec">Latest results</h2>
      ${cur.length ? html`<p class="sec-sub">Tournaments in progress</p>${matchList(cur.slice(0, 6))}` : ''}
      ${finals.length ? html`<p class="sec-sub">Latest Grand Slam finals</p>${matchList(finals.slice(0, 6))}` : ''}` : '');
  };
  const drawTours = () => {
    const el = $('[data-tours]');
    if (!el) return;
    const cur = today?.tournaments || [];
    const eds = (slams?.editions || []).slice(0, 6);
    render(el, html`${cur.length ? html`<p class="sec-sub">In progress</p><div class="trs">${cur.map(tournamentRow)}</div>` : html`<p class="note">No covered tournament is in progress today.</p>`}
      ${eds.length ? html`<p class="sec-sub">Grand Slams</p><div class="trs">${eds.map(slamRow)}</div>` : ''}`);
  };
  const drawPlayers = () => {
    const el = $('[data-players]');
    if (!el || !slams || !wta) return;
    const out = [];
    const seen = new Set();
    for (const f of slams.data?.featured || []) if (!seen.has(f.player.id)) { seen.add(f.player.id); out.push({ player: f.player, note: f.note }); }
    for (const r of (wta.data?.rows || []).slice(0, 6)) if (!seen.has(r.player.id)) { seen.add(r.player.id); out.push({ player: r.player, note: `WTA No. ${r.rank}` }); }
    render(el, out.length ? html`<ul class="men-feat">${out.slice(0, 12).map((f) => html`<li><a href="/players/${f.player.slug}">${avatar(f.player, { size: 'square', px: 64 })}<span><b>${f.player.name}</b><small>${f.note}</small></span></a></li>`)}</ul>` : html`<p class="note">No players yet.</p>`);
  };
  const refresh = async () => {
    let t;
    try { t = await api('/v1/today', { signal: ctl.signal }); } catch { return; }
    const d = t.data;
    render($('[data-strip]'), d ? html`${d.live.length ? html`<i class="dot"></i>` : ''}<b>${d.live.length ? `LIVE NOW · ${d.live.length} MATCH${d.live.length === 1 ? '' : 'ES'}` : 'NO MATCH LIVE RIGHT NOW'}</b><span>· ${d.tournaments.length} tournament${d.tournaments.length === 1 ? '' : 's'} in progress</span>` : html`Live data unavailable right now.`);
    if (!d) return;
    today = d;
    render($('[data-live]'), d.live.length ? html`<h2 class="sec">Live now <small>WATCH PBECAST for the live court</small></h2>${matchList(d.live.slice(0, 6))}` : d.upcoming.length ? html`<h2 class="sec">Up next</h2>${matchList(d.upcoming.slice(0, 6))}` : '');
    drawResults();
    drawTours();
  };
  refresh();
  const timer = setInterval(refresh, 60000);
  api('/v1/slams', { signal: ctl.signal }).then((r) => {
    slams = r;
    const s = r.data;
    const el = $('[data-pbecast]');
    if (el) render(el, html`<header class="mod-h"><h2>PBEcast</h2><a class="mod-k" href="/pbecast">All casts and replays →</a></header>
      <p class="note">The analytical court for every covered match — live when a match is on, replays afterwards.</p>
      ${s?.replays?.length ? html`<p class="sec-sub">Point-by-point replays · ${s.replay_edition.tournament} ${s.replay_edition.year}</p>${replayList(s.replays.slice(0, 6))}` : html`<p class="note">No point-by-point replay is stored yet.</p>`}`);
    if (s) { slams = { ...r, finals: s.finals, editions: s.editions }; drawResults(); drawTours(); }
    drawPlayers();
  }).catch(() => {});
  api('/v1/rankings?tour=wta&type=singles&limit=10', { signal: ctl.signal }).then((r) => { wta = r; drawPlayers(); }).catch(() => {});
  api('/v1/news?limit=5', { signal: ctl.signal }).then((r) => {
    const el = $('[data-news]');
    if (!el) return;
    const list = r.data?.articles || [];
    render(el, html`<header class="mod-h"><h2>Latest tennis intelligence</h2><a class="mod-k" href="/news">All news →</a></header>${list.length ? html`${card(list[0], true)}${list.length > 1 ? html`<div class="nw-grid">${list.slice(1, 5).map((a) => card(a))}</div>` : ''}` : html`<p class="note">No story is published yet. The newsroom publishes only when a real event in our data passes every factual check — a quiet day publishes nothing. <a href="/news">Newsroom →</a></p>`}`);
  }).catch(() => {});
  return () => { ctl.abort(); clearInterval(timer); };
}
