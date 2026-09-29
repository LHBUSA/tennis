// Data-backed pages. Every page fetches tennis-api routes, renders real rows, or says exactly why not.

import { html, render, raw, setIndexable } from '../lib/dom.js';
import { api } from '../data/api.js';
import { emptyModule, errorModule, resultState, freshnessBadge } from '../ui/state.js';
import { matchDnaSummary, familyTable, formBlock, historyTable, ratingLine, careerBlock, surfaceTable } from '../ui/match-dna.js';
import { avatar, nat } from '../ui/avatar.js';
import { ratingChart, profileBlock } from '../ui/player-profile.js';
import { shareBar } from '../ui/share.js';
import { slamRow, matchList, matchCard, tournamentRow, rankingTable, rankSpark, dnaRadar, dnaBars, eventLabel, roundLabel, fmtRange, fmtDate, cap, pct } from '../ui/render.js';
import { track } from '../analytics.js';
import { liveEntry } from '../lib/pbecast-live.js';
import { replayList } from './men.js';
import { storyRow, wireList, editorialPicture } from './news.js';

const title = (s) => String(s || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function shell(root, { eyebrow, heading, lede = '', chips = null }) {
  render(root, html`<div class="page">
    <header class="page-h"><p class="eyebrow">${eyebrow}</p><h1>${heading}</h1>${lede ? html`<p class="lede">${lede}</p>` : ''}
    ${chips ? html`<nav class="chips" aria-label="Views">${chips.map(([h, l, on]) => html`<a class="chip${on ? ' on' : ''}" href="${h}" ${on ? html`aria-current="page"` : ''}>${l}</a>`)}</nav>` : ''}
    <p class="meta" data-meta></p></header>
    <div data-body><p class="loading">Loading…</p></div></div>`);
}

async function fill(root, path, draw, note, signal, { poll = 0, errorNote = 'This data could not be loaded right now. Please try again shortly.' } = {}) {
  const run = async () => {
    let res;
    try { res = await api(path, { signal }); } catch { return; }
    const body = root.querySelector('[data-body]');
    const meta = root.querySelector('[data-meta]');
    if (!body) return;
    if (meta) render(meta, html`${freshnessBadge(res.meta)} <span>${res.meta?.semantics || ''}</span>`);
    // an API failure is an error state, never "nothing stored"
    if (resultState(res) === 'error') { render(body, errorModule(res.meta, errorNote)); return; }
    const out = res.data != null ? draw(res.data, res.meta) : null;
    render(body, out || emptyModule(res.meta, note));
  };
  await run();
  if (!poll) return () => {};
  const t = setInterval(run, poll * 1000);
  return () => clearInterval(t);
}

function mountWith(fn) {
  return (root, ctx) => {
    const ctl = new AbortController();
    let stop = () => {};
    Promise.resolve(fn(root, ctx, ctl.signal)).then((s) => { if (typeof s === 'function') stop = s; });
    return () => { ctl.abort(); stop(); };
  };
}

// ---- live ---------------------------------------------------------------------------------------------
export const live = mountWith((root, _c, signal) => {
  track('tennis_live_open', { route: '/live' });
  shell(root, { eyebrow: 'Live', heading: 'Live Now', lede: 'Matches in progress, with set, game and point scores and the server exactly as the source last published them. Open PBEcast for the live analytical court.' });
  return fill(root, '/v1/live', (d) => (d.length ? html`<p class="sec"><span>${d.length} match${d.length === 1 ? '' : 'es'} live</span></p>${matchList(d)}` : html`<div class="mod"><p class="empty-h">No matches in progress right now.</p><p class="note">Covered live: ATP Tour (set and game score from a secondary source, no point-by-point), WTA Tour and WTA 125 (official, with point score) and the Grand Slams. Challenger and ITF live data are not yet acquirable. <a href="/schedule">See the schedule →</a> · <a href="/pbecast">PBEcast replays →</a></p></div>`), 'Live data unavailable.', signal, { poll: 30 });
});

// ---- schedule -----------------------------------------------------------------------------------------
const VIEWS = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['upcoming', 'Upcoming']];
export const schedule = mountWith((root, _c, signal) => {
  const q = new URLSearchParams(location.search);
  const view = VIEWS.some(([v]) => v === q.get('view')) ? q.get('view') : 'today';
  const f = { gender: ['men', 'women', 'mixed'].includes(q.get('gender')) ? q.get('gender') : '', status: q.get('status') || '', event: q.get('event') || '', surface: q.get('surface') || '', tour: q.get('tour') || '' };
  track('tennis_schedule_open', { route: '/schedule' });
  const link = (patch) => { const p = new URLSearchParams({ view, ...f, ...patch }); for (const [k, v] of [...p]) if (!v) p.delete(k); return `/schedule?${p}`; };
  shell(root, { eyebrow: 'Schedule', heading: 'Tennis Schedule', lede: `ATP Tour, WTA Tour, WTA 125 and the Grand Slams in one schedule. ATP fixtures come from a secondary source and appear once it lists them (usually the draw and the next day); WTA order of play is official. Start times appear in your time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone}) when the source publishes a full timestamp.`, chips: VIEWS.map(([v, l]) => [link({ view: v }).replace(/view=[a-z]+/, `view=${v}`), l, v === view]) });
  root.querySelector('.page-h').insertAdjacentHTML('beforeend', String(html`<div class="chips" aria-label="Filters">
    ${[['', 'All'], ['men', 'Men'], ['women', 'Women'], ['mixed', 'Mixed']].map(([v, l]) => html`<a class="chip${f.gender === v ? ' on' : ''}" href="${link({ gender: v })}" data-gender="${v || 'all'}">${l}</a>`)}
    ${[['', 'All tours'], ['atp', 'ATP'], ['wta', 'WTA'], ['wta-125', 'WTA 125'], ['grand-slam', 'Grand Slam']].map(([v, l]) => html`<a class="chip${f.tour === v ? ' on' : ''}" href="${link({ tour: v })}">${l}</a>`)}
    ${[['', 'Singles + doubles'], ['singles', 'Singles'], ['doubles', 'Doubles']].map(([v, l]) => html`<a class="chip${f.event === v ? ' on' : ''}" href="${link({ event: v })}">${l}</a>`)}
    ${[['', 'Any surface'], ['hard', 'Hard'], ['clay', 'Clay'], ['grass', 'Grass']].map(([v, l]) => html`<a class="chip${f.surface === v ? ' on' : ''}" href="${link({ surface: v })}">${l}</a>`)}
    ${[['', 'Any status'], ['live', 'Live'], ['scheduled', 'Scheduled'], ['completed', 'Completed']].map(([v, l]) => html`<a class="chip${f.status === v ? ' on' : ''}" href="${link({ status: v })}">${l}</a>`)}
  </div>`));
  const qs = new URLSearchParams({ view, ...f });
  for (const [k, v] of [...qs]) if (!v) qs.delete(k);
  return fill(root, `/v1/schedule?${qs}`, (d) => html`
    ${d.tournaments.length ? html`<h2 class="sec">Tournaments <small>${fmtRange(d.window[0], d.window[1])}</small></h2><div class="trs">${d.tournaments.map(tournamentRow)}</div>` : html`<p class="note">No covered tournament in this window.</p>`}
    ${d.live.length ? html`<h2 class="sec">Live</h2>${matchList(d.live)}` : ''}
    ${d.scheduled.length ? html`<h2 class="sec">Order of play <small>as published; a match without a time follows the one before it on that court</small></h2>${matchList(d.scheduled)}` : ''}
    ${d.completed.length ? html`<h2 class="sec">Completed</h2>${matchList(d.completed.slice(0, 60))}` : ''}
    ${f.gender === 'men' && !d.live.length && !d.scheduled.length && !d.completed.length ? html`<div class="mod"><p class="empty-h">No men’s match in this window.</p><p class="note">ATP Tour fixtures appear once our secondary source lists them; Grand Slam men’s events come from the tournaments’ own feeds where accessible. ATP Challenger is not yet covered. <a href="/schedule?view=week">This week →</a> · <a href="/tournaments">Tournaments →</a></p></div>` : ''}
    ${view === 'week' || view === 'upcoming' ? html`<p class="note">Match-level order of play is published a day ahead; future days show tournaments only.</p>` : ''}
    <div class="mod"><header class="mod-h"><h2>Where to watch</h2></header><p class="note">Broadcast rights are territorial. PropBetEdge shows official broadcasters only when a verified official source is ingested — none is yet, so no watch links are shown.</p></div>`, 'Schedule unavailable.', signal, { poll: view === 'today' ? 60 : 0 });
});

export const matches = schedule;

// ---- tournaments --------------------------------------------------------------------------------------
export const tournaments = mountWith((root, _c, signal) => {
  shell(root, { eyebrow: 'Tournaments', heading: 'Tournaments', lede: 'ATP Tour, WTA Tour, WTA 125 and Grand Slam editions from the last week through the next two months — and every Grand Slam edition PropBetEdge holds as one tournament: men’s and women’s singles and doubles, mixed doubles and qualifying. ATP Tour editions come from a secondary source that publishes no tournament level or surface.' });
  root.querySelector('[data-body]').insertAdjacentHTML('afterend', '<section class="mod" data-slams style="margin-top:18px"><header class="mod-h"><h2>Grand Slams</h2><span class="mod-k">every event, by edition</span></header><p class="loading">Loading…</p></section>');
  api('/v1/slams', { signal }).then((r) => { const el = root.querySelector('[data-slams]'); if (el && r.data?.editions?.length) render(el, html`<header class="mod-h"><h2>Grand Slams</h2><span class="mod-k">every event, by edition</span></header><div class="trs">${r.data.editions.map(slamRow)}</div><p class="note">Each edition holds every event our sources publish — men’s and women’s singles and doubles, mixed and qualifying — in one tournament. Where a Grand Slam’s own feed is not reachable (US Open), that data stays unavailable.</p>`); else if (el) el.remove(); }).catch(() => {});
  return fill(root, '/v1/tournaments', (d) => (d.length ? html`<h2 class="sec">Current and upcoming</h2><div class="trs">${d.map(tournamentRow)}</div>` : null), 'No tournaments stored for this window yet.', signal);
});

const EVENT_SLUG = { MS: 'mens-singles', WS: 'womens-singles', MD: 'mens-doubles', WD: 'womens-doubles', XD: 'mixed-doubles' };
export const tournament = mountWith((root, { params }, signal) => {
  track('tennis_tournament_open', { tournament_id: `${params.slug}-${params.year}` });
  shell(root, { eyebrow: `Tournament · ${params.year}`, heading: title(params.slug) });
  // stories live outside the polled body so the 2-minute refresh never hides them
  root.querySelector('[data-body]').insertAdjacentHTML('afterend', '<section class="mod" data-stories hidden style="margin-top:18px"><header class="mod-h"><h2>Latest from this event</h2><span class="mod-k">stories and live wire from this tournament</span></header><div data-stories-list></div></section>');
  fillStories(root, `tournament=${params.slug}&year=${params.year}`, signal);
  const qual = params.event === 'qualifying';
  const want = Object.entries(EVENT_SLUG).find(([, s]) => s === params.event)?.[0];
  return fill(root, `/v1/tournaments/${params.slug}/${params.year}`, (d) => {
    const e = d.edition;
    const h = root.querySelector('.page-h h1');
    if (h && e.tournament) h.textContent = e.tournament;
    // editorial hero (licensed photo of this edition / this tournament's venue), mounted once above the page
    const hm = d.media?.hero?.images?.[0];
    if (hm?.derivatives && !root.querySelector('.tnx-hero')) root.insertAdjacentHTML('afterbegin', String(html`<figure class="tnx-hero nwx-hero">${editorialPicture(hm, { hero: true, alt: hm.caption })}<figcaption class="page">${hm.caption}. Photo: <a href="${hm.source_page}" rel="noopener nofollow" target="_blank">${hm.author || 'Author'} / ${hm.license}</a></figcaption></figure>`));
    const isQ = (m) => String(m.round || '').startsWith('Q-');
    const ms = qual ? d.matches.filter(isQ) : want ? d.matches.filter((m) => m.event_type === want && !isQ(m)) : d.matches;
    const present = new Set(d.matches.map((m) => m.event_type));
    const events = ['MS', 'WS', 'MD', 'WD', 'XD'].filter((ev) => present.has(ev));
    const hasQ = d.matches.some(isQ);
    const count = (ev) => d.matches.filter((m) => m.event_type === ev && !isQ(m)).length;
    const order = (r) => { const [st, n] = String(r).split('-'); return (st === 'Q' ? 0 : 100) + ({ Q: 50, S: 60, F: 70 }[n] ?? (Number(n) || 0)); };
    const groups = new Map();
    for (const m of [...ms].sort((a, b) => order(b.round) - order(a.round))) { const k = `${m.event_type}|${m.round}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
    const live = ms.filter((m) => m.status === 'in_progress');
    const where = [e.city, e.country].filter(Boolean).join(', ');
    return html`<div class="mod"><div class="grid-3" style="gap:10px">
        <div><p class="eyebrow">Dates</p><b>${fmtRange(e.start_date, e.end_date)}</b></div>
        <div><p class="eyebrow">Surface</p><b>${cap(e.surface || '—')}${e.indoor === true ? ' · indoor' : e.indoor === false ? ' · outdoor' : ''}</b></div>
        <div><p class="eyebrow">Location</p><b>${where || '—'}</b>${e.venue?.slug ? html` <a href="/venues/${e.venue.slug}">venue page</a>` : ''}<br><small class="note">${e.venue?.precision === 'city' ? 'City from the source; the venue itself is not named by our source.' : ''}</small></div>
        <div><p class="eyebrow">Category</p><b>${e.level || (e.tour === 'atp' ? 'ATP Tour' : '—')}</b>${!e.level && e.tour === 'atp' ? html`<br><small class="note">Secondary source (ESPN); it publishes no tournament level or surface.</small>` : ''}</div>
      </div></div>
      <nav class="tabs ev-tabs" aria-label="Events"><a href="/tournaments/${params.slug}/${params.year}" ${!want && !qual ? raw('aria-current="page"') : ''}>All events <small>${d.matches.length}</small></a>${events.map((ev) => html`<a href="/tournaments/${params.slug}/${params.year}/${EVENT_SLUG[ev]}" ${want === ev ? raw('aria-current="page"') : ''}>${eventLabel(ev)} <small>${count(ev)}</small></a>`)}${hasQ ? html`<a href="/tournaments/${params.slug}/${params.year}/qualifying" ${qual ? raw('aria-current="page"') : ''}>Qualifying <small>${d.matches.filter(isQ).length}</small></a>` : ''}</nav>
      ${live.length ? html`<h2 class="sec">Live now</h2>${matchList(live, { showTournament: false })}` : ''}
      ${ms.length ? [...groups].map(([k, list]) => html`<h2 class="sec">${eventLabel(k.split('|')[0])} · ${roundLabel(k.split('|')[1])} <small>${list.length} match${list.length === 1 ? '' : 'es'}</small></h2>${matchList(list, { showTournament: false })}`) : html`<p class="note">No matches stored for this event.</p>`}
      <p class="note">Draw positions and bracket lines are not published by our current source for this event; matches are grouped by round as observed. Where to watch: no verified broadcast source yet.</p>
      ${shareBar({ url: `${location.origin}/tournaments/${params.slug}/${params.year}`, text: `${e.tournament} ${e.year} — PropBetEdge Tennis` })}`;
  }, 'This edition is not in the canonical store.', signal, { poll: 120 });
});

export const venue = mountWith((root, { params }, signal) => {
  shell(root, { eyebrow: 'Venue', heading: title(params.slug) });
  return fill(root, `/v1/venues/${params.slug}`, (d) => {
    const h = root.querySelector('.page-h h1');
    if (h) h.textContent = d.venue.name || `${d.venue.city}${d.venue.country ? `, ${d.venue.country}` : ''}`;
    return html`<p class="lede">${d.venue.precision === 'city' ? 'Location known to city level only — the venue name and coordinates are not in our source, so none are shown.' : ''}</p><h2 class="sec">Tournament editions here</h2><div class="trs">${d.editions.map(tournamentRow)}</div>`;
  }, 'Venue not found.', signal);
});

// ---- match lab ------------------------------------------------------------------------------------------
export const match = mountWith((root, { params }, signal) => {
  shell(root, { eyebrow: 'Match', heading: 'Match' });
  return fill(root, `/v1/matches/${params.id}`, (m) => {
    track('tennis_match_open', { match_id: m.id, match_status: m.status, surface: m.tournament?.surface });
    const nm = (s) => (m.sides?.[s]?.players || []).map((p) => p.name).join(' / ');
    const h = root.querySelector('.page-h h1');
    if (h) h.textContent = `${nm('A')} vs ${nm('B')}`;
    const vs = (s) => html`<div class="vs-side">${(m.sides?.[s]?.players || []).map((p) => html`<a href="/players/${p.slug}">${avatar(p, { size: 'square', px: 112, eager: true })}<b>${p.name}</b></a>`)}</div>`;
    const A = m.statistics?.A, B = m.statistics?.B;
    return html`<div class="vs">${vs('A')}<span class="vs-x">VS</span>${vs('B')}</div>
      ${matchCard(m)}
      <div class="grid-2" style="margin-top:16px">
        <section class="mod"><header class="mod-h"><h2>Match statistics</h2></header><div class="mod-b">${A && B ? html`<table class="cmp2"><tbody>${[['Aces', A.aces, B.aces], ['Double faults', A.double_faults, B.double_faults], ['1st serve in', pct(A.first_serves_in / A.service_points, 0), pct(B.first_serves_in / B.service_points, 0)], ['1st serve points won', pct(A.first_serve_points_won / A.first_serves_in, 0), pct(B.first_serve_points_won / B.first_serves_in, 0)], ['Break points saved', `${A.break_points_saved}/${A.break_points_faced}`, `${B.break_points_saved}/${B.break_points_faced}`], ['Total points won', A.total_points_won, B.total_points_won]].map(([l, a, b]) => html`<tr><td class="n">${a ?? '—'}</td><th scope="row">${l}</th><td>${b ?? '—'}</td></tr>`)}</tbody></table>` : html`<p class="note">${m.stats === 'pending' ? 'Statistics not ingested yet for this match.' : m.stats === 'not_applicable' ? 'Walkover — no match played.' : 'The source publishes no statistics for this match.'}</p>`}</div></section>
        <section class="mod"><header class="mod-h"><h2>PBEcast</h2></header><div class="mod-b"><p>${m.status === 'scheduled' ? 'PBEcast opens when live coverage begins.' : 'Open the analytical court: score, serve, key moments, stats, DNA and head-to-head.'}</p>${m.status !== 'scheduled' ? html`<a class="btn green" href="/pbecast/${m.id}">${m.status === 'in_progress' ? 'Watch PBEcast' : 'Replay PBEcast'}</a>` : ''}</div></section>
        <section class="mod"><header class="mod-h"><h2>Observed changes</h2></header><div class="mod-b">${m.observed_changes?.length ? html`<ul class="opp">${m.observed_changes.slice(-12).map((c) => html`<li><span>${c.kind.replace(/_/g, ' ')}</span><b>${String(c.to_value ?? '')}</b></li>`)}</ul>` : html`<p class="note">No upstream changes recorded since we first observed this match.</p>`}</div></section>
        <section class="mod"><header class="mod-h"><h2>Model</h2></header><div class="mod-b"><p class="note">No PBE model output: the Tennis model is research-only and unvalidated. Market: unavailable.</p></div></section>
      </div>
      ${m.sides?.A?.players?.length === 1 && m.sides?.B?.players?.length === 1 ? html`<p><a class="btn line" href="/h2h/${m.sides.A.players[0].slug}/${m.sides.B.players[0].slug}">Head-to-head →</a></p>` : ''}
      ${shareBar({ url: `${location.origin}/matches/${m.id}`, text: `${nm('A')} vs ${nm('B')} — PropBetEdge Tennis` })}`;
  }, 'This match is not in the canonical store.', signal, { poll: 30 });
});

// ---- rankings -----------------------------------------------------------------------------------------
export const rankings = mountWith((root, { params, route }, signal) => {
  const tour = params.tour === 'men' ? 'atp' : 'wta';
  const type = route?.doubles ? 'doubles' : 'singles';
  track('tennis_rankings_open', { tour, route: location.pathname });
  const chips = [['/rankings', 'All rankings', false], ['/rankings/women', 'WTA singles', tour === 'wta' && type === 'singles'], ['/rankings/women/doubles', 'WTA doubles', tour === 'wta' && type === 'doubles'], ['/rankings/men', 'ATP singles', tour === 'atp' && type === 'singles']];
  shell(root, { eyebrow: 'Rankings', heading: `${tour.toUpperCase()} ${type === 'doubles' ? 'Doubles' : 'Singles'} Rankings`, lede: tour === 'atp' ? (type === 'singles' ? 'Weekly ATP singles list carried by a secondary source — not an official ATP feed — archived so ranking history belongs to PropBetEdge.' : '') : 'The official list exactly as published, archived weekly so ranking history belongs to PropBetEdge. Movement compares with our previous archived list.', chips });
  return fill(root, `/v1/rankings?tour=${tour}&type=${type}&limit=200`, (d) => html`<p class="note">List dated ${fmtDate(d.ranking_date)} · ${d.total.toLocaleString('en-US')} ranked${d.previous_date ? ` · movement vs ${fmtDate(d.previous_date)}` : ''}${tour === 'atp' ? ' · carried by a secondary source, not an official ATP feed' : ''}</p>${rankingTable(d)}`, tour === 'atp' ? (type === 'doubles' ? 'ATP doubles rankings are not available from a legitimate source yet.' : 'No ATP singles list archived yet.') : 'No complete ranking list archived yet.', signal);
});

export const rankingsHub = mountWith((root) => {
  track('tennis_rankings_open', { tour: 'all', route: '/rankings' });
  shell(root, { eyebrow: 'Rankings', heading: 'Tennis Rankings', lede: 'Official WTA lists exactly as published and the weekly ATP singles list carried by a secondary source, archived weekly. We never compute or estimate an official ranking.' });
  render(root.querySelector('[data-body]'), html`<div class="rk-hub">
    <a class="rk-card" href="/rankings/women"><span class="st-ok">WTA RANKINGS — AVAILABLE</span><b>WTA singles</b><span class="note">Official list, archived weekly, with movement.</span></a>
    <a class="rk-card" href="/rankings/women/doubles"><span class="st-ok">WTA RANKINGS — AVAILABLE</span><b>WTA doubles</b><span class="note">Official doubles list, archived weekly.</span></a>
    <a class="rk-card" href="/rankings/men"><span class="st-ok">ATP SINGLES — SECONDARY SOURCE</span><b>ATP singles</b><span class="note">Weekly list (top 100–150) carried by a secondary source, not an official ATP feed. ATP doubles rankings are not available yet.</span></a>
  </div>`);
  return () => {};
});

// ---- players + search --------------------------------------------------------------------------------
const atpTable = (k) => html`<h2 class="sec">ATP singles <small>list dated ${fmtDate(k.ranking_date)} · ${k.rows.length}</small></h2>
  ${rankingTable(k)}
  <p class="note">${k.disclosure || 'ATP singles list'} · dated when that source last updated it${k.previous_date ? ` · movement vs our archived list of ${fmtDate(k.previous_date)}` : ''}.</p>`;
const menDirectory = (d) => (d.ranking?.rows?.length || d.rows.length ? html`${d.ranking?.rows?.length ? atpTable(d.ranking) : ''}${d.rows.length ? html`<h2 class="sec">Grand Slam performance <small>${d.basis.join(' · ')}</small></h2>${menTable(d, 200)}` : ''}` : null);
const menTable = (d, limit = 500) => html`<p class="note">Men’s singles players in the newest Grand Slam main draws we hold (${d.basis.join(', ')}), by furthest round reached — not a ranking.</p>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Player</th><th>Best result</th><th class="n hide-s">Draws</th></tr></thead><tbody>${d.rows.slice(0, limit).map((r) => html`<tr><td><span class="rk-p">${avatar(r.player, { px: 32 })}<a href="/players/${r.player.slug}">${r.player.name}</a> ${nat(r.player.nationality)}</span></td><td>${r.best.stage} <small class="note">· ${r.best.edition}</small></td><td class="n hide-s">${r.draws.length}</td></tr>`)}</tbody></table></div>`;
export const players = mountWith((root, _c, signal) => {
  const gq = new URLSearchParams(location.search).get('gender');
  const g = ['men', 'women'].includes(gq) ? gq : 'all';
  track('tennis_players_open', { gender: g });
  shell(root, { eyebrow: 'Players', heading: g === 'men' ? 'MEN’S PLAYERS' : 'Players', lede: g === 'men' ? 'ATP singles ranking carried by a secondary source, plus PropBetEdge’s canonical profiles and Grand Slam history.' : 'One canonical identity per player across every source — men and women. Search, or browse below.', chips: [['/players', 'All', g === 'all'], ['/players?gender=men', 'Men', g === 'men'], ['/players?gender=women', 'Women', g === 'women']] });
  root.querySelector('.page-h').insertAdjacentHTML('beforeend', '<form class="search" role="search" action="/search"><label class="sr" for="q">Search players and tournaments</label><input id="q" name="q" type="search" placeholder="Search players or tournaments" autocomplete="off" minlength="2" maxlength="60"><button class="btn green" type="submit">Search</button></form>');
  const women = (d) => html`<p class="note">WTA singles · official list dated ${fmtDate(d.ranking_date)}</p>${rankingTable(d)}`;
  if (g === 'men') {
    return fill(root, '/v1/men/players', menDirectory, 'No men’s players stored yet.', signal, { errorNote: 'Men’s player data could not be loaded.' });
  }
  if (g === 'women') return fill(root, '/v1/players', women, 'No ranking list archived yet.', signal);
  Promise.all([api('/v1/men/players', { signal }), api('/v1/players', { signal }), api('/v1/slams', { signal })]).then(([m, w, sl]) => {
    const body = root.querySelector('[data-body]');
    if (!body) return;
    // one directory: every player we hold a profile for, with the context each source gives
    const all = new Map();
    for (const r of w.data?.rows || []) all.set(r.player.id, { player: r.player, context: `WTA No. ${r.rank}`, sortKey: r.player.last_name || r.player.name });
    for (const r of m.data?.ranking?.rows || []) if (r.player && !all.has(r.player.id)) all.set(r.player.id, { player: r.player, context: `ATP No. ${r.rank} (secondary source)`, sortKey: r.player.last_name || r.player.name });
    for (const r of m.data?.rows || []) if (!all.has(r.player.id)) all.set(r.player.id, { player: r.player, context: `${r.best.stage} · ${r.best.edition}`, sortKey: r.player.last_name || r.player.name });
    const rows = [...all.values()].sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
    const featured = (sl.data?.featured || []).slice(0, 8);
    render(body, html`${featured.length ? html`<h2 class="sec">Featured <small>recent Grand Slam champions and finalists</small></h2><ul class="men-feat">${featured.map((f) => html`<li><a href="/players/${f.player.slug}">${avatar(f.player, { size: 'square', px: 64 })}<span><b>${f.player.name}</b><small>${f.note}</small></span></a></li>`)}</ul>` : ''}
      <h2 class="sec">All players <small>${rows.length.toLocaleString('en-US')} · A–Z</small></h2>
      ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Player</th><th>Context</th></tr></thead><tbody>${rows.map((r) => html`<tr><td><span class="rk-p">${avatar(r.player, { px: 32 })}<a href="/players/${r.player.slug}">${r.player.name}</a> ${nat(r.player.nationality)}</span></td><td>${r.context}</td></tr>`)}</tbody></table></div><p class="note">Women carry the official WTA singles ranking; men carry their ATP singles position from a list carried by a secondary source (not an official ATP feed), or their best recent Grand Slam result. Filter with Men or Women above, or search.</p>` : resultState(w) === 'error' || resultState(m) === 'error' ? errorModule(w.meta, 'Player data could not be loaded.') : emptyModule(w.meta, 'No players stored yet.')}`);
    const meta = root.querySelector('[data-meta]');
    if (meta) render(meta, html`${freshnessBadge(w.meta)} <span>official WTA list + ATP list from a secondary source + Grand Slam draws</span>`);
  }).catch(() => {});
  return () => {};
});

export const search = mountWith((root, _c, signal) => {
  const q = new URLSearchParams(location.search).get('q') || '';
  shell(root, { eyebrow: 'Search', heading: 'Search' });
  root.querySelector('.page-h').insertAdjacentHTML('beforeend', `<form class="search" role="search" action="/search"><label class="sr" for="q">Search players and tournaments</label><input id="q" name="q" type="search" value="${q.replace(/"/g, '&quot;')}" placeholder="e.g. Rybakina, Wimbledon 2025" autocomplete="off" minlength="2" maxlength="60"><button class="btn green" type="submit">Search</button></form>`);
  if (q.trim().length < 2) { render(root.querySelector('[data-body]'), html`<p class="note">Type at least two characters.</p>`); return () => {}; }
  return fill(root, `/v1/search?q=${encodeURIComponent(q)}`, (d) => {
    track('tennis_search', { results: d.players.length + d.tournaments.length });
    return html`<h2 class="sec">Players <small>${d.players.length}</small></h2>${d.players.length ? html`<ul class="plist">${d.players.map((p) => html`<li><a href="/players/${p.slug}">${avatar(p, { px: 36 })}<span>${p.name}</span> ${nat(p.nationality)}</a></li>`)}</ul>` : html`<p class="note">No player matches.</p>`}
      <h2 class="sec">Tournaments <small>${d.tournaments.length}</small></h2>${d.tournaments.length ? html`<ul class="plist">${d.tournaments.flatMap((t) => (t.editions.length ? t.editions.slice(0, 4) : [{ year: null }]).map((e) => html`<li><a href="${e.year ? `/tournaments/${t.slug}/${e.year}` : '#'}"><span>${t.name}${e.year ? ` ${e.year}` : ''}</span></a></li>`))}</ul>` : html`<p class="note">No tournament matches.</p>`}`;
  }, 'Search unavailable.', signal);
});

// ---- player -------------------------------------------------------------------------------------------
function playerHero(p, meta, tab, md = null) {
  const age = p.dob ? Math.floor((Date.now() - Date.parse(`${p.dob}T00:00:00Z`)) / (365.2425 * 86400000)) : null;
  const r = p.rankings || {};
  return html`<div class="ph-band"><div class="page"><div class="ph">
      <div class="ph-photo">${avatar(p, { size: 'portrait', px: 240, eager: true, cls: 'ph-img' })}</div>
      <div>
        <p class="eyebrow">${p.gender === 'F' ? 'Women · WTA' : p.gender === 'M' ? 'Men · ATP' : 'Player'}${p.nationality ? ` · ${p.nationality}` : ''}</p>
        <h1>${p.name}</h1>
        <dl class="ph-f">
          ${r.wta_singles ? html`<div><dt>WTA singles</dt><dd>No. ${r.wta_singles.rank}<small>${r.wta_singles.points?.toLocaleString('en-US')} pts · ${fmtDate(r.wta_singles.date)}</small></dd></div>` : ''}
          ${r.wta_doubles ? html`<div><dt>WTA doubles</dt><dd>No. ${r.wta_doubles.rank}<small>${fmtDate(r.wta_doubles.date)}</small></dd></div>` : ''}
          ${r.atp_singles ? (() => { const prev = (p.ranking_history || []).filter((h) => h.list === 'atp_singles')[1]; const mv = prev ? prev.rank - r.atp_singles.rank : null; return html`<div><dt>ATP singles</dt><dd>No. ${r.atp_singles.rank}<small>${r.atp_singles.points?.toLocaleString('en-US')} pts · ${fmtDate(r.atp_singles.date)}${mv ? ` · ${mv > 0 ? '▲' : '▼'}${Math.abs(mv)}` : ''} · secondary source, not an official ATP feed</small></dd></div>`; })() : ''}
          ${md?.rating && md.rating.status !== 'not_validated' ? html`<div><dt>PBE Rating</dt><dd>${ratingLine(md.rating)}</dd></div>` : ''}
          ${age != null ? html`<div><dt>Age</dt><dd>${age}<small>born ${fmtDate(p.dob)}</small></dd></div>` : ''}
        </dl>
        ${p.photo ? html`<p class="ph-credit">Photo: ${p.photo.author || 'unknown'} · ${p.photo.license} · <a href="${p.photo.source_page}" rel="noopener nofollow" target="_blank">Wikimedia Commons</a></p>` : html`<p class="ph-credit">No licensed photo approved yet — identity card shown.</p>`}
        ${shareBar({ url: `${location.origin}/players/${p.slug}`, text: `${p.name} — PropBetEdge Tennis` })}
      </div></div></div></div>
    <div class="page" style="padding-top:0"><nav class="tabs" aria-label="Player sections"><a href="/players/${p.slug}" ${!tab ? html`aria-current="page"` : ''}>Overview</a><a href="/players/${p.slug}/dna" ${tab === 'dna' ? html`aria-current="page"` : ''}>Tennis DNA</a></nav><p class="meta">${freshnessBadge(meta)} <span>${meta?.semantics || ''}</span></p></div>`;
}

const ORD = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const PCT_NOTE = { missing: 'no value', player_sample_low: 'Sample too small', peer_sample_not_mature: 'comparison building' };
/** Tennis DNA publication contract: individual measurements always; a metric percentile only with enough same-tour
 *  peers; the full comparative view (radar, bars) only once the tour gate opens. */
function dnaSection(d) {
  const byKey = Object.fromEntries((d.dimensions || []).map((x) => [x.key, x]));
  const cmp = d.comparative || { published: false };
  const rows = Object.values(d.metrics || {}).filter((m) => m && m.metric_key);
  return html`<section class="mod"><header class="mod-h"><h2>Technical DNA — ${cmp.published ? 'published' : 'coverage building'}</h2><span class="mod-k">v${d.definition_version} · ${d.tour} singles · as of ${fmtDate(d.as_of)}</span></header>
    ${cmp.published ? '' : html`<p class="dna-status"><b>TECHNICAL DNA — COVERAGE BUILDING.</b> ${cmp.qualified} of ${cmp.threshold} ${d.tour} players currently meet the full comparative standard, so the tour radar, strengths and leaderboard are held (the gate is not lowered). The individual measurements below are real; each metric's ${d.tour} percentile appears as soon as at least 10 ${d.tour} players have a medium-confidence sample for it. ATP and WTA are never compared.</p>`}
    ${cmp.published ? html`<div class="dna-wrap"><div>${dnaRadar(d.dimensions)}<p class="note">Percentile vs ${d.percentile_basis}.</p></div><div>${dnaBars(d.dimensions)}</div></div>` : ''}
    <div class="tbl-wrap"><table class="tbl dna-tbl"><thead><tr><th>Metric</th><th class="n">Value</th><th class="n hide-s">Sample</th><th>Confidence</th><th>${d.tour} percentile</th></tr></thead><tbody>
      ${rows.map((m) => { const x = byKey[m.metric_key]; return html`<tr><th scope="row" style="text-align:left">${m.metric_key.replace(/_/g, ' ')}</th><td class="n">${m.value == null ? '—' : pct(m.value)}</td><td class="n hide-s">${m.numerator == null ? '' : `${m.numerator}/${m.denominator} · `}${m.sample_matches ?? 0} matches</td><td><span class="conf c-${m.confidence}">${m.confidence}</span></td><td>${x?.percentile != null ? html`<b>${ORD(x.percentile)}</b>` : html`<span class="note">${x ? (x.percentile_status === 'peer_sample_not_mature' ? `${d.tour} comparison building` : PCT_NOTE[x.percentile_status] || 'no value') : 'measurement only'}</span>`}</td></tr>`; })}
    </tbody></table></div>
    <p class="note">“measurement only” = a descriptive rate with no tour percentile by definition (both tours).</p>
  </section>`;
}

/** Surface rating history: a chart where a validated surface rating has stored history; otherwise the explicit reason. */
function surfaceHistorySection(md) {
  const S = (md.by_surface || []).filter((x) => x.rating);
  if (!S.length) return '';
  const cap = (x) => `${x.surface[0].toUpperCase()}${x.surface.slice(1)}`;
  const charted = (x) => x.profile?.rating_history && x.rating.status !== 'not_validated';
  const why = (x) => (x.rating.status === 'not_validated' ? `not published — the ${md.tour} surface model has not passed its out-of-sample validation gate`
    : !x.profile?.rating_history ? `no history chart: the ${x.surface} rating is not established (${x.rating.rated_matches ?? 0} rated ${x.surface} matches; a chart needs 20+ and a ${x.surface} match in the last 365 days)` : '');
  return html`<section class="mod"><header class="mod-h"><h2>Surface rating history</h2><span class="mod-k">pre-match surface ratings · months played on the surface</span></header>
    ${S.some(charted) ? html`<div class="surf-charts">${S.filter(charted).map((x) => html`<div class="surf-chart ${x.surface}"><h3 class="sub-h">${cap(x)}</h3>${ratingChart(x.profile.rating_history, { label: `${x.surface} rating history` })}</div>`)}</div>` : ''}
    ${S.filter((x) => !charted(x)).map((x) => html`<p class="note"><b>${cap(x)}:</b> ${why(x)}.</p>`)}</section>`;
}

export const player = mountWith(async (root, { params }, signal) => {
  render(root, html`<div class="page"><p class="loading">Loading player…</p></div>`);
  const [pr, prof] = await Promise.all([api(`/v1/players/${params.slug}`, { signal }), api(`/v1/players/${params.slug}/profile`, { signal })]).catch(() => [null, null]);
  if (!pr) return;
  if (!pr.data) { render(root, html`<div class="page">${emptyModule(pr.meta, 'This player is not in the canonical store.')}</div>`); return; }
  const p = pr.data;
  const f = prof?.data || null;
  track(params.tab === 'dna' ? 'tennis_dna_open' : 'tennis_player_open', { player_id: p.id });
  document.title = `${p.name} — ${params.tab === 'dna' ? 'Tennis DNA' : 'Profile, Rankings, Match DNA & Matches'} | PropBetEdge Tennis`;
  // same rule as the tennis-web head: indexable once the player has a ranking or stored matches (overview only)
  if (!params.tab) setIndexable(!!(p.rankings?.wta_singles || p.rankings?.atp_singles || p.recent_matches?.length));
  if (params.tab === 'dna' || params.tab === 'surfaces') {
    const dr = await api(`/v1/players/${params.slug}/dna`, { signal }).catch(() => null);
    if (resultState(dr) === 'error') { render(root, html`${playerHero(p, pr.meta, 'dna')}<div class="page">${errorModule(dr?.meta, 'Tennis DNA could not be loaded.')}</div>`); return; }
    const d = dr?.data?.dna;
    const md = dr?.data?.match_dna;
    render(root, html`${playerHero(p, pr.meta, 'dna', md)}<div class="page" style="padding-top:0">
      ${md ? html`<p class="dna-status"><b>MATCH DNA — LIVE.</b> Built from ${md.sample.matches} singles results in the canonical match record (${md.tour} population, as of ${fmtDate(md.as_of)}). Each metric publishes its ${md.tour} comparison on its own once ${md.gates.comparative_min} players qualify. <b>TECHNICAL DNA — ${d?.comparative?.published ? 'PUBLISHED' : 'COVERAGE BUILDING'}</b>: serve/return numbers exist only where detailed match statistics were published.</p>
        ${md.rating ? html`<section class="mod"><header class="mod-h"><h2>PBE Rating</h2><span class="mod-k">chronological Elo · method v${md.rating.method_version}</span></header><div class="mod-b"><p class="ph-rating">${ratingLine(md.rating)}</p><p class="note">Pre-match ratings only ever use earlier results; validated against a ranking model out of sample before publication (see methodology).</p>
          ${md.rating.status !== 'not_validated' && md.profile?.rating_history ? html`<h3 class="sub-h">Rating history</h3>${ratingChart(md.profile.rating_history)}<p class="note">${md.profile_definitions?.rating_history || ''}.</p>` : ''}</div></section>` : ''}
        ${profileBlock(md.profile, md.profile_definitions, md.as_of)}
        <section class="mod"><header class="mod-h"><h2>Form</h2><span class="mod-k">as of ${fmtDate(md.as_of)}</span></header><div class="mod-b">${formBlock(md.form)}</div></section>
        ${md.families.map((f) => familyTable(f, md.tour))}
        ${surfaceTable(md)}
        ${surfaceHistorySection(md)}` : ''}
      <h2 class="sec">Technical DNA <small>serve · return · pressure from match statistics</small></h2>
      ${d ? dnaSection(d) : html`<p class="dna-status" data-tech-status="unavailable"><b>Technical serve/return DNA is still building</b> for ${p.name}: it needs matches with published serve/return statistics.${md ? ' Match DNA above is complete and unaffected.' : ''}</p>`}
      ${Object.keys(dr.data.surfaces || {}).length ? html`<section class="mod"><header class="mod-h"><h2>Surface profile</h2></header><div class="surfrec">${Object.entries(dr.data.surfaces).map(([s, x]) => html`<div class="${s}"><span>${s}</span>${x.metrics.hold_rate?.value != null ? html`<b>${pct(x.metrics.hold_rate.value)}</b><small class="note">hold · ${x.matches_considered} matches</small>` : html`<b class="note">building</b><small class="note">hold rate needs more ${s} matches with serve statistics (${x.matches_considered} so far)</small>`}</div>`)}</div></section>` : ''}
      <p class="note">How every metric is defined: <a href="/methodology">methodology</a>.</p></div>`);
    return;
  }
  const surf = f?.surface_record || {};
  // men's DNA is gated by population size; the gate never hides the rest of the profile
  const dres = await api(`/v1/players/${params.slug}/dna`, { signal }).catch(() => null);
  const dnaGate = dres?.data?.dna || null;
  const md = dres?.data?.match_dna || null;
  render(root, html`${playerHero(p, pr.meta, null, md)}<div class="page" style="padding-top:0">
    ${md ? matchDnaSummary(md, p.slug) : ''}
    ${dnaGate?.comparative && !dnaGate.comparative.published ? html`<p class="note dna-gate"><a href="/players/${p.slug}/dna">Technical DNA →</a> · ${dnaGate.tour} serve/return comparison is still building (${dnaGate.comparative.qualified} of ${dnaGate.comparative.threshold} players with enough match statistics).</p>` : ''}
    ${md ? html`<section class="mod"><header class="mod-h"><h2>Form</h2></header><div class="mod-b">${formBlock(md.form)}${f?.current_tournament ? html`<p class="note" style="margin-top:10px">Current tournament: <a href="/tournaments/${f.current_tournament.slug}/${f.current_tournament.year}">${f.current_tournament.name} ${f.current_tournament.year}</a></p>` : ''}</div></section>` : ''}
    ${md ? careerBlock(md) : ''}
    ${md ? html`<section class="mod"><header class="mod-h"><h2>Surface record</h2><span class="mod-k">singles · where the surface is recorded</span></header><div class="mod-b"><div class="surfrec">${Object.entries(md.surface_record || {}).filter(([k]) => k !== 'unknown').map(([k, r]) => html`<div class="${k}"><span>${k}</span><b>${r.W}–${r.L}</b></div>`)}</div>${md.surface_record?.unknown ? html`<p class="note">${md.surface_record.unknown.W + md.surface_record.unknown.L} matches have no recorded surface (their source does not publish it) and are not assigned one.</p>` : ''}</div></section>` : html`<div class="grid-2">
      <section class="mod"><header class="mod-h"><h2>Recent form</h2><span class="mod-k">last ${f?.form?.length || 0}</span></header><div class="mod-b">${f?.form?.length ? html`<div class="form">${f.form.map((x) => html`<a class="${x.result}" href="/matches/${x.id}" title="${x.result} ${x.score || ''} · ${x.tournament || ''} ${x.year || ''}">${x.result}</a>`)}</div>` : html`<p class="note">No completed singles matches in the store yet — history is backfilling.</p>`}${f?.current_tournament ? html`<p class="note" style="margin-top:10px">Current tournament: <a href="/tournaments/${f.current_tournament.slug}/${f.current_tournament.year}">${f.current_tournament.name} ${f.current_tournament.year}</a></p>` : ''}</div></section>
      <section class="mod"><header class="mod-h"><h2>Surface record</h2></header><div class="mod-b">${Object.keys(surf).length ? html`<div class="surfrec">${Object.entries(surf).map(([s, r]) => html`<div class="${s}"><span>${s}</span><b>${r.W}–${r.L}</b></div>`)}</div><p class="note">Singles matches in the PropBetEdge store (${f.matches_in_store} total, coverage-limited).</p>` : html`<p class="note">No results in the store yet.</p>`}</div></section>
    </div>`}
    <section class="mod"><header class="mod-h"><h2>Ranking history</h2>${p.gender === 'M' ? html`<span class="mod-k">ATP singles · secondary source</span>` : ''}</header><div class="mod-b">${rankSpark(p.ranking_history || [], p.gender === 'M' ? 'atp_singles' : 'wta_singles')}</div></section>
    <section class="mod" data-stories hidden><header class="mod-h"><h2>Tennis intelligence</h2><a class="mod-k" href="/news">Newsroom →</a></header><div data-stories-list></div></section>
    ${md?.recent?.length ? html`<section class="mod"><header class="mod-h"><h2>Match history</h2><span class="mod-k">singles · last ${md.recent.length}</span></header>${historyTable(md)}</section>` : html`<section class="mod"><header class="mod-h"><h2>Recent matches</h2></header><div class="mod-b">${p.recent_matches.length ? matchList(p.recent_matches.slice(0, 12)) : html`<p class="note">No matches stored yet.</p>`}</div></section>`}
    ${f?.top_opponents?.length ? html`<section class="mod"><header class="mod-h"><h2>Head-to-head</h2><span class="mod-k">most-played opponents in the store</span></header><ul class="opp">${f.top_opponents.map((o) => html`<li><a href="/h2h/${p.slug}/${o.slug}">${o.name}</a><b>${o.W}–${o.L}</b></li>`)}</ul></section>` : ''}
    <section class="mod"><header class="mod-h"><h2>Identity</h2></header><div class="mod-b"><p class="note">Canonical id <code>${p.id}</code>. Linked source ids: ${p.external_ids.map((e) => `${e.provider}:${e.id}`).join(' · ')}</p></div></section>
  </div>`);
  fillStories(root, `player=${p.id}`, signal);
});

/** Stories + live-wire items for a player (by canonical id) or a tournament edition (newsroom V3); hidden when neither
 *  exists. Stories are ruled rows (no tile wall); the wire shows the deterministic fact cards for the same filter. */
function fillStories(root, query, signal) {
  Promise.all([api(`/v1/news?${query}&limit=4`, { signal }).catch(() => null), api(`/v1/news/live?${query}&limit=8`, { signal }).catch(() => null)]).then(([r, w]) => {
    const list = r?.data?.articles || [];
    const wire = Array.isArray(w?.data?.items) ? w.data.items : [];
    const box = root.querySelector('[data-stories]');
    const wireHtml = wireList(wire, { limit: 6, more: false });
    if (!box || (!list.length && !wireHtml)) return;
    render(box.querySelector('[data-stories-list]'), html`<div class="nf-int${list.length && wireHtml ? ' two' : ''}">${list.length ? html`<div>${list.map((a) => storyRow(a))}</div>` : ''}${wireHtml ? html`<div><p class="nf-w-day" style="padding-top:0">Live wire</p>${wireHtml}</div>` : ''}</div>`);
    box.hidden = false;
  }).catch(() => {});
}

export const h2h = mountWith((root, { params }, signal) => {
  shell(root, { eyebrow: 'Head-to-head', heading: 'Head-to-Head', lede: 'Descriptive evidence from matches in our store — not a prediction. Older meetings carry their dates; recency matters.' });
  return fill(root, `/v1/h2h/${params.a}/${params.b}`, (d) => {
    const h = root.querySelector('.page-h h1');
    if (h) h.textContent = `${d.a.name} vs ${d.b.name}`;
    return html`<p class="h2h-big tabnum"><span class="h2h-p">${avatar(d.a, { px: 44 })}${d.a.name}</span> <b>${d.record[d.a.slug]}</b> – <b>${d.record[d.b.slug]}</b> <span class="h2h-p">${d.b.name}${avatar(d.b, { px: 44 })}</span></p>${d.meetings.length ? matchList(d.meetings) : html`<p class="note">No meetings in the canonical store yet (history is backfilling).</p>`}`;
  }, 'One of these players is not in the canonical store.', signal);
});

// ---- Tennis DNA hub -----------------------------------------------------------------------------------
const MATCH_METRICS = [['pbe_rating', 'PBE Rating'], ['match_win_rate', 'Match win %'], ['set_win_rate', 'Set win %'], ['game_win_rate', 'Games won %'], ['deciding_set_win_rate', 'Deciding sets'], ['tiebreak_win_rate', 'Tiebreaks'], ['comeback_win_rate', 'Comebacks'], ['top10_win_rate', 'vs top 10'], ['wins_above_expectation', 'Wins above expectation']];
const DNA_METRICS = [['hold_rate', 'Hold rate'], ['service_points_won', 'Service points won'], ['first_serve_won', '1st serve points won'], ['second_serve_won', '2nd serve points won'], ['return_points_won', 'Return points won'], ['return_games_won', 'Break rate'], ['break_points_saved', 'Break points saved'], ['break_points_converted', 'Break points converted'], ['ace_rate', 'Ace rate']];
export const dna = mountWith((root, _c, signal) => {
  const q = new URLSearchParams(location.search);
  const isTech = DNA_METRICS.some(([k]) => k === q.get('metric'));
  // Match DNA (live for both tours) is the default view; technical DNA is opt-in per metric
  const metric = isTech || MATCH_METRICS.some(([k]) => k === q.get('metric')) ? q.get('metric') : 'match_win_rate';
  const isMatch = !isTech;
  const surface = !isMatch && ['hard', 'clay', 'grass'].includes(q.get('surface')) ? q.get('surface') : 'all';
  // ATP and WTA are separate populations (never pooled); no tour param = both tours side by side
  const tour = ['atp', 'wta'].includes(q.get('tour')) ? q.get('tour') : 'both';
  const dnaUrl = (o) => { const x = { metric, surface, tour, ...o }; return `/dna?metric=${x.metric}${x.surface !== 'all' ? `&surface=${x.surface}` : ''}${x.tour !== 'both' ? `&tour=${x.tour}` : ''}`; };
  track('tennis_dna_open', { route: '/dna', surface, tour });
  shell(root, { eyebrow: 'Tennis DNA', heading: 'Tennis DNA', lede: 'ATP and WTA Match DNA from the canonical results record, plus technical serve/return DNA from match statistics where enough of them exist — numerator, denominator, sample and confidence on every number. Leaders include only medium- or high-confidence samples; ATP and WTA are separate populations and are never pooled.', chips: [...MATCH_METRICS.map(([k, l]) => [dnaUrl({ metric: k, surface: 'all' }), l, k === metric]), ...DNA_METRICS.map(([k, l]) => [dnaUrl({ metric: k }), `${l} (technical)`, k === metric])] });
  root.querySelector('.page-h').insertAdjacentHTML('beforeend', String(html`<div class="chips" aria-label="Tour" data-tour-chips>${[['both', 'ATP + WTA'], ['atp', 'ATP'], ['wta', 'WTA']].map(([t, l]) => html`<a class="chip${tour === t ? ' on' : ''}" href="${dnaUrl({ tour: t })}" ${tour === t ? raw('aria-current="true"') : ''}>${l}</a>`)}</div>${isMatch ? '' : html`<div class="chips">${[['all', 'All surfaces'], ['hard', 'Hard'], ['clay', 'Clay'], ['grass', 'Grass']].map(([s, l]) => html`<a class="chip${surface === s ? ' on' : ''}" href="${dnaUrl({ surface: s })}">${l}</a>`)}</div>`}`));
  const val = (r) => (metric === 'pbe_rating' ? r.value : metric === 'wins_above_expectation' ? `${r.value >= 0 ? '+' : ''}${Number(r.value).toFixed(3)}` : pct(r.value));
  const board = (d, t, limit) => {
    const T = t.toUpperCase();
    if (d.published === false) return html`<div class="mod"><p class="empty-h">${T} comparison for this metric is still building.</p><p class="note">This leaderboard opens once ${d.threshold} ${T} players qualify for this metric (currently ${d.qualified})${metric === 'pbe_rating' ? ' and the rating has passed its backtest for this tour' : ''}. Each player's own measurements are already on their Tennis DNA page${isMatch ? '' : ', next to their Match DNA'}. ATP and WTA are separate populations and are never compared.</p></div>`;
    return html`<p class="note">${d.definition} · ${T} singles · as of ${fmtDate(d.as_of)} · ${d.qualified} qualified players</p>
    ${d.rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:44px">#</th><th>Player</th><th class="n" style="width:84px">Value</th><th class="n hide-s" style="width:120px">Sample</th></tr></thead><tbody>${d.rows.slice(0, limit).map((r) => html`<tr><td class="rk-n">${r.rank}</td><td><span class="rk-p">${avatar(r.player, { px: 32 })}<a href="/players/${r.player?.slug}/dna">${r.player?.name}</a></span></td><td class="n">${val(r)}</td><td class="n hide-s">${r.numerator != null && metric !== 'wins_above_expectation' ? `${r.numerator}/${r.denominator} · ` : ''}${r.sample_matches}m</td></tr>`)}</tbody></table></div>` : html`<div class="mod"><p class="empty-h">No ${T} player has a medium-confidence sample for this metric yet.</p><p class="note">Small samples are never ranked.</p></div>`}`;
  };
  const foot = html`<p class="note"><a href="/methodology">Definitions and confidence rules →</a></p>`;
  if (tour !== 'both') return fill(root, `/v1/dna/leaders?metric=${metric}&surface=${surface}&tour=${tour}&limit=50`, (d) => html`${board(d, tour, 50)}${foot}`, 'Tennis DNA unavailable.', signal);
  Promise.all(['atp', 'wta'].map((t) => api(`/v1/dna/leaders?metric=${metric}&surface=${surface}&tour=${t}&limit=25`, { signal }).catch(() => null))).then(([a, w]) => {
    const body = root.querySelector('[data-body]');
    if (!body) return;
    const meta = root.querySelector('[data-meta]');
    if (meta) render(meta, html`${freshnessBadge(a?.meta || w?.meta)} <span>ATP and WTA leaderboards, each within its own tour population</span>`);
    const col = (r, t) => html`<section class="dna-tour" data-dna-tour="${t}"><h2 class="sec">${t.toUpperCase()} <small>singles</small></h2>${!r || resultState(r) === 'error' ? errorModule(r?.meta, `${t.toUpperCase()} Tennis DNA could not be loaded.`) : r.data ? board(r.data, t, 25) : emptyModule(r.meta, `No ${t.toUpperCase()} DNA snapshots stored yet.`)}${r?.data?.rows?.length ? html`<p class="note"><a href="${dnaUrl({ tour: t })}">Full ${t.toUpperCase()} leaderboard →</a></p>` : ''}</section>`;
    render(body, html`<div class="grid-2 dna-tours">${col(a, 'atp')}${col(w, 'wta')}</div>${foot}`);
  }).catch(() => {});
  return () => {};
});

// ---- PBEcast hub --------------------------------------------------------------------------------------
export const pbecastHub = mountWith(async (root, _c, signal) => {
  // Clicking PBEcast enters a live court when one exists (no extra landing click). replaceState keeps the
  // back button honest and never loops; with zero live matches this stays the replay hub.
  render(root, html`<div class="page"><p class="loading">Finding live PBEcast…</p></div>`);
  let live = null;
  try { live = await api('/v1/live', { signal }); } catch { return () => {}; }
  const entry = liveEntry(live?.data || []);
  if (entry.mode === 'live' && location.pathname === '/pbecast') {
    history.replaceState({}, '', entry.path);
    const { mount } = await import('./pbecast.js');
    return mount(root, { params: { id: entry.id }, live: live.data });
  }
  const menBox = () => {
    // outside the polled body so the 60 s refresh never blanks it
    root.querySelector('[data-body]')?.insertAdjacentHTML('afterend', '<section class="mod" data-pbp-replays style="margin-top:18px"><header class="mod-h"><h2>Point-by-point replays</h2></header><p class="loading">Loading…</p></section>');
    api('/v1/slams', { signal }).then((r) => { const el = root.querySelector('[data-pbp-replays]'); if (el && r.data?.replays?.length) render(el, html`<header class="mod-h"><h2>Point-by-point replays</h2><span class="mod-k">${r.data.replay_edition.tournament} ${r.data.replay_edition.year}</span></header>${replayList(r.data.replays)}<p class="note">Every point from the official match feed — reason and score only. <a href="/tournaments/${r.data.replay_edition.slug}/${r.data.replay_edition.year}">All ${r.data.replay_edition.tournament} matches →</a></p>`); else if (el) el.remove(); }).catch(() => {});
  };
  shell(root, { eyebrow: 'PBEcast', heading: 'PBEcast', lede: 'The live analytical court: score, server, key moments, serve and return, Tennis DNA and head-to-head — and replays of completed matches. Observed-live coverage updates about every 18 seconds; point-by-point appears only where a source publishes it.' });
  menBox();
  return fill(root, '/v1/today', (d) => html`<div class="mod"><p class="empty-h">No PBEcast live right now.</p><p class="note">When a covered match goes live, PBEcast opens straight onto its court. <a href="/schedule">See today’s schedule →</a></p></div>
    ${d.latest_results.length ? html`<h2 class="sec">Replays <small>matches finished at tournaments in progress</small></h2>${matchList(d.latest_results.filter((m) => ['completed', 'retired'].includes(m.status)).slice(0, 12))}` : ''}`, 'PBEcast unavailable.', signal, { poll: 60 });
});

// ---- credits + coverage --------------------------------------------------------------------------------
export const credits = mountWith((root, _c, signal) => {
  shell(root, { eyebrow: 'Credits', heading: 'Photo Credits', lede: 'Player photos are shown only when the file’s license is CC0, public domain, CC BY or CC BY-SA and the player’s identity is proven through an exact tour-id match. Every photo, its author and license:' });
  return fill(root, '/v1/credits', (d) => html`<ul class="credits">${d.map((c) => html`<li><div><b><a href="/players/${c.player.slug}">${c.player.name}</a></b><br>${c.author || 'Unknown author'} · ${c.license} · <a href="${c.source_page}" rel="noopener nofollow" target="_blank">source</a></div></li>`)}</ul>`, 'No approved photos yet.', signal);
});

export const coverage = mountWith((root, _c, signal) => {
  shell(root, { eyebrow: 'Internal', heading: 'Data Coverage', lede: 'Historical warehouse depth. Q1 result only · Q2 set/game score · Q3 match statistics · Q4 point-by-point · Q5 point + spatial.' });
  return fill(root, '/v1/coverage', (d) => html`<p class="note">${d.players.toLocaleString('en-US')} players · ${d.approved_photos} approved photos · ${d.dna_snapshots} DNA snapshots · ${d.ranking_snapshots} complete ranking lists</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:56px">Year</th><th>Level</th><th style="width:46px">Evt</th><th class="n">Matches</th><th class="n hide-s">Q1</th><th class="n hide-s">Q2</th><th class="n">Q3</th><th class="n">Q4</th></tr></thead><tbody>${d.by_year.map((r) => html`<tr><td>${r.year}</td><td>${r.level}</td><td>${r.event_type}</td><td class="n">${r.matches}</td><td class="n hide-s">${r.q1}</td><td class="n hide-s">${r.q2}</td><td class="n">${r.q3}</td><td class="n">${r.q4}</td></tr>`)}</tbody></table></div>`, 'Coverage unavailable.', signal);
});
