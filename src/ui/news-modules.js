// Tennis newsroom V4 data modules (tennis-plan/4.0.0): Match control, Set by set, Serve profile, Return pressure,
// How the match developed, Player context and What's next. Every value is copied from the story's frozen content plan
// (numerator/denominator as stored) — nothing is computed, estimated or invented here. A module the plan omitted is simply
// not rendered; tables carry captions and scoped headers so they read correctly without the styling.
// Styles: src/styles/news-modules.css (imported from src/main.js; not here, so node tests can import this file).

import { html } from '../lib/dom.js';

const SUPERSEDED_CHARTS = { serve_profile: ['serve_comparison', 'serve_counts'], return_pressure: ['return_comparison'], set_by_set: ['match_flow'] };

const shortName = (side) => {
  const ps = side?.players || [];
  if (!ps.length) return null;
  return ps.map((p) => String(p.name || '').split(' ').slice(-1)[0]).join(' / ');
};
const pct = (x) => (x ? html`<b>${x.pct}%</b> <small>${x.n}/${x.d}</small>` : '—');
const cell = (kind, x) => (kind === 'count' ? html`<b>${x.value}</b>` : pct(x));
const edge = (row) => {
  const a = row.kind === 'count' ? row.w.value : row.w.pct;
  const b = row.kind === 'count' ? row.l.value : row.l.pct;
  if (a === b) return '';
  const lowerBetter = row.key === 'double_faults';
  return (a > b) !== lowerBetter ? 'w' : 'l';
};
const playerLink = (p) => (p?.slug ? html`<a href="/players/${p.slug}">${p.name}</a>` : p?.name || '');

export function pairTable(mod, names) {
  const d = mod.data;
  return html`<figure class="mod nwd nwd-pair" data-module="${mod.id}">
    <table class="nwd-t"><caption>${mod.title}</caption>
      <thead><tr><th scope="col">Measure</th><th scope="col">${names.W}</th><th scope="col">${names.L}</th></tr></thead>
      <tbody>${d.rows.map((r) => { const e = edge(r); return html`<tr><th scope="row">${r.label}</th><td class="${e === 'w' ? 'lead' : ''}">${cell(r.kind, r.w)}</td><td class="${e === 'l' ? 'lead' : ''}">${cell(r.kind, r.l)}</td></tr>`; })}</tbody>
    </table>
    <figcaption class="nwd-src">Official match statistics${mod.id === 'return_pressure' ? " (return figures derived from the opponent's serve totals)" : ''}.</figcaption>
  </figure>`;
}

export function keyNumbers(mod, names) {
  const d = mod.data;
  return html`<section class="mod nwd nwd-keys" data-module="key_numbers" aria-label="${mod.title}">
    <p class="mod-k">${mod.title} · ${names.W} vs ${names.L}</p>
    <ul class="nwd-tiles">${d.tiles.map((t) => html`<li><span class="nwd-tl">${t.label}${t.note ? html` <small>(${t.note})</small>` : ''}</span><span class="nwd-tv" aria-hidden="true"><b>${t.w}</b><i>–</i><b>${t.l}</b></span><span class="sr">${names.W} ${t.w}, ${names.L} ${t.l}</span></li>`)}</ul>
    ${d.run ? html`<p class="nwd-note">Longest run: ${d.run.games} straight games to ${names[d.run.side]}${d.run.from_set === d.run.to_set ? ` in set ${d.run.from_set}` : `, sets ${d.run.from_set}–${d.run.to_set}`} (observed game by game).</p>` : ''}
  </section>`;
}

export function setBySet(mod, names) {
  const d = mod.data;
  const hasPts = d.rows.some((r) => r.points_won);
  const hasBrk = d.rows.some((r) => r.breaks);
  const src = [...new Set(d.rows.map((r) => r.breaks?.source).filter(Boolean))];
  const games = (r) => (r.match_tiebreak ? (r.tiebreak ? `TB ${r.tiebreak.w}–${r.tiebreak.l}` : 'Match TB') : html`${r.games.w}–${r.games.l}${r.tiebreak ? html`<sup>${Math.min(r.tiebreak.w, r.tiebreak.l)}</sup>` : ''}`);
  return html`<figure class="mod nwd nwd-sets" data-module="set_by_set">
    <table class="nwd-t"><caption>${mod.title} <small>(${names.W} first)</small></caption>
      <thead><tr><th scope="col">Set</th><th scope="col">Games</th>${hasPts ? html`<th scope="col">Points won</th>` : ''}${hasBrk ? html`<th scope="col">Breaks</th>` : ''}<th scope="col">Set to</th></tr></thead>
      <tbody>${d.rows.map((r) => html`<tr><th scope="row">${r.match_tiebreak ? 'Match TB' : r.set}</th><td>${games(r)}</td>${hasPts ? html`<td>${r.points_won ? `${r.points_won.w}–${r.points_won.l}` : '—'}</td>` : ''}${hasBrk ? html`<td>${r.breaks ? `${r.breaks.w}–${r.breaks.l}` : '—'}</td>` : ''}<td>${r.winner ? names[r.winner] : '—'}</td></tr>`)}</tbody>
    </table>
    ${src.length ? html`<figcaption class="nwd-src">Breaks from ${src.join(' and ')}.</figcaption>` : ''}
  </figure>`;
}

export function development(mod, names) {
  const d = mod.data;
  const basis = d.source === 'point_by_point' ? 'point-by-point record' : d.complete ? 'live score, observed game by game' : `live score, partial (${d.games_observed} games observed)`;
  return html`<figure class="mod nwd nwd-dev" data-module="match_development">
    <p class="mod-k">${mod.title}</p>
    ${d.breaks.length ? html`<ol class="nwd-breaks" aria-label="Breaks of serve in order">${d.breaks.map((b) => html`<li class="${b.by === 'W' ? 'w' : 'l'}"><span class="nwd-at">Set ${b.set}${Number.isFinite(b.game) ? `, game ${b.game}` : ''}</span> ${names[b.by]} broke</li>`)}</ol>` : html`<p class="nwd-note">No breaks of serve in the observed games.</p>`}
    ${d.longest_run ? html`<p class="nwd-note">Longest run: ${d.longest_run.games} straight games to ${names[d.longest_run.by]}.</p>` : ''}
    <figcaption class="nwd-src">Source: ${basis}.</figcaption>
  </figure>`;
}

export function playerContext(mod, people) {
  const d = mod.data;
  const card = (rel) => {
    const c = d.players[rel];
    if (!c) return '';
    return html`<div class="nwd-pc"><h3>${playerLink(c)}</h3><dl>
      ${c.rank ? html`<dt>Ranking</dt><dd>No. ${c.rank.rank} <small>(list ${c.rank.list_date})</small></dd>` : ''}
      ${c.surface ? html`<dt>${c.surface.surface} record</dt><dd>${c.surface.W}–${c.surface.L}</dd>` : ''}
      ${c.year ? html`<dt>Last 52 weeks</dt><dd>${c.year.W}–${c.year.L}</dd>` : ''}
      ${c.form ? html`<dt>Recent form</dt><dd><ul class="nw-list">${c.form.slice(0, 5).map((r) => html`<li><span class="${r.result === 'W' ? 'win' : 'loss'}">${r.result}</span> ${r.opponent || ''} · ${r.tournament} ${r.round_label || ''}</li>`)}</ul></dd>` : ''}
    </dl>${c.slug ? html`<p class="nw-links"><a href="/players/${c.slug}/dna">Tennis DNA →</a></p>` : ''}</div>`;
  };
  return html`<section class="mod nwd nwd-ctx" data-module="player_context" aria-label="${mod.title}">
    <p class="mod-k">${mod.title}${d.rank_phrase ? html` · <small>${d.rank_phrase}</small>` : ''}</p>
    <div class="nwd-pcs">${card('W')}${card('L')}</div>
    ${d.h2h ? html`<p class="nwd-note">Head-to-head in our archive (from ${d.h2h.coverage_from}): ${d.h2h.wins}–${d.h2h.losses} across ${d.h2h.meetings} prior meeting${d.h2h.meetings === 1 ? '' : 's'}.</p>` : ''}
  </section>`;
}

export function nextMatch(next) {
  return html`<div class="mod nwd nwd-next" data-module="next"><p class="mod-k">What's next · ${next.round_label}</p>
    <p>${next.opponent?.length ? html`Next opponent: ${next.opponent.map(playerLink).reduce((acc, x, i) => (i ? html`${acc} / ${x}` : x), '')}` : 'Opponent to be decided'} · <a href="/matches/${next.match_id}">Match page →</a></p></div>`;
}

/**
 * The single hook for article(): returns insert overrides keyed by section id. `inserts` are the page's existing inserts;
 * helpers = { sections, parts, W, charts, chart }. Modules the plan does not carry render nothing (thin stories unchanged).
 */
export function depthInserts(mods, inserts, { sections = [], parts = null, W = null, charts = [], chart = null } = {}) {
  const get = (id) => mods.find((m) => m.id === id && m.data);
  const has = (id) => sections.some((s) => s.id === id);
  const L = W === 'A' ? 'B' : W === 'B' ? 'A' : null;
  const names = { W: shortName(parts?.[W]) || 'Winner', L: shortName(parts?.[L]) || 'Opponent' };
  const out = {};
  const push = (id, ...xs) => { out[id] = [...(out[id] || inserts[id] || []), ...xs.filter(Boolean)]; };

  const kn = get('key_numbers');
  const sbs = get('set_by_set');
  const sp = get('serve_profile');
  const rp = get('return_pressure');
  const dev = get('match_development');
  const pc = get('player_context');
  const nx = get('next');

  if (kn) push('what_happened', keyNumbers(kn, names));
  const devHome = has('match_development') ? 'match_development' : 'what_happened';
  if (sbs) push(devHome, setBySet(sbs, names));
  if (dev) push(devHome, development(dev, names));

  if (sp || rp) {
    const drop = new Set([...(sp ? SUPERSEDED_CHARTS.serve_profile : []), ...(rp ? SUPERSEDED_CHARTS.return_pressure : []), ...(sbs ? SUPERSEDED_CHARTS.set_by_set : [])]);
    const rest = chart ? charts.filter((c) => c.id !== 'dna_comparison' && c.id !== 'ranking_trajectory' && !drop.has(c.id)) : [];
    out.match_data = [sp ? pairTable(sp, names) : '', rp ? pairTable(rp, names) : '', rest.length ? html`<details class="nf-more-data"><summary>More match numbers (${rest.length})</summary>${rest.map(chart)}</details>` : ''].filter(Boolean);
  }

  if (pc) push(['player_read', 'surface', 'why_it_mattered'].find(has) || 'player_read', playerContext(pc));
  if (nx) push(has('next') ? 'next' : 'path', nextMatch(nx.data));
  return out;
}
