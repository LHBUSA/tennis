// Home: one Tennis product, organized by what is happening — never by gender. Hero -> live / up next ->
// latest results (every event, labelled) -> PBEcast -> latest tennis intelligence -> featured players ->
// tournament coverage. Event type (men's/women's singles, doubles, mixed) is context on each card.
// Every module is real data or states why it is empty.

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { avatar } from '../ui/avatar.js';
import { matchList, tournamentRow, slamRow } from '../ui/render.js';
import { replayList } from './men.js';
import { leadStory, storyRow, wireList } from './news.js';
import { hierarchy } from '../lib/newsroom.js';
import { ensureEach, eventGender, storyTour } from '../lib/balance.js';
import { leaderBoard } from '../lib/v4.js';

const menWomen = (m) => { const g = eventGender(m); return g === 'mixed' ? null : g; };

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
        <p class="hero-sub">ATP, WTA and the Grand Slams in one product — singles, doubles and mixed: live scores, results, PBEcast, Match DNA and player analytics, built on a data graph PropBetEdge collects, normalizes and owns.</p>
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
      <section class="mod lb" data-leaders aria-labelledby="lb-h"><header class="mod-h"><h2 id="lb-h">Tennis DNA leaders</h2><a class="mod-k" href="/dna">All Tennis DNA →</a></header><p class="loading">Loading…</p></section>
      <section class="mod"><header class="mod-h"><h2>Featured players</h2><a class="mod-k" href="/players">All players →</a></header><div class="mod-b" data-players><p class="loading">Loading…</p></div></section>
      <section class="mod"><header class="mod-h"><h2>Tournament coverage</h2><a class="mod-k" href="/tournaments">All tournaments →</a></header><div class="mod-b" data-tours><p class="loading">Loading…</p></div></section>
      <section class="mod"><header class="mod-h"><h2>Coverage today</h2></header><div class="mod-b"><p><b>ATP Tour</b> — tournaments, results (2007 on), fixtures and the weekly ATP singles list (top 100–150), all from a secondary source (ESPN), labelled as such and never presented as official ATP data; live ATP scores are set and game level from that source, without point-by-point. <b>WTA Tour and WTA 125</b> — official live scores with point score, results, match statistics and official WTA singles and doubles rankings. <b>Grand Slams</b> — one tournament with every event: men’s and women’s singles and doubles, mixed doubles and qualifying; the Australian Open complete with point-by-point, the Wimbledon archive and Roland-Garros. <b>Tennis DNA</b> — results-based Match DNA for ATP and WTA players, each tour compared only with itself. ATP Challenger, ITF and official ATP feeds are not yet acquirable — we show nothing rather than something unsourced. <a href="/sources">Sources →</a></p></div></section>
    </div>`);
  const $ = (s) => root.querySelector(s);
  let today = null;
  let slams = null;
  let wta = null;
  let atp = null;
  const drawResults = () => {
    const el = $('[data-results]');
    if (!el) return;
    // availability-aware: when both men's and women's results exist, the cut shows both (tests/one-product.test.js)
    const cur = ensureEach(today?.latest_results || [], 6, menWomen);
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
    if (!el || !slams || !wta || !atp) return;
    const out = [];
    const seen = new Set();
    for (const f of slams.data?.featured || []) if (!seen.has(f.player.id)) { seen.add(f.player.id); out.push({ player: f.player, note: f.note }); }
    // ATP and WTA as peers: the two lists interleave (No. 1 ATP, No. 1 WTA, ...)
    const w = (wta.data?.rows || []).slice(0, 6);
    const a = (atp.data?.rows || []).slice(0, 6);
    for (let i = 0; i < 6; i += 1) {
      for (const [r, note] of [[a[i], (x) => `ATP No. ${x.rank} · secondary-source list`], [w[i], (x) => `WTA No. ${x.rank}`]]) if (r?.player && !seen.has(r.player.id)) { seen.add(r.player.id); out.push({ player: r.player, note: note(r) }); }
    }
    render(el, out.length ? html`<ul class="men-feat">${out.slice(0, 12).map((f) => html`<li><a href="/players/${f.player.slug}">${avatar(f.player, { size: 'square', px: 64 })}<span><b>${f.player.name}</b><small>${f.note}</small></span></a></li>`)}</ul>` : html`<p class="note">No players yet.</p>`);
  };
  const refresh = async () => {
    let t;
    try { t = await api('/v1/today', { signal: ctl.signal }); } catch { return; }
    const d = t.data;
    render($('[data-strip]'), d ? html`${d.live.length ? html`<i class="dot"></i>` : ''}<b>${d.live.length ? `LIVE NOW · ${d.live.length} MATCH${d.live.length === 1 ? '' : 'ES'}` : 'NO MATCH LIVE RIGHT NOW'}</b><span>· ${d.tournaments.length} tournament${d.tournaments.length === 1 ? '' : 's'} in progress</span>` : html`Live data unavailable right now.`);
    if (!d) return;
    today = d;
    render($('[data-live]'), d.live.length ? html`<h2 class="sec">Live now <small>WATCH PBECAST for the live court</small></h2>${matchList(ensureEach(d.live, 6, menWomen))}` : d.upcoming.length ? html`<h2 class="sec">Up next</h2>${matchList(ensureEach(d.upcoming, 6, menWomen))}` : '');
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
  api('/v1/rankings?tour=wta&type=singles&limit=10', { signal: ctl.signal }).then((r) => { wta = r; drawPlayers(); }).catch(() => { wta = {}; drawPlayers(); });
  api('/v1/rankings?tour=atp&type=singles&limit=10', { signal: ctl.signal }).then((r) => { atp = r; drawPlayers(); }).catch(() => { atp = {}; drawPlayers(); });
  // newsroom V3 on the homepage: top stories (lead + majors) next to the live wire. A wider window than we show, so
  // the latest ATP and WTA stories can both surface (never duplicated or held)
  Promise.all([api('/v1/news?limit=20', { signal: ctl.signal }).catch(() => null), api('/v1/news/live?limit=12', { signal: ctl.signal }).catch(() => null)]).then(([r, w]) => {
    const el = $('[data-news]');
    if (!el) return;
    const list = ensureEach(r?.data?.articles || [], 5, (a) => storyTour(a));
    const { lead, majors } = hierarchy(list, { majors: 2 });
    const wire = Array.isArray(w?.data?.items) ? w.data.items : [];
    const wireHtml = wireList(wire, { limit: 6, more: false });
    render(el, html`<header class="mod-h"><h2>Latest tennis intelligence</h2><a class="mod-k" href="/news">Newsroom →</a></header>
      ${lead || wireHtml ? html`<div class="nf-home-top">${lead ? html`<div>${leadStory(lead)}${majors.length ? html`<div class="nf-rows">${majors.map(storyRow)}</div>` : ''}</div>` : ''}${wireHtml ? html`<div class="nf-wire nf-wire-home"><header class="nf-sec"><h2><i class="nf-pulse" aria-hidden="true"></i>Live tennis wire</h2><a href="/news">All →</a></header>${wireHtml}</div>` : ''}</div>`
        : html`<p class="note">No story is published yet. The newsroom publishes only when a real event in our data passes every factual check — a quiet day publishes nothing. <a href="/news">Newsroom →</a></p>`}`);
  }).catch(() => {});
  // Tennis DNA leaders: every board states its qualification population; a tour whose comparison population is not
  // published yet shows "comparison building" (never a leaderboard from an incomplete population). ATP and WTA never pooled.
  const BOARDS = [['pbe_rating', 'PBE Rating', (v) => String(v)], ['hold_rate', 'Serve · hold rate', (v) => `${(v * 100).toFixed(1)}%`], ['return_games_won', 'Return · break rate', (v) => `${(v * 100).toFixed(1)}%`]];
  Promise.all(BOARDS.flatMap(([m]) => ['atp', 'wta'].map((t) => api(`/v1/dna/leaders?metric=${m}&tour=${t}&limit=5`, { signal: ctl.signal }).then((r) => r?.data || null).catch(() => null)))).then((res) => {
    const el = $('[data-leaders]');
    if (!el) return;
    // one card per metric; inside it ATP and WTA as separate top-3 boards, each with its own population line
    const tourBoard = ([m, , fmt], t, d) => {
      const b = leaderBoard(d, { tour: t });
      const T = t.toUpperCase();
      return html`<div class="lb-tour"><p class="lb-tk"><span class="nf-tour nf-tour-${t}">${T}</span>${b.show ? html`<a href="/dna?metric=${m}&tour=${t}">Full board →</a>` : html`<b>${T} comparison building</b>`}</p>
        ${b.show ? html`<ol class="lb-list">${b.rows.slice(0, 3).map((r) => html`<li><span class="lb-r">${r.rank}</span>${r.player?.slug ? html`<a href="/players/${r.player.slug}">${r.player.name}</a>` : html`<span>${r.player?.name || ''}</span>`}<b>${fmt(r.value)}</b></li>`)}</ol>` : ''}
        <p class="lb-pop">${b.note}</p></div>`;
    };
    render(el, html`<header class="mod-h"><h2 id="lb-h">Tennis DNA leaders</h2><a class="mod-k" href="/dna">All Tennis DNA →</a></header>
      <div class="lb-grid">${BOARDS.map((B, i) => html`<div class="lb-card"><h3>${B[1]}</h3>${tourBoard(B, 'atp', res[i * 2])}${tourBoard(B, 'wta', res[i * 2 + 1])}</div>`)}</div>
      <p class="note">Singles only, from our canonical results and match statistics. Each board shows who qualifies for it. <a href="/methodology">Definitions and confidence rules →</a></p>`);
  });
  return () => { ctl.abort(); clearInterval(timer); };
}
