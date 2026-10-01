// Homepage V2 renderers (src/pages/today.js). Every value comes from a tennis-api payload; a renderer with nothing
// legitimate to show returns '' and the section says why. Styles: src/styles/home.css (all classes .hm-*).

import { html } from '../lib/dom.js';
import { avatar, nat } from './avatar.js';
import { localTime, fmtRange, fmtDuration, roundLabel, eventLabel, statusLabel } from './render.js';
import { scoreGrid } from './score-grid.js';
import { tourTag, tourFamily, tournamentName, roundShort } from '../lib/home.js';

/** Section row: intro column (title, one line, link) + body. `dark` = emerald band. */
export function section({ id, title, sub, link, linkLabel, body, hook = 'body', dark = false, cls = '' }) {
  return html`<section class="hm-sec${dark ? ' hm-dark' : ''} ${cls}" aria-labelledby="${id}"><div class="hm-in">
    <header class="hm-intro"><h2 id="${id}">${title}</h2>${sub ? html`<p>${sub}</p>` : ''}${link ? html`<a class="hm-more" href="${link}">${linkLabel} <span aria-hidden="true">→</span></a>` : ''}</header>
    <div class="hm-body" data-${hook}>${body ?? html`<p class="hm-wait" aria-hidden="true"></p>`}</div>
  </div></section>`;
}

export { rail, wireRails } from './rail.js';

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
const SURFACE = { hard: 'Hard', clay: 'Clay', grass: 'Grass', carpet: 'Carpet' };
const cardStatus = (m) => (m.status === 'scheduled' ? 'Upcoming' : ['completed', 'retired', 'walkover'].includes(m.status) ? 'Final' : statusLabel(m.status));

/**
 * Match card: WHO (avatars, nationality, names) · WHERE (tour, tournament, round, level / surface / court) · WHAT the
 * score is (scoreGrid: aligned set columns + the live point) · WHO serves · where to open PBEcast. Only served fields;
 * a null level / surface / court is simply absent.
 */
export function matchCard(m) {
  const live = m.status === 'in_progress';
  const t = m.tournament;
  const when = m.status === 'scheduled' ? localTime(m.scheduled_at) : null;
  const surf = SURFACE[String(t?.surface || '').toLowerCase()] || null;
  const meta = [t?.level, surf ? `${surf}${t.indoor ? ' · indoor' : ''}` : null, m.court].filter(Boolean);
  const dur = m.status === 'scheduled' ? '' : fmtDuration(m.duration_s);
  return html`<article class="hm-card hm-match${live ? ' is-live' : ''}">
    <header class="hm-mh">
      <p class="hm-mh1">${tag(m.tour)}${t ? html`<a class="hm-mt" href="/tournaments/${t.slug}/${t.year}" title="${tournamentName(t)}">${tournamentName(t)}</a>` : ''}<span class="hm-mr" title="${eventLabel(m.event_type)} · ${roundLabel(m.round)}">${roundShort(m.round)}</span></p>
      <p class="hm-mh2">${[eventLabel(m.event_type), ...meta].join(' · ')}${when ? html` · <b>${when}</b>` : ''}</p>
    </header>
    ${scoreGrid(m)}
    <footer>${live ? html`<span class="hm-pill live"><i class="hm-dot" aria-hidden="true"></i>Live</span>` : html`<span class="hm-pill">${cardStatus(m)}</span>`}${dur ? html`<span class="hm-el tabnum" title="${live ? 'Match time reported by the source at its last update' : 'Match duration'}">${dur}</span>` : ''}<span class="hm-go-wrap">${live ? html`<a class="hm-go hm-go-cast" href="/pbecast/${m.id}">PBEcast <span aria-hidden="true">→</span></a>` : ''}<a class="hm-go" href="/matches/${m.id}">Match <span aria-hidden="true">→</span></a></span></footer>
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

/** One tour's board inside a DNA column: top 3 with its population note, or the held/unavailable panel. */
export function dnaBoard(metric, tour, fmt, b) {
  return html`<p class="hm-dna-k"><span class="hm-tag hm-tag-${tour}">${tour.toUpperCase()}</span>${b.show ? html`<a href="/dna?metric=${metric}&tour=${tour}">Full board →</a>` : ''}</p>
    ${b.show ? html`<ol>${b.rows.slice(0, 3).map((r) => html`<li><span class="hm-dna-r tabnum">${r.rank}</span>${r.player ? avatar(r.player, { px: 32 }) : ''}${r.player?.slug ? html`<a href="/players/${r.player.slug}">${r.player.name}</a>` : html`<span>${r.player?.name || ''}</span>`}<b class="tabnum">${fmt(r.value)}</b></li>`)}</ol>
    <p class="hm-dna-pop">${b.note}</p>` : thresholdPanel(tour, b)}`;
}

export function dnaColumn([metric, title, fmt], boards) {
  return html`<div class="hm-dna-col"><h3>${title}</h3>${boards.map(({ tour, b }) => html`<div class="hm-dna-tour">${dnaBoard(metric, tour, fmt, b)}</div>`)}</div>`;
}

/**
 * Homepage DNA module before any board has answered: the real columns and tour slots with skeleton rows, so the dark
 * band is never an empty block. Each [data-dna-slot="metric:tour"] is replaced independently when its request resolves.
 */
export function dnaColumnsSkeleton(boards) {
  const skel = (tour) => html`<p class="hm-dna-k"><span class="hm-tag hm-tag-${tour}">${tour.toUpperCase()}</span></p><ol class="hm-dna-skel" aria-hidden="true">${[1, 2, 3].map(() => html`<li><i></i><i></i><i></i><i></i></li>`)}</ol><p class="hm-dna-pop">Loading ${tour.toUpperCase()} board…</p>`;
  return html`<div class="hm-dna">${boards.map(([metric, title]) => html`<div class="hm-dna-col"><h3>${title}</h3>${['atp', 'wta'].map((tour) => html`<div class="hm-dna-tour" data-dna-slot="${metric}:${tour}" aria-busy="true">${skel(tour)}</div>`)}</div>`)}</div>
    <p class="hm-note">Singles only, from the canonical match record. <a href="/methodology">Definitions and confidence rules →</a></p>`;
}

/**
 * Rejection-first null state: a held board shows WHY — the served qualified count against the board's own threshold, as
 * a progress bar. The numbers are the API's (leaders payload qualified / threshold); nothing is estimated or projected.
 */
export function thresholdPanel(tour, b) {
  const T = tour.toUpperCase();
  if (b.population == null || !b.threshold) return html`<div class="hm-cal"><p class="hm-cal-k">${T} board unavailable</p><p class="hm-dna-pop">${b.note}</p></div>`;
  const pct = Math.max(0, Math.min(100, Math.round((b.population / b.threshold) * 100)));
  return html`<div class="hm-cal">
    <p class="hm-cal-k"><i aria-hidden="true"></i>Awaiting data threshold</p>
    <div class="hm-cal-bar" role="progressbar" aria-label="${T} players meeting the comparison standard" aria-valuemin="0" aria-valuemax="${b.threshold}" aria-valuenow="${b.population}"><span style="width:${pct}%"></span></div>
    <p class="hm-cal-n"><b class="tabnum">${b.population}</b> of <b class="tabnum">${b.threshold}</b> ${T} players meet the comparison standard</p>
    <p class="hm-cal-why">The board publishes only once ${b.threshold} qualify — never from a partial field.</p>
  </div>`;
}

// ---------------------------------------------------------------- PBEcast

export function pbecastLive(m) {
  const nm = (s) => (m.sides?.[s]?.players || []).map((p) => p.name).join(' / ');
  return html`<a class="hm-cast-live" href="/pbecast/${m.id}"><span class="hm-pill live"><i class="hm-dot" aria-hidden="true"></i>Live</span>
    <b>${nm('A')} <span>v</span> ${nm('B')}</b><span>${[tournamentName(m.tournament), roundLabel(m.round), m.court].filter(Boolean).join(' · ')}</span><em>Watch PBEcast →</em></a>`;
}

export function replayCard(m, edition) {
  const nm = (s) => (m.sides?.[s]?.players || []).map((p) => p.last_name || p.name).join(' / ');
  const sets = m.sets || [];
  const cell = (x, s) => {
    if (x.match_tiebreak && x.tb) return html`<td class="${x.winner === s ? 'w' : ''}">${x.tb[s]}</td>`;
    const tb = x.tb && Math.min(x.tb.A, x.tb.B) === x.tb[s] ? html`<sup>${x.tb[s]}</sup>` : '';
    return html`<td class="${x.winner === s ? 'w' : ''}">${x[s]}${tb}</td>`;
  };
  const row = (s) => html`<tr class="${m.winner_side === s ? 'won' : ''}"><th scope="row">${m.winner_side === s ? html`<i class="hm-win" aria-label="Winner"></i>` : ''}${nm(s)}</th>${sets.map((x) => cell(x, s))}</tr>`;
  return html`<a class="hm-card hm-replay" href="/pbecast/${m.id}">
    <span class="hm-rk-l">${eventLabel(m.event_type)} · ${roundLabel(m.round)}</span>
    ${sets.length ? html`<table class="hm-box tabnum"><caption class="sr">${nm('A')} v ${nm('B')}, ${m.score || ''}</caption>${row('A')}${row('B')}</table>` : html`<b>${nm('A')} v ${nm('B')}</b><span class="tabnum hm-rs">${m.score || ''}</span>`}
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
