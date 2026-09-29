// Homepage V2 renderers (src/pages/today.js). Every value comes from a tennis-api payload; a renderer with nothing
// legitimate to show returns '' and the section says why. Styles: src/styles/home.css (all classes .hm-*).

import { html, raw } from '../lib/dom.js';
import { avatar, nat } from './avatar.js';
import { localTime, fmtRange, fmtDuration, roundLabel, eventLabel } from './render.js';
import { tourTag, tourFamily, tournamentName, roundShort } from '../lib/home.js';

const ARROW = raw('<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>');

/** Section row: intro column (title, one line, link) + body. `dark` = emerald band. */
export function section({ id, title, sub, link, linkLabel, body, hook = 'body', dark = false, cls = '' }) {
  return html`<section class="hm-sec${dark ? ' hm-dark' : ''} ${cls}" aria-labelledby="${id}"><div class="hm-in">
    <header class="hm-intro"><h2 id="${id}">${title}</h2>${sub ? html`<p>${sub}</p>` : ''}${link ? html`<a class="hm-more" href="${link}">${linkLabel} <span aria-hidden="true">→</span></a>` : ''}</header>
    <div class="hm-body" data-${hook}>${body ?? html`<p class="hm-wait" aria-hidden="true"></p>`}</div>
  </div></section>`;
}

/** Horizontal rail with WORKING previous/next buttons (wired by wireRails; hidden when the rail does not overflow). */
export function rail(items, { label, cls = '' } = {}) {
  if (!items?.length) return '';
  return html`<div class="hm-rail ${cls}" data-rail>
    <div class="hm-track" tabindex="0" role="region" aria-label="${label}">${items}</div>
    <div class="hm-nav" hidden><button type="button" class="hm-arrow prev" data-dir="-1" aria-label="Previous ${label}">${ARROW}</button><button type="button" class="hm-arrow" data-dir="1" aria-label="Next ${label}">${ARROW}</button></div>
  </div>`;
}

/** One delegated listener for every rail; nav visibility + disabled ends follow the real scroll state. */
export function wireRails(root, signal) {
  const sync = (r) => {
    const t = r.querySelector('.hm-track');
    const nav = r.querySelector('.hm-nav');
    if (!t || !nav) return;
    const over = t.scrollWidth - t.clientWidth > 4;
    nav.hidden = !over;
    const [p, n] = nav.querySelectorAll('button');
    p.disabled = t.scrollLeft <= 2;
    n.disabled = t.scrollLeft >= t.scrollWidth - t.clientWidth - 2;
  };
  const all = () => root.querySelectorAll('[data-rail]').forEach(sync);
  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('.hm-arrow');
    if (!b) return;
    const t = b.closest('[data-rail]')?.querySelector('.hm-track');
    if (!t) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    t.scrollBy({ left: Number(b.dataset.dir) * Math.max(240, t.clientWidth * 0.85), behavior: reduce ? 'auto' : 'smooth' });
  }, { signal });
  root.addEventListener('scroll', (e) => { const r = e.target.closest?.('[data-rail]'); if (r) sync(r); }, { capture: true, passive: true, signal });
  addEventListener('resize', all, { signal });
  new MutationObserver(all).observe(root, { childList: true, subtree: true });
  all();
}

// ---------------------------------------------------------------- hero

export function heroMedia(pick) {
  if (!pick) return '';
  const p = pick.player;
  const ph = p.photo;
  return html`<figure class="hm-hero-fig">
    <a class="hm-hero-photo" href="/players/${p.slug}" aria-label="${p.name} — player profile">
      <img src="${ph.portrait}" alt="${p.name}" width="480" height="600" fetchpriority="high" decoding="async">
    </a>
    <figcaption><a href="/players/${p.slug}"><b>${p.name}</b></a>${pick.note ? html`<span>${pick.note}</span>` : ''}<small>Photo: ${ph.credit || 'approved source'}</small></figcaption>
  </figure>`;
}

// ---------------------------------------------------------------- live status bar

export function statusBar(d, groups, next) {
  if (!d) return html`<p class="hm-st-msg">Live data unavailable right now.</p><a class="hm-st-cta" href="/live">View live scores <span aria-hidden="true">→</span></a>`;
  if (groups.length) {
    return html`<p class="hm-st-live"><i class="hm-dot" aria-hidden="true"></i>Live now</p>
      <ul class="hm-st-list">${groups.map((g) => html`<li><a href="${g.href}"><b>${g.name}</b><span>${g.rounds.join(' · ')}</span><em>${g.count} match${g.count === 1 ? '' : 'es'} live</em></a></li>`)}</ul>
      <a class="hm-st-cta" href="/live">View live scores <span aria-hidden="true">→</span></a>`;
  }
  const t = next ? localTime(next.scheduled_at) : null;
  return html`<p class="hm-st-msg"><b>No match live right now</b></p>
    <ul class="hm-st-list"><li><span>${d.tournaments.length} tournament${d.tournaments.length === 1 ? '' : 's'} in progress</span></li>
    ${next && t ? html`<li><a href="/matches/${next.id}"><span>Next match</span><b>${t}</b><em>${tournamentName(next.tournament)}</em></a></li>` : ''}</ul>
    <a class="hm-st-cta" href="/schedule">View today <span aria-hidden="true">→</span></a>`;
}

// ---------------------------------------------------------------- match cards

const tag = (code) => { const t = tourTag(code); return t ? html`<span class="hm-tag hm-tag-${tourFamily(code)}">${t}</span>` : ''; };

function sideRow(m, s) {
  const side = m.sides?.[s];
  const ps = side?.players || [];
  const live = m.status === 'in_progress';
  const won = m.winner_side === s;
  return html`<div class="hm-mside${won ? ' won' : ''}">
    <span class="hm-mav">${ps.map((p) => avatar(p, { px: 30 }))}</span>
    <span class="hm-mnm">${ps.map((p, i) => html`${i ? ' / ' : ''}${p.nationality ? nat(p.nationality) : ''}<a href="/players/${p.slug}">${p.name}</a>`)}${side?.seed ? html` <small>(${side.seed})</small>` : ''}</span>
    ${live || m.sets?.length ? html`<span class="hm-msc tabnum">${(m.sets || []).map((x) => html`<span class="${x.winner === s ? 'w' : ''}">${x.match_tiebreak && x.tb ? x.tb[s] : x[s]}</span>`)}${live && m.live?.point ? html`<span class="pt">${m.live.point[s] ?? ''}</span>` : ''}</span>` : ''}
  </div>`;
}

export function matchCard(m) {
  const live = m.status === 'in_progress';
  const t = m.tournament;
  const when = live ? null : m.status === 'scheduled' ? localTime(m.scheduled_at) : fmtDuration(m.duration_s);
  return html`<article class="hm-card hm-match${live ? ' is-live' : ''}">
    <header>${tag(m.tour)}${t ? html`<a class="hm-mt" href="/tournaments/${t.slug}/${t.year}" title="${tournamentName(t)}">${tournamentName(t)}</a>` : ''}<span class="hm-mr" title="${eventLabel(m.event_type)} · ${roundLabel(m.round)}">${roundShort(m.round)}${when ? html` · ${when}` : ''}</span></header>
    ${sideRow(m, 'A')}${sideRow(m, 'B')}
    <footer><span class="hm-ev">${eventLabel(m.event_type)}</span>${live ? html`<span class="hm-pill live"><i class="hm-dot" aria-hidden="true"></i>Live</span><a class="hm-go" href="/pbecast/${m.id}">PBEcast →</a>` : html`<span class="hm-pill">${m.status === 'scheduled' ? 'Upcoming' : 'Final'}</span>`}<a class="hm-go" href="/matches/${m.id}">Match →</a></footer>
  </article>`;
}

// ---------------------------------------------------------------- tournaments

const SURF = { hard: 'Hard', clay: 'Clay', grass: 'Grass' };
export function tournamentCard(t, { slam = false } = {}) {
  const surf = SURF[String(t.surface || '').toLowerCase()] || null;
  const where = [t.city, t.country].filter(Boolean).join(', ');
  const level = slam ? 'Grand Slam' : t.level || tourTag(t.tour) && (t.tour === 'atp' ? 'ATP Tour' : tourTag(t.tour));
  const count = slam ? Number(t.counts?.total) || 0 : Number(t.matches) || 0;
  return html`<a class="hm-tcard surf-${surf ? surf.toLowerCase() : 'neutral'}${slam ? ' is-slam' : ''}" href="/tournaments/${t.slug}/${t.year}">
    <span class="hm-tart" aria-hidden="true"></span>
    <span class="hm-ttop">${level ? html`<span class="hm-tag hm-tag-${slam ? 'slam' : tourFamily(t.tour)}">${level}</span>` : ''}${t.live_count ? html`<span class="hm-pill live"><i class="hm-dot" aria-hidden="true"></i>Live · ${t.live_count}</span>` : ''}</span>
    <span class="hm-tbot"><b>${tournamentName(t)}${slam ? ` ${t.year}` : ''}</b>
      <span>${fmtRange(t.start_date, t.end_date)}</span>
      <span>${[where, surf ? `${surf}${t.indoor ? ' · indoor' : ''}` : null].filter(Boolean).join(' · ')}</span>
      ${count ? html`<small>${count.toLocaleString('en-US')} ${slam ? 'matches in the archive' : 'matches in our data'}${slam && t.counts?.point_by_point ? ` · ${Number(t.counts.point_by_point).toLocaleString('en-US')} point-by-point` : ''}</small>` : ''}</span>
  </a>`;
}

// ---------------------------------------------------------------- players

export function playerCard(f, i) {
  const p = f.player;
  return html`<a class="hm-pcard" href="/players/${p.slug}">
    <span class="hm-pn tabnum" aria-hidden="true">${i + 1}</span>
    <span class="hm-pimg">${avatar(p, { size: 'square', px: 88 })}</span>
    <b>${p.name}</b>
    <span class="hm-pmeta">${p.nationality ? nat(p.nationality) : ''}${f.rank ? html`<span class="hm-rk hm-tag-${f.tour}">${f.tour === 'atp' ? 'ATP' : 'WTA'} ${f.rank}</span>` : ''}</span>
    <small>${f.note}</small>
  </a>`;
}

// ---------------------------------------------------------------- DNA band

export function dnaColumn([metric, title, fmt], boards) {
  return html`<div class="hm-dna-col"><h3>${title}</h3>${boards.map(({ tour, b }) => html`<div class="hm-dna-tour">
    <p class="hm-dna-k"><span class="hm-tag hm-tag-${tour}">${tour.toUpperCase()}</span>${b.show ? html`<a href="/dna?metric=${metric}&tour=${tour}">Full board →</a>` : html`<b>Comparison building</b>`}</p>
    ${b.show ? html`<ol>${b.rows.slice(0, 3).map((r) => html`<li><span class="hm-dna-r tabnum">${r.rank}</span>${r.player ? avatar(r.player, { px: 32 }) : ''}${r.player?.slug ? html`<a href="/players/${r.player.slug}">${r.player.name}</a>` : html`<span>${r.player?.name || ''}</span>`}<b class="tabnum">${fmt(r.value)}</b></li>`)}</ol>` : ''}
    <p class="hm-dna-pop">${b.note}</p></div>`)}</div>`;
}

// ---------------------------------------------------------------- PBEcast

export function pbecastLive(m) {
  const nm = (s) => (m.sides?.[s]?.players || []).map((p) => p.name).join(' / ');
  return html`<a class="hm-cast-live" href="/pbecast/${m.id}"><span class="hm-pill live"><i class="hm-dot" aria-hidden="true"></i>Live</span>
    <b>${nm('A')} <span>v</span> ${nm('B')}</b><span>${[tournamentName(m.tournament), roundLabel(m.round), m.court].filter(Boolean).join(' · ')}</span><em>Watch PBEcast →</em></a>`;
}

export function replayCard(m, edition) {
  const nm = (s) => (m.sides?.[s]?.players || []).map((p) => p.last_name || p.name).join(' / ');
  const w = m.winner_side;
  return html`<a class="hm-card hm-replay" href="/pbecast/${m.id}">
    <span class="hm-rk-l">${eventLabel(m.event_type)} · ${roundLabel(m.round)}</span>
    <b><span class="${w === 'A' ? 'won' : ''}">${nm('A')}</span> v <span class="${w === 'B' ? 'won' : ''}">${nm('B')}</span></b>
    <span class="tabnum hm-rs">${m.score || ''}</span>
    <small>${edition ? `${tournamentName(edition)} ${edition.year}` : ''}${m.duration_s ? ` · ${fmtDuration(m.duration_s)}` : ''}</small>
    <em>Replay ▸</em></a>`;
}

// ---------------------------------------------------------------- coverage

export function coverageCards(cov) {
  const rows = [
    cov?.atp && ['ATP Tour', cov.atp.source, [cov.atp.tournaments_results, cov.atp.live, cov.atp.rankings]],
    cov?.wta && ['WTA Tour + WTA 125', cov.wta.source, [cov.wta.tournaments_results, cov['wta-125']?.tournaments_results, cov.wta.live, cov.wta.rankings]],
    cov?.['grand-slam'] && ['Grand Slams', cov['grand-slam'].source, [cov['grand-slam'].tournaments_results, 'Australian Open with point-by-point; the Wimbledon archive; Roland-Garros']],
    ['Tennis DNA', 'PropBetEdge, from canonical results and match statistics', ['Results-based Match DNA and PBE Rating for ATP and WTA singles', 'each tour compared only with itself — never pooled']]
  ].filter(Boolean);
  return html`<div class="hm-cov">${rows.map(([h, src, lines]) => html`<div class="hm-cov-c"><h3>${h}</h3><p class="hm-cov-src">${src}</p><ul>${lines.filter(Boolean).map((l) => html`<li>${l}</li>`)}</ul></div>`)}</div>`;
}
