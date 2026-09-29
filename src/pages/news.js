// Tennis newsroom V3 (docs/NEWSROOM_V3.md): a news FRONT PAGE (masthead, desks with current counts, lead + majors,
// live wire, latest intelligence, current tournaments, players moving) and the story page. Stories come from
// tennis-api /v1/news (published only; a ?preview token shows held drafts for internal QA, noindex); the live wire
// from /v1/news/live (deterministic fact cards). Prose sections are rendered as text; data modules and charts are
// rendered from the story's deterministic content plan — no value here is computed or invented in the browser.

import { html, render, raw, setIndexable } from '../lib/dom.js';
import { api } from '../data/api.js';
import { avatar } from '../ui/avatar.js';
import { shareBar } from '../ui/share.js';
import { track } from '../analytics.js';
import { CLASS_LABEL, DESK_LABEL, KIND_LABEL, hierarchy, deskCounts, navDesks, wireRow, glanceCells, readingMinutes, shortName } from '../lib/newsroom.js';

export const DESKS = [['all', 'All'], ['atp', 'ATP'], ['wta', 'WTA'], ['grand-slams', 'Grand Slams'], ['doubles', 'Doubles'], ['rankings', 'Rankings'], ['challenger', 'Challenger'], ['itf', 'ITF']];
const KIND = KIND_LABEL;
const joinH = (xs, sep = ' / ') => html`${xs.map((x, i) => (i ? html`${sep}${x}` : x))}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const ago = (iso, now = Date.now()) => { const s = (now - Date.parse(iso || '')) / 1000; if (!Number.isFinite(s)) return ''; if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return when(iso); };
const previewQ = () => { const p = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('preview'); return p && /^[0-9a-f]{16,64}$/.test(p) ? p : null; };
const withPreview = (path) => (previewQ() ? `${path}${path.includes('?') ? '&' : '?'}preview=${previewQ()}` : path);
const storyHref = (a) => `/news/${a.slug}${previewQ() ? `?preview=${previewQ()}` : ''}`;
const tLabel = (t) => (t?.name ? `${shortName(t.name)}${t.year ? ` ${t.year}` : ''}` : '');

// ---- real imagery only (resolver: workers/shared/editorial.js). No generated graphic is ever a hero or card.
const srcset = (d, names) => names.filter((n) => d?.[n]?.url).map((n) => `${d[n].url} ${n.split('-')[1]}w`).join(', ');
const focalPos = (f, fallback = '50% 22%') => (f ? `${Math.round(f.x * 100)}% ${Math.round(f.y * 100)}%` : fallback);

/** Responsive catalog photo (16:9; 4:3 on phones for the hero). */
export function editorialPicture(img, { hero = false, sizes = '100vw', alt = '' } = {}) {
  const d = img.derivatives || {};
  const src = d['wide-1600']?.url || d['wide-1200']?.url || d['wide-800']?.url;
  const std = srcset(d, ['std-800', 'std-1200']);
  return html`<picture>${hero && std ? html`<source media="(max-width: 700px)" type="image/webp" srcset="${std}" sizes="100vw">` : ''}<img src="${src}" srcset="${srcset(d, ['wide-480', 'wide-800', 'wide-1200', 'wide-1600', 'wide-2400'])}" sizes="${sizes}" width="1600" height="900" alt="${alt || img.caption || ''}" loading="${hero ? 'eager' : 'lazy'}" ${hero ? raw('fetchpriority="high"') : ''} decoding="async" style="object-position:${focalPos(img.focal, '50% 50%')}"></picture>`;
}

/** A real canonical player photo filling its frame (wide crop when the pipeline made one, else portrait). */
function playerImg(p, { eager = false, wideOk = true } = {}) {
  const src = (wideOk && p.wide) || p.portrait || p.square;
  return html`<img src="${src}" alt="${p.name}" width="${wideOk && p.wide ? 1600 : 800}" height="${wideOk && p.wide ? 900 : 1000}" loading="${eager ? 'eager' : 'lazy'}" ${eager ? raw('fetchpriority="high"') : ''} decoding="async" style="object-position:${focalPos(p.focal)}">`;
}

/** The hero/card visual for a resolved hero. Returns '' when there is no real image (callers decide the fallback). */
function heroVisual(h, { hero = false, card = false } = {}) {
  if (!h || !h.images?.length) return '';
  if (h.type === 'portrait') {
    const ps = h.images;
    if (ps.length === 1) return html`<div class="nwm-ph one${ps[0].wide ? ' wide' : ''}">${playerImg(ps[0], { eager: hero })}</div>`;
    return html`<div class="nwm-ph duo">${ps.map((p) => html`<div>${playerImg(p, { eager: hero, wideOk: false })}</div>`)}</div>`;
  }
  return html`<div class="nwm-ph">${editorialPicture(h.images[0], { hero, sizes: card ? '(max-width: 700px) 100vw, 520px' : '(max-width: 1100px) 100vw, 760px' })}</div>`;
}

function heroCaption(h) {
  if (!h?.images?.length) return '';
  const cr = (i) => (i.source_page ? html`<a href="${i.source_page}" rel="noopener nofollow" target="_blank">${i.author || 'Author'} / ${i.license}</a>` : html`${i.credit || ''}`);
  if (h.type === 'portrait') return html`${h.images.map((i, k) => html`${k ? ' · ' : ''}<b>${i.name}</b> — photo: ${cr(i)}`)}`;
  const i = h.images[0];
  return html`${i.caption}. Photo: ${cr(i)}`;
}

/** Restrained branded treatment (brand mark + story type + tournament) — typography, never an illustration. */
function brandArt(a, cls = '') {
  return html`<div class="nf-brand-art ${cls}"><img src="/brand/pbe-mark-80.webp" width="110" height="60" alt="" loading="lazy"><span>TENNIS · ${(KIND[a.story_type] || 'Story').toUpperCase()}</span>${a.tournament?.name ? html`<b>${tLabel(a.tournament)}</b>` : ''}</div>`;
}

/** Card visual: real photo, else the branded treatment. */
function cardArt(a, lead) {
  const v = heroVisual(a.media?.hero, { hero: lead, card: true });
  if (v) return html`<div class="nwx-thumb">${v}</div>`;
  return html`<div class="nwx-thumb nwm-brand">${brandArt(a)}</div>`;
}

const who = (a) => (a.team && a.team.length ? a.team : a.player ? [a.player] : []);
const kicker = (a) => html`${a.story_class && CLASS_LABEL[a.story_class] ? html`<span class="nf-cls nf-cls-${a.story_class}">${CLASS_LABEL[a.story_class]}</span>` : ''}<span class="nf-kind">${KIND[a.story_type] || 'Story'}</span>${a.tournament?.name ? html`<span class="nf-ev">${tLabel(a.tournament)}</span>` : ''}${a.status && a.status !== 'published' ? html` <b class="nw-held">HELD: ${a.hold_reason || ''}</b>` : ''}`;

/** Research links for a story (only links that resolve from the card itself). */
function researchLinks(a) {
  const out = [];
  if (a.match_id) out.push(html`<a href="/matches/${a.match_id}">Match →</a>`);
  const ps = who(a).slice(0, 2).filter((p) => p.slug);
  const lasts = ps.map((p) => p.name.split(' ').pop());
  // surnames only when they tell the players apart (sisters / namesakes get full names)
  ps.forEach((p, i) => out.push(html`<a href="/players/${p.slug}/dna">${new Set(lasts).size === lasts.length ? lasts[i] : p.name} DNA →</a>`));
  if (a.tournament?.slug && a.tournament?.year) out.push(html`<a href="/tournaments/${a.tournament.slug}/${a.tournament.year}">Tournament →</a>`);
  return out.length ? html`<p class="nf-research">${out}</p>` : '';
}

/** Legacy card (still used by callers that want a boxed tile). */
export function card(a, lead = false) {
  const names = who(a).map((p) => p.name).join(' / ');
  return html`<article class="nw-card nwx-card${lead ? ' nw-lead' : ''}">
    <a class="nw-card-a" href="${storyHref(a)}">
      ${cardArt(a, lead)}
      <div class="nw-card-t">
        <p class="nw-kick nf-kick">${kicker(a)}</p>
        <h2>${a.headline}</h2>
        ${a.dek ? html`<p class="nw-dek">${a.dek}</p>` : ''}
        <p class="nw-meta">${names ? html`<span class="nw-who">${names}</span>` : ''}<time datetime="${a.published_at || a.updated_at}">${when(a.published_at || a.updated_at)}</time></p>
      </div>
    </a></article>`;
}

/** LEAD story: large real image, class, tournament, headline, deck, players, time, research links. */
export function leadStory(a) {
  const v = heroVisual(a.media?.hero, { hero: true, card: true });
  const names = who(a).map((p) => p.name).join(' / ');
  return html`<article class="nf-lead">
    <a class="nf-lead-img" href="${storyHref(a)}" tabindex="-1" aria-hidden="true">${v || brandArt(a, 'lg')}</a>
    <div class="nf-lead-t">
      <p class="nf-kick">${kicker(a)}</p>
      <h2><a href="${storyHref(a)}">${a.headline}</a></h2>
      ${a.dek ? html`<p class="nf-dek">${a.dek}</p>` : ''}
      <p class="nf-meta">${names ? html`<span>${names}</span>` : ''}<time datetime="${a.published_at || a.updated_at}">${ago(a.published_at || a.updated_at)}</time></p>
      ${researchLinks(a)}
    </div></article>`;
}

/** MAJOR story: smaller scale, text-led with a small photo. */
function majorStory(a, withImg = true) {
  const v = withImg ? heroVisual(a.media?.hero, { card: true }) : '';
  return html`<article class="nf-major${v ? ' has-img' : ''}">
    ${v ? html`<a class="nf-major-img" href="${storyHref(a)}" tabindex="-1" aria-hidden="true">${v}</a>` : ''}
    <div><p class="nf-kick">${kicker(a)}</p><h3><a href="${storyHref(a)}">${a.headline}</a></h3>
    <p class="nf-meta"><time datetime="${a.published_at || a.updated_at}">${ago(a.published_at || a.updated_at)}</time></p></div></article>`;
}

/** Compact story row (latest intelligence, player/tournament integrations). */
export function storyRow(a) {
  const names = who(a).map((p) => p.name).join(' / ');
  return html`<article class="nf-row"><p class="nf-kick">${kicker(a)}</p><h3><a href="${storyHref(a)}">${a.headline}</a></h3>
    ${a.dek ? html`<p class="nf-row-dek">${a.dek}</p>` : ''}<p class="nf-meta">${names ? html`<span>${names}</span>` : ''}<time datetime="${a.published_at || a.updated_at}">${when(a.published_at || a.updated_at)}</time></p></article>`;
}

/** Medium feature: the one larger treatment inside Latest intelligence. */
function featureStory(a) {
  const v = heroVisual(a.media?.hero, { card: true });
  return html`<article class="nf-feature${v ? '' : ' no-img'}">${v ? html`<a class="nf-feature-img" href="${storyHref(a)}" tabindex="-1" aria-hidden="true">${v}</a>` : ''}
    <div><p class="nf-kick">${kicker(a)}</p><h3><a href="${storyHref(a)}">${a.headline}</a></h3>${a.dek ? html`<p class="nf-row-dek">${a.dek}</p>` : ''}
    <p class="nf-meta"><time datetime="${a.published_at || a.updated_at}">${when(a.published_at || a.updated_at)}</time></p>${researchLinks(a)}</div></article>`;
}

/** Live-wire list: compact chronological rows with day separators. Returns '' when there is nothing to show. */
export function wireList(items, { limit = 14, more = true } = {}) {
  const all = (items || []).map((w) => wireRow(w)).filter(Boolean);
  // without a reveal button, rows beyond the limit are not rendered at all
  const rows = more ? all : all.slice(0, limit);
  if (!rows.length) return '';
  let lastDay = null;
  const li = (r, i) => {
    const sep = r.day && r.day !== lastDay ? ((lastDay = r.day), html`<li class="nf-w-day${i >= limit ? ' nf-w-more' : ''}" aria-hidden="true"${i >= limit ? raw(' hidden') : ''}>${r.day}</li>`) : '';
    return html`${sep}<li class="nf-w${i >= limit ? ' nf-w-more' : ''}"${i >= limit ? raw(' hidden') : ''}><time class="nf-w-t" datetime="${r.iso || ''}">${r.time}</time>
      <div class="nf-w-b"><p class="nf-w-ev">${r.label}${r.kind ? html`<span> · ${r.kind}</span>` : ''}${r.story ? html`<span class="nf-w-story"> · Story</span>` : ''}</p>
      <p class="nf-w-h">${r.links[0]?.rel === 'article' ? html`<a href="${r.links[0].href}">${r.headline}</a>` : r.headline}</p>
      ${r.summary ? html`<p class="nf-w-s">${r.summary}</p>` : ''}
      ${r.links.length ? html`<p class="nf-w-l">${r.links.map((l) => html`<a href="${l.href}">${l.label} →</a>`)}</p>` : ''}</div></li>`;
  };
  return html`<ol class="nf-wire-list">${rows.map(li)}</ol>${more && rows.length > limit ? html`<button type="button" class="nf-w-btn" data-wire-more>Show ${rows.length - limit} more</button>` : ''}`;
}

/** Winner-oriented score from served sets ("7-6(5) 6-4"; match tiebreak in brackets); null when not provable. */
export function winnerScore(m) {
  const W = m?.winner_side;
  if (!W || !Array.isArray(m.sets) || !m.sets.length) return null;
  const L = W === 'A' ? 'B' : 'A';
  return m.sets.map((x) => (x.match_tiebreak && x.tb ? `[${x.tb[W]}-${x.tb[L]}]` : `${x[W]}-${x[L]}${!x.match_tiebreak && x.tb ? `(${Math.min(x.tb.A, x.tb.B)})` : ''}`)).join(' ') + (m.status === 'retired' ? ' ret.' : '');
}

/** Deterministic result rows from /v1/today when the live wire is unavailable (labelled "Latest results"). The match
 *  END time is not in the payload, so rows carry day precision only (shown as FINAL), never a batch timestamp. */
function resultRows(results, tourOf) {
  return (results || []).filter((m) => ['completed', 'retired', 'walkover'].includes(m.status) && m.winner_side).slice(0, 12).map((m) => {
    const W = m.sides?.[m.winner_side]?.players || [];
    const L = m.sides?.[m.winner_side === 'A' ? 'B' : 'A']?.players || [];
    const nm = (ps) => ps.map((p) => p.name).join(' / ');
    if (!W.length || !L.length) return null;
    const t = m.tournament || {};
    const tour = tourOf({ tour: m.tour || t.tour });
    const score = m.status === 'walkover' ? null : winnerScore(m);
    return { id: m.id, headline: m.status === 'walkover' ? `${nm(W)} advances by walkover against ${nm(L)}` : `${nm(W)} defeats ${nm(L)}${score ? ` ${score}` : ''}`, tour, desk: tour, tournament: { name: t.name, slug: t.slug, year: t.year }, day_only: true, occurred_at: m.scheduled_at || null, match_id: m.id, players: W, kind: 'result' };
  }).filter(Boolean);
}

const deskHref = (k) => `${k === 'all' ? '/news' : `/news/${k}`}${previewQ() ? `?preview=${previewQ()}` : ''}`;

/** Current tournaments (real /v1/today data): live / stored counts, latest significant result, links. */
function tournamentsModule(today, deskTour) {
  const eds = (today?.tournaments || []).filter((t) => !deskTour || t.tour === deskTour || t.tour === 'grand-slam');
  if (!eds.length) return '';
  const live = today?.live || [];
  const res = today?.latest_results || [];
  const same = (m, t) => m.tournament?.slug === t.slug && m.tournament?.year === t.year;
  const latest = (t) => { const m = res.find((x) => same(x, t) && ['MS', 'WS'].includes(x.event_type) && x.winner_side) || res.find((x) => same(x, t) && x.winner_side); if (!m) return null; const W = m.sides[m.winner_side]?.players || []; const L = m.sides[m.winner_side === 'A' ? 'B' : 'A']?.players || []; return `${W.map((p) => p.name).join(' / ')} d. ${L.map((p) => p.name).join(' / ')} ${m.status === 'walkover' ? '(walkover)' : winnerScore(m) || ''}`.trim(); };
  const tour = (t) => ({ atp: 'ATP', wta: 'WTA', 'wta-125': 'WTA 125', 'grand-slam': 'Grand Slam' })[t.tour] || '';
  return html`<section class="nf-mod" aria-labelledby="nf-tr-h"><header class="nf-sec"><h2 id="nf-tr-h">Current tournaments</h2><a href="/tournaments">All tournaments →</a></header>
    <ul class="nf-trs">${eds.slice(0, 6).map((t) => { const n = live.filter((m) => same(m, t)).length; const l = latest(t); return html`<li>
      <p class="nf-tr-h"><a href="/tournaments/${t.slug}/${t.year}">${shortName(t.name)}</a><span>${[tour(t), t.level && !/^wta 125$/i.test(t.level) ? t.level : null, t.city].filter(Boolean).join(' · ')}</span></p>
      <p class="nf-tr-c">${n ? html`<b class="nf-live">${n} live</b> · ` : ''}${t.matches ? `${t.matches} matches in our record` : ''}</p>
      ${l ? html`<p class="nf-tr-l">Latest: ${l}</p>` : ''}
      <p class="nf-tr-a"><a href="/tournaments/${t.slug}/${t.year}">Tournament →</a> <a href="/schedule">Schedule →</a></p></li>`; })}</ul></section>`;
}

/** Players moving: PBE Rating risers (only where the tour's rating is published) + ranking moves from the wire. */
function moversModule(ptw, wire, deskTour) {
  const rows = [];
  for (const tour of ['ATP', 'WTA']) {
    if (deskTour && deskTour !== tour.toLowerCase()) continue;
    const t = ptw?.tours?.[tour];
    if (!t?.rating_published) continue;
    for (const r of (t.biggest_30d_change?.risers || []).slice(0, 3)) if (r.player?.slug) rows.push({ p: r.player, tour, what: `+${r.change} PBE Rating in 30 days`, ctx: `${r.rating}${r.rank?.rank ? ` · No. ${r.rank.rank}` : ''} · ${r.matches_30d} matches`, href: `/players/${r.player.slug}/dna` });
  }
  const ranking = (wire || []).filter((w) => /^(new_no1|enters_top)/.test(w.kind || '') && (!deskTour || w.tour === deskTour)).slice(0, 3);
  if (!rows.length && !ranking.length) return '';
  return html`<section class="nf-mod" aria-labelledby="nf-mv-h"><header class="nf-sec"><h2 id="nf-mv-h">Players moving</h2><a href="/players-to-watch">Players to watch →</a></header>
    ${ranking.length ? html`<ul class="nf-mv">${ranking.map((w) => { const r = wireRow(w); return html`<li><div><p class="nf-mv-k">${r.kind || 'Ranking'}</p><p class="nf-mv-h">${r.headline}</p></div>${r.links[0] ? html`<a href="${r.links[0].href}">${r.links[0].label} →</a>` : ''}</li>`; })}</ul>` : ''}
    ${rows.length ? html`<ul class="nf-mv">${rows.map((x) => html`<li>${avatar(x.p, { px: 40 })}<div><p class="nf-mv-k">${x.tour} · PBE Rating</p><p class="nf-mv-h"><a href="${x.href}">${x.p.name}</a> <b>${x.what}</b></p><p class="nf-mv-c">${x.ctx}</p></div><a href="${x.href}">DNA →</a></li>`)}</ul>
    <p class="nf-note">Rating movement from the PBE Rating (chronological Elo, published per tour after out-of-sample validation). Ranking moves come from the lists we archive; the ATP list is secondary-source.</p>` : ''}</section>`;
}

export function hub(root, ctx) {
  const ctl = new AbortController();
  const desk = ctx?.params?.desk || 'all';
  const deskTour = ['atp', 'wta'].includes(desk) ? desk : null;
  track('tennis_news_open', { route: location.pathname });
  const dateLine = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  render(root, html`<div class="nf">
    <header class="nf-mast"><div class="page nf-mast-in">
      <p class="nf-brand"><a href="/news">PropBetEdge Tennis <span>Newsroom</span></a></p>
      <p class="nf-date"><time>${dateLine}</time> <span data-updated></span></p></div>
      <div class="page"><nav class="nf-desks" aria-label="Desks" data-desks>${DESKS.filter(([k]) => !['itf', 'challenger'].includes(k)).map(([k, l]) => html`<a href="${deskHref(k)}" ${k === desk ? raw('aria-current="page"') : ''}>${l}</a>`)}</nav></div></header>
    <div class="page nf-body" data-body><p class="loading">Loading the newsroom…</p></div></div>`);
  const Q = (p) => api(withPreview(p), { signal: ctl.signal }).catch(() => null);
  Promise.all([Q('/v1/news?limit=60'), Q('/v1/news/live?limit=80'), Q('/v1/today'), Q('/v1/players-to-watch')]).then(([nr, lr, tr, pr]) => {
    const body = root.querySelector('[data-body]');
    if (!body) return;
    const all = nr?.data?.articles || [];
    const wireAll = Array.isArray(lr?.data?.items) ? lr.data.items : [];
    const today = tr?.data || null;
    const tourOf = (t) => (t?.tour === 'atp' || t?.tour === 'wta' ? t.tour : null);
    const counts = deskCounts(all, wireAll);
    const nav = root.querySelector('[data-desks]');
    if (nav) render(nav, html`${navDesks(counts).map((d) => html`<a href="${deskHref(d.key)}" class="${d.empty ? 'is-empty' : ''}" ${d.key === desk ? raw('aria-current="page"') : ''}>${d.label}${d.count ? html`<small>${d.count}</small>` : ''}</a>`)}`);
    const inDesk = (x) => desk === 'all' || x.desk === desk;
    const stories = all.filter(inDesk);
    const wire = wireAll.filter(inDesk);
    const fallbackWire = !wire.length && ['all', 'atp', 'wta'].includes(desk) ? resultRows(today?.latest_results, tourOf).filter((w) => desk === 'all' || w.tour === desk) : [];
    const latestAt = [stories[0]?.published_at, wire[0]?.detected_at].filter(Boolean).sort().at(-1);
    const upd = root.querySelector('[data-updated]');
    if (upd && latestAt) upd.textContent = `· Updated ${ago(latestAt)}`;
    const { lead, majors, rest } = hierarchy(stories);
    const [feature, ...rows] = rest;
    const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
    const wireBlock = wire.length ? wireList(wire, { limit: narrow ? 8 : 14 }) : fallbackWire.length ? wireList(fallbackWire, { limit: narrow ? 6 : 10 }) : '';
    const wireTitle = wire.length ? 'Live tennis wire' : 'Latest results';
    const wireNote = wire.length ? 'Facts as our data records them, newest first: results, upsets, titles, ranking moves. Stories link where one is published.' : 'Completed matches from our canonical record, newest first.';
    render(body, html`
      ${lead ? html`<section class="nf-top" aria-label="Top stories"><div class="nf-top-lead">${leadStory(lead)}</div>${majors.length ? html`<div class="nf-top-majors">${majors.map((a, i) => majorStory(a, i === 0 && heroKey(a) !== heroKey(lead)))}</div>` : ''}</section>` : ''}
      ${wireBlock ? html`<section class="nf-wire" aria-labelledby="nf-wire-h"><header class="nf-sec"><h2 id="nf-wire-h"><i class="nf-pulse" aria-hidden="true"></i>${wireTitle}</h2><span>${wireNote}</span></header>${wireBlock}</section>` : ''}
      ${feature ? html`<section class="nf-latest" aria-labelledby="nf-lat-h"><header class="nf-sec"><h2 id="nf-lat-h">Latest intelligence</h2>${desk !== 'all' ? html`<a href="/news">All tennis news →</a>` : ''}</header>${featureStory(feature)}${rows.length ? html`<div class="nf-rows">${rows.map((a, i) => (i < ROWS_SHOWN ? storyRow(a) : html`<div class="nf-row-more" hidden>${storyRow(a)}</div>`))}</div>${rows.length > ROWS_SHOWN ? html`<button type="button" class="nf-w-btn" data-rows-more>Show ${rows.length - ROWS_SHOWN} more stories</button>` : ''}` : ''}</section>` : ''}
      ${!lead && !wireBlock ? html`<section class="nf-mod nf-empty"><p class="empty-h">Nothing on the ${DESK_LABEL[desk] || desk} desk right now.</p><p class="nf-note">Stories and wire items appear only when a real event in our data passes every factual check. ${res0(nr)}</p><p class="nf-research"><a href="/news">All tennis news →</a> <a href="/schedule">Today’s schedule →</a> <a href="/rankings">Rankings →</a></p></section>` : ''}
      <div class="nf-band">${tournamentsModule(today, deskTour)}${moversModule(pr?.data, wireAll, deskTour)}</div>`);
    body.querySelector('[data-rows-more]')?.addEventListener('click', (e) => { body.querySelectorAll('.nf-row-more').forEach((x) => { x.hidden = false; }); e.currentTarget.remove(); });
    body.querySelector('[data-wire-more]')?.addEventListener('click', (e) => { body.querySelectorAll('.nf-w-more').forEach((x) => { x.hidden = false; }); e.currentTarget.remove(); });
  }).catch(() => {});
  return () => ctl.abort();
}
const ROWS_SHOWN = 10;
/** Identity of a card's hero image (so a major never repeats the lead's photo right below it). */
const heroKey = (a) => { const i = a?.media?.hero?.images?.[0]; return i ? i.player_id || i.square || i.id || i.caption || JSON.stringify(i).slice(0, 80) : null; };
const res0 = (r) => (r?.meta?.semantics ? `${r.meta.semantics}.` : '');

// ---- charts: rendered from plan specs only ---------------------------------------------------------------
function groupedBar(c) {
  const max = c.max || Math.max(1, ...c.series.flatMap((r) => c.value_keys.map((k) => Number(r[k]) || 0)));
  const fmt = (v) => (v == null ? '—' : c.unit === '%' ? `${v}%` : String(v));
  return html`<figure class="nw-chart" aria-label="${c.title}">
    <figcaption><b>${c.title}</b>${c.legend ? html`<span class="nw-leg">${c.legend.map((l, i) => html`<i class="k${i}"></i>${l}`)}</span>` : ''}</figcaption>
    ${c.series.map((r) => html`<div class="nw-row"><span class="nw-rl">${r[c.label_key]}${r.tb ? html` <small>TB ${r.tb}</small>` : ''}</span>
      <div class="nw-bars">${c.value_keys.map((k, i) => html`<div class="nw-bar"><span class="k${i}" style="width:${Math.max(0, Math.min(100, ((Number(r[k]) || 0) / max) * 100))}%"></span><em>${fmt(r[k])}${r[`${k}_n`] ? html` <small>${r[`${k}_n`]}</small>` : ''}</em></div>`)}</div></div>`)}
    ${c.source ? html`<p class="nw-src">Source: ${c.source}${c.note ? ` · ${c.note}` : ''}</p>` : ''}</figure>`;
}
function lineChart(c) {
  const vals = c.series.map((r) => Number(r[c.value_keys[0]]));
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const W = 600; const H = 180; const pad = 24;
  const x = (i) => pad + (i * (W - 2 * pad)) / Math.max(1, vals.length - 1);
  const y = (v) => (hi === lo ? H / 2 : c.invert ? pad + ((v - lo) / (hi - lo)) * (H - 2 * pad) : H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad));
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return html`<figure class="nw-chart" aria-label="${c.title}"><figcaption><b>${c.title}</b></figcaption>
    <svg viewBox="0 0 ${W} ${H}" class="nw-line" role="img" aria-label="${c.title}: from ${vals[0]} to ${vals.at(-1)}"><path d="${d}" fill="none" stroke="var(--court-600)" stroke-width="3"/>${vals.map((v, i) => html`<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="var(--gold)"><title>${c.series[i][c.label_key]}: ${v}</title></circle>`)}
    <text x="${pad}" y="14" class="nw-ax">${c.invert ? `No. ${lo}` : hi}</text><text x="${pad}" y="${H - 4}" class="nw-ax">${c.invert ? `No. ${hi}` : lo}</text></svg>
    ${c.source ? html`<p class="nw-src">Source: ${c.source}</p>` : ''}</figure>`;
}
const chart = (c) => (c.type === 'line' ? lineChart(c) : groupedBar(c));

// ---- modules ---------------------------------------------------------------------------------------------
function scoreboard(d) {
  const W = d.winner_side;
  const row = (s) => { const side = d.sides[s]; return html`<tr class="${s === W ? 'w' : ''}"><th scope="row">${joinH((side.players || []).map((p) => html`<a href="/players/${p.slug}">${p.name}</a>`))}${side.seed ? html` <small>[${side.seed}]</small>` : ''}${side.entry ? html` <small>(${side.entry})</small>` : ''}</th>${d.sets.map((x) => html`<td>${x.match_tiebreak && x.tb ? x.tb[s] : x[s]}${!x.match_tiebreak && x.tb ? html`<sup>${x.tb[s]}</sup>` : ''}</td>`)}</tr>`; };
  return html`<div class="mod nw-score"><p class="mod-k">${d.tournament?.name || ''} · ${d.round_label}${d.duration ? ` · ${d.duration.hours ? `${d.duration.hours}h ` : ''}${d.duration.minutes}m` : ''}</p>
    <table><tbody>${row('A')}${row('B')}</tbody></table>
    <p class="nw-links"><a href="/matches/${d.match_id}">Match page →</a>${d.replay?.available ? html` <a href="/pbecast/${d.match_id}">PBEcast replay →</a>` : ''}</p></div>`;
}
function h2hMod(h) {
  return html`<div class="mod"><p class="mod-k">Head-to-head · our archive from ${h.coverage_from}</p><ul class="nw-list">${h.prior_meetings.map((r) => html`<li><span class="${r.result === 'W' ? 'win' : 'loss'}">${r.result}</span> ${r.tournament} ${r.year} · ${r.round_label} · ${r.score || ''}</li>`)}</ul></div>`;
}
function pathMod(p) {
  return html`<div class="mod"><p class="mod-k">Path through the draw</p><ul class="nw-list">${p.matches.map((r) => html`<li><span class="${r.result === 'W' ? 'win' : 'loss'}">${r.result}</span> ${r.round_label} · ${joinH(r.opponent.map((o) => html`<a href="/players/${o.slug}">${o.name}</a>`))} · ${r.score || ''}</li>`)}</ul></div>`;
}
function formMod(f, names) {
  return html`<div class="mod"><p class="mod-k">Recent form before this tournament</p><div class="nw-form">${Object.entries(f).filter(([, rows]) => rows.length).map(([pid, rows]) => html`<div><b>${names[pid] || ''}</b><ul class="nw-list">${rows.map((r) => html`<li><span class="${r.result === 'W' ? 'win' : 'loss'}">${r.result}</span> ${r.opponent.map((o) => o.name).join(' / ')} · ${r.tournament} ${r.round_label} · ${r.score || ''}</li>`)}</ul></div>`)}</div></div>`;
}
// ---- linking: resolved entities only ------------------------------------------------------------------------
const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ROUND_TITLE = (r) => String(r || '').replace(/^\w/, (c) => c.toUpperCase());

/** Text -> parts with the FIRST mention of each resolved entity linked. Only exact canonical full names from
 *  the frozen evidence packet (resolved ids) are linked; surnames, variants and anything ambiguous stay text. */
export function linkParts(text, entities, linked, max = 8) {
  const live = linked.size >= max ? [] : entities.filter((e) => e.name && e.href && !linked.has(e.key));
  if (!live.length) return [text];
  const re = new RegExp(`(^|[^\\p{L}])(${live.map((e) => esc(e.name)).sort((x, y) => y.length - x.length).join('|')})(?![\\p{L}])`, 'gu');
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const at = m.index + m[1].length;
    const e = live.find((x) => x.name === m[2]);
    if (!e || linked.has(e.key) || linked.size >= max) continue;
    linked.add(e.key);
    out.push(text.slice(last, at), html`<a class="nw-ent" href="${e.href}">${m[2]}</a>`);
    last = at + m[2].length;
  }
  out.push(text.slice(last));
  return out;
}

function facts(a, sb, t, replay) {
  const m = a.evidence?.match;
  const items = [];
  if (t?.name) items.push(['Event', `${t.name}${t.year ? ` ${t.year}` : ''}${t.level ? ` · ${t.level}` : ''}`]);
  if (m?.round_label) items.push(['Round', ROUND_TITLE(m.round_label)]);
  if (t?.surface) items.push(['Surface', `${ROUND_TITLE(t.surface)}${t.indoor ? ' · indoor' : t.indoor === false ? ' · outdoor' : ''}`]);
  if (sb?.duration) items.push(['Duration', `${sb.duration.hours ? `${sb.duration.hours}h ` : ''}${sb.duration.minutes}m`]);
  if (a.key_stat) items.push([a.key_stat.label, a.key_stat.value]);
  if (!items.length && !replay?.available) return '';
  return html`<div class="nwv-facts">${items.map(([k, v]) => html`<div><span>${k}</span><b>${v}</b></div>`)}
    ${replay?.available ? html`<a class="nwv-cta" href="/pbecast/${a.match_id}"><b>Watch PBEcast replay</b><small>${replay.quality === 'point_by_point' ? 'Point-by-point from the official feed' : 'Observed score changes — no point-by-point for this match'}</small></a>` : ''}</div>`;
}

const photoOf = (a, p) => a.media?.photos?.[p.id] || (p.photo?.square ? { square: p.photo.square, portrait: p.photo.portrait || null } : null);

/** "In this story" chips (network pattern): real portrait when approved, initials otherwise; tournament chip. */
function storyChips(a, people, t) {
  return html`<nav class="nwm-chips" aria-label="In this story"><span class="nwm-chips-l">In this story</span>
    ${people.map((p) => html`<a class="nwv-chip" href="/players/${p.slug}">${avatar({ name: p.name, photo: photoOf(a, p) }, { px: 30 })}<span><b>${p.name}</b></span></a>`)}
    ${t?.slug ? html`<a class="nwv-chip nwm-tchip" href="/tournaments/${t.slug}/${t.year}"><span><b>${t.name} ${t.year}</b></span></a>` : ''}</nav>`;
}

// ranking list labels by the list actually held (never a WTA label on an ATP list); the ATP list is secondary-source
export const RANK_LIST = { wta_singles: 'WTA singles', wta_doubles: 'WTA doubles', atp_singles: 'ATP singles' };

/** Four-player (or two-player) matchup card after the opening section: real photos only. */
function matchup(a, parts, W) {
  if (!parts || !W) return '';
  const L = W === 'A' ? 'B' : 'A';
  const col = (side, label) => html`<div class="nwm-mu-side"><p class="nwm-mu-l">${label}</p>${(parts[side]?.players || []).filter((p) => p.slug).map((p) => {
    const ph = photoOf(a, p);
    return html`<a class="nwm-mu-p" href="/players/${p.slug}">${ph ? html`<img src="${ph.portrait || ph.square}" alt="${p.name}" width="120" height="150" loading="lazy" decoding="async">` : ''}<span><b>${p.name}</b><small>${[p.nationality, p.rank && RANK_LIST[p.rank.list] ? `${RANK_LIST[p.rank.list]} No. ${p.rank.rank}` : null].filter(Boolean).join(' · ')}</small><em>View player →</em></span></a>`;
  })}${parts[side]?.seed ? html`<p class="nwm-mu-seed">Seed ${parts[side].seed}</p>` : ''}</div>`;
  return html`<section class="nwm-mu" aria-label="The matchup">${col(W, 'Won')}${col(L, 'Lost')}</section>`;
}

function photoCredits(a, people) {
  const ph = people.map((p) => ({ p, m: a.media?.photos?.[p.id] })).filter((x) => x.m?.source_page);
  if (!ph.length) return '';
  return html`<p class="nwv-credit">Player photos: ${ph.map(({ p, m }, i) => html`${i ? ' · ' : ''}${p.name} — <a href="${m.source_page}" rel="noopener nofollow" target="_blank">${m.author || 'author'} / ${m.license}</a>`)}</p>`;
}

function railLinks(a, people, t, replay) {
  const links = [];
  if (t?.slug) links.push([`/tournaments/${t.slug}/${t.year}`, `${t.name} ${t.year}`, 'Latest from this event']);
  if (a.match_id) links.push([`/matches/${a.match_id}`, 'Match page', 'Score, statistics, head-to-head']);
  if (replay?.available) links.push([`/pbecast/${a.match_id}`, 'PBEcast replay', replay.quality === 'point_by_point' ? 'Point-by-point' : 'Observed score changes']);
  const lists = [...new Set(people.map((p) => p.rank?.list).filter(Boolean))];
  if (lists.includes('wta_doubles')) links.push(['/rankings/women/doubles', 'WTA doubles rankings', 'Official list, archived weekly']);
  if (lists.includes('wta_singles')) links.push(['/rankings/women', 'WTA singles rankings', 'Official list, archived weekly']);
  if (lists.includes('atp_singles')) links.push(['/rankings/men', 'ATP singles list', 'Secondary-source list (not an official ATP feed), archived weekly']);
  return links;
}

/** AT-A-GLANCE strip (3-5 cells, never an empty cell; nothing when fewer than 2 legitimate cells). */
function glanceStrip(a) {
  const cells = glanceCells(a);
  if (!cells.length) return '';
  return html`<div class="nf-glance" role="list" aria-label="At a glance">${cells.map((c) => html`<div role="listitem"><span>${c.label}</span><b>${c.value}</b>${c.note ? html`<small>${c.note}</small>` : ''}</div>`)}</div>`;
}

/** PBEcast replay call to action (only when the match has observed or point-by-point data). */
function replayCta(a) {
  if (!a.replay?.available || !a.match_id) return '';
  return html`<p class="nf-replay"><a href="/pbecast/${a.match_id}"><b>Watch the PBEcast replay →</b><small>${a.replay.quality === 'point_by_point' ? 'Point-by-point from the official feed' : 'Observed score changes — no point-by-point for this match'}</small></a></p>`;
}

/** PBE INTELLIGENCE: the analytics product entering the story (served `intelligence` only; never a betting ad). */
function intelligenceMod(x) {
  if (!x || !x.takeaway) return '';
  const ev = (x.evidence || []).filter(Boolean);
  return html`<aside class="nf-intel" aria-label="PBE Intelligence"><p class="nf-intel-k">PBE Intelligence <span>What the data adds</span></p>
    <p class="nf-intel-t">${x.takeaway}</p>
    ${ev.length ? html`<ul class="nf-intel-ev">${ev.map((e) => html`<li>${typeof e === 'string' ? e : html`<b>${e.label}</b>${e.value != null ? html` ${e.value}` : ''}${e.note ? html` <small>${e.note}</small>` : ''}`}</li>`)}</ul>` : ''}
    ${x.counterpoint ? html`<p class="nf-intel-c"><b>Counterpoint</b> ${x.counterpoint}</p>` : ''}
    <p class="nf-intel-m">Model values are PropBetEdge estimates frozen before the event; descriptive values are results in our record. <a href="/methodology">Methodology →</a></p></aside>`;
}

/** SOURCE & METHOD, collapsed (soccer pattern): sources, last verified, unavailable evidence, methodology; advanced inside. */
function sourceMethod(a, meta) {
  const e = a.evidence || {};
  const up = (e.provenance?.upstream || []).map((u) => `${String(u.family || '').toUpperCase()} (${u.what})`);
  const unavailable = [...(e.unavailable || []), ...(a.unavailable || [])].filter(Boolean);
  const gates = a.method?.gates || null;
  return html`<details class="nf-method"><summary><span class="nf-method-k">Source &amp; Method</span> <span class="nf-method-s">How this story was built</span></summary>
    <div class="nf-method-b">
      <p><b>Sources.</b> ${e.provenance?.data_brand || 'DATA · PropSports'}${up.length ? ` — upstream: ${up.join('; ')}` : ''}.</p>
      <p><b>Last verified.</b> Evidence frozen ${e.frozen_at ? when(e.frozen_at) : 'at publication'}; every number in this story was checked against it before publication. Values are as of the event, not today.</p>
      ${unavailable.length ? html`<p><b>Not available for this story.</b> ${unavailable.map((u) => (typeof u === 'string' ? u : u.what || u.label || '')).filter(Boolean).join('; ')}.</p>` : ''}
      <p><b>Prose.</b> ${a.method?.prose === 'model' ? 'PropBetEdge editorial model, fact-checked against the evidence' : 'PropBetEdge fact-safe writer'}; charts are built by code from the same evidence. <a href="/methodology">Methodology →</a></p>
      <details class="nf-method-adv"><summary>Advanced</summary><dl>
        ${e.packet_hash || a.packet_hash ? html`<dt>Packet hash</dt><dd><code>${e.packet_hash || a.packet_hash}</code></dd>` : ''}
        ${e.packet_version ? html`<dt>Packet</dt><dd>${e.packet_version}</dd>` : ''}
        ${a.method?.writer ? html`<dt>Composer</dt><dd>${a.method.writer}</dd>` : ''}
        ${a.method?.editorial ? html`<dt>Editorial</dt><dd>${a.method.editorial}</dd>` : ''}
        ${gates ? html`<dt>Gates</dt><dd>${gates}${a.method?.gates_passed ? ' · passed' : ''}</dd>` : ''}
        ${meta?.api_version || meta?.version ? html`<dt>API</dt><dd>${meta.api_version || meta.version}</dd>` : ''}
      </dl></details>
    </div></details>`;
}

/** The article hero: event photo > subject composition > tournament atmosphere (all via the resolver) > restrained
 *  branded band (compact, typographic — never a giant blank frame, never an illustration). */
function articleHero(a) {
  const hero = a.media?.hero;
  const v = heroVisual(hero, { hero: true });
  if (v) return html`<figure class="nwm-hero">${v}<figcaption>${heroCaption(hero)}</figcaption></figure>`;
  const t = a.evidence?.tournament || a.tournament;
  return html`<div class="nf-band-hero" role="img" aria-label="${KIND[a.story_type] || 'Story'}${t?.name ? ` · ${tLabel(t)}` : ''}"><img src="/brand/pbe-mark-80.webp" width="110" height="60" alt=""><div><span>${(KIND[a.story_type] || 'Story').toUpperCase()}</span>${t?.name ? html`<b>${tLabel(t)}</b>` : ''}${t?.surface ? html`<small>${t.surface}${t.level ? ` · ${t.level}` : ''}</small>` : ''}</div></div>`;
}

export function article(root, ctx) {
  const ctl = new AbortController();
  const slug = ctx?.params?.slug;
  render(root, html`<div class="nw"><div data-body><div class="page"><p class="loading">Loading…</p></div></div></div>`);
  api(withPreview(`/v1/news/${slug}`), { signal: ctl.signal }).then((res) => {
    const body = root.querySelector('[data-body]');
    if (!body) return;
    const a = res.data;
    if (!a) { render(body, html`<div class="page"><div class="mod"><p class="empty-h">Story not found.</p><p class="note"><a href="/news">All tennis news →</a></p></div></div>`); return; }
    document.title = `${a.headline} | PropBetEdge Tennis`;
    setIndexable(a.status === 'published' && !previewQ());
    track('tennis_news_open', { route: '/news/:slug', event_type: a.story_type });
    const mods = a.plan?.modules || [];
    const get = (id) => mods.find((m) => m.id === id)?.data;
    const charts = get('charts')?.charts || [];
    const sb = get('scoreboard') ? { ...get('scoreboard'), replay: a.replay } : null;
    const parts = a.evidence?.participants;
    const W = sb?.winner_side;
    // winners first (chips, links, credits)
    const people = (parts ? (W === 'B' ? ['B', 'A'] : ['A', 'B']).flatMap((s) => parts[s]?.players || []) : a.evidence?.player ? [a.evidence.player] : []).filter((p) => p?.slug);
    const names = {};
    for (const p of people) names[p.id] = p.name;
    const t = a.evidence?.tournament || a.tournament || null;
    const entities = [...people.map((p) => ({ key: `p:${p.id}`, name: p.name, href: `/players/${p.slug}` })), ...(t?.slug && t?.name ? [{ key: 't', name: t.name, href: `/tournaments/${t.slug}/${t.year}` }] : [])];
    const linked = new Set();
    // visuals live INSIDE the section they support (at most three strong visuals; the rest go to the data section)
    // at most two match-data charts in the narrative; any further ones stay one tap away (never a wall of charts)
    const dataCharts = charts.filter((c) => c.id !== 'dna_comparison' && c.id !== 'ranking_trajectory');
    const dataBlock = [...dataCharts.slice(0, 2).map(chart), dataCharts.length > 2 ? html`<details class="nf-more-data"><summary>More match numbers (${dataCharts.length - 2})</summary>${dataCharts.slice(2).map(chart)}</details>` : ''];
    const inserts = { what_happened: [sb ? scoreboard(sb) : ''], match_data: dataBlock, dna: charts.filter((c) => c.id === 'dna_comparison').map(chart), h2h: [get('h2h') ? h2hMod(get('h2h')) : ''], path: [get('path') ? pathMod(get('path')) : ''], trajectory: charts.filter((c) => c.id === 'ranking_trajectory').map(chart) };
    const sections = a.sections || [];
    const placed = new Set(Object.entries(inserts).filter(([id]) => sections.some((s) => s.id === id)).map(([id]) => id));
    const leftovers = Object.entries(inserts).filter(([id]) => !placed.has(id)).flatMap(([, v]) => v).filter(Boolean);
    const url = `https://tennis.propbetedge.ai/news/${a.slug}`;
    const pub = a.first_published_at || a.published_at || a.updated_at;
    const revised = a.revised_at || (a.updated_at && a.first_published_at && Date.parse(a.updated_at) - Date.parse(a.first_published_at) > 5 * 60e3 ? a.updated_at : null);
    const mins = readingMinutes(sections);
    const links = railLinks(a, people, t, a.replay);
    const dnaLinks = people.slice(0, 2).map((p) => [`/players/${p.slug}/dna`, `${p.name} — Tennis DNA`, 'Match DNA, PBE Rating, splits, surfaces']);
    const intel = intelligenceMod(a.intelligence);
    const deskL = DESK_LABEL[a.desk] && a.desk !== 'all' ? DESK_LABEL[a.desk] : null;
    render(body, html`<div class="nwm">
      <div class="page nwm-shell">
        <nav class="nwv-crumbs nwm-crumbs" aria-label="Breadcrumb"><a href="/">Tennis</a><span>›</span><a href="/news">News</a>${deskL ? html`<span>›</span><a href="/news/${a.desk}">${deskL}</a>` : ''}${t?.slug ? html`<span>›</span><a href="/tournaments/${t.slug}/${t.year}">${tLabel(t)}</a>` : ''}</nav>
        <div class="nwm-grid">
          <article class="nwm-art nw-story">
            <header class="nwm-head">
              <div class="nwm-meta"><span class="nwm-sport">TENNIS</span>${a.story_class && CLASS_LABEL[a.story_class] ? html`<span class="nwm-cat nf-cls-${a.story_class}">${CLASS_LABEL[a.story_class]}</span>` : ''}${deskL ? html`<span class="nwm-cat">${deskL}</span>` : ''}<span class="nwm-cat">${KIND[a.story_type] || 'Story'}</span>${t?.name ? html`<span class="nwm-cat">${tLabel(t)}</span>` : ''}${a.evidence?.match?.round_label ? html`<span class="nwm-cat">${ROUND_TITLE(a.evidence.match.round_label)}</span>` : ''}<time class="nwm-date" datetime="${pub}">${when(pub)}</time></div>
              <h1>${a.headline}</h1>
              ${a.dek ? html`<p class="nwm-dek">${a.dek}</p>` : ''}
              <p class="nwm-by">By <a href="/news">PropBetEdge Tennis Desk</a> · <time datetime="${pub}">${when(pub)}</time>${mins ? html` · ${mins} min read` : ''}${a.evidence?.frozen_at ? html` · Data as of <time datetime="${a.evidence.frozen_at}">${when(a.evidence.frozen_at)}</time>` : ''}${revised ? html` · Updated <time datetime="${revised}">${when(revised)}</time>` : ''}${a.status !== 'published' ? html` · <b class="nw-held">HELD DRAFT (not public): ${a.hold_reason || ''}</b>` : ''}</p>
              ${shareBar({ url, text: `${a.headline} — PropBetEdge Tennis` })}
            </header>
            ${storyChips(a, people, t)}
            ${articleHero(a)}
            ${glanceCells(a).length ? html`${glanceStrip(a)}${replayCta(a)}` : facts(a, sb, t, a.replay)}
            <div class="nw-body">
              ${sections.map((s, i) => html`<section id="${s.id}"><h2>${s.heading}</h2>${s.paragraphs.map((p) => html`<p>${linkParts(p, entities, linked)}</p>`)}${(inserts[s.id] || []).filter(Boolean)}</section>${i === 0 ? matchup(a, parts, W) : ''}${i === Math.min(1, sections.length - 1) ? intel : ''}`)}
              ${!sections.length ? intel : ''}
              ${leftovers.length ? html`<section id="more-data"><h2>The match in numbers</h2>${leftovers}</section>` : ''}
              ${get('form') ? formMod(get('form'), names) : ''}
              ${sourceMethod(a, res.meta)}
              ${photoCredits(a, people)}
            </div>
          </article>
          <aside class="nwm-rail" aria-label="Keep exploring">
            ${links.length || dnaLinks.length ? html`<section class="nwm-rbox"><h2>Keep exploring</h2><div class="nwv-links">${[...dnaLinks, ...links].map(([h, l, n]) => html`<a href="${h}"><b>${l}</b><small>${n}</small></a>`)}</div></section>` : ''}
            ${t?.slug ? html`<section class="nwm-rbox" data-event-live hidden><h2>Live at this event</h2><div data-event-live-list></div><p class="nw-back"><a href="/tournaments/${t.slug}/${t.year}">${tLabel(t)} →</a></p></section>` : ''}
            ${a.related?.length ? html`<section class="nwm-rbox"><h2>Related intelligence</h2><div class="nf-rel">${a.related.slice(0, 3).map(storyRow)}</div><p class="nw-back"><a href="/news">All tennis news →</a></p></section>` : ''}
          </aside>
        </div>
      </div>
    </div>`);
    if (t?.slug && t?.year) {
      api(`/v1/news/live?tournament=${encodeURIComponent(t.slug)}&year=${t.year}&limit=8`, { signal: ctl.signal }).then((r) => {
        const items = (Array.isArray(r?.data?.items) ? r.data.items : []).filter((w) => !w.article_slug || w.article_slug !== a.slug).slice(0, 6);
        const box = body.querySelector('[data-event-live]');
        if (!box || !items.length) return;
        render(box.querySelector('[data-event-live-list]'), wireList(items, { limit: 6, more: false }));
        box.hidden = false;
      }).catch(() => {});
    }
  }).catch(() => {});
  return () => ctl.abort();
}

export const __test = { glanceStrip, intelligenceMod, sourceMethod, articleHero, majorStory, featureStory, resultRows, tournamentsModule, moversModule };
