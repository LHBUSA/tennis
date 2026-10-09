// PBE PICKS + Track Record (Picker V1 ledger, tennis-api /v1/picks*). Owner decisions 2026-10-04.
// NOT ACTIVATED: until the owner activates Official Picks these surfaces render only with ?preview=picker (proof /
// owner review); everyone else keeps the "not live" pages. Every record is PROSPECTIVE · NOT OFFICIAL until activation,
// and activation never makes an earlier decision official. Pending pre-match sides are All Access (/v1/picks is
// premium); resolved proof is public (/v1/picks/track-record). Market numbers are benchmarks frozen at the lock from
// PropBetEdge's own observations, one venue at a time, compared with PBE only where the rules match.
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { emptyModule, errorModule, resultState, freshnessBadge } from '../ui/state.js';
import { localTime, fmtDate, roundLabel } from '../ui/render.js';

import { PICKS_LIVE } from './picks-flag.js'; // owner activation flips it (with PICKER_POLICY.activated_at); never before
export const picksVisible = (search = globalThis.location?.search || '') => PICKS_LIVE || new URLSearchParams(search).get('preview') === 'picker';

const pc = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const VENUE = { kalshi: 'Kalshi', polymarket: 'Polymarket' };
const STATE_CLS = { CALL: 'call', PASS: 'pass', HOLD: 'hold' };
const RES_CLS = { W: 'w', L: 'l', VOID: 'void' };
const RES_TEXT = { W: 'RIGHT', L: 'MISSED', VOID: 'VOID' };
const OP_TEXT = { MATCH_WINNER: 'Match winner', SURFACE_MATCHUP: 'Surface matchup', UNDERDOG_WATCH: 'Underdog watch', PBE_ABOVE_MARKET: 'PBE above market', PBE_BELOW_MARKET: 'PBE below market' };
const opText = (o) => `${OP_TEXT[o.code] || o.code}${o.venue && (o.code === 'PBE_ABOVE_MARKET' || o.code === 'PBE_BELOW_MARKET') ? ` · ${VENUE[o.venue] || o.venue} ${o.diff > 0 ? '+' : ''}${Math.round(o.diff * 100)} pts` : ''}`;
const lockText = (l) => (l.rule === 'T_MINUS_60' ? `Locked ${localTime(l.lock_at)} · 60 min before the sourced start` : l.rule === 'DAY_START_LOCK' ? `Locked ${localTime(l.lock_at)} · start of ${fmtDate(l.day)} (tournament local, UTC${l.utc_offset})` : 'No lock time: no sourced start and no source-proven day + timezone');
const who = (e, s) => { const p = e?.[s]; return p ? (p.slug ? html`<a href="/players/${p.slug}">${p.name}</a>` : p.name) : 'TBD'; };

/** One venue benchmark frozen at the lock (or why there is none). Never a live price. */
function venueAtLock(v, pick) {
  const name = VENUE[v.venue] || v.venue;
  const rel = v.comparable ? 'Same contract' : v.semantic_class === 'RULE_MISMATCH' ? 'Related market · rules differ' : v.semantic_class === 'VENUE_ONLY' ? 'Related market' : 'Related market · rules not verified';
  if (v.benchmark === 'NO_OBSERVATION_AT_PBE_FORECAST') return html`<li class="pk-v"><b>${name}</b> <span class="pk-rel">${rel}</span> <span class="pk-miss">No observation at the lock${v.coverage && !v.coverage.covered ? ' (our reader had no fresh read)' : ''} — stays missing</span></li>`;
  const sel = v.benchmark?.sides?.find((x) => x.team_id === pick.selection?.selection_id);
  const p = v.selection_market_p_bp != null ? v.selection_market_p_bp / 1e4 : sel?.mid_bp != null ? sel.mid_bp / 1e4 : null;
  return html`<li class="pk-v"><b>${name}</b> <span class="pk-rel">${rel}</span> ${pick.selection?.selection_name || 'Selection'} ${p == null ? '—' : pc(p, 0)} <span class="pk-age">observed ${localTime(v.benchmark.observed_at)}</span>${v.comparable && p != null && pick.probability != null ? html` <span class="pk-div">PBE ${pc(pick.probability, 0)} vs market ${pc(p, 0)}</span>` : ''}</li>`;
}

/** The PBE PICK card (also used above Market Pulse on the match page). */
export function pickCard(pick, { compact = false } = {}) {
  const e = pick.event || {};
  const st = pick.state;
  const head = st === 'CALL' && pick.side ? html`PBE PICK · <b>${pick.selection?.selection_name || who(e, pick.side.toLowerCase())}</b> ${pc(pick.probability, 0)}` : st === 'CALL' ? html`PBE PICK · locked (All Access)` : html`${st} · ${pick.reasons.map((r) => r.code.replace(/_/g, ' ')).join(', ')}`;
  const shadow = pick.scope === 'atp_shadow';
  return html`<article class="pk pk-${STATE_CLS[st] || 'hold'}${shadow ? ' pk-shadow' : ''}" data-pick="${pick.match_id}" data-scope="${pick.scope}">
    <header class="pk-h"><span class="pk-label">${shadow ? 'SHADOW · ATP research — not an official pick' : pick.label}</span>${pick.grade ? html`<span class="pk-res pk-${RES_CLS[pick.grade.result]}">${RES_TEXT[pick.grade.result] || pick.grade.result}</span>` : st === 'CALL' ? html`<span class="pk-res pk-pend">PENDING</span>` : ''}</header>
    <p class="pk-main">${head}</p>
    ${compact ? '' : html`<p class="pk-ev">${who(e, 'a')} vs ${who(e, 'b')} · ${e.tour || ''}${e.level ? ` ${e.level}` : ''}${e.round ? ` · ${roundLabel(e.round)}` : ''}</p>`}
    <p class="pk-lock">${lockText(pick.lock)}</p>
    ${pick.uncertainty ? html`<p class="pk-unc">In development testing, favourites priced ${Math.round(pick.uncertainty.band[0] * 100)}–${Math.round(pick.uncertainty.band[1] * 100)}% won ${pc(pick.uncertainty.favourite_won, 0)} of ${pick.uncertainty.past_calls.toLocaleString('en-US')}${pick.probability_uncalibrated != null ? ` · uncalibrated PBE Rating ${pc(pick.probability_uncalibrated, 0)}` : ''}</p>` : ''}
    ${pick.opportunities?.length ? html`<ul class="pk-ops" aria-label="Labels">${pick.opportunities.map((o) => html`<li class="pk-op">${opText(o)}</li>`)}</ul>` : ''}
    ${pick.why?.length ? html`<ul class="pk-whylist" aria-label="Why">${pick.why.map((w) => html`<li>${w}</li>`)}</ul>` : ''}
    ${pick.reasons.length ? html`<p class="pk-why">${pick.reasons.map((r) => r.text).join(' · ')}</p>` : ''}
    ${pick.grade ? html`<p class="pk-grade">Result: ${pick.grade.score || pick.grade.reason}${pick.grade.scores ? html` · Brier ${pick.grade.scores.brier.toFixed(3)}` : ''}</p>` : ''}
    ${pick.markets_at_lock?.length ? html`<ul class="pk-venues" aria-label="Prediction markets at the lock">${pick.markets_at_lock.map((v) => venueAtLock(v, pick))}</ul>` : pick.markets_status === 'UNAVAILABLE_AT_DECISION' ? html`<p class="pk-miss">Market observations were unavailable at the lock — permanently missing.</p>` : ''}
    ${pick.evidence ? html`<p class="pk-proof">Evidence frozen ${localTime(pick.evidence.frozen_at)} · sha256 ${pick.evidence.sha256.slice(0, 12)}</p>` : ''}
    ${pick.policy?.version ? html`<p class="pk-ver">${pick.policy.version}${pick.model?.challenger ? ` · ${pick.model.challenger}` : ''}${pick.model?.basis ? ` · ${pick.model.basis === 'surface_blend' ? 'surface blend' : 'overall rating'}` : ''}</p>` : ''}
    ${compact ? '' : html`<p class="pk-links"><a href="/matches/${pick.match_id}">Match</a><a href="/pbecast/${pick.match_id}">PBEcast</a></p>`}
  </article>`;
}

function recordTable(rec) {
  const rows = [['wta_main', 'WTA main tour (official candidate)'], ['shadow_wta125', 'WTA 125 (shadow)'], ['atp_shadow', 'ATP (SHADOW research, recalibrated)'], ['atp', 'ATP Picker V1 (not validated)']].filter(([k]) => rec?.[k]);
  if (!rows.length) return '';
  const bandRows = rows.flatMap(([k, l]) => Object.entries(rec[k].by_probability || {}).map(([b, x]) => [l, b, x]));
  const opRows = rows.flatMap(([k, l]) => Object.entries(rec[k].opportunities || {}).filter(([c]) => c !== 'MATCH_WINNER').map(([c, x]) => [l, c, x]));
  return html`<table class="pk-table"><thead><tr><th>Scope</th><th>Version</th><th>Decisions</th><th>CALL / PASS / HOLD</th><th>Graded</th><th>Right–Missed</th><th>VOID</th><th>Pending</th><th>Hit rate (95%)</th><th>Mean PBE p</th><th>Brier</th><th>Locked before start</th></tr></thead><tbody>
    ${rows.map(([k, l]) => { const r = rec[k]; return html`<tr><th>${l}</th><td>${r.version || '—'}</td><td>${r.decisions}</td><td>${r.CALL} / ${r.PASS} / ${r.HOLD}</td><td>${r.graded}</td><td>${r.W}–${r.L}</td><td>${r.VOID}</td><td>${r.pending}</td><td>${pc(r.hit_rate)}${r.wilson95 ? ` (${pc(r.wilson95[0], 0)}–${pc(r.wilson95[1], 0)})` : ''}</td><td>${pc(r.mean_p)}</td><td>${r.brier == null ? '—' : r.brier.toFixed(3)}</td><td>${r.lock_integrity ? `${r.lock_integrity.before_start} / ${r.lock_integrity.checked}` : '—'}</td></tr>`; })}
  </tbody></table>
  ${bandRows.length ? html`<p class="pk-sub">By PBE probability (chalk stays visible as chalk)</p><table class="pk-table"><thead><tr><th>Scope</th><th>PBE probability</th><th>Graded</th><th>Right</th><th>Hit rate</th><th>Mean PBE p</th></tr></thead><tbody>${bandRows.map(([l, b, x]) => html`<tr><th>${l}</th><td>${b}%</td><td>${x.graded}</td><td>${x.W}</td><td>${pc(x.hit_rate)}</td><td>${pc(x.mean_p)}</td></tr>`)}</tbody></table>` : ''}
  ${opRows.length ? html`<p class="pk-sub">Labels (watch items and market differences are not picks and not profit claims)</p><table class="pk-table"><thead><tr><th>Scope</th><th>Label</th><th>Records</th><th>Right–Missed</th><th>VOID</th><th>Pending</th></tr></thead><tbody>${opRows.map(([l, c, x]) => html`<tr><th>${l}</th><td>${OP_TEXT[c] || c}</td><td>${x.n}</td><td>${x.W}–${x.L}</td><td>${x.VOID}</td><td>${x.pending}</td></tr>`)}</tbody></table>` : ''}
  ${rec.wta_main?.vs_market ? html`<p class="pk-vm">PBE vs market (same-contract venues only, frozen at the lock): ${rec.wta_main.vs_market.compared} compared · agreed on the favourite ${rec.wta_main.vs_market.agree_on_favourite} · PBE Brier ${rec.wta_main.vs_market.pbe_brier ?? '—'} vs market ${rec.wta_main.vs_market.market_brier ?? '—'} · ${rec.wta_main.vs_market.no_observation_at_lock} with no observation at the lock · ${rec.wta_main.vs_market.not_comparable} related-only (not scored)</p>` : ''}`;
}

function policyBox(p) {
  return html`<section class="mod pk-policy"><header class="mod-h"><h2>How PBE Picks work</h2></header><div class="mod-b">
    <p><b>${p.status === 'FROZEN_PROSPECTIVE' && !p.activated_at ? 'PROSPECTIVE · NOT OFFICIAL' : 'OFFICIAL'}</b> — policy ${p.version}, threshold ${Math.round(p.tau * 100)}%. ${p.activated_at ? `Official since ${localTime(p.activated_at)}; decisions before activation are never official.` : 'Official Picks are not activated. Records below are prospective proof only.'}</p>
    <p>${p.scope.wta_main}. ${p.scope.shadow_wta125}. ${p.scope.atp}.${p.scope.atp_shadow ? ` ${p.scope.atp_shadow}.` : ''}</p>
    ${p.atp_shadow ? html`<p>ATP shadow (${p.atp_shadow.challenger}, threshold ${Math.round(p.atp_shadow.tau * 100)}%): the PBE Rating ATP probability ran about 4 points over-confident, so a frozen recalibration shrinks it toward 50%. Development test 2019–2022: log loss ${p.atp_shadow.development.log_loss_uncalibrated} → ${p.atp_shadow.development.log_loss}, ${p.atp_shadow.development.calls_at_tau.toLocaleString('en-US')} calls at ${pc(p.atp_shadow.development.hit_rate)}. It is validated only by the prospective record on this page.</p>` : ''}
    ${p.activation_gates ? html`<p>Activation gate (${p.activation_gates.status}): WTA — ${p.activation_gates.wta_main}. ATP — ${p.activation_gates.atp_shadow}.</p>` : ''}
    <p>Lock: ${p.lock_rule}</p><p>Grading: ${p.grading}</p>
    <p>Validation (historical, not this ledger): WTA holdout ${p.validation.WTA.holdout_calls.toLocaleString()} calls, ${pc(p.validation.WTA.hit_rate)} hit rate; tour level ${pc(p.validation.WTA.tour_level_descriptive.hit_rate)} on ${p.validation.WTA.tour_level_descriptive.graded_calls.toLocaleString()} calls. ATP: ${p.validation.ATP.result}.</p>
    <p class="note">The pick is the PBE Rating probability through a frozen threshold. Prediction-market prices are never an input; they are shown as they stood at the lock.</p></div></section>`;
}

function shell(root, { eyebrow, heading, lede }) {
  render(root, html`<div class="page pk-page"><header class="page-h"><p class="eyebrow">${eyebrow}</p><h1>${heading}</h1><p class="lede">${lede}</p><p class="meta" data-meta></p></header><div data-body><p class="loading">Loading…</p></div></div>`);
}
async function load(root, path, draw, emptyNote, signal) {
  let res;
  try { res = await api(path, { signal }); } catch { return; }
  const body = root.querySelector('[data-body]');
  if (!body) return;
  const meta = root.querySelector('[data-meta]');
  if (meta) render(meta, html`${freshnessBadge(res.meta)} <span>${res.meta?.semantics || ''}</span>`);
  if (resultState(res) === 'error') { render(body, errorModule(res.meta, 'The pick ledger could not be loaded right now.')); return; }
  render(body, (res.data != null && draw(res.data)) || emptyModule(res.meta, emptyNote));
}
const notLive = (root, heading, note) => render(root, html`<div class="page"><header class="page-h"><p class="eyebrow">${heading}</p><h1>${heading}</h1><p class="lede">${note}</p></header></div>`);

export function picks(root) {
  if (!picksVisible()) { notLive(root, 'PBE Picks', 'Locked pre-match model calls. Official PBE Picks have not launched yet.'); return () => {}; }
  const c = new AbortController();
  shell(root, { eyebrow: 'PBE Picks · All Access', heading: 'PBE Picks', lede: 'One designated pre-match decision per match — CALL, PASS or HOLD — frozen at its lock and never replaced.' });
  load(root, '/v1/picks', (d) => {
    const main = d.picks.filter((p) => p.scope !== 'atp_shadow' && p.scope !== 'atp');
    const atp = d.picks.filter((p) => p.scope === 'atp_shadow');
    const pending = main.filter((p) => !p.grade && p.state === 'CALL');
    const rest = main.filter((p) => !(!p.grade && p.state === 'CALL'));
    const atpPending = atp.filter((p) => !p.grade && p.state === 'CALL');
    const atpRest = atp.filter((p) => !(!p.grade && p.state === 'CALL'));
    return html`${policyBox(d.policy)}
      ${pending.length ? html`<section class="mod"><header class="mod-h"><h2>Upcoming locked calls · WTA</h2></header><div class="mod-b pk-grid">${pending.map((p) => pickCard(p))}</div></section>` : ''}
      <section class="mod"><header class="mod-h"><h2>Record so far · ATP and WTA</h2></header><div class="mod-b">${recordTable(d.record)}</div></section>
      ${rest.length ? html`<section class="mod"><header class="mod-h"><h2>All WTA decisions</h2></header><div class="mod-b pk-grid">${rest.map((p) => pickCard(p))}</div></section>` : ''}
      ${atpPending.length ? html`<section class="mod" data-atp-shadow><header class="mod-h"><h2>ATP shadow research · locked</h2></header><div class="mod-b pk-grid">${atpPending.map((p) => pickCard(p))}</div></section>` : ''}
      ${atpRest.length ? html`<section class="mod" data-atp-shadow><header class="mod-h"><h2>ATP shadow research · all decisions</h2></header><div class="mod-b pk-grid">${atpRest.map((p) => pickCard(p))}</div></section>` : ''}`;
  }, 'No decision has been recorded yet.', c.signal);
  return () => c.abort();
}

export function trackRecord(root) {
  if (!picksVisible()) { notLive(root, 'Track Record', 'Every graded PBE pick will be listed here once PBE Picks launch.'); return () => {}; }
  const c = new AbortController();
  shell(root, { eyebrow: 'Track Record', heading: 'PBE Picks Track Record', lede: 'Every resolved decision, wins, losses and voids. Nothing is back-filled; losing runs stay visible.' });
  load(root, '/v1/picks/track-record', (d) => html`${policyBox(d.policy)}
    <section class="mod"><header class="mod-h"><h2>Record</h2></header><div class="mod-b">${recordTable(d.record) || html`<p class="note">Nothing has been graded yet.</p>`}</div></section>
    <section class="mod"><header class="mod-h"><h2>Resolved picks</h2></header><div class="mod-b pk-grid">${d.resolved.length ? d.resolved.map((p) => pickCard(p)) : html`<p class="note">No pick has been resolved yet.</p>`}</div></section>`, 'Nothing has been graded yet.', c.signal);
  return () => c.abort();
}

// ---- match page: PBE PICK above Market Pulse (All Access; preview until activation) ----
const pickCache = new Map();
export const pickSlot = (m) => (picksVisible() && pickCache.get(m.id) ? pickCache.get(m.id) : '');
export async function pickLoad(root, m, signal) {
  if (!picksVisible() || pickCache.has(m.id)) return;
  pickCache.set(m.id, '');
  let res;
  try { res = await api(`/v1/picks/${m.id}`, { signal }); } catch { pickCache.delete(m.id); return; }
  if (!res?.data?.pick) return;
  const out = html`<section class="mod pk-slot" aria-label="PBE Pick"><header class="mod-h"><h2>PBE Pick</h2></header><div class="mod-b">${pickCard(res.data.pick, { compact: true })}</div></section>`;
  pickCache.set(m.id, out);
  const slot = root.querySelector('[data-pbe-pick]');
  if (slot) render(slot, out);
}
