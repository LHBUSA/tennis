// Phase 6 intelligence pages: Matchup DNA (upcoming matches + one matchup) and Players to Watch. Every number comes
// from tennis-api; a withheld probability or list says why; context is labelled as context.
import { html, render, setIndexable } from '../lib/dom.js';
import { api } from '../data/api.js';
import { emptyModule, errorModule, resultState, freshnessBadge } from '../ui/state.js';
import { avatar, nat } from '../ui/avatar.js';
import { fmtDate, localTime, roundLabel, cap } from '../ui/render.js';
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

// ---- /matchups/:id — Matchup Intelligence V2: a pre-match dossier ---------------------------------------------------
// Order: players + probability -> why PBE -> DNA category comparison -> Match DNA face-off -> serve/return collision ->
// surface -> form -> opposition -> pressure -> H2H -> load -> model validation. Only the probability is a model output;
// every other module is labelled context with its sample and confidence. Values come from /v1/matchups/:id only.
const cmpRow = (label, A, B, fmt, note = '') => html`<tr><th scope="row">${label}${note ? html`<small class="note"> ${note}</small>` : ''}</th><td class="n tabnum">${A == null ? '—' : fmt(A)}</td><td class="n tabnum">${B == null ? '—' : fmt(B)}</td></tr>`;
const EDGE_TXT = { A: (a) => a, B: (_, b) => b, no_edge: () => 'No edge', insufficient: () => 'Insufficient data' };
const fmtVal = (r, v) => (r.kind === 'rank' ? `No. ${Math.round(v)}` : r.kind === 'diff' ? sgn(v, 2) : r.kind === 'wae' ? sgn(v, 3) : pc1(v));
const recTxt = (x) => (x?.record ? (x.record.W != null ? `${x.record.W}–${x.record.L}` : x.record.losses != null ? `${x.record.losses} of ${x.record.matches}` : '') : '');
const sampleTxt = (x) => `${x.sample ?? '—'} ${x.sample === 1 ? 'match' : 'matches'} · ${x.confidence}`;

function heroSide(p, side, m, cls) {
  const seed = m.sides?.[side]?.seed;
  return html`<div class="mx-id ${cls}">
    ${p?.slug ? html`<a class="mx-portrait" href="/players/${p.slug}/dna" aria-label="${p.name} — Tennis DNA">${avatar(p, { size: 'portrait', px: 132, eager: true })}</a>` : avatar(p, { size: 'portrait', px: 132, eager: true })}
    <div class="mx-id-t"><b class="mx-name">${p?.slug ? html`<a href="/players/${p.slug}/dna">${p.name}</a>` : p?.name || 'TBD'}</b>
      <span class="mx-meta">${p?.nationality ? nat(p.nationality) : ''}${p?.rank ? html`<span>No. ${p.rank.rank}</span>` : ''}${seed ? html`<span>Seed ${seed}</span>` : ''}</span>
      ${p?.slug ? html`<a class="mx-dna-link" href="/players/${p.slug}/dna">View Tennis DNA →</a>` : ''}</div></div>`;
}

function heroCenter(d, a, b) {
  const mod = d.model;
  const nm = (p) => p?.last_name || p?.name;
  const t = d.match.tournament || {};
  const where = [roundLabel(d.match.round), t.tournament || t.name, t.surface ? cap(t.surface) : null].filter(Boolean).join(' · ');
  if (!mod?.probability) {
    return html`<div class="mx-center"><p class="mx-kicker">PBE Matchup Intelligence</p><p class="mx-withheld">${STATUS_TEXT[mod?.status] || 'No probability'}</p><p class="mx-reason">${mod?.reason || ''}</p>${mod?.rating_edge ? html`<p class="mx-edge">Rating edge ${Math.abs(mod.rating_edge.points)} pts${mod.rating_edge.favours ? ` · ${nm(mod.rating_edge.favours === 'A' ? a : b)}` : ''} · descriptive</p>` : ''}<p class="mx-where">${where}</p></div>`;
  }
  const pa = Math.round(mod.probability.A * 1000) / 10;
  const pb = Math.round((100 - pa) * 10) / 10;
  const fav = mod.probability.A >= mod.probability.B ? 'A' : 'B';
  return html`<div class="mx-center"><p class="mx-kicker">PBE Matchup Intelligence</p>
    <div class="mx-prob tabnum" role="img" aria-label="Win probability: ${a?.name} ${pa}%, ${b?.name} ${pb}%"><b class="${fav === 'A' ? 'fav' : ''}">${pa}<small>%</small></b><b class="${fav === 'B' ? 'fav' : ''}">${pb}<small>%</small></b></div>
    <div class="mx-bar" aria-hidden="true"><span style="width:${pa}%"></span></div>
    <p class="mx-edge">${nm(fav === 'A' ? a : b).toUpperCase()} EDGE · ${sgn(fav === 'A' ? mod.rating_edge.points : -mod.rating_edge.points)} RATING</p>
    <p class="mx-where">${where}${t.surface ? '' : ' · surface not sourced'}</p>
    <p class="mx-basis"><span class="mx-chip">PBE Rating · validated</span><span>Basis: ${mod.basis === 'surface_blend' ? `overall + ${mod.surface_ratings.surface} rating blend` : 'overall rating'}</span><span>Confidence: ${mod.confidence.level.replace('_', ' ')}</span></p></div>`;
}

function whyBlock(d, a, b) {
  const w = d.intel?.why;
  if (!w) return html`<section class="mod mx-why"><header class="mod-h"><h2>Why PBE has no number here</h2></header><ul>${d.why.map((x) => html`<li>${x}</li>`)}</ul></section>`;
  const fav = (w.favourite === 'A' ? a : b)?.last_name || w.favourite_name;
  return html`<section class="mod mx-why" aria-labelledby="mx-why-h"><header class="mod-h"><h2 id="mx-why-h">Why PBE leans ${fav}</h2></header>
    <div class="mx-why-g">
      <div class="mx-why-c k-model"><h3>Model</h3><ul>${w.model_inputs.map((x) => html`<li><b class="tabnum">${sgn(x.value)}</b> ${x.label}</li>`)}</ul><p class="note">The only inputs to the probability.</p></div>
      <div class="mx-why-c k-agree"><h3>Supporting context</h3>${w.supporting.length ? html`<ul>${w.supporting.map((x) => html`<li>${x} — ${fav} leads the DNA comparison</li>`)}</ul>` : html`<p class="note">No DNA category leans ${fav}.</p>`}</div>
      <div class="mx-why-c k-counter"><h3>Counterpoint</h3>${w.counterpoint.length ? html`<ul>${w.counterpoint.map((x) => html`<li>${x} — leans the other way</li>`)}</ul>` : html`<p class="note">No DNA category leans the other way.</p>`}</div>
    </div>
    <ul class="mx-why-t">${d.why.map((x) => html`<li>${x}</li>`)}</ul>
    <p class="note">${w.note}</p></section>`;
}

function edgeBlock(d, a, b) {
  const map = d.intel?.edge_map;
  if (!map) return '';
  const nm = (s) => (s === 'A' ? a : b)?.last_name || (s === 'A' ? a : b)?.name;
  return html`<section class="mod mx-edges" aria-labelledby="mx-edges-h"><header class="mod-h"><h2 id="mx-edges-h">DNA category comparison</h2><span class="mod-k">${map.version} · not a prediction</span></header>
    <div class="mx-tally tabnum"><div><b>${map.tally.A}</b><span>${nm('A')}</span></div><div><b>${map.tally.B}</b><span>${nm('B')}</span></div><div><b>${map.tally.no_edge}</b><span>No edge</span></div><div><b>${map.tally.insufficient}</b><span>Insufficient</span></div></div>
    <ul class="mx-edge-l">${map.categories.map((c) => html`<li class="e-${c.edge}"><span class="mx-cat">${c.label}</span><b>${EDGE_TXT[c.edge](nm('A'), nm('B'))}</b><small>${c.edge === 'insufficient' ? (c.note || `${c.qualified ?? 0} qualified comparison${c.qualified === 1 ? '' : 's'}`) : c.windows ? `wins above expectation · 10w ${c.windows[0]} · 52w ${c.windows[1]}` : c.points != null ? `${sgn(c.points)} rating points` : `${c.A}–${c.B} decided · ${c.even} even`}</small></li>`)}</ul>
    <p class="note">Rule: ${map.rule}</p></section>`;
}

const CAT_TITLE = { overall: 'Overall strength', pressure: 'Pressure situations', opposition: 'Opponent quality' };
function faceoffBlock(d, a, b) {
  const f = d.intel?.faceoff;
  if (!f?.rows?.length) return html`<section class="mod"><header class="mod-h"><h2>Match DNA</h2></header><p class="note">No Match DNA metric is qualified (medium/high confidence) for both players.</p></section>`;
  const nm = (p) => p?.last_name || p?.name;
  const row = (r) => {
    const span = r.kind === 'rate' ? 1 : Math.max(Math.abs(r.A.value), Math.abs(r.B.value)) || 1;
    const wA = r.kind === 'rank' ? null : Math.max(0, Math.min(100, (Math.abs(r.A.value) / span) * 100));
    const wB = r.kind === 'rank' ? null : Math.max(0, Math.min(100, (Math.abs(r.B.value) / span) * 100));
    return html`<li class="mx-row adv-${r.advantage || 'neutral'}">
      <span class="mx-row-l">${r.label}${r.better === 'low' ? html`<small>lower is better</small>` : r.better == null ? html`<small>style · no edge</small>` : ''}</span>
      <span class="mx-v a"><b class="tabnum">${fmtVal(r, r.A.value)}</b>${r.advantage === 'A' ? html`<i aria-label="${nm(a)} leads">◀</i>` : ''}<small>${recTxt(r.A)} ${sampleTxt(r.A)}</small>${wA != null ? html`<span class="mx-b" style="--w:${wA}%"></span>` : ''}</span>
      <span class="mx-v b">${r.advantage === 'B' ? html`<i aria-label="${nm(b)} leads">▶</i>` : ''}<b class="tabnum">${fmtVal(r, r.B.value)}</b><small>${recTxt(r.B)} ${sampleTxt(r.B)}</small>${wB != null ? html`<span class="mx-b" style="--w:${wB}%"></span>` : ''}</span></li>`;
  };
  const cats = ['overall', 'pressure', 'opposition'];
  return html`<section class="mod mx-faceoff" aria-labelledby="mx-fo-h"><header class="mod-h"><h2 id="mx-fo-h">Match DNA face-off</h2><span class="mod-k">${f.rows.length} qualified comparisons${f.withheld ? ` · ${f.withheld} withheld (low confidence)` : ''}</span></header>
    <div class="mx-names"><span>${nm(a)}</span><span>${nm(b)}</span></div>
    ${cats.map((c) => { const rows = f.rows.filter((r) => r.category === c); return rows.length ? html`<h3 class="mx-sub">${CAT_TITLE[c]}</h3><ul class="mx-rows">${rows.map(row)}</ul>` : ''; })}
    <p class="note">${f.basis}. ATP and WTA are never pooled.</p></section>`;
}

function collisionBlock(d, a, b) {
  const c = d.intel?.collision;
  const t = d.intel?.technical;
  const nm = (p) => p?.last_name || p?.name;
  if (!c?.available) return html`<section class="mod mx-col"><header class="mod-h"><h2>Serve / return collision</h2><span class="mod-k">technical DNA</span></header><p class="mx-honest">Not available for this matchup.</p><p class="note">${c?.reason || ''}${t?.withheld ? ` ${t.withheld} technical metric${t.withheld === 1 ? ' is' : 's are'} held below medium confidence.` : ''}</p></section>`;
  const side = (rows, srv, ret) => html`<div class="mx-col-s"><h3>When ${nm(srv)} serves</h3>${rows.length ? html`<ul>${rows.map((r) => html`<li><span class="mx-cl">${r.label}</span><b class="tabnum">${pc1(r.server.value)}</b><span class="mx-cbar" aria-hidden="true">${((e) => html`<i style="left:${e >= 0 ? 50 : 50 + e}%;width:${Math.abs(e)}%"></i>`)(Math.max(-50, Math.min(50, r.server_edge * 100)))}</span><b class="tabnum">${pc1(r.returner.value)}</b><small>${nm(ret)} return · edge ${sgn(r.server_edge * 100, 1)} pts</small></li>`)}</ul>` : html`<p class="note">No qualified pair.</p>`}</div>`;
  const read = (x, srv, ret) => (x ? `${nm(srv)}’s ${x.strongest_server.toLowerCase()} profile carries the most weight against ${nm(ret)}’s returns${x.strongest_returner ? `, while ${nm(ret)}’s return profile resists ${nm(srv)}’s ${x.strongest_returner.toLowerCase()} most` : ''}.` : null);
  const reads = [read(c.read?.A_serving, a, b), read(c.read?.B_serving, b, a)].filter(Boolean);
  return html`<section class="mod mx-col" aria-labelledby="mx-col-h"><header class="mod-h"><h2 id="mx-col-h">Serve / return collision</h2><span class="mod-k">technical DNA · context</span></header>
    <div class="mx-col-g">${side(c.A_serving, a, b)}${side(c.B_serving, b, a)}</div>
    ${reads.length ? html`<p class="mx-read"><b>PBE read</b> ${reads.join(' ')} Historical measurement only — not a causal claim and not a model input.</p>` : ''}
    ${t?.rows?.length ? html`<details class="mx-tech"><summary>All ${t.rows.length} qualified technical metrics</summary><div class="tbl-wrap"><table class="tbl mu-tbl"><thead><tr><th></th><th class="n">${nm(a)}</th><th class="n">${nm(b)}</th></tr></thead><tbody>${t.rows.map((r) => cmpRow(r.label, r.A.value, r.B.value, pc1, r.better === 'low' ? '(lower is better)' : ''))}</tbody></table></div></details>` : ''}
    <p class="note">${c.note}</p></section>`;
}

function surfaceBlock(d, a, b) {
  const s = d.intel?.surface_profile;
  if (!s) return '';
  const nm = (p) => p?.last_name || p?.name;
  const S = ['hard', 'clay', 'grass'];
  return html`<section class="mod mx-surface"><header class="mod-h"><h2>${s.tournament_surface ? `${cap(s.tournament_surface)} court DNA` : 'Surface DNA'}</h2><span class="mod-k">PBE surface ratings</span></header>
    <div class="tbl-wrap"><table class="tbl mu-tbl"><thead><tr><th></th><th class="n">${nm(a)}</th><th class="n">${nm(b)}</th></tr></thead><tbody>${S.map((k) => html`<tr class="${s.tournament_surface === k ? 'on' : ''}"><th scope="row">${cap(k)}${s.tournament_surface === k ? html` <small>this event</small>` : ''}</th><td class="n tabnum">${s.A?.[k] ? html`${s.A[k].rating} <small>${sgn(s.A[k].vs_overall)} vs overall · ${s.A[k].rated_matches}</small>` : '—'}</td><td class="n tabnum">${s.B?.[k] ? html`${s.B[k].rating} <small>${sgn(s.B[k].vs_overall)} vs overall · ${s.B[k].rated_matches}</small>` : '—'}</td></tr>`)}</tbody></table></div>
    <p class="note">${s.note || (d.model?.surface_ratings?.used ? `The model used the ${s.tournament_surface} blend.` : `The model did not use a ${s.tournament_surface} blend (it needs both players with 5+ ${s.tournament_surface}-rated matches and a validated surface model).`)}</p></section>`;
}

function formBlock(d, a, b) {
  const f = d.context?.form || {};
  const nm = (p) => p?.last_name || p?.name;
  const cell = (x) => (x ? html`<b class="tabnum">${x.W}–${x.L}</b><small>vs expectation ${sgn(x.wae, 3)} · ${x.n_rated} rated</small>` : '—');
  return html`<section class="mod mx-form"><header class="mod-h"><h2>Form</h2><span class="mod-k">opponent-adjusted</span></header>
    <div class="mx-form-g"><span></span><span class="mx-fh">Last 10 weeks</span><span class="mx-fh">Last 52 weeks</span>
      ${['A', 'B'].map((s) => html`<span class="mx-fn">${nm(s === 'A' ? a : b)}</span><span class="mx-fc">${cell(f['10w']?.[s])}</span><span class="mx-fc">${cell(f['52w']?.[s])}</span>`)}</div>
    <p class="note">“vs expectation” = results minus what each player’s rating predicted against those opponents, so a strong record against weak schedules does not look stronger than it is.${f['52w']?.wae_edge != null ? ` 52-week edge ${sgn(f['52w'].wae_edge, 3)} per match.` : ''}</p></section>`;
}

function oppBlock(d, a, b) {
  const rows = (d.intel?.faceoff?.rows || []).filter((r) => r.category === 'opposition' && r.A.record && r.B.record);
  if (!rows.length) return '';
  const nm = (p) => p?.last_name || p?.name;
  const maxN = Math.max(...rows.flatMap((r) => [r.A.sample, r.B.sample]));
  const pill = (x) => html`<span class="mx-opp-v" style="--o:${0.35 + 0.65 * Math.min(1, (x.sample || 0) / maxN)}"><b class="tabnum">${recTxt(x)}</b><small>${pc1(x.value)} · ${x.sample}</small></span>`;
  return html`<section class="mod mx-opp"><header class="mod-h"><h2>Opponent-strength profile</h2><span class="mod-k">opacity = sample size</span></header>
    <div class="mx-names"><span>${nm(a)}</span><span>${nm(b)}</span></div>
    <ul class="mx-opp-l">${rows.map((r) => html`<li><span class="mx-cat">${r.label}</span>${pill(r.A)}${pill(r.B)}</li>`)}</ul>
    <p class="note">A small sample is drawn fainter: a 1–0 record never competes visually with 14–11.</p></section>`;
}

function pressureBlock(d, a, b) {
  const rows = (d.intel?.faceoff?.rows || []).filter((r) => r.category === 'pressure' && r.better);
  if (!rows.length) return '';
  const nm = (p) => p?.last_name || p?.name;
  return html`<section class="mod mx-press"><header class="mod-h"><h2>Pressure profile</h2><span class="mod-k">specific metrics</span></header>
    <div class="mx-press-g">${rows.map((r) => html`<div class="mx-pc adv-${r.advantage}"><h3>${r.label}</h3><p><span>${nm(a)}</span><b class="tabnum">${pc1(r.A.value)}</b><small>${r.A.sample} matches</small></p><p><span>${nm(b)}</span><b class="tabnum">${pc1(r.B.value)}</b><small>${r.B.sample} matches</small></p></div>`)}</div>
    <p class="note">Each card is one defined Match DNA metric with its sample.</p></section>`;
}

function h2hBlock(d, a, b) {
  const h = d.h2h;
  const nm = (p) => p?.last_name || p?.name;
  const bys = d.intel?.h2h_by_surface;
  return html`<section class="mod mu-h2h mx-h2h"><header class="mod-h"><h2>Head to head</h2><span class="mod-k">not a model input</span></header>
    <p class="h2h-big tabnum"><span>${nm(a)}</span> <b>${h.record.A}</b> – <b>${h.record.B}</b> <span>${nm(b)}</span></p>
    ${bys ? html`<p class="mx-h2h-s">${Object.entries(bys).map(([s, x]) => html`<span><b>${cap(s)}</b> ${x.A}–${x.B}</span>`)}</p>` : ''}
    ${h.meetings.length ? html`<ul class="mx-meet">${h.meetings.map((x) => html`<li><span class="tabnum">${x.year || ''}</span><span>${x.tournament || ''}${x.surface ? html` <small>${x.surface}</small>` : ''}</span><b>${nm(x.won_by === 'A' ? a : b)}</b><span class="tabnum">${x.score || ''}</span></li>`)}</ul>` : html`<p class="note">No stored meeting.</p>`}
    <p class="note">${h.note}.</p></section>`;
}

function loadBlock(d, a, b) {
  const c = d.context;
  const nm = (p) => p?.last_name || p?.name;
  return html`<section class="mod mx-load"><header class="mod-h"><h2>Schedule load</h2><span class="mod-k">workload context</span></header>
    <div class="tbl-wrap"><table class="tbl mu-tbl"><thead><tr><th></th><th class="n">${nm(a)}</th><th class="n">${nm(b)}</th></tr></thead><tbody>
      ${cmpRow('Rest (days since last match)', c.rest?.A?.days_since_last, c.rest?.B?.days_since_last, (v) => `${v}d`)}
      ${cmpRow('Matches, last 7 days', c.rest?.A?.matches_7d, c.rest?.B?.matches_7d, (v) => `${v}`)}
      ${cmpRow('Sets, last 7 days', c.rest?.A?.sets_7d, c.rest?.B?.sets_7d, (v) => `${v}`)}
      ${cmpRow('Matches, last 14 days', c.rest?.A?.matches_14d, c.rest?.B?.matches_14d, (v) => `${v}`)}
      ${cmpRow('Previous event', c.travel?.A?.previous_event ? `${c.travel.A.previous_event}${c.travel.A.previous_city ? ` · ${c.travel.A.previous_city}` : ''}` : null, c.travel?.B?.previous_event ? `${c.travel.B.previous_event}${c.travel.B.previous_city ? ` · ${c.travel.B.previous_city}` : ''}` : null, (v) => v)}
    </tbody></table></div>
    <p class="note">${c.rest?.basis || ''}. Schedule and location exactly as the sources publish them: workload context only, with no distance or travel-time estimate.</p></section>`;
}

function validationBlock(d) {
  const mod = d.model;
  const bt = mod?.confidence?.backtest;
  const sim = mod?.confidence?.similar_matches;
  const s = sim?.same_surface || sim?.all_surfaces;
  if (!mod?.model) return '';
  return html`<section class="mod mx-valid" aria-labelledby="mx-v-h"><header class="mod-h"><h2 id="mx-v-h">Model validation</h2><span class="mod-k">PBE Rating · method v${mod.model.method_version}${mod.model.variant ? ` (${mod.model.variant})` : ''} · matchup v${mod.model.matchup_version}</span></header>
    ${bt ? html`<div class="mx-vg tabnum">
      <div><span>Out-of-sample matches</span><b>${bt.matches.toLocaleString('en-US')}</b></div>
      <div><span>Accuracy</span><b>${pc1(bt.accuracy)}</b></div>
      <div><span>Log loss</span><b>${bt.log_loss}</b>${bt.vs_rank ? html`<small>vs ranking model ${bt.vs_rank.rank_log_loss} (rating ${bt.vs_rank.rating_log_loss} on the shared set)</small>` : ''}</div>
      <div><span>Brier</span><b>${bt.brier}</b></div></div>` : html`<p class="note">No backtest summary for this tour.</p>`}
    ${s ? html`<p class="mx-cal"><b>Historical calibration</b> In ${s.matches.toLocaleString('en-US')} past ${s.surface === 'all' ? '' : `${s.surface} `}matches where the model gave the favourite ${Math.round(s.band[0] * 100)}–${Math.round(s.band[1] * 100)}%, the favourite won <b>${pc1(s.favourite_won)}</b> (predicted ${pc1(s.predicted)}).</p>` : ''}
    ${mod.ratings ? html`<p class="note">Ratings: ${mod.ratings.A.value} (${mod.ratings.A.rated_matches} rated) vs ${mod.ratings.B.value} (${mod.ratings.B.rated_matches} rated). A probability is published only for a validated tour and players inside the backtested range; withheld otherwise. <a href="/methodology">Methodology →</a></p>` : ''}</section>`;
}

export const matchup = mount(async (root, { params }, signal) => {
  render(root, html`<div class="page"><p class="loading">Loading matchup…</p></div>`);
  let res;
  try { res = await api(`/v1/matchups/${params.id}`, { signal }); } catch { return; }
  if (resultState(res) === 'error') { render(root, html`<div class="page">${errorModule(res.meta, 'Matchup DNA could not be loaded.')}</div>`); return; }
  if (!res.data) { render(root, html`<div class="page">${emptyModule(res.meta, 'Matchup DNA covers singles matches with both players identified.')}</div>`); return; }
  const d = res.data; const m = d.match; const a = P(m, 'A'); const b = P(m, 'B');
  track('tennis_matchup_open', { match_id: m.id, tour: d.tour, probability: d.model?.status });
  document.title = `${a?.name} vs ${b?.name} — Matchup Intelligence | PropBetEdge Tennis`;
  setIndexable(false);
  render(root, html`<div class="mx">
    <section class="mx-hero" aria-label="Matchup">
      <div class="mx-hero-in">${heroSide(a, 'A', m, 'a')}${heroCenter(d, a, b)}${heroSide(b, 'B', m, 'b')}</div>
      <p class="mx-hero-meta">${d.tour} · ${m.scheduled_at ? `${fmtDate(m.scheduled_at.slice(0, 10))} ${localTime(m.scheduled_at)}` : 'start time not published'}${m.court ? ` · ${m.court}` : ''} · ${freshnessBadge(res.meta)}</p>
    </section>
    <div class="page mx-body">
      ${whyBlock(d, a, b)}
      ${edgeBlock(d, a, b)}
      ${faceoffBlock(d, a, b)}
      <div class="mx-grid">${collisionBlock(d, a, b)}${surfaceBlock(d, a, b)}${formBlock(d, a, b)}${oppBlock(d, a, b)}${pressureBlock(d, a, b)}${h2hBlock(d, a, b)}${loadBlock(d, a, b)}</div>
      ${validationBlock(d)}
      <p class="note"><a href="/matches/${m.id}">Match page →</a> · <a href="/matchups">All matchups →</a> · <a href="/methodology">Methodology →</a></p>
    </div></div>`);
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
