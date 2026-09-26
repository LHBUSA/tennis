// Tennis newsroom: desk hub + story page. Stories come from tennis-api /v1/news (published only; a
// ?preview token shows held drafts for internal QA, noindex). Prose sections are rendered as text; data
// modules and charts are rendered from the story's deterministic content plan — no value here is computed
// or invented in the browser.

import { html, render, raw } from '../lib/dom.js';
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

export function card(a, lead = false) {
  const href = `/news/${a.slug}${previewQ() ? `?preview=${previewQ()}` : ''}`;
  return html`<article class="nw-card${lead ? ' nw-lead' : ''}">
    <a class="nw-card-a" href="${href}">
      <div class="nw-card-img">${a.player ? avatar({ name: a.player.name, photo: a.player.photo }, { size: 'square', px: lead ? 160 : 72, eager: lead }) : ''}</div>
      <div class="nw-card-t">
        <p class="nw-kick"><span>${KIND[a.story_type] || 'Story'}</span>${a.tournament?.name ? html` · ${a.tournament.name}` : ''}${a.status !== 'published' ? html` · <b class="nw-held">HELD: ${a.hold_reason || ''}</b>` : ''}</p>
        <h2>${a.headline}</h2>
        ${lead && a.dek ? html`<p class="nw-dek">${a.dek}</p>` : ''}
        <p class="nw-meta">${a.key_stat ? html`<span class="nw-stat"><em>${a.key_stat.label}</em> ${a.key_stat.value}</span>` : ''}<time datetime="${a.published_at || a.updated_at}">${when(a.published_at || a.updated_at)}</time></p>
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
    <p class="nw-links"><a href="/matches/${d.match_id}">Match page →</a> <a href="/pbecast/${d.match_id}">PBEcast replay →</a></p></div>`;
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

export function article(root, ctx) {
  const ctl = new AbortController();
  const slug = ctx?.params?.slug;
  render(root, html`<div class="page nw"><div data-body><p class="loading">Loading…</p></div></div>`);
  api(withPreview(`/v1/news/${slug}`), { signal: ctl.signal }).then((res) => {
    const body = root.querySelector('[data-body]');
    if (!body) return;
    const a = res.data;
    if (!a) { render(body, html`<div class="mod"><p class="empty-h">Story not found.</p><p class="note"><a href="/news">All tennis news →</a></p></div>`); return; }
    document.title = `${a.headline} | PropBetEdge Tennis`;
    track('tennis_news_open', { route: '/news/:slug', event_type: a.story_type });
    const mods = a.plan?.modules || [];
    const get = (id) => mods.find((m) => m.id === id)?.data;
    const charts = get('charts')?.charts || [];
    const names = {};
    for (const s of ['A', 'B']) for (const p of a.evidence?.participants?.[s]?.players || []) names[p.id] = p.name;
    // modules interrupt the prose: scoreboard after the lead, charts after the match-data section, the
    // rest spread through the remaining sections (the UFC placement rule, deterministic)
    const inserts = { what_happened: [get('scoreboard') ? scoreboard(get('scoreboard')) : ''], match_data: charts.filter((c) => c.id !== 'dna_comparison' && c.id !== 'ranking_trajectory').map(chart), dna: charts.filter((c) => c.id === 'dna_comparison').map(chart), h2h: [get('h2h') ? h2hMod(get('h2h')) : ''], path: [get('path') ? pathMod(get('path')) : ''], trajectory: charts.filter((c) => c.id === 'ranking_trajectory').map(chart) };
    const placed = new Set(Object.entries(inserts).filter(([id]) => a.sections.some((s) => s.id === id)).map(([id]) => id));
    const leftovers = Object.entries(inserts).filter(([id]) => !placed.has(id)).flatMap(([, v]) => v);
    const hero = a.player?.photo?.wide || a.player?.photo?.square;
    const url = `https://tennis.propbetedge.ai/news/${a.slug}`;
    render(body, html`<article class="nw-story">
      <header class="nw-hero${hero ? ' has-img' : ''}">
        ${hero ? html`<img class="nw-hero-img" src="${hero}" alt="${a.player.name}" width="1200" height="675" fetchpriority="high">` : ''}
        <div class="nw-hero-t"><p class="nw-kick"><span>${KIND[a.story_type] || 'Story'}</span>${a.tournament?.name ? html` · <a href="/tournaments/${a.tournament.slug}/${a.tournament.year}">${a.tournament.name} ${a.tournament.year}</a>` : ''}</p>
        <h1>${a.headline}</h1>${a.dek ? html`<p class="nw-dek">${a.dek}</p>` : ''}
        <p class="nw-byline">PropBetEdge Tennis Desk · <time datetime="${a.published_at || a.updated_at}">${when(a.published_at || a.updated_at)}</time>${a.status !== 'published' ? html` · <b class="nw-held">HELD DRAFT (not public): ${a.hold_reason || ''}</b>` : ''}</p>
        ${a.key_stat ? html`<p class="nw-stat big"><em>${a.key_stat.label}</em> ${a.key_stat.value}</p>` : ''}</div>
      </header>
      <nav class="nw-chips" aria-label="People">${Object.entries(names).map(([, n]) => html`<span class="chip">${n}</span>`)}</nav>
      <div class="nw-body">
        ${a.sections.map((s) => html`<section id="${s.id}"><h2>${s.heading}</h2>${s.paragraphs.map((p) => html`<p>${p}</p>`)}${(inserts[s.id] || []).filter(Boolean)}</section>`)}
        ${leftovers.filter(Boolean)}
        ${get('form') ? formMod(get('form'), names) : ''}
        ${methodMod(a)}
      </div>
      ${shareBar({ url, text: `${a.headline} — PropBetEdge Tennis` })}
      <p class="nw-back"><a href="/news">← All tennis news</a></p>
    </article>`);
  }).catch(() => {});
  return () => ctl.abort();
}
