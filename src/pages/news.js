// Tennis newsroom: desk hub + story page. Stories come from tennis-api /v1/news (published only; a
// ?preview token shows held drafts for internal QA, noindex). Prose sections are rendered as text; data
// modules and charts are rendered from the story's deterministic content plan — no value here is computed
// or invented in the browser.

import { html, render, raw, setIndexable } from '../lib/dom.js';
import { api } from '../data/api.js';
import { avatar } from '../ui/avatar.js';
import { shareBar } from '../ui/share.js';
import { track } from '../analytics.js';

export const DESKS = [['all', 'All'], ['wta', 'WTA'], ['atp', 'ATP'], ['grand-slams', 'Grand Slams'], ['challenger', 'Challenger'], ['itf', 'ITF'], ['doubles', 'Doubles'], ['rankings', 'Rankings']];
const KIND = { upset: 'Upset', seed_upset: 'Seed upset', title: 'Title', doubles_title: 'Doubles title', retirement: 'Retirement', walkover: 'Walkover', marathon: 'Marathon', comeback: 'Comeback', deciding_tiebreak: 'Deciding tiebreak', dominant: 'Dominant win', qualifier_run: 'Qualifier run', new_no1: 'New No. 1', enters_top10: 'Top 10', enters_top20: 'Top 20', enters_top50: 'Top 50', enters_top100: 'Top 100' };
const joinH = (xs, sep = ' / ') => html`${xs.map((x, i) => (i ? html`${sep}${x}` : x))}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const previewQ = () => { const p = new URLSearchParams(location.search).get('preview'); return p && /^[0-9a-f]{16,64}$/.test(p) ? p : null; };
const withPreview = (path) => (previewQ() ? `${path}${path.includes('?') ? '&' : '?'}preview=${previewQ()}` : path);

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

/** The hero/card visual for a resolved hero. Returns '' for the fallback on article pages. */
function heroVisual(h, { hero = false, card = false } = {}) {
  if (!h || !h.images?.length) return '';
  if (h.type === 'player_photos') {
    const ps = h.images;
    if (ps.length === 1) return html`<div class="nwm-ph one${ps[0].wide ? ' wide' : ''}">${playerImg(ps[0], { eager: hero })}</div>`;
    return html`<div class="nwm-ph duo">${ps.map((p) => html`<div>${playerImg(p, { eager: hero, wideOk: false })}</div>`)}</div>`;
  }
  return html`<div class="nwm-ph">${editorialPicture(h.images[0], { hero, sizes: card ? '(max-width: 700px) 100vw, 420px' : '(max-width: 1100px) 100vw, 760px' })}</div>`;
}

function heroCaption(h) {
  if (!h?.images?.length) return '';
  const cr = (i) => (i.source_page ? html`<a href="${i.source_page}" rel="noopener nofollow" target="_blank">${i.author || 'Author'} / ${i.license}</a>` : html`${i.credit || ''}`);
  if (h.type === 'player_photos') return html`${h.images.map((i, k) => html`${k ? ' · ' : ''}<b>${i.name}</b> — photo: ${cr(i)}`)}`;
  const i = h.images[0];
  return html`${i.caption}. Photo: ${cr(i)}`;
}

/** Card visual: real photo, else the branded PropBetEdge Tennis treatment (brand mark + story kind). */
function cardArt(a, lead) {
  const v = heroVisual(a.media?.hero, { hero: lead, card: true });
  if (v) return html`<div class="nwx-thumb">${v}</div>`;
  return html`<div class="nwx-thumb nwm-brand"><img src="/brand/pbe-mark-80.webp" width="110" height="60" alt="" loading="lazy"><span>TENNIS · ${(KIND[a.story_type] || 'Story').toUpperCase()}</span>${a.tournament?.name ? html`<b>${a.tournament.name}${a.tournament.year ? ` ${a.tournament.year}` : ''}</b>` : ''}</div>`;
}

export function card(a, lead = false) {
  const href = `/news/${a.slug}${previewQ() ? `?preview=${previewQ()}` : ''}`;
  const who = (a.team && a.team.length ? a.team : a.player ? [a.player] : []).map((p) => p.name).join(' / ');
  return html`<article class="nw-card nwx-card${lead ? ' nw-lead' : ''}">
    <a class="nw-card-a" href="${href}">
      ${cardArt(a, lead)}
      <div class="nw-card-t">
        <p class="nw-kick"><span>${KIND[a.story_type] || 'Story'}</span>${a.tournament?.name ? html` · ${a.tournament.name}${a.tournament.year ? ` ${a.tournament.year}` : ''}` : ''}${a.status !== 'published' ? html` · <b class="nw-held">HELD: ${a.hold_reason || ''}</b>` : ''}</p>
        <h2>${a.headline}</h2>
        ${a.dek ? html`<p class="nw-dek">${a.dek}</p>` : ''}
        <p class="nw-meta">${who ? html`<span class="nw-who">${who}</span>` : ''}<time datetime="${a.published_at || a.updated_at}">${when(a.published_at || a.updated_at)}</time></p>
      </div>
    </a></article>`;
}

export function hub(root, ctx) {
  const ctl = new AbortController();
  const desk = ctx?.params?.desk || 'all';
  track('tennis_news_open', { route: location.pathname });
  render(root, html`<div class="page nw">
    <header class="page-h"><p class="eyebrow">PropBetEdge Tennis</p><h1>Tennis News</h1>
      <p class="lede">Stories built from our own match, ranking and Tennis DNA data. Every number is checked against a frozen evidence packet before anything is published, and a quiet day publishes nothing.</p>
      <nav class="chips" aria-label="Desks">${DESKS.map(([k, l]) => html`<a class="chip${k === desk ? ' on' : ''}" href="${k === 'all' ? '/news' : `/news/${k}`}${previewQ() ? `?preview=${previewQ()}` : ''}" ${k === desk ? raw('aria-current="page"') : ''}>${l}</a>`)}</nav></header>
    <div data-body><p class="loading">Loading…</p></div></div>`);
  api(withPreview(desk === 'all' ? '/v1/news' : `/v1/news/${desk}`), { signal: ctl.signal }).then((res) => {
    const body = root.querySelector('[data-body]');
    if (!body) return;
    const list = res.data?.articles || [];
    if (!list.length) {
      render(body, html`<div class="mod nw-empty"><p class="empty-h">No stories on this desk yet.</p><p class="note">${res.meta?.semantics || ''} Stories appear only when a real event in our data (an upset, a title, a ranking milestone…) passes every factual gate. Men’s stories come from supported Grand Slam sources (ATP and Grand Slams desks); Challenger and ITF desks fill as those sources come online.</p><p class="note"><a href="/schedule">Today’s schedule →</a> · <a href="/men">Men’s tennis →</a> · <a href="/rankings">Rankings →</a></p></div>`);
      return;
    }
    const [lead, ...rest] = list;
    render(body, html`${card(lead, true)}<p class="sec"><span>Latest</span></p><div class="nw-grid">${rest.map((a) => card(a))}</div>`);
  }).catch(() => {});
  return () => ctl.abort();
}

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
function methodMod(a) {
  const e = a.evidence;
  return html`<aside class="mod nw-method"><p class="mod-k">Evidence &amp; method</p>
    <p>Data: <a href="${e?.provenance?.data_url || 'https://propsports.proptechusa.ai'}" rel="noopener">${e?.provenance?.data_brand || 'DATA · PropSports'}</a>. Upstream: ${(e?.provenance?.upstream || []).map((u) => `${u.family.toUpperCase()} (${u.what})`).join('; ')}.</p>
    <p>Evidence frozen ${e?.frozen_at ? when(e.frozen_at) : ''} (${e?.packet_version || ''}); every number in this story was checked against it (${a.method?.gates || ''}). Prose: ${a.method?.prose === 'model' ? 'PropBetEdge editorial model, fact-checked' : 'PropBetEdge fact-safe writer'}. Charts are built by code from the same evidence.</p></aside>`;
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

/** Four-player (or two-player) matchup card after the opening section: real photos only. */
function matchup(a, parts, W) {
  if (!parts || !W) return '';
  const L = W === 'A' ? 'B' : 'A';
  const col = (side, label) => html`<div class="nwm-mu-side"><p class="nwm-mu-l">${label}</p>${(parts[side]?.players || []).filter((p) => p.slug).map((p) => {
    const ph = photoOf(a, p);
    return html`<a class="nwm-mu-p" href="/players/${p.slug}">${ph ? html`<img src="${ph.portrait || ph.square}" alt="${p.name}" width="120" height="150" loading="lazy" decoding="async">` : ''}<span><b>${p.name}</b><small>${[p.nationality, p.rank ? `${p.rank.list === 'wta_doubles' ? 'WTA doubles' : 'WTA singles'} No. ${p.rank.rank}` : null].filter(Boolean).join(' · ')}</small><em>View player →</em></span></a>`;
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
  return links;
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
    const people = (parts ? ['A', 'B'].flatMap((s) => parts[s]?.players || []) : a.evidence?.player ? [a.evidence.player] : []).filter((p) => p?.slug);
    const W = sb?.winner_side;
    const names = {};
    for (const p of people) names[p.id] = p.name;
    const t = a.evidence?.tournament || a.tournament || null;
    const entities = [...people.map((p) => ({ key: `p:${p.id}`, name: p.name, href: `/players/${p.slug}` })), ...(t?.slug && t?.name ? [{ key: 't', name: t.name, href: `/tournaments/${t.slug}/${t.year}` }] : [])];
    const linked = new Set();
    const inserts = { what_happened: [sb ? scoreboard(sb) : ''], match_data: charts.filter((c) => c.id !== 'dna_comparison' && c.id !== 'ranking_trajectory').map(chart), dna: charts.filter((c) => c.id === 'dna_comparison').map(chart), h2h: [get('h2h') ? h2hMod(get('h2h')) : ''], path: [get('path') ? pathMod(get('path')) : ''], trajectory: charts.filter((c) => c.id === 'ranking_trajectory').map(chart) };
    const placed = new Set(Object.entries(inserts).filter(([id]) => a.sections.some((s) => s.id === id)).map(([id]) => id));
    const leftovers = Object.entries(inserts).filter(([id]) => !placed.has(id)).flatMap(([, v]) => v);
    const url = `https://tennis.propbetedge.ai/news/${a.slug}`;
    const hero = a.media?.hero;
    const visual = heroVisual(hero, { hero: true });
    const updated = a.updated_at && a.first_published_at && Date.parse(a.updated_at) - Date.parse(a.first_published_at) > 5 * 60e3 ? a.updated_at : null;
    const links = railLinks(a, people, t, a.replay);
    render(body, html`<div class="nwm">
      <div class="page nwm-shell">
        <nav class="nwv-crumbs nwm-crumbs" aria-label="Breadcrumb"><a href="/">Tennis</a><span>›</span><a href="/news">News</a>${t?.slug ? html`<span>›</span><a href="/tournaments/${t.slug}/${t.year}">${t.name} ${t.year}</a>` : ''}</nav>
        <div class="nwm-grid">
          <article class="nwm-art nw-story">
            <header class="nwm-head">
              <div class="nwm-meta"><span class="nwm-sport">TENNIS</span><span class="nwm-cat">${KIND[a.story_type] || 'Story'}</span>${a.evidence?.match?.round_label ? html`<span class="nwm-cat">${ROUND_TITLE(a.evidence.match.round_label)}</span>` : ''}<time class="nwm-date" datetime="${a.published_at || a.updated_at}">${when(a.published_at || a.updated_at)}</time></div>
              <h1>${a.headline}</h1>
              ${a.dek ? html`<p class="nwm-dek">${a.dek}</p>` : ''}
              <p class="nwm-by">By <a href="/news">PropBetEdge Tennis Desk</a> · <time datetime="${a.published_at || a.updated_at}">${when(a.published_at || a.updated_at)}</time>${updated ? html` · Updated <time datetime="${updated}">${when(updated)}</time>` : ''}${a.status !== 'published' ? html` · <b class="nw-held">HELD DRAFT (not public): ${a.hold_reason || ''}</b>` : ''}</p>
              ${shareBar({ url, text: `${a.headline} — PropBetEdge Tennis` })}
            </header>
            ${storyChips(a, people, t)}
            ${visual ? html`<figure class="nwm-hero">${visual}<figcaption>${heroCaption(hero)}</figcaption></figure>` : ''}
            ${facts(a, sb, t, a.replay)}
            <div class="nw-body">
              ${a.sections.map((s, i) => html`<section id="${s.id}"><h2>${s.heading}</h2>${s.paragraphs.map((p) => html`<p>${linkParts(p, entities, linked)}</p>`)}${(inserts[s.id] || []).filter(Boolean)}</section>${i === 0 ? matchup(a, parts, W) : ''}`)}
              ${leftovers.filter(Boolean)}
              ${get('form') ? formMod(get('form'), names) : ''}
              ${methodMod(a)}
              ${photoCredits(a, people)}
            </div>
          </article>
          <aside class="nwm-rail" aria-label="Related">
            ${links.length ? html`<section class="nwm-rbox"><h2>Keep exploring</h2><div class="nwv-links">${links.map(([h, l, n]) => html`<a href="${h}"><b>${l}</b><small>${n}</small></a>`)}</div></section>` : ''}
            ${a.related?.length ? html`<section class="nwm-rbox"><h2>Related intelligence</h2><div class="nwm-rel">${a.related.map((r) => card(r))}</div><p class="nw-back"><a href="/news">All tennis news →</a></p></section>` : ''}
          </aside>
        </div>
      </div>
    </div>`);
  }).catch(() => {});
  return () => ctl.abort();
}
