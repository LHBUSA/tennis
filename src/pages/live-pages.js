// Data-backed pages: Live, Matches, Tournaments, Tournament, Match Lab, Rankings, Players, Player, H2H.
// Every page: fetch one tennis-api route, render real rows, or state exactly why there are none.

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { emptyModule, freshnessBadge } from '../ui/state.js';
import { matchList, matchCard, tournamentRow, rankingTable, rankSpark, dnaTable, statsCompare, playerHero, eventLabel, roundLabel, fmtRange, fmtDate } from '../ui/render.js';

const shell = (root, { eyebrow, heading, lede = '', chips = null }) => render(root, html`<div class="page">
  <header class="page-h"><p class="eyebrow">${eyebrow}</p><h1>${heading}</h1>${lede ? html`<p class="lede">${lede}</p>` : ''}
  ${chips ? html`<nav class="chips">${chips.map(([h, l, on]) => html`<a class="chip${on ? ' on' : ''}" href="${h}">${l}</a>`)}</nav>` : ''}
  <p class="meta" data-meta></p></header>
  <div data-body><p class="loading">Loading…</p></div></div>`);

async function fill(root, path, draw, note, signal, { poll = 0 } = {}) {
  const run = async () => {
    let res;
    try { res = await api(path, { signal }); } catch { return; }
    const body = root.querySelector('[data-body]');
    const meta = root.querySelector('[data-meta]');
    if (!body) return;
    if (meta) render(meta, html`${freshnessBadge(res.meta)} <span class="sem">${res.meta?.semantics || ''}</span>`);
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

const byStatus = (ms, st) => ms.filter((m) => st.includes(m.status));

export const live = mountWith((root, _c, signal) => {
  shell(root, { eyebrow: 'Live', heading: 'Live Now', lede: 'Matches in progress, with the point score and server exactly as the source last published them. Refreshes every 30 seconds.' });
  return fill(root, '/v1/live', (d) => (d.length ? html`<p class="count">${d.length} match${d.length === 1 ? '' : 'es'} live</p>${matchList(d)}` : html`<div class="empty"><p class="empty-h">No matches in progress right now.</p><p>Covered live today: WTA Tour, WTA 125 and Grand Slam women's events. ATP, Challenger and ITF live data are not yet acquirable.</p></div>`), 'Live data unavailable.', signal, { poll: 30 });
});

export const matches = mountWith((root, _c, signal) => {
  shell(root, { eyebrow: 'Matches', heading: "Today's Matches", lede: 'Every observed match at tournaments in progress today.' });
  return fill(root, '/v1/today', (d) => {
    const all = [...d.live, ...d.upcoming, ...d.latest_results];
    if (!all.length) return null;
    return html`${d.live.length ? html`<h2 class="sec">Live</h2>${matchList(d.live)}` : ''}${d.upcoming.length ? html`<h2 class="sec">Up next</h2>${matchList(d.upcoming)}` : ''}${d.latest_results.length ? html`<h2 class="sec">Latest results</h2>${matchList(d.latest_results)}` : ''}`;
  }, 'No matches at tournaments in progress today.', signal, { poll: 60 });
});

export const tournaments = mountWith((root, _c, signal) => {
  shell(root, { eyebrow: 'Tournaments', heading: 'Tournaments', lede: 'WTA Tour, WTA 125 and Grand Slam editions from the last week through the next two months.' });
  return fill(root, '/v1/tournaments', (d) => (d.length ? html`<div class="trs">${d.map(tournamentRow)}</div>` : null), 'No tournaments stored for this window yet.', signal);
});

export const tournament = mountWith((root, { params }, signal) => {
  shell(root, { eyebrow: `Tournament · ${params.year}`, heading: params.slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) });
  const want = { 'mens-singles': 'MS', 'womens-singles': 'WS', 'mens-doubles': 'MD', 'womens-doubles': 'WD', 'mixed-doubles': 'XD' }[params.event];
  return fill(root, `/v1/tournaments/${params.slug}/${params.year}`, (d) => {
    const h = root.querySelector('.page-h h1');
    if (h && d.edition.tournament) h.textContent = d.edition.tournament;
    const ms = want ? d.matches.filter((m) => m.event_type === want) : d.matches;
    const events = [...new Set(d.matches.map((m) => m.event_type))];
    const order = (r) => { const [st, n] = String(r).split('-'); return (st === 'Q' ? 0 : 100) + ({ Q: 50, S: 60, F: 70 }[n] ?? Number(n) ?? 0); };
    const groups = new Map();
    for (const m of ms.sort((a, b) => order(b.round) - order(a.round))) {
      const k = `${m.event_type}|${m.round}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    return html`<p class="lede">${d.edition.name} · ${fmtRange(d.edition.start_date, d.edition.end_date)}${d.edition.surface ? ` · ${d.edition.surface}` : ''}</p>
      <nav class="chips"><a class="chip${!want ? ' on' : ''}" href="/tournaments/${params.slug}/${params.year}">All</a>${events.map((e) => html`<a class="chip${want === e ? ' on' : ''}" href="/tournaments/${params.slug}/${params.year}/${{ MS: 'mens-singles', WS: 'womens-singles', MD: 'mens-doubles', WD: 'womens-doubles', XD: 'mixed-doubles' }[e]}">${eventLabel(e)}</a>`)}</nav>
      ${ms.length ? [...groups].map(([k, list]) => html`<h2 class="sec">${eventLabel(k.split('|')[0])} · ${roundLabel(k.split('|')[1])}</h2>${matchList(list, { showTournament: false })}`) : html`<p class="note">No matches stored for this event.</p>`}
      <p class="note">Draw positions and bracket lines are not published by our current source for this event; matches are grouped by round as observed.</p>`;
  }, 'This edition is not in the canonical store.', signal, { poll: 120 });
});

export const match = mountWith((root, { params }, signal) => {
  shell(root, { eyebrow: 'Match Lab', heading: 'Match Lab' });
  return fill(root, `/v1/matches/${params.id}`, (m) => {
    const h = root.querySelector('.page-h h1');
    const nm = (s) => (m.sides?.[s]?.players || []).map((p) => p.name).join(' / ');
    if (h) h.textContent = `${nm('A')} vs ${nm('B')}`;
    const stats = statsCompare(m);
    return html`${matchCard(m)}
      <section class="mod"><header class="mod-h"><h2>Match statistics</h2></header><div class="mod-b">${stats || html`<p class="note">${m.stats === 'pending' ? 'Statistics not ingested yet for this match.' : m.stats === 'not_applicable' ? 'Walkover — no match played.' : 'The source publishes no statistics for this match.'}</p>`}</div></section>
      <section class="mod"><header class="mod-h"><h2>Observed changes</h2></header><div class="mod-b">${m.observed_changes?.length ? html`<ul class="chg">${m.observed_changes.map((c) => html`<li><time>${new Date(c.observed_at).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} UTC</time> ${c.kind.replace(/_/g, ' ')}: ${JSON.stringify(c.from_value)} → ${JSON.stringify(c.to_value)}</li>`)}</ul>` : html`<p class="note">No upstream changes recorded since we first observed this match.</p>`}</div></section>
      <section class="mod"><header class="mod-h"><h2>PBE evaluation</h2></header><div class="mod-b"><p class="note">The PBE Tennis model is not trained or validated; no probability is shown. Market: UNAVAILABLE.</p></div></section>
      ${m.sides?.A?.players?.length === 1 && m.sides?.B?.players?.length === 1 ? html`<p><a class="btn ghost" href="/h2h/${m.sides.A.players[0].slug}/${m.sides.B.players[0].slug}">Head-to-head →</a></p>` : ''}`;
  }, 'This match is not in the canonical store.', signal, { poll: 30 });
});

export const rankings = mountWith((root, { params, route }, signal) => {
  const tour = params.tour === 'men' ? 'atp' : 'wta';
  const type = route?.doubles ? 'doubles' : 'singles';
  const chips = [['/rankings/women', 'WTA singles', tour === 'wta' && type === 'singles'], ['/rankings/women/doubles', 'WTA doubles', tour === 'wta' && type === 'doubles'], ['/rankings/men', 'ATP singles', tour === 'atp' && type === 'singles'], ['/rankings/men/doubles', 'ATP doubles', tour === 'atp' && type === 'doubles']];
  shell(root, { eyebrow: 'Rankings', heading: `${tour.toUpperCase()} ${type === 'doubles' ? 'Doubles' : 'Singles'} Rankings`, lede: 'The official list exactly as published, archived weekly so ranking history belongs to PropBetEdge. Movement compares with our previous archived list.', chips });
  return fill(root, `/v1/rankings?tour=${tour}&type=${type}&limit=200`, (d) => html`<p class="count">List dated ${fmtDate(d.ranking_date)} · ${d.total.toLocaleString('en-US')} ranked${d.previous_date ? ` · movement vs ${fmtDate(d.previous_date)}` : ''}</p>${rankingTable(d)}`, tour === 'atp' ? 'ATP rankings are not available: atptour.com refuses automated access and we do not evade it. We are working on another legitimate path.' : 'No complete ranking list archived yet.', signal);
});

export const players = mountWith((root, _c, signal) => {
  shell(root, { eyebrow: 'Players', heading: 'Players', lede: 'One canonical identity per player across every source. Search, or browse by current WTA singles ranking.' });
  const body = () => root.querySelector('[data-body]');
  root.querySelector('.page-h').insertAdjacentHTML('beforeend', '<form class="search" role="search"><label class="sr" for="q">Search players</label><input id="q" name="q" type="search" placeholder="Search players" autocomplete="off" minlength="2" maxlength="60"><button class="btn" type="submit">Search</button></form>');
  root.querySelector('form.search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get('q');
    if (String(q).trim().length < 2) return;
    const res = await api(`/v1/players?q=${encodeURIComponent(q)}`, { signal });
    render(body(), res.data?.length ? html`<ul class="plist">${res.data.map((p) => html`<li><a href="/players/${p.slug}">${p.name}</a> <span class="nat">${p.nationality || ''}</span></li>`)}</ul>` : emptyModule(res.meta, `No player matches “${q}”.`));
  });
  return fill(root, '/v1/players', (d) => html`<p class="count">WTA singles · list dated ${fmtDate(d.ranking_date)}</p>${rankingTable(d)}`, 'No ranking list archived yet.', signal);
});

export const player = mountWith((root, { params }, signal) => {
  shell(root, { eyebrow: 'Player', heading: params.slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) });
  const tab = params.tab || null;
  if (tab === 'dna' || tab === 'surfaces') {
    return fill(root, `/v1/players/${params.slug}/dna`, (d, meta) => html`
      <p class="lede"><a href="/players/${params.slug}">← ${d.player.name}</a> · Tennis DNA v${d.definition_version} (singles), as of ${fmtDate(d.as_of)} (exclusive) · ${d.matches_considered} matches considered</p>
      ${dnaTable(d)}
      <p class="note">${meta?.degraded?.join(' ') || ''} Definitions: <a href="/methodology">methodology</a>.</p>`, 'No Tennis DNA yet.', signal);
  }
  return fill(root, `/v1/players/${params.slug}`, (p, meta) => {
    const h = root.querySelector('.page-h');
    if (h) h.remove();
    const hist = p.ranking_history || [];
    return html`${playerHero(p, meta)}
      <nav class="chips"><a class="chip on" href="/players/${p.slug}">Overview</a><a class="chip" href="/players/${p.slug}/dna">Tennis DNA</a></nav>
      <section class="mod"><header class="mod-h"><h2>Ranking history</h2></header><div class="mod-b">${rankSpark(hist, p.gender === 'M' ? 'atp_singles' : 'wta_singles')}</div></section>
      <section class="mod"><header class="mod-h"><h2>Recent matches</h2></header><div class="mod-b">${p.recent_matches.length ? matchList(p.recent_matches) : html`<p class="note">No matches stored yet — history is backfilling from January 2025.</p>`}</div></section>
      <section class="mod"><header class="mod-h"><h2>Identity</h2></header><div class="mod-b"><p class="note">Canonical id <code>${p.id}</code>. Linked source ids: ${p.external_ids.map((e) => `${e.provider}:${e.id}`).join(' · ')}</p></div></section>`;
  }, 'This player is not in the canonical store.', signal);
});

export const h2h = mountWith((root, { params }, signal) => {
  shell(root, { eyebrow: 'H2H Lab', heading: 'Head-to-Head', lede: 'Descriptive evidence from matches in our store — not the PBE prediction. Older meetings are shown with their dates; recency matters.' });
  return fill(root, `/v1/h2h/${params.a}/${params.b}`, (d) => {
    const h = root.querySelector('.page-h h1');
    if (h) h.textContent = `${d.a.name} vs ${d.b.name}`;
    return html`<p class="count">Record in stored matches: ${d.a.name} ${d.record[d.a.slug]} – ${d.record[d.b.slug]} ${d.b.name}</p>${d.meetings.length ? matchList(d.meetings) : html`<p class="note">No meetings in the canonical store yet (history backfills from January 2025).</p>`}`;
  }, 'One of these players is not in the canonical store.', signal);
});
