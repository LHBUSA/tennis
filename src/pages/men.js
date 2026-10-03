// /men — the entry point for every legitimate piece of men's coverage we hold: Grand Slam draws
// (Australian Open match centre with genuine point-by-point, Wimbledon draws archive, Roland-Garros
// results) plus ATP Tour results and weekly ATP singles lists from a secondary source (ESPN lane, 2026-09-27).
// ATP Challenger data and official ATP ranking feeds have no legitimate source yet; the page
// says so plainly and never fills the gap with anything unsourced.

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { emptyModule, errorModule, resultState, freshnessBadge } from '../ui/state.js';
import { avatar } from '../ui/avatar.js';
import { matchList, eventLabel, roundLabel, surfaceClass } from '../ui/render.js';
import { track } from '../analytics.js';

const n = (x) => Number(x || 0).toLocaleString('en-US');
const TOURNAMENT_NOTE = { 'australian-open': 'Match centre: results, statistics and genuine point-by-point', wimbledon: 'Draws archive: results by round (source-quality holds apply)', 'roland-garros': 'Results by round; identity proven player by player' };

export function editionRow(e) {
  const c = e.counts || {};
  const parts = [c.ms_main && `${n(c.ms_main)} singles`, c.ms_qualifying && `${n(c.ms_qualifying)} qualifying`, c.md && `${n(c.md)} doubles`, c.xd && `${n(c.xd)} mixed`].filter(Boolean).join(' · ');
  return html`<a class="tr ${surfaceClass(e.surface)}" href="/tournaments/${e.slug}/${e.year}${c.ms_main ? '/mens-singles' : ''}">
    <span class="tr-l">Grand Slam${e.surface ? ` · ${e.surface}` : ''}</span>
    <b>${e.tournament} ${e.year}</b>
    <span class="tr-d">${parts}${c.point_by_point ? html` · <em class="men-pbp">${n(c.point_by_point)} with point-by-point</em>` : ''}</span>
  </a>`;
}

export function featuredList(rows) {
  return html`<ul class="men-feat">${rows.map((f) => html`<li><a href="/players/${f.player.slug}">${avatar(f.player, { size: 'square', px: 64 })}<span><b>${f.player.name}</b><small>${f.note}</small></span></a></li>`)}</ul>`;
}

export function replayList(ms) {
  return html`<ul class="men-rp">${ms.map((m) => {
    const nm = (s) => (m.sides?.[s]?.players || []).map((p) => p.last_name || p.name).join(' / ');
    const w = m.winner_side;
    return html`<li><a href="/pbecast/${m.id}"><span class="men-rp-k">${eventLabel(m.event_type)} · ${roundLabel(m.round)}</span><span class="men-rp-p"><b class="${w === 'A' ? 'won' : ''}">${nm('A')}</b> v <b class="${w === 'B' ? 'won' : ''}">${nm('B')}</b></span><span class="men-rp-s tabnum">${m.score || ''}</span><span class="men-rp-cta">Replay ▸</span></a></li>`;
  })}</ul>`;
}

export function mount(root) {
  const ctl = new AbortController();
  track('tennis_men_open', { route: '/men' });
  render(root, html`<section class="men-hero"><div class="page">
      <p class="eyebrow">PropBetEdge Tennis</p>
      <h1>MEN'S TENNIS</h1>
      <p class="lede">Men’s tennis inside PropBetEdge Tennis — the same product as the women’s game: ATP Tour results, Grand Slam draws, Match DNA, player analytics and PBEcast.</p>
      <p class="men-totals" data-totals></p>
      <div class="hero-cta"><a class="btn" href="#replays">PBEcast replays</a><a class="btn ghost" href="/tournaments/australian-open/2026/mens-singles">Australian Open 2026</a><a class="btn ghost" href="/players?gender=men">Men’s players</a></div>
    </div></section>
    <div class="page">
      <p class="meta" data-meta></p>
      <div data-body><p class="loading">Loading…</p></div>
    </div>`);
  api('/v1/men', { signal: ctl.signal }).then((res) => {
    const body = root.querySelector('[data-body]');
    if (!body) return;
    render(root.querySelector('[data-meta]'), html`${freshnessBadge(res.meta)} <span>${res.meta?.semantics || ''}</span>`);
    const d = res.data;
    if (!d) { render(body, resultState(res) === 'error' ? errorModule(res.meta, 'Men’s coverage data could not be loaded.') : emptyModule(res.meta, 'No men’s coverage stored yet.')); return; }
    render(root.querySelector('[data-totals]'), html`<b>${n(d.totals.matches)}</b> men’s matches · <b>${n(d.totals.editions)}</b> Grand Slam editions${d.atp_tour?.available ? html` · ATP Tour results ${d.atp_tour.first_year}–${d.atp_tour.last_year}` : ''} · <b>${n(d.totals.point_by_point)}</b> with genuine point-by-point`);
    const ao = d.editions.find((e) => e.slug === 'australian-open' && e.counts.point_by_point > 0);
    const bySlam = (slug) => [...d.editions, ...(d.archive_editions || [])].filter((e) => e.slug === slug);
    const years = (slug) => bySlam(slug).map((e) => e.year).sort();
    render(body, html`
      ${d.recent.map((r) => r.matches.length ? html`<section class="mod"><header class="mod-h"><h2>Latest results · ${r.edition.tournament} ${r.edition.year}</h2><a class="mod-k" href="/tournaments/${r.edition.slug}/${r.edition.year}">All matches →</a></header>${matchList(r.matches.slice(0, 6), { showTournament: false })}${r.edition.counts.ms_main < 127 && r.edition.slug !== 'australian-open' ? html`<p class="note">${n(r.edition.counts.ms_main)} of 127 main-draw singles matches are published so far; the rest wait for a proven player identity and are never guessed.</p>` : ''}</section>` : '')}
      <div class="grid-2">
        <section class="mod" id="replays"><header class="mod-h"><h2>Men’s replays</h2><span class="mod-k">PBEcast · point-by-point</span></header>
          ${d.replays.length ? html`${replayList(d.replays)}<p class="note">Every point from the official ${d.replay_edition?.tournament || ''} ${d.replay_edition?.year || ''} match feed — reason and score only; no ball tracking is shown because none is published.</p>` : html`<p class="note">No men’s match with published point-by-point is stored yet.</p>`}</section>
        <section class="mod"><header class="mod-h"><h2>Featured players</h2><span class="mod-k">recent Grand Slam finals and semifinals</span></header>
          ${d.featured.length ? featuredList(d.featured) : html`<p class="note">No featured players yet.</p>`}<p class="note"><a href="/players?gender=men">All men’s players →</a></p></section>
      </div>
      ${ao ? html`<section class="mod"><header class="mod-h"><h2>Australian Open ${ao.year}</h2><span class="mod-k">complete draw</span></header><div class="men-ao">
        ${[['mens-singles', 'Men’s singles', ao.counts.ms_main], ['qualifying', 'Qualifying', ao.counts.ms_qualifying], ['mens-doubles', 'Men’s doubles', ao.counts.md], ['mixed-doubles', 'Mixed doubles', ao.counts.xd]].map(([slug, l, c]) => html`<a href="/tournaments/australian-open/${ao.year}/${slug}"><b class="tabnum">${n(c)}</b><span>${l}</span></a>`)}
        <a href="#replays"><b class="tabnum">${n(ao.counts.point_by_point)}</b><span>with point-by-point</span></a></div></section>` : ''}
      <div class="grid-2">
        <section class="mod"><header class="mod-h"><h2>Wimbledon archive</h2><span class="mod-k">${years('wimbledon')[0] || ''}–${years('wimbledon').at(-1) || ''}</span></header><div class="trs">${bySlam('wimbledon').map(editionRow)}</div><p class="note">${TOURNAMENT_NOTE.wimbledon}.</p></section>
        <section class="mod"><header class="mod-h"><h2>Roland-Garros</h2><span class="mod-k">${years('roland-garros')[0] || ''}–${years('roland-garros').at(-1) || ''}</span></header><div class="trs">${bySlam('roland-garros').map(editionRow)}</div><p class="note">${TOURNAMENT_NOTE['roland-garros']}; historical ingest continues.</p></section>
      </div>
      <section class="mod men-cov"><header class="mod-h"><h2>Coverage status</h2></header>
        <ul class="men-cov-l">
          <li class="ok"><b>Grand Slam coverage</b><span>Australian Open (complete, with statistics and point-by-point), Wimbledon archive, Roland-Garros.</span></li>
          <li class="ok"><b>Player profiles and photos</b><span>Every men’s player we hold has a canonical profile; photos only with a proven identity and an open licence.</span></li>
          <li class="${d.match_dna?.published ? 'ok' : 'wait'}"><b>Match DNA (ATP)</b><span>${d.match_dna?.published ? `Published · ${n(d.match_dna.qualified)} ATP players with a meaningful sample, compared only with other ATP players.` : d.match_dna ? `Building · ${n(d.match_dna.qualified)}/${d.match_dna.threshold} ATP players qualify.` : 'Status unavailable right now.'} <a href="/dna">Tennis DNA →</a></span></li>
          <li class="${d.dna.published ? 'ok' : 'wait'}"><b>Technical serve/return DNA (ATP)</b><span>${d.dna.published ? 'Published.' : `Still building · ${d.dna.qualified}/${d.dna.threshold} ATP players have enough match statistics. Match DNA is shown meanwhile.`}</span></li>
          <li class="ok"><b>ATP Tour results and fixtures</b><span>From 2007, from a secondary source behind official Grand Slam data: results, rounds, scores and published fixtures; no match statistics, tournament level or surface from that source. Live ATP scores are set and game level from the same source.</span></li>
          <li class="ok"><b>ATP singles list</b><span>Weekly top 100–150 lists (2007 on) from a secondary source, dated when that source updated them — not an official ATP feed.</span></li>
          <li class="no"><b>ATP Challenger and official ATP ranking feeds</b><span>Not yet available — no legitimate source.</span></li>
        </ul><p class="note"><a href="/sources">Source details →</a></p></section>`);
  }).catch(() => {});
  return () => ctl.abort();
}
