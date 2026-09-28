// Phase 6 intelligence pages: Matchup DNA (upcoming matches + one matchup) and Players to Watch. Every number comes
// from tennis-api; a withheld probability or list says why; context is labelled as context.
import { html, render, setIndexable } from '../lib/dom.js';
import { api } from '../data/api.js';
import { emptyModule, errorModule, resultState, freshnessBadge } from '../ui/state.js';
import { avatar } from '../ui/avatar.js';
import { fmtDate, localTime, roundLabel } from '../ui/render.js';
import { track } from '../analytics.js';

const pct0 = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const pc1 = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const sgn = (v, d = 0) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(d)}`);
const P = (m, s) => m.sides?.[s]?.players?.[0] || null;
const who = (p) => (p ? html`<a href="/players/${p.slug}/dna">${p.name}</a>` : 'TBD');
const STATUS_TEXT = { fixture_not_upcoming: 'No probability: this match is no longer upcoming', fixture_stale: 'No probability: the start time passed and no result is stored (stale fixture)', fixture_undated: 'No probability: no start time published yet', not_validated: 'No probability: this tour’s rating has not passed its backtest', insufficient_history: 'No probability: a player has too few rated matches', no_rating: 'No probability: a player has no PBE Rating yet' };

function page(root, { eyebrow, heading, lede, chips = null }) {
  render(root, html`<div class="page"><header class="page-h"><p class="eyebrow">${eyebrow}</p><h1>${heading}</h1>${lede ? html`<p class="lede">${lede}</p>` : ''}
    ${chips ? html`<nav class="chips" aria-label="Views">${chips.map(([h, l, on]) => html`<a class="chip${on ? ' on' : ''}" href="${h}" ${on ? html`aria-current="page"` : ''}>${l}</a>`)}</nav>` : ''}
    <p class="meta" data-meta></p></header><div data-body><p class="loading">Loading…</p></div></div>`);
}
async function load(root, path, draw, emptyNote, signal) {
  let res;
  try { res = await api(path, { signal }); } catch { return; }
  const body = root.querySelector('[data-body]');
  if (!body) return;
  const meta = root.querySelector('[data-meta]');
  if (meta) render(meta, html`${freshnessBadge(res.meta)} <span>${res.meta?.semantics || ''}</span>`);
  if (resultState(res) === 'error') { render(body, errorModule(res.meta, 'This data could not be loaded right now. Please try again shortly.')); return; }
  const out = res.data != null ? draw(res.data, res.meta) : null;
  render(body, out || emptyModule(res.meta, emptyNote));
}
const mount = (fn) => (root, ctx) => { const c = new AbortController(); fn(root, ctx, c.signal); return () => c.abort(); };

/** Two-sided probability bar (A left, B right); withheld probability renders the reason instead. */
function probBar(model, a, b) {
  if (!model?.probability) return html`<p class="mu-withheld">${STATUS_TEXT[model?.status] || 'No probability'}${model?.rating_edge ? html` · rating edge ${Math.abs(model.rating_edge.points)} pts${model.rating_edge.favours ? ` to ${model.rating_edge.favours === 'A' ? a?.last_name || a?.name : b?.last_name || b?.name}` : ''}` : ''}</p>`;
  const pa = Math.round(model.probability.A * 100);
  return html`<div class="pbar" role="img" aria-label="${a?.name} ${pa}%, ${b?.name} ${100 - pa}%"><span class="a ${pa >= 50 ? 'fav' : ''}" style="width:${pa}%"><b>${pa}%</b></span><span class="b ${pa < 50 ? 'fav' : ''}" style="width:${100 - pa}%"><b>${100 - pa}%</b></span></div>`;
}

// ---- /matchups --------------------------------------------------------------------------------------------
export const matchups = mount((root, _c, signal) => {
  const q = new URLSearchParams(location.search);
  const tour = ['atp', 'wta'].includes(q.get('tour')) ? q.get('tour') : '';
  track('tennis_matchups_open', { tour: tour || 'all' });
  page(root, { eyebrow: 'Matchup DNA', heading: 'Matchups This Week', lede: 'Every scheduled singles match in the next seven days with its PBE Rating win probability, the rating and surface edges, and the model’s track record at that confidence. Probabilities appear only for tours whose rating beat the ranking model out of sample, and only when both players have enough rated matches.', chips: [['/matchups', 'All', !tour], ['/matchups?tour=atp', 'ATP', tour === 'atp'], ['/matchups?tour=wta', 'WTA', tour === 'wta']] });
  return load(root, `/v1/matchups${tour ? `?tour=${tour}` : ''}`, (d) => {
    if (!d.matchups.length) return html`<div class="mod"><p class="empty-h">No scheduled singles matches with both players confirmed in the next 7 days.</p><p class="note">Fixtures appear as the tournaments publish their order of play and draws. <a href="/schedule">Full schedule →</a></p></div>`;
    const groups = new Map();
    for (const x of d.matchups) { const k = `${(x.match.scheduled_at || '').slice(0, 10)}|${x.match.tournament?.name || ''}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
    return html`${[...groups].map(([k, xs]) => { const t = xs[0].match.tournament; return html`<section class="mod"><header class="mod-h"><h2>${t?.tournament || t?.name || 'Tournament'}</h2><span class="mod-k">${fmtDate(k.slice(0, 10))}${t?.surface ? ` · ${t.surface}` : ''} · ${xs[0].tour}</span></header>
      <div class="mu-list">${xs.map((x) => { const a = P(x.match, 'A'); const b = P(x.match, 'B'); return html`<a class="mu-card" href="/matchups/${x.match.id}">
        <div class="mu-row"><span class="mu-p">${avatar(a, { px: 32 })}<b>${a?.name}</b>${x.match.sides.A?.seed ? html`<small>(${x.match.sides.A.seed})</small>` : ''}</span><span class="mu-t">${x.match.scheduled_at ? localTime(x.match.scheduled_at) : ''} · ${roundLabel(x.match.round)}</span><span class="mu-p r">${x.match.sides.B?.seed ? html`<small>(${x.match.sides.B.seed})</small>` : ''}<b>${b?.name}</b>${avatar(b, { px: 32 })}</span></div>
        ${probBar(x.model, a, b)}
        <p class="mu-k">${x.model.rating_edge ? html`Rating edge <b>${Math.abs(x.model.rating_edge.points)}</b>` : ''}${x.surface_edge != null ? html` · ${t?.surface} edge <b>${Math.abs(x.surface_edge)}</b>` : ''}${x.form_edge_52w != null ? html` · 52-week form edge <b>${sgn(x.form_edge_52w, 2)}</b>` : ''}${x.model.confidence ? html` · <span class="conf c-${x.model.confidence === 'standard' ? 'high' : 'low'}">${x.model.confidence.replace('_', ' ')}</span>` : ''}</p></a>`; })}</div></section>`; })}
      <p class="note">Model: PBE Rating (chronological Elo), matchup v${d.matchup_version}, ratings as of ${fmtDate(d.as_of)}. Edges and form are context, not model inputs. <a href="/methodology">Methodology →</a></p>`;
  }, 'Matchups unavailable.', signal);
});

// ---- /matchups/:id ---------------------------------------------------------------------------------------
const cmpRow = (label, A, B, fmt, note = '') => html`<tr><th scope="row">${label}${note ? html`<small class="note"> ${note}</small>` : ''}</th><td class="n tabnum">${A == null ? '—' : fmt(A)}</td><td class="n tabnum">${B == null ? '—' : fmt(B)}</td></tr>`;
export const matchup = mount(async (root, { params }, signal) => {
  render(root, html`<div class="page"><p class="loading">Loading matchup…</p></div>`);
  let res;
  try { res = await api(`/v1/matchups/${params.id}`, { signal }); } catch { return; }
  if (resultState(res) === 'error') { render(root, html`<div class="page">${errorModule(res.meta, 'Matchup DNA could not be loaded.')}</div>`); return; }
  if (!res.data) { render(root, html`<div class="page">${emptyModule(res.meta, 'Matchup DNA covers singles matches with both players identified.')}</div>`); return; }
  const d = res.data; const m = d.match; const a = P(m, 'A'); const b = P(m, 'B');
  const mod = d.model; const c = d.context;
  track('tennis_matchup_open', { match_id: m.id, tour: d.tour });
  document.title = `${a?.name} vs ${b?.name} — Matchup DNA | PropBetEdge Tennis`;
  setIndexable(false);
  const nm = (p) => p?.last_name || p?.name;
  const win = (k, s) => c.form?.[k]?.[s];
  const sim = mod.confidence?.similar_matches;
  const simRow = sim?.same_surface || sim?.all_surfaces;
  render(root, html`<div class="page">
    <header class="page-h"><p class="eyebrow">Matchup DNA · ${d.tour} · ${m.tournament?.tournament || m.tournament?.name || ''} ${m.tournament?.year || ''}${m.tournament?.surface ? ` · ${m.tournament.surface}` : ''}</p>
      <h1 class="mu-h1"><span>${avatar(a, { px: 56 })}${who(a)}</span><em>vs</em><span>${who(b)}${avatar(b, { px: 56 })}</span></h1>
      <p class="lede">${roundLabel(m.round)}${m.scheduled_at ? ` · ${fmtDate(m.scheduled_at.slice(0, 10))} ${localTime(m.scheduled_at)}` : ''}${m.court ? ` · ${m.court}` : ''} · status: ${m.status.replace('_', ' ')}</p>
      <p class="meta">${freshnessBadge(res.meta)} <span>${res.meta?.semantics || ''}</span></p></header>
    <section class="mod mu-model"><header class="mod-h"><h2>Win probability</h2><span class="mod-k">PBE Rating · method v${mod.model.method_version}${mod.model.variant ? ` (${mod.model.variant})` : ''} · matchup v${mod.model.matchup_version}</span></header>
      ${probBar(mod, a, b)}
      <div class="mu-why"><h3 class="sub-h">Why this number</h3><ul>${d.why.map((x) => html`<li>${x}</li>`)}</ul></div>
      ${mod.ratings ? html`<div class="tbl-wrap"><table class="tbl mu-tbl"><thead><tr><th>Model input</th><th class="n">${nm(a)}</th><th class="n">${nm(b)}</th></tr></thead><tbody>
        ${cmpRow('PBE Rating', mod.ratings.A.value, mod.ratings.B.value, (v) => v)}
        ${cmpRow('Rated matches', mod.ratings.A.rated_matches, mod.ratings.B.rated_matches, (v) => `${v}`, mod.ratings.A.provisional || mod.ratings.B.provisional ? '(under 20 = provisional)' : '')}
        ${mod.surface_ratings ? cmpRow(`${mod.surface_ratings.surface} rating`, mod.surface_ratings.A?.value, mod.surface_ratings.B?.value, (v) => v, mod.surface_ratings.used ? '(used: 50/50 blend)' : '(not used)') : ''}
      </tbody></table></div>` : ''}
      ${mod.confidence ? html`<div class="mu-conf"><div><span>Confidence</span><b>${mod.confidence.level.replace('_', ' ')}</b></div>${simRow ? html`<div><span>Similar past matches</span><b class="tabnum">${simRow.matches.toLocaleString('en-US')}</b><small>favourite ${pct0(simRow.band[0])}–${pct0(simRow.band[1])} ${simRow.surface === 'all' ? '' : `on ${simRow.surface}`} · won ${pc1(simRow.favourite_won)} (model said ${pc1(simRow.predicted)})</small></div>` : ''}${mod.confidence.backtest ? html`<div><span>Out-of-sample record</span><b class="tabnum">${pc1(mod.confidence.backtest.accuracy)}</b><small>correct favourite over ${mod.confidence.backtest.matches.toLocaleString('en-US')} matches · log loss ${mod.confidence.backtest.log_loss}${mod.confidence.backtest.vs_rank ? ` vs ranking model ${mod.confidence.backtest.vs_rank.rank_log_loss}` : ''}</small></div>` : ''}</div>` : ''}
    </section>
    <h2 class="sec">Context <small>shown with its sample — none of this changes the probability</small></h2>
    <div class="grid-2">
      <section class="mod"><header class="mod-h"><h2>Form</h2><span class="mod-k">opponent-adjusted</span></header>
        <div class="tbl-wrap"><table class="tbl mu-tbl"><thead><tr><th></th><th class="n">${nm(a)}</th><th class="n">${nm(b)}</th></tr></thead><tbody>
          ${['10w', '52w'].map((k) => html`${cmpRow(`Last ${k.replace('w', '')} weeks`, win(k, 'A'), win(k, 'B'), (x) => `${x.W}–${x.L}`)}${cmpRow('  vs expectation', win(k, 'A')?.wae, win(k, 'B')?.wae, (v) => sgn(v, 3))}`)}
          ${cmpRow('Career vs expectation', c.opponent_quality?.A?.wins_above_expectation, c.opponent_quality?.B?.wins_above_expectation, (v) => sgn(v, 3))}
          ${cmpRow('Avg opponent rank', c.opponent_quality?.A?.avg_opponent_rank, c.opponent_quality?.B?.avg_opponent_rank, (v) => `No. ${Math.round(v)}`)}
        </tbody></table></div>
        <p class="note">${c.form?.['52w']?.wae_edge != null ? `52-week edge: ${sgn(c.form['52w'].wae_edge, 3)} wins above expectation per match. ` : c.form?.['52w']?.note ? `${c.form['52w'].note}. ` : ''}“vs expectation” = results minus the rating’s pre-match win probability.</p></section>
      <section class="mod"><header class="mod-h"><h2>Serve &amp; return</h2><span class="mod-k">technical DNA · match statistics</span></header>
        ${c.serve_return?.available ? html`<div class="tbl-wrap"><table class="tbl mu-tbl"><thead><tr><th></th><th class="n">${nm(a)}</th><th class="n">${nm(b)}</th></tr></thead><tbody>${c.serve_return.metrics.map((r) => cmpRow(r.label, r.A?.value, r.B?.value, pc1))}</tbody></table></div>
          <p class="note">${nm(a)} serve vs ${nm(b)} return: <b>${sgn(c.serve_return.matchups.A_serve_vs_B_return == null ? null : c.serve_return.matchups.A_serve_vs_B_return * 100, 1)} pts</b> · ${nm(b)} serve vs ${nm(a)} return: <b>${sgn(c.serve_return.matchups.B_serve_vs_A_return == null ? null : c.serve_return.matchups.B_serve_vs_A_return * 100, 1)} pts</b>. ${c.serve_return.note}</p>` : html`<p class="note">${c.serve_return?.reason || 'Not available.'}</p>`}</section>
      <section class="mod"><header class="mod-h"><h2>Surface</h2></header>
        ${c.surface?.A || c.surface?.B ? html`<div class="tbl-wrap"><table class="tbl mu-tbl"><thead><tr><th></th><th class="n">${nm(a)}</th><th class="n">${nm(b)}</th></tr></thead><tbody>${cmpRow(`${c.surface.surface} rating`, c.surface.A?.rating, c.surface.B?.rating, (v) => v)}${cmpRow('vs own overall', c.surface.A?.vs_overall, c.surface.B?.vs_overall, (v) => sgn(v))}${cmpRow(`${c.surface.surface} rated matches`, c.surface.A?.rated_matches, c.surface.B?.rated_matches, (v) => `${v}`)}</tbody></table></div>` : html`<p class="note">${c.surface?.note || 'No surface rating for either player on this surface yet.'}</p>`}</section>
      <section class="mod"><header class="mod-h"><h2>Rest &amp; schedule</h2></header>
        <div class="tbl-wrap"><table class="tbl mu-tbl"><thead><tr><th></th><th class="n">${nm(a)}</th><th class="n">${nm(b)}</th></tr></thead><tbody>
          ${cmpRow('Days since last match', c.rest?.A?.days_since_last, c.rest?.B?.days_since_last, (v) => `${v}`)}
          ${cmpRow('Matches, last 7 days', c.rest?.A?.matches_7d, c.rest?.B?.matches_7d, (v) => `${v}`)}
          ${cmpRow('Sets, last 7 days', c.rest?.A?.sets_7d, c.rest?.B?.sets_7d, (v) => `${v}`)}
          ${cmpRow('Matches, last 14 days', c.rest?.A?.matches_14d, c.rest?.B?.matches_14d, (v) => `${v}`)}
          ${cmpRow('Previous event', c.travel?.A?.previous_event ? `${c.travel.A.previous_event}${c.travel.A.previous_city ? ` · ${c.travel.A.previous_city}` : ''}` : null, c.travel?.B?.previous_event ? `${c.travel.B.previous_event}${c.travel.B.previous_city ? ` · ${c.travel.B.previous_city}` : ''}` : null, (v) => v)}
        </tbody></table></div>
        <p class="note">${c.rest?.basis || ''}. Travel shows only where the sources place each event; no distance or jet-lag estimate is made.</p></section>
    </div>
    <section class="mod mu-h2h"><header class="mod-h"><h2>Head-to-head</h2><span class="mod-k">not a model input</span></header>
      <p class="h2h-big tabnum"><span>${nm(a)}</span> <b>${d.h2h.record.A}</b> – <b>${d.h2h.record.B}</b> <span>${nm(b)}</span></p>
      ${d.h2h.meetings.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Event</th><th class="hide-s">Surface</th><th>Winner</th><th>Score</th></tr></thead><tbody>${d.h2h.meetings.map((x) => html`<tr><td class="tabnum">${fmtDate(x.date)}</td><td>${x.slug ? html`<a href="/tournaments/${x.slug}/${x.year}">${x.tournament} ${x.year}</a>` : x.tournament || '—'} · ${roundLabel(x.round)}</td><td class="hide-s">${x.surface || '—'}</td><td>${x.won_by === 'A' ? nm(a) : nm(b)}</td><td class="tabnum"><a href="/matches/${x.id}">${x.score || x.status}</a></td></tr>`)}</tbody></table></div>` : html`<p class="note">No previous meetings in the stored ledger.</p>`}
      <p class="note">${d.h2h.note}.</p></section>
    <p class="note"><a href="/matches/${m.id}">Match page →</a> · <a href="/matchups">All matchups →</a> · <a href="/methodology">Methodology →</a></p>
  </div>`);
});

// ---- /players-to-watch -----------------------------------------------------------------------------------
const LISTS = [
  ['biggest_30d_change.risers', 'Biggest 30-day risers', 'Largest PBE Rating gain in the last 30 days (played in that window)', (r) => `${sgn(r.change)} · ${r.rating_30d_ago} → ${r.rating}`, (r) => `${r.matches_30d} matches in 30 days`],
  ['biggest_30d_change.fallers', 'Biggest 30-day fallers', 'Largest PBE Rating drop in the last 30 days', (r) => `${sgn(r.change)} · ${r.rating_30d_ago} → ${r.rating}`, (r) => `${r.matches_30d} matches in 30 days`],
  ['fastest_rising_90d', 'Fastest rising (90 days)', 'Largest gain over 90 days with at least 5 matches played', (r) => `${sgn(r.change)} · ${r.rating_90d_ago} → ${r.rating}`, (r) => `${r.matches_90d} matches in 90 days`],
  ['outperforming_ranking', 'Rated above their ranking', 'Among active rated players inside the top 200 of the ranking list, those whose PBE Rating order is furthest above their ranking order', (r) => `+${r.ranking_gap} places`, (r) => `No. ${r.rating_position} by PBE Rating vs No. ${r.ranking_position} by ranking in this set · official list No. ${r.rank?.rank}`],
  ['underperforming_ranking', 'Ranked above their rating', 'Same set: players whose ranking order is furthest above their PBE Rating order', (r) => `${r.ranking_gap} places`, (r) => `No. ${r.rating_position} by PBE Rating vs No. ${r.ranking_position} by ranking in this set · official list No. ${r.rank?.rank}`],
  ['emerging', 'Emerging', 'Highest-rated players whose first stored tour-level match is within 3 years (20+ rated matches)', (r) => `${r.rating}`, (r) => `first match ${fmtDate(r.first_ledger_match)} · ${r.rated_matches} rated`]
];
const at = (o, path) => path.split('.').reduce((x, k) => x?.[k], o);
const watchList = ([path, title, rule, main, sub], t) => { const rows = at(t, path) || []; return html`<section class="mod"><header class="mod-h"><h2>${title}</h2></header><p class="note">${rule}.</p>${rows.length ? html`<ol class="ptw">${rows.map((r, i) => html`<li><span class="ptw-n">${i + 1}</span>${avatar(r.player, { px: 36 })}<span class="ptw-p">${r.player ? html`<a href="/players/${r.player.slug}/dna">${r.player.name}</a>` : 'Unknown player'}<small>${sub(r)}</small></span><b class="tabnum">${main(r)}</b></li>`)}</ol>` : html`<p class="note">No player meets this list’s minimum samples this week.</p>`}</section>`; };

export const watch = mount((root, _c, signal) => {
  const q = new URLSearchParams(location.search);
  const tour = q.get('tour') === 'wta' ? 'WTA' : 'ATP';
  const week = /^\d{4}-\d{2}-\d{2}$/.test(q.get('week') || '') ? q.get('week') : null;
  track('tennis_watch_open', { tour, week: week || 'current' });
  const url = (o) => { const x = { tour, week, ...o }; return `/players-to-watch?tour=${x.tour.toLowerCase()}${x.week ? `&week=${x.week}` : ''}`; };
  page(root, { eyebrow: 'Players to Watch', heading: `${tour} Players to Watch`, lede: 'The week’s biggest PropBetEdge Rating movements: risers, fallers, surface specialists on the rise, players the ranking list has not caught up with, and the best emerging players. Every list is a ranked calculation with minimum samples — no editorial picks.', chips: [[url({ tour: 'ATP' }), 'ATP', tour === 'ATP'], [url({ tour: 'WTA' }), 'WTA', tour === 'WTA']] });
  return load(root, `/v1/players-to-watch${week ? `?week=${week}` : ''}`, (d) => {
    const t = d.tours?.[tour];
    const weeks = d.weeks || [];
    const head = html`<p class="note">${d.edition === 'weekly' ? `Weekly edition of ${fmtDate(d.as_of)} (frozen)` : `Current lists, as of ${fmtDate(d.as_of)}`}${weeks.length ? html` · Past weeks: ${weeks.slice(0, 8).map((w, i) => html`${i ? ' · ' : ''}<a href="${url({ week: w })}">${fmtDate(w)}</a>`)}` : ''}${week ? html` · <a href="${url({ week: null })}">Current →</a>` : ''}</p>`;
    if (!t) return html`${head}<div class="mod"><p class="empty-h">No ${tour} lists in this edition.</p></div>`;
    if (t.status === 'not_validated') return html`${head}<div class="mod"><p class="empty-h">${tour} lists are withheld.</p><p class="note">${t.note}.</p></div>`;
    const sr = t.surface_risers_90d || {};
    return html`${head}<p class="note">Population: ${t.population} active ${tour} players with an established rating (20+ rated matches, a match in the last ${t.rules.recent_days} days); ${t.ranking_comparison_set} of them hold a top-${t.rules.rank_scope} rank and form the rating-vs-ranking set.</p>
      <div class="grid-2">${LISTS.slice(0, 2).map((l) => watchList(l, t))}</div>
      ${watchList(LISTS[2], t)}
      ${t.surface_rating_published ? html`<h2 class="sec">Surface risers <small>90-day surface rating gain · 3+ matches on the surface · 10+ surface-rated matches at the start</small></h2><div class="grid-3">${['hard', 'clay', 'grass'].map((s) => watchList([`${s}`, `${s[0].toUpperCase()}${s.slice(1)}`, `Surface rating gain on ${s}`, (r) => `${sgn(r.change)} · ${r.surface_rating_90d_ago} → ${r.surface_rating}`, (r) => `${r.surface_matches_90d} ${s} matches in 90 days`], sr))}</div>` : html`<p class="note">Surface risers are withheld: the ${tour} surface model has not passed its backtest.</p>`}
      <div class="grid-2">${LISTS.slice(3, 5).map((l) => watchList(l, t))}</div>
      ${watchList(LISTS[5], t)}
      <p class="note">PBE Rating is a chronological Elo over stored results (method v1); a rating movement is a fact about results, not a prediction. <a href="/methodology">Methodology →</a> · <a href="/matchups">This week’s matchups →</a></p>`;
  }, 'Players to Watch has not been built yet.', signal);
});
