// Tennis newsroom: desk hub + story page. Stories come from tennis-api /v1/news (published only; a
// ?preview token shows held drafts for internal QA, noindex). Prose sections are rendered as text; data
// modules and charts are rendered from the story's deterministic content plan — no value here is computed
// or invented in the browser.

import { html, render, raw, setIndexable } from '../lib/dom.js';
import { api } from '../data/api.js';
import { avatar } from '../ui/avatar.js';
import { shareBar } from '../ui/share.js';
import { track } from '../analytics.js';
import { courtVisualSvg, courtFromStory } from '../../workers/shared/court-visual.js';

export const DESKS = [['all', 'All'], ['wta', 'WTA'], ['atp', 'ATP'], ['grand-slams', 'Grand Slams'], ['challenger', 'Challenger'], ['itf', 'ITF'], ['doubles', 'Doubles'], ['rankings', 'Rankings']];
const KIND = { upset: 'Upset', seed_upset: 'Seed upset', title: 'Title', doubles_title: 'Doubles title', retirement: 'Retirement', walkover: 'Walkover', marathon: 'Marathon', comeback: 'Comeback', deciding_tiebreak: 'Deciding tiebreak', dominant: 'Dominant win', qualifier_run: 'Qualifier run', new_no1: 'New No. 1', enters_top10: 'Top 10', enters_top20: 'Top 20', enters_top50: 'Top 50', enters_top100: 'Top 100' };
const joinH = (xs, sep = ' / ') => html`${xs.map((x, i) => (i ? html`${sep}${x}` : x))}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const previewQ = () => { const p = new URLSearchParams(location.search).get('preview'); return p && /^[0-9a-f]{16,64}$/.test(p) ? p : null; };
const withPreview = (path) => (previewQ() ? `${path}${path.includes('?') ? '&' : '?'}preview=${previewQ()}` : path);

// ---- editorial media (V3): landscape photos from the approved catalog, else the court graphic -----------------
const isPhoto = (m) => m && m.type && m.type !== 'data_visual' && m.wide;
const srcset = (d, names) => names.filter((n) => d?.[n]?.url).map((n) => `${d[n].url} ${n.split('-')[1]}w`).join(', ');
/** Responsive editorial <picture>: 16:9 on wide screens, 4:3 crop on phones; eager only for the hero. */
export function editorialPicture(m, { hero = false, sizes = '100vw', alt = '' } = {}) {
  const d = m.wide;
  const wideSet = srcset(d, ['wide-480', 'wide-800', 'wide-1200', 'wide-1600', 'wide-2400']);
  const stdSet = srcset(d, ['std-800', 'std-1200']);
  const src = d['wide-1600']?.url || d['wide-1200']?.url || d['wide-800']?.url;
  // when the viewport crops further (max-height), keep the reviewed focal point in frame
  const pos = m.focal ? raw(`style="object-position:${Math.round(m.focal.x * 100)}% ${Math.round(m.focal.y * 100)}%"`) : '';
  return html`<picture>${hero && stdSet ? html`<source media="(max-width: 700px)" type="image/webp" srcset="${stdSet}" sizes="100vw">` : ''}<img src="${src}" srcset="${wideSet}" sizes="${sizes}" width="1600" height="900" alt="${alt || m.caption || ''}" loading="${hero ? 'eager' : 'lazy'}" ${hero ? raw('fetchpriority="high"') : ''} decoding="async" ${pos}></picture>`;
}
const credit = (m) => html`<a href="${m.source_page}" rel="noopener nofollow" target="_blank">${m.author || 'Author'} / ${m.license}</a>`;
function figure(m) {
  return html`<figure class="nwx-fig">${editorialPicture(m, { sizes: '(max-width: 900px) 100vw, 860px' })}<figcaption>${m.file_photo ? html`<b>File photo.</b> ` : ''}${m.caption}. <span class="nwx-cr">Photo: ${credit(m)}</span></figcaption></figure>`;
}
function courtFigure(c, kicker = '') {
  return c ? html`<figure class="nwx-fig nwx-cvfig"><div class="nwx-cv">${raw(courtVisualSvg({ ...c, kicker }))}</div><figcaption>PropBetEdge court graphic built from the match data.</figcaption></figure>` : '';
}

/** Card visual: the story's editorial photo (landscape) or its court graphic; faces are not the visual system. */
function cardArt(a, lead) {
  const m = a.media?.hero;
  if (isPhoto(m)) return html`<div class="nwx-thumb">${editorialPicture(m, { hero: lead, sizes: lead ? '(max-width: 900px) 100vw, 900px' : '(max-width: 700px) 100vw, 420px', alt: '' })}</div>`;
  if (a.court) return html`<div class="nwx-thumb nwx-cv">${raw(courtVisualSvg({ ...a.court, label: false, kicker: '' }))}</div>`;
  return html`<div class="nwx-thumb nw-art-brand"><span>${KIND[a.story_type] || 'Story'}</span>${a.key_stat ? html`<b>${a.key_stat.value}</b>` : ''}</div>`;
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
export function linkParts(text, entities, linked) {
  const live = entities.filter((e) => e.name && e.href && !linked.has(e.key));
  if (!live.length) return [text];
  const re = new RegExp(`(^|[^\\p{L}])(${live.map((e) => esc(e.name)).sort((x, y) => y.length - x.length).join('|')})(?![\\p{L}])`, 'gu');
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const at = m.index + m[1].length;
    const e = live.find((x) => x.name === m[2]);
    if (!e || linked.has(e.key)) continue;
    linked.add(e.key);
    out.push(text.slice(last, at), html`<a class="nw-ent" href="${e.href}">${m[2]}</a>`);
    last = at + m[2].length;
  }
  out.push(text.slice(last));
  return out;
}

function photoCredits(people) {
  const ph = people.filter((p) => p.photo?.source_page);
  if (!ph.length) return '';
  return html`<p class="nwv-credit">Player photos: ${ph.map((p, i) => html`${i ? ' · ' : ''}${p.name} — <a href="${p.photo.source_page}" rel="noopener nofollow" target="_blank">${p.photo.author || 'author'} / ${p.photo.license}</a>`)}</p>`;
}

function facts(a, sb, t, replay) {
  const m = a.evidence?.match;
  const items = [];
  if (a.key_stat) items.push([a.key_stat.label, a.key_stat.value]);
  if (m?.round_label) items.push(['Round', ROUND_TITLE(m.round_label)]);
  if (sb?.duration) items.push(['Duration', `${sb.duration.hours ? `${sb.duration.hours}h ` : ''}${sb.duration.minutes}m`]);
  if (m?.date) items.push(['Date', fmtDay(m.date)]);
  if (t?.level || t?.surface) items.push(['Event', [t.level, t.surface ? `${t.surface}${t.indoor ? ' · indoor' : ''}` : null].filter(Boolean).join(' · ')]);
  const seeds = sb ? ['A', 'B'].filter((s) => sb.sides?.[s]?.seed).map((s) => `${(sb.sides[s].players || []).map((p) => p.last_name || p.name).join('/')} [${sb.sides[s].seed}]`) : [];
  if (seeds.length) items.push(['Seeds', seeds.join(' · ')]);
  if (!items.length && !replay?.available) return '';
  return html`<div class="nwv-facts">${items.map(([k, v]) => html`<div><span>${k}</span><b>${v}</b></div>`)}
    ${replay?.available ? html`<a class="nwv-cta" href="/pbecast/${a.match_id}"><b>Watch PBEcast replay</b><small>${replay.quality === 'point_by_point' ? 'Point-by-point from the official feed' : 'Observed score changes — no point-by-point for this match'}</small></a>` : ''}</div>`;
}
const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function chips(people) {
  return html`<nav class="nwv-chips" aria-label="Players in this story">${people.map((p) => html`<a class="nwv-chip" href="/players/${p.slug}">${avatar(p, { px: 28 })}<span><b>${p.name}</b>${p.rank ? html`<small>${p.rank.list === 'wta_doubles' ? 'WTA doubles' : p.rank.list === 'wta_singles' ? 'WTA singles' : ''} No. ${p.rank.rank}</small>` : ''}</span></a>`)}</nav>`;
}

function related(a, people, t, replay, singles) {
  const links = [];
  if (t?.slug) links.push([`/tournaments/${t.slug}/${t.year}`, `${t.name} ${t.year}`, 'Tournament · every match']);
  if (a.match_id) links.push([`/matches/${a.match_id}`, 'Match page', 'Score, statistics, head-to-head']);
  if (replay?.available) links.push([`/pbecast/${a.match_id}`, 'PBEcast replay', replay.quality === 'point_by_point' ? 'Point-by-point' : 'Observed score changes']);
  const lists = [...new Set(people.map((p) => p.rank?.list).filter(Boolean))];
  if (lists.includes('wta_doubles')) links.push(['/rankings/women/doubles', 'WTA doubles rankings', 'Official list, archived weekly']);
  if (lists.includes('wta_singles')) links.push(['/rankings/women', 'WTA singles rankings', 'Official list, archived weekly']);
  if (singles) links.push(['/dna', 'Tennis DNA', 'Serve, return and pressure leaders']);
  return html`<section class="nwv-rel" aria-labelledby="rel-h"><h2 id="rel-h">Keep exploring</h2>
    ${people.length ? html`<p class="sec-sub">Players</p><ul class="men-feat">${people.map((p) => html`<li><a href="/players/${p.slug}">${avatar(p, { size: 'square', px: 56 })}<span><b>${p.name}</b><small>${[p.nationality, p.rank ? `No. ${p.rank.rank} ${p.rank.list === 'wta_doubles' ? 'doubles' : 'singles'}` : null].filter(Boolean).join(' · ')}</small></span></a></li>`)}</ul>` : ''}
    ${links.length ? html`<p class="sec-sub">Tournament, match and data</p><div class="nwv-links">${links.map(([h, l, n]) => html`<a href="${h}"><b>${l}</b><small>${n}</small></a>`)}</div>` : ''}
    ${a.related?.length ? html`<p class="sec-sub">Latest tennis intelligence</p><div class="nw-grid">${a.related.map((r) => card(r))}</div>` : ''}
    <p class="nw-back"><a href="/news">All tennis news →</a></p></section>`;
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
    const team = W && parts?.[W] ? parts[W].players.filter((p) => p?.slug) : a.evidence?.player?.slug ? [a.evidence.player] : [];
    const opp = W && parts ? (parts[W === 'A' ? 'B' : 'A']?.players || []).filter((p) => p?.slug) : [];
    const names = {};
    for (const p of people) names[p.id] = p.name;
    const t = a.evidence?.tournament || a.tournament || null;
    const singles = parts ? ['A', 'B'].every((s) => (parts[s]?.players || []).length === 1) : false;
    // resolved entities for in-text links: canonical player pages + the tournament edition
    const entities = [...people.map((p) => ({ key: `p:${p.id}`, name: p.name, href: `/players/${p.slug}` })), ...(t?.slug && t?.name ? [{ key: 't', name: t.name, href: `/tournaments/${t.slug}/${t.year}` }] : [])];
    const linked = new Set();
    // modules interrupt the prose: scoreboard after the lead, charts after the match-data section, the
    // rest spread through the remaining sections (the UFC placement rule, deterministic)
    const inserts = { what_happened: [sb ? scoreboard(sb) : ''], match_data: charts.filter((c) => c.id !== 'dna_comparison' && c.id !== 'ranking_trajectory').map(chart), dna: charts.filter((c) => c.id === 'dna_comparison').map(chart), h2h: [get('h2h') ? h2hMod(get('h2h')) : ''], path: [get('path') ? pathMod(get('path')) : ''], trajectory: charts.filter((c) => c.id === 'ranking_trajectory').map(chart) };
    const placed = new Set(Object.entries(inserts).filter(([id]) => a.sections.some((s) => s.id === id)).map(([id]) => id));
    const leftovers = Object.entries(inserts).filter(([id]) => !placed.has(id)).flatMap(([, v]) => v);
    const url = `https://tennis.propbetedge.ai/news/${a.slug}`;
    const sections = a.sections;
    const hero = a.media?.hero;
    const court = courtFromStory(a);
    const inline = (a.media?.inline || []).filter(isPhoto);
    // visual rhythm: story -> visual -> data -> story -> visual. Inline photos after the 1st and 3rd sections;
    // if the hero is a photo and no second photo exists, the court graphic takes the later slot.
    const slots = [inline[0] ? figure(inline[0]) : '', inline[1] ? figure(inline[1]) : isPhoto(hero) && court ? courtFigure(court) : ''];
    render(body, html`<article class="nw-story nwv nwx">
      <div class="nwx-hero">${isPhoto(hero) ? editorialPicture(hero, { hero: true, alt: hero.caption }) : court ? html`<div class="nwx-cv cv-wide">${raw(courtVisualSvg({ ...court, tournament: '', round: '', fit: 'meet' }))}</div><div class="nwx-cv cv-narrow">${raw(courtVisualSvg({ ...court, tournament: '', round: '' }))}</div>` : ''}</div>
      <header class="nwv-hero nwx-head"><div class="page nwv-hero-in">
        <div class="nwv-hero-t">
          <nav class="nwv-crumbs" aria-label="Breadcrumb"><a href="/">Tennis</a><span>›</span><a href="/news">News</a>${t?.slug ? html`<span>›</span><a href="/tournaments/${t.slug}/${t.year}">${t.name} ${t.year}</a>` : ''}</nav>
          <p class="nw-kick"><span>${KIND[a.story_type] || 'Story'}</span>${t?.slug ? html` · <a href="/tournaments/${t.slug}/${t.year}">${t.name} ${t.year}</a>` : ''}${a.evidence?.match?.round_label ? ` · ${ROUND_TITLE(a.evidence.match.round_label)}` : ''}</p>
          <h1>${a.headline}</h1>${a.dek ? html`<p class="nw-dek">${a.dek}</p>` : ''}
          <p class="nwv-by"><b>PropBetEdge Tennis Desk</b> · <time datetime="${a.published_at || a.updated_at}">${when(a.published_at || a.updated_at)}</time>${a.status !== 'published' ? html` · <b class="nw-held">HELD DRAFT (not public): ${a.hold_reason || ''}</b>` : ''}</p>
        </div>
      </div></header>
      <div class="page nwv-main">
        <p class="nwx-heroCap">${isPhoto(hero) ? html`${hero.file_photo ? html`<b>File photo.</b> ` : ''}${hero.caption}. Photo: ${credit(hero)}` : court ? 'Illustration: PropBetEdge court graphic built from the match data — not a photograph.' : ''}</p>
        ${facts(a, sb, t, a.replay)}
        ${chips(people)}
        <div class="nw-body">
          ${sections.map((s, i) => html`<section id="${s.id}"><h2>${s.heading}</h2>${s.paragraphs.map((p) => html`<p>${linkParts(p, entities, linked)}</p>`)}${(inserts[s.id] || []).filter(Boolean)}</section>${i === 0 ? slots[0] : i === 2 ? slots[1] : ''}`)}
          ${leftovers.filter(Boolean)}
          ${get('form') ? formMod(get('form'), names) : ''}
          ${methodMod(a)}
          ${photoCredits([...team, ...opp])}
        </div>
        ${shareBar({ url, text: `${a.headline} — PropBetEdge Tennis` })}
        ${related(a, people, t, a.replay, singles)}
      </div>
    </article>`);
  }).catch(() => {});
  return () => ctl.abort();
}
