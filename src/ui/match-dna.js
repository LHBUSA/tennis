// Tennis DNA v2 presentation: Match DNA families, PBE Rating, form and match history with the opponent's rank at
// match time. Renders only what /v1/players/:slug/dna returns (stored, gated server-side); never computes a
// comparison in the browser.
import { html } from '../lib/dom.js';
import { avatar } from './avatar.js';
import { fmtDate } from './render.js';

const ORD = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const STATUS = { missing: 'No sample', descriptive: 'Descriptive only', player_sample_low: 'Sample too small', population_building: 'Tour comparison building', peer_sample_not_mature: 'Peer sample not mature' };

export function fmtMetric(m) {
  if (m.value == null) return '—';
  if (m.unit === 'ratio') return `${(m.value * 100).toFixed(1)}%`;
  if (m.unit === 'rank') return `No. ${Math.round(m.value)}`;
  if (m.unit === 'wins_per_match') return `${m.value >= 0 ? '+' : ''}${m.value.toFixed(3)}`;
  return `${m.value >= 0 ? '+' : ''}${m.value.toFixed(2)}`;
}
const sampleText = (m) => (m.record && m.record.W != null ? `${m.record.W}–${m.record.L}` : m.numerator == null ? '' : m.unit === 'ratio' ? `${m.numerator}/${m.denominator}` : `${m.denominator} matches`);

export function ratingLine(r) {
  if (!r) return '';
  if (r.status === 'not_validated') return html`<span class="note">PBE Rating not published for this tour yet (backtest pending)</span>`;
  return html`<b class="tabnum">${r.value}</b><small>${r.percentile != null ? `${ORD(r.percentile)} percentile · ` : ''}${r.rated_matches} rated matches${r.provisional ? ' · provisional' : ''}</small>`;
}

export function formBlock(f) {
  if (!f) return '';
  const rec = (x, k) => html`<div><span>Last ${k}</span><b class="tabnum">${x.W}–${x.L}</b></div>`;
  return html`<div class="surfrec">${rec(f.last5, 5)}${rec(f.last10, 10)}${rec(f.last20, 20)}${f.current_streak ? html`<div><span>Streak</span><b class="tabnum">${f.current_streak.result}${f.current_streak.length}</b></div>` : ''}</div>
    <p class="note">Rolling last ${f.rolling20.matches}: sets ${f.rolling20.set_win_rate == null ? '—' : `${(f.rolling20.set_win_rate * 100).toFixed(1)}%`} · games ${f.rolling20.game_win_rate == null ? '—' : `${(f.rolling20.game_win_rate * 100).toFixed(1)}%`} · longest win streak in 52 weeks ${f.longest_win_streak_52w}${f.last20.from ? ` · ${fmtDate(f.last20.from)} – ${fmtDate(f.last20.to)}` : ''}</p>`;
}

export function familyTable(fam, tour) {
  return html`<section class="mod"><header class="mod-h"><h2>${fam.label}</h2><span class="mod-k">${fam.published} of ${fam.metrics.length} compared across ${tour}</span></header>
    <div class="tbl-wrap"><table class="tbl dna-tbl"><thead><tr><th>Metric</th><th class="n">Value</th><th class="n hide-s">Sample</th><th>Confidence</th><th>${tour} percentile</th></tr></thead><tbody>
    ${fam.metrics.map((m) => html`<tr><th scope="row" style="text-align:left" title="${m.doc}">${m.label}</th><td class="n tabnum">${fmtMetric(m)}</td><td class="n hide-s">${sampleText(m)}</td><td><span class="conf c-${m.confidence}">${m.confidence}</span></td><td>${m.percentile != null ? html`<b>${ORD(m.percentile)}</b>` : html`<span class="note">${STATUS[m.status] || '—'}</span>`}</td></tr>`)}
    </tbody></table></div></section>`;
}

/** Headline Match DNA card for the overview. */
export function matchDnaSummary(md, slug) {
  const get = (k) => md.families.flatMap((f) => f.metrics).find((m) => m.key === k);
  const cell = (k, label) => { const m = get(k); return m ? html`<div><span>${label}</span><b class="tabnum">${m.record ? `${m.record.W}–${m.record.L}` : fmtMetric(m)}</b><small class="note">${m.percentile != null ? `${ORD(m.percentile)} pct` : m.confidence}</small></div>` : ''; };
  return html`<section class="mod mdna-summary"><header class="mod-h"><h2><a href="/players/${slug}/dna">Match DNA</a> <span class="tag">summary</span></h2><a class="mod-k dna-cta" href="/players/${slug}/dna">Open full Tennis DNA →</a></header>
    <div class="surfrec mdna">${cell('match_win_rate', 'Match win')}${cell('set_win_rate', 'Set win')}${cell('game_win_rate', 'Games won')}${cell('deciding_set_win_rate', 'Deciding sets')}${cell('tiebreak_win_rate', 'Tiebreaks')}${cell('comeback_win_rate', 'Comebacks')}${cell('top10_win_rate', 'vs top 10')}${cell('top25_win_rate', 'vs top 25')}${cell('top50_win_rate', 'vs top 50')}</div>
    <p class="note">${md.sample.matches} singles matches (${fmtDate(md.sample.first_day)} – ${fmtDate(md.sample.last_day)}) from the canonical match record, as of ${fmtDate(md.as_of)}. Rank-based records use the list in force when each tournament began.</p>
    <p class="dna-more"><a class="btn line" href="/players/${slug}/dna">Summary · Open full Match DNA, rating history, splits and surface intelligence →</a></p></section>`;
}

const rankTxt = (r) => (!r ? '—' : r.rank ? `No. ${r.rank}` : `>${r.outside}`);
export function historyTable(md) {
  if (!md.recent?.length) return html`<p class="note">No matches in the record yet.</p>`;
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Opponent</th><th class="hide-s">Tournament</th><th>Rd</th><th>Score</th><th class="n hide-s">Opp. rank</th></tr></thead><tbody>
    ${md.recent.map((r) => html`<tr><td class="tabnum">${fmtDate(r.day)}</td><td><span class="rk-p"><b class="${r.won ? 'won' : 'lost'}">${r.won ? 'W' : 'L'}</b> ${r.opponent ? html`${avatar(r.opponent, { px: 24 })}<a href="/players/${r.opponent.slug}">${r.opponent.name}</a>` : 'Unknown'}</span></td><td class="hide-s">${r.tournament ? html`${r.tournament.slug ? html`<a href="/tournaments/${r.tournament.slug}/${r.tournament.year}">${r.tournament.name} ${r.tournament.year}</a>` : `${r.tournament.name} ${r.tournament.year}`}` : '—'}</td><td>${r.round}</td><td class="tabnum"><a href="/matches/${r.match_id}">${r.score}</a></td><td class="n hide-s tabnum">${rankTxt(r.opponent_rank)}</td></tr>`)}
    </tbody></table></div><p class="note">Opponent rank = the list in force when the tournament began (at most 28 days old); “>150” means outside a list of that length; “—” = no list in force.</p>`;
}

/** Career record, ranking peak and yearly singles records from the stored Match DNA (absent facts are not shown). */
export function careerBlock(md) {
  const f = md.form || {};
  const years = Object.entries(f.years || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const pk = f.rank_peak;
  if (!f.career && !years.length) return '';
  return html`<section class="mod"><header class="mod-h"><h2>Career</h2><span class="mod-k">singles in the PropBetEdge record</span></header>
    <div class="surfrec">${f.career ? html`<div><span>Career</span><b class="tabnum">${f.career.W}–${f.career.L}</b><small class="note">${fmtDate(f.career.from)} – ${fmtDate(f.career.to)}</small></div>` : ''}
    ${pk ? html`<div><span>Best ranking</span><b class="tabnum">No. ${pk.rank}</b><small class="note">${fmtDate(pk.date)}${pk.source === 'espn' ? ' · secondary-source list' : ''}</small></div>` : ''}</div>
    ${years.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Year</th><th class="n">W–L</th><th class="n">Win %</th></tr></thead><tbody>${years.map(([y, r]) => html`<tr><td>${y}</td><td class="n tabnum">${r.W}–${r.L}</td><td class="n tabnum">${r.W + r.L ? `${((r.W / (r.W + r.L)) * 100).toFixed(0)}%` : '—'}</td></tr>`)}</tbody></table></div>` : ''}
    <p class="note">Counts only matches stored in the canonical record (official feeds, official WTA player history and a secondary source); earlier or unsourced matches are not included, and a best ranking covers only the lists archived.</p></section>`;
}

/** Surface Match DNA: the same metrics on each sourced surface, compared within the tour x surface population. */
export function surfaceTable(md) {
  const S = md.by_surface || [];
  if (!S.length) return '';
  const cell = (m) => (m.value == null ? html`<span class="note">—</span>` : html`<b class="tabnum">${m.record && m.record.W != null ? `${m.record.W}–${m.record.L}` : fmtMetric(m)}</b><small class="note">${m.percentile != null ? `${ORD(m.percentile)} pct` : STATUS[m.status] || m.confidence}</small>`);
  const keys = S[0].metrics.map((m) => [m.key, m.label]);
  return html`<section class="mod"><header class="mod-h"><h2>By surface</h2><span class="mod-k">${md.tour} players on each surface · surface from the tournament's own record</span></header>
    <div class="tbl-wrap"><table class="tbl surf-tbl"><thead><tr><th>Metric</th>${S.map((s) => html`<th class="n">${s.surface[0].toUpperCase()}${s.surface.slice(1)}</th>`)}</tr></thead><tbody>
    <tr><th scope="row" style="text-align:left">Record</th>${S.map((s) => html`<td class="n tabnum">${s.form?.career ? `${s.form.career.W}–${s.form.career.L}` : '—'}</td>`)}</tr>
    <tr><th scope="row" style="text-align:left">Surface PBE Rating</th>${S.map((s) => html`<td class="n">${surfaceRatingCell(s, md.tour)}</td>`)}</tr>
    <tr><th scope="row" style="text-align:left">Last 10</th>${S.map((s) => html`<td class="n tabnum">${s.form?.last10 ? `${s.form.last10.W}–${s.form.last10.L}` : '—'}</td>`)}</tr>
    ${keys.map(([k, label]) => html`<tr><th scope="row" style="text-align:left">${label}</th>${S.map((s) => html`<td class="n">${cell(s.metrics.find((m) => m.key === k))}</td>`)}</tr>`)}
    </tbody></table></div><p class="note">Only matches whose tournament edition has a sourced surface count; a surface needs at least 5 matches.${unsourcedNote(md)} Percentiles compare ${md.tour} players on the same surface and publish per metric under the same gates as overall Match DNA. ${surfaceGateNote(S, md.tour)}</p></section>`;
}

const RATED_MIN = 20;
/** Surface PBE Rating cell: a value, or the explicit reason there is none — never a blank. */
export function surfaceRatingCell(s, tour) {
  const r = s.rating;
  const sf = s.surface;
  if (!r) return html`<span class="note">not rated: no rated ${sf} matches</span>`;
  if (r.status === 'not_validated') return html`<span class="note">Not published — the ${tour} surface model has not passed its out-of-sample validation gate</span>`;
  if (r.percentile != null) return html`<b class="tabnum">${r.value}</b><small class="note">${ORD(r.percentile)} pct</small>`;
  const why = (r.rated_matches ?? 0) < RATED_MIN ? `${r.rated_matches ?? 0} rated ${sf} matches (${RATED_MIN} needed)` : `no rated ${sf} match in the last 365 days`;
  return html`<b class="tabnum">${r.value}</b><small class="note">no percentile: ${why}</small>`;
}

/** How many singles results are outside the surface table because their tournament has no sourced surface. */
function unsourcedNote(md) {
  const career = md.form?.career;
  const total = career ? career.W + career.L : null;
  const placed = (md.by_surface || []).reduce((t, s) => t + (s.form?.career ? s.form.career.W + s.form.career.L : 0), 0);
  if (total == null || total <= placed) return '';
  return ` ${total - placed} of ${total} singles results have no sourced surface (the source publishes none for that tournament) and are left out — never inferred from a tournament name.`;
}

function surfaceGateNote(S, tour) {
  const rated = S.filter((s) => s.rating);
  if (!rated.length) return '';
  return rated.some((s) => s.rating.status === 'not_validated')
    ? `${tour} surface PBE Ratings are not published: the surface model has not beaten the overall rating out of sample.`
    : `${tour} surface PBE Ratings are published: the ${tour} surface blend beat the overall rating out of sample (methodology). A surface percentile needs ${RATED_MIN}+ rated matches on the surface and one in the last 365 days.`;
}
