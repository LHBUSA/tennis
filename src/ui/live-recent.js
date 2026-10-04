// Homepage LIVE & RECENT: a full-width tennis scoreboard strip — live matches (live PBEcast + the shared market line)
// followed by recent finals (winner-side result, PBEcast replay only when events are stored, the shared "how the market
// closed" line, official highlights). Market state comes ONLY from the shared Kalshi board (kalshiSlot ->
// paintKalshiLines); nothing is hard-coded here. Styles: src/styles/live-recent.css (.lr-*); the strip scrolls with the
// shared rail behaviour (src/ui/rail.js — arrows only when it overflows, here in the header row).
import { html } from '../lib/dom.js';
import { scoreGrid } from './score-grid.js';
import { railNav } from './rail.js';
import { kalshiSlot, roundLabel, eventLabel } from './render.js';
import { tourTag, tourFamily, tournamentName, roundShort } from '../lib/home.js';
import { orderLive } from '../lib/pbecast-live.js';

const FINAL = new Set(['completed', 'retired']);
const LABEL = 'live and recent matches';
const full = (m, s) => (m.sides?.[s]?.players || []).map((p) => p.name || p.last_name || '').join(' / ');
const winnerScore = (m) => String(m.score || '').split(/\s+/).map((t) => (m.winner_side === 'B' ? t.replace(/^(\d+)-(\d+)/, (_, a, b) => `${b}-${a}`) : t)).join(' ');
const VIDEO = { full_match: 'Full match replay', extended_highlights: 'Extended highlights', match_highlights: 'Highlights', interview: 'Interview' };

/** Section shell: one header row (title, line, All PBEcasts, arrows) above a full-width strip. Rendered before data. */
export function liveRecentSection() {
  return html`<section class="hm-sec lr-sec" aria-labelledby="h-lr"><div class="hm-in lr-in" data-rail>
    <header class="lr-head"><h2 id="h-lr">Live &amp; recent</h2><p>Live courts, recent finals, PBEcast and official highlights.</p><span class="lr-tools"><a class="hm-more" href="/pbecast">All PBEcasts <span aria-hidden="true">→</span></a>${railNav(LABEL)}</span></header>
    <div class="lr-body" data-lrbody><p class="hm-wait lr-wait" aria-hidden="true"></p></div>
  </div></section>`;
}

/** The strip itself (the .hm-track the shared rail wiring scrolls). '' when there is nothing to show. */
export const liveRecentTrack = (items) => (items?.length ? html`<div class="hm-track lr-track" tabindex="0" role="region" aria-label="${LABEL}">${items}</div>` : '');

// tour · tournament on the left, round on the right; all secondary to the result
const meta = (m) => {
  const t = m.tournament;
  const tag = tourTag(m.tour);
  return html`<span class="lr-ev">${tag ? html`<span class="lr-tour lr-tour-${tourFamily(m.tour) || 'x'}">${tag}</span>` : ''}${tag && t ? ' · ' : ''}${t ? tournamentName(t) : ''}</span><span class="lr-rd" title="${eventLabel(m.event_type)} · ${roundLabel(m.round)}">${roundShort(m.round)}</span>`;
};

// One scoreboard system for LIVE and FINAL: two player / team rows from scoreGrid() — approved photos (branded monogram
// otherwise), nationality, seed, set columns with tiebreak notation, the winner bold and the loser muted. Names link to
// the player profiles. A result without structured sets keeps the rows and shows the stored score text beneath.
const PX = 36;
export function liveRecentCard(m, video = null) {
  const fam = tourFamily(m.tour) || '';
  if (m.status === 'in_progress') {
    return html`<article class="hm-card lr-card is-live" data-lr="live" data-tour="${fam}" data-id="${m.id}">
      <p class="lr-meta"><span class="lr-live"><i class="hm-dot" aria-hidden="true"></i>LIVE</span>${meta(m)}</p>
      ${scoreGrid(m, { px: PX })}
      ${kalshiSlot(m, 'hm-kx')}
      <footer class="lr-ft"><a class="hm-go hm-go-cast" href="/pbecast/${m.id}">Live PBEcast <span aria-hidden="true">→</span></a></footer>
    </article>`;
  }
  const w = m.winner_side;
  const l = w === 'A' ? 'B' : 'A';
  const noSets = !(m.sets || []).length;
  return html`<article class="hm-card lr-card" data-lr="final" data-tour="${fam}" data-id="${m.id}" aria-label="${full(m, w)} def. ${full(m, l)} ${winnerScore(m)}">
    <p class="lr-meta">${meta(m)}</p>
    ${scoreGrid(m, { px: PX })}
    ${noSets && m.score ? html`<p class="lr-score"><span class="tabnum">${winnerScore(m).replace(/(\d)-(\d)/g, '$1–$2')}</span></p>` : ''}
    ${m.status === 'retired' ? html`<p class="lr-ret">Retired</p>` : ''}
    <footer class="lr-ft">${m.replay ? html`<a class="hm-go hm-go-cast" href="/pbecast/${m.id}">PBEcast replay <span aria-hidden="true">→</span></a>` : html`<a class="hm-go" href="/matches/${m.id}">Match <span aria-hidden="true">→</span></a>`}${video ? html`<a class="lr-badge lr-video" href="/pbecast/${m.id}#pbc-watch">▶ ${VIDEO[video.best] || 'Video'}</a>` : ''}</footer>
    ${kalshiSlot(m, 'hm-kx')}
  </article>`;
}

/** Live first (deterministic court order), then the latest finals with a winner; walkovers are not "recent finals". */
export function liveRecentItems(today, videos = {}, { finals = 10 } = {}) {
  const live = orderLive(today?.live || []);
  // newest finals, men's and women's events interleaved (the newest rows are often one tour's batch of results)
  const done = (today?.latest_results || []).filter((m) => FINAL.has(m.status) && m.winner_side);
  const men = done.filter((m) => /^M/.test(m.event_type || ''));
  const women = done.filter((m) => /^W/.test(m.event_type || ''));
  const other = done.filter((m) => !/^[MW]/.test(m.event_type || ''));
  const recent = [];
  for (let i = 0; recent.length < finals && (i < men.length || i < women.length || i < other.length); i += 1) for (const g of [women, men, other]) if (g[i] && recent.length < finals) recent.push(g[i]);
  return [...live, ...recent].map((m) => liveRecentCard(m, videos[m.id] || null));
}
