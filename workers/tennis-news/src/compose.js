// Deterministic article writer — tennis-compose/1.0.0. PURE: packet in, article out.
//
// Same philosophy as the WNBA newsroom: no language model. Every sentence is assembled from frozen packet
// fields, so every number in the prose is a packet value (the gates still verify that independently).
// The writer never states a reason for a retirement or withdrawal, an injury, a feeling, a motive, a
// quote, a price or a "first"/"career-best" claim — the packet cannot prove any of those.

import { deskFor, provenanceOf, LIST_LABEL } from './tour.js';
import { hasKind } from './classify.js';

export const COMPOSE_VERSION = 'tennis-compose/5.0.0';
const RANKC = { brief: 1, full: 2, deep: 3 };
const atLeastC = (c, min) => (RANKC[c] || 2) >= RANKC[min];
const brief0 = (c) => !atLeastC(c, 'full');

const other = (s) => (s === 'A' ? 'B' : 'A');
const surname = (p) => p?.last_name ? p.last_name.split(' ').map((w) => (w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ') : String(p?.name || '').split(' ').slice(-1)[0];
const team = (side, short = false) => (side?.players || []).map((p) => (short ? surname(p) : p.name)).join(short ? '/' : ' and ');
const rankTxt = (p) => (Number.isFinite(p?.rank?.rank) ? `No. ${p.rank.rank}` : null);
const plural = (side) => (side?.players || []).length > 1;
const v = (side, one, many) => (plural(side) ? many : one);
const setLine = (sets, W) => sets.map((s) => (s.match_tiebreak && s.tb ? `[${s.tb[W]}-${s.tb[other(W)]}]` : `${s[W]}-${s[other(W)]}${s.tb ? `(${Math.min(s.tb.A, s.tb.B)})` : ''}`)).join(', ');
const durTxt = (d) => (!d ? null : d.hours ? `${d.hours} hour${d.hours === 1 ? '' : 's'}${d.minutes ? ` ${d.minutes} minute${d.minutes === 1 ? '' : 's'}` : ''}` : `${d.minutes} minutes`);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** Tournament tier as FROZEN: the source level, else the reviewed ATP tier registry recorded on the event facts
 *  (facts.edition_tier, e.g. "ATP 500"). Never inferred from a tournament name at render time. */
export const tierLabel = (packet) => packet?.tournament?.level || packet?.event?.facts?.edition_tier || null;
const theEvent = (t, tier = t.level) => `${t.name}${tier ? ` (${tier}${t.surface ? `, ${t.indoor ? 'indoor ' : ''}${t.surface}` : ''})` : ''}`;
const isQual = (r) => /^Q-/.test(String(r?.round || '')) || /qualifying/i.test(String(r?.round_label || ''));
/** Draw path split: qualifying wins vs main-draw wins (never one ambiguous "Nth win of the tournament"). */
export function drawPathSplit(packet) {
  const rows = (packet?.draw_path?.matches || []).filter((r) => r.result === 'W');
  return { qual: rows.filter(isQual), main: rows.filter((r) => !isQual(r)) };
}
const namesOf = (rows) => rows.map((r) => r.opponent.map((o) => o.name).join(' / '));
const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const NUMW = ['no', 'one', 'two', 'three', 'four', 'five'];
/** "round 1" reads as a name ("in round 1"); "semifinals" keeps its article ("in the semifinals"). */
const theRound = (label) => (/^round \d+$/i.test(String(label || '')) ? String(label) : `the ${label}`);
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

function statSentence(name, st, oName) {
  const bits = [];
  if (st.first_serve_won) bits.push(`won ${st.first_serve_won.pct}% of first-serve points (${st.first_serve_won.n} of ${st.first_serve_won.d})`);
  if (st.second_serve_won) bits.push(`${st.second_serve_won.pct}% behind the second serve (${st.second_serve_won.n} of ${st.second_serve_won.d})`);
  if (st.break_points_converted?.d) bits.push(`converted ${st.break_points_converted.n} of ${st.break_points_converted.d} break points`);
  return bits.length ? `${name} ${bits.join(', ')}.` : null;
}

function headlineFor(k, P) {
  const { W, L, w, l, t, m } = P;
  const wn = team(w, true);
  const ln = team(l, true);
  const lead = w.players[0];
  const loser = l.players[0];
  switch (k) {
    case 'upset': return rankTxt(loser) ? `${wn} ${v(w, 'beats', 'beat')} ${rankTxt(loser)} ${ln} in the ${t.name} ${m.round_label}` : `${wn} ${v(w, 'beats', 'beat')} ${ln} in the ${t.name} ${m.round_label}`;
    case 'seed_upset': return `${wn} knocks out No. ${l.seed} seed ${ln} at ${t.name}`;
    case 'title': return `${wn} wins the ${t.name} title`;
    case 'doubles_title': return `${wn} win the ${t.name} doubles title`;
    case 'retirement': return `${ln} ${v(l, 'retires', 'retire')} against ${wn} at ${t.name}`;
    case 'walkover': return `${wn} ${v(w, 'advances', 'advance')} at ${t.name} after ${ln} ${v(l, 'withdraws', 'withdraw')}`;
    case 'marathon': return `${wn} ${v(w, 'outlasts', 'outlast')} ${ln} in ${durTxt(m.duration)} at ${t.name}`;
    case 'comeback': return `${wn} ${v(w, 'recovers', 'recover')} from a set down to beat ${ln} at ${t.name}`;
    case 'deciding_tiebreak': return `${wn} ${v(w, 'edges', 'edge')} ${ln} in a deciding-set tiebreak at ${t.name}`;
    case 'dominant': return `${wn} drops ${P.event.facts.games_lost} ${P.event.facts.games_lost === 1 ? 'game' : 'games'} against ${ln} at ${t.name}`;
    case 'qualifier_run': return `${P.event.facts.entry === 'LL' ? 'Lucky loser' : 'Qualifier'} ${wn} reaches the ${t.name} ${{ SF: 'semifinals', F: 'final', title: 'title' }[P.event.facts.reached]}`;
    default: return `${wn} ${v(w, 'beats', 'beat')} ${ln} at ${t.name}`;
  }
}

function composeMatch(packet, storyClass = 'full') {
  const m = packet.match;
  const t = packet.tournament;
  const W = m.winner_side;
  const L = other(W);
  const w = packet.participants[W];
  const l = packet.participants[L];
  const P = { W, L, w, l, t, m, event: packet.event };
  const kind = packet.event.kind;
  const tier = tierLabel(packet);
  const is = (k) => hasKind(packet, k); // primary kind OR a proven secondary kind of the same canonical story
  const wName = team(w);
  const lName = team(l);
  const wS = team(w, true);
  const lS = team(l, true);
  const sections = [];

  // WHAT HAPPENED
  const how = m.status === 'retired' ? `after ${lS} retired with the score at ${setLine(m.sets, W)}` : m.status === 'walkover' ? `by walkover` : setLine(m.sets, W);
  const lead = m.status === 'walkover'
    ? `${wName} advanced past ${theRound(m.round_label)} of ${theEvent(t, tier)} by walkover: ${lName} withdrew before the match. The source does not give a reason, and we do not state one.`
    : `${wName}${!plural(w) && rankTxt(w.players[0]) ? `, ranked ${rankTxt(w.players[0])},` : ''} beat ${lName}${!plural(l) && rankTxt(l.players[0]) ? ` (${rankTxt(l.players[0])})` : ''} ${how} in ${theRound(m.round_label)} of ${theEvent(t, tier)}${t.city && !String(t.name).startsWith(t.city) ? ` in ${t.city}` : ''}.`;
  const what = [lead];
  if (m.status === 'retired') what.push(`${lS} did not finish the match. The result records a retirement and no cause; we do not speculate about one.`);
  if (m.duration && m.status !== 'walkover') what.push(`The match lasted ${durTxt(m.duration)}.`);
  sections.push({ id: 'what_happened', heading: 'What happened', paragraphs: what });

  // THE MATCH IN NUMBERS — one analytical point, not a narration of the charts beside it: which serve/return line
  // separated the players most, and how the break points went (the charts carry every other number)
  if (packet.stats && m.status !== 'walkover') {
    const sw = packet.stats[W];
    const sl = packet.stats[L];
    const LINES = [['first_serve_won', 'points behind the first serve'], ['second_serve_won', 'points behind the second serve'], ['first_return_won', 'returns against the first serve'], ['second_return_won', 'returns against the second serve'], ['service_points_won', 'service points'], ['return_points_won', 'return points']];
    const gaps = LINES.filter(([k]) => sw[k]?.pct != null && sl[k]?.pct != null).map(([k, label]) => ({ k, label, a: sw[k].pct, b: sl[k].pct, gap: Math.abs(sw[k].pct - sl[k].pct) })).sort((x, y) => y.gap - x.gap);
    const paras = [];
    if (gaps.length) {
      const g = gaps[0];
      paras.push(`The clearest separation came on ${g.label}: ${wS} won ${g.a}% of them and ${lS} ${g.b}%${g.a >= g.b ? '' : ', the one area where the loser held the edge'}.`);
    }
    if (sw.break_points_converted?.d && sl.break_points_converted?.d) paras.push(`The break points decided more than the totals: ${wS} converted ${sw.break_points_converted.n} of ${sw.break_points_converted.d}, ${lS} ${sl.break_points_converted.n} of ${sl.break_points_converted.d}.`);
    // V4 serve story in games: holds are what a set is built on (only where the source counts service games)
    if (sw.service_games_held?.d && sl.service_games_held?.d) {
      const cleaner = sw.service_games_held.pct >= sl.service_games_held.pct;
      paras.push(`Across the match ${wS} held ${sw.service_games_held.n} of ${sw.service_games_held.d} service games and ${lS} ${sl.service_games_held.n} of ${sl.service_games_held.d}${cleaner ? '' : `, so the result came despite ${lS} holding a larger share`}.`);
    }
    if (paras.length) sections.push({ id: 'match_data', heading: 'The match in numbers', paragraphs: storyClass === 'brief' ? paras.slice(0, 1) : paras });
  }

  // HOW THE MATCH DEVELOPED (V4) — only from OBSERVED games (point events or live score snapshots), never from the final score
  const dev = packet.match_development;
  if (atLeastC(storyClass, 'full') && dev && m.status !== 'walkover' && (dev.breaks.length || dev.longest_run)) {
    const side = (x) => (x === W ? wS : lS);
    const where = (b) => `set ${b.set}${Number.isFinite(b.game) ? `, game ${b.game}` : ''}`;
    const devParas = [];
    const basis = dev.source === 'point_by_point' ? 'the point-by-point data' : dev.complete ? 'the live score we observed game by game' : 'the part of the match we observed live';
    if (dev.first_break) devParas.push(`In ${basis}, the first break of serve went to ${side(dev.first_break.by)} in ${where(dev.first_break)}.`);
    // partial coverage: name the breaks we SAW, never call one the first (unobserved games may hold earlier breaks)
    else if (dev.breaks.length) devParas.push(`In ${basis}, ${dev.breaks.slice(0, 3).map((b) => `${side(b.by)} broke in ${where(b)}`).join(', ')}.`);
    if (dev.breaks_total) { const times = (n) => (n === 0 ? 'not at all' : n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`); devParas.push(`${wS} broke serve ${times(dev.breaks_total[W])} and ${lS} ${times(dev.breaks_total[L])}.`); }
    if (dev.longest_run) devParas.push(`The longest run of the match was ${dev.longest_run.games} straight games to ${side(dev.longest_run.side)}${dev.longest_run.from_set === dev.longest_run.to_set ? ` in set ${dev.longest_run.from_set}` : `, from set ${dev.longest_run.from_set} into set ${dev.longest_run.to_set}`}.`);
    const perSet = packet.stats_by_set;
    if (perSet?.length >= 2) {
      const widest = perSet.filter((r) => r.points_won.A != null && r.points_won.B != null).map((r) => ({ set: r.set, w: r.points_won[W], l: r.points_won[L], gap: Math.abs(r.points_won[W] - r.points_won[L]) })).sort((x, y) => y.gap - x.gap)[0];
      if (widest && widest.gap > 0) devParas.push(`The widest points margin in a single set came in set ${widest.set}, where ${widest.w >= widest.l ? wS : lS} won ${Math.max(widest.w, widest.l)} points to ${Math.min(widest.w, widest.l)}.`);
    }
    if (devParas.length >= 2) sections.push({ id: 'match_development', heading: 'How the match turned', paragraphs: [devParas.join(' ')] });
  }

  // WHY IT MATTERED
  const why = [];
  const lr = plural(l) ? null : l.players[0]?.rank?.rank ?? null;
  const wr = plural(w) ? null : w.players[0]?.rank?.rank ?? null;
  // ranking wording follows the list's provenance: "the official WTA singles list" vs "the ATP singles list in the
  // PropBetEdge archive" (secondary source); outside a top-N extract is never written as "not ranked"
  const prov = provenanceOf(packet);
  const ef = packet.event.facts || {};
  if (kind === 'upset' && lr && prov) {
    const rankedTxt = wr ? `${wS} was ranked No. ${wr} and ${lS} No. ${lr}` : null;
    if (rankedTxt) why.push(`On ${prov.phrase} in force when the tournament began, ${rankedTxt}.`);
    else if (ef.winner_outside_list) why.push(`${wS} was outside the top ${ef.winner_outside_list} of ${prov.phrase} in force when the tournament began; ${lS} was No. ${lr}.`);
    else why.push(`${wS} was not ranked on ${prov.phrase} in force when the tournament began; ${lS} was No. ${lr}.`);
  }
  // seeding: the loser's seed whenever the story is (also) a seed upset — "unseeded" only when the winner had no seed
  if (is('seed_upset') && l.seed) why.push(`${lS} was the No. ${l.seed} seed${tier ? ` at this ${tier}` : ''}${w.seed ? `; ${wS} the No. ${w.seed}` : `; ${wS} was unseeded`}.`);
  if (kind === 'qualifier_run') why.push(`${wS} entered the main draw as a ${packet.event.facts.entry === 'LL' ? 'lucky loser' : 'qualifier'}.`);
  if (kind === 'title' || kind === 'doubles_title') why.push(`The final was the last match of ${t.name} ${t.year}.`);
  // the second paragraph tells HOW the win came about, in order: draw path, then match development
  const story = [];
  const sets = m.sets || [];
  const comeback = is('comeback') && sets.length >= 2 && m.status === 'completed' && sets[0][W] < sets[0][L];
  // DRAW PATH: qualifying wins and main-draw wins are never merged into one "Nth win of the tournament"
  const dp = drawPathSplit(packet);
  const qN = `${NUMW[dp.qual.length] || dp.qual.length} qualifying win${dp.qual.length === 1 ? '' : 's'}`;
  if (dp.qual.length && !dp.main.length) story.push(`${wS} reached the main draw through ${qN}, over ${andList(namesOf(dp.qual))}${comeback ? '' : `, before beating ${lS} in ${theRound(m.round_label)}`}.`);
  else if (dp.main.length) story.push(`It was ${wS}'s ${ord(dp.main.length + 1)} main-draw win at ${t.name}${dp.qual.length ? `, after ${qN}` : ''}.`);
  // MATCH DEVELOPMENT from the stored set scores (never reconstructed breaks): primary OR secondary comeback
  if (comeback) {
    const rest = sets.slice(1);
    const restWon = rest.filter((s) => s[W] > s[L] || (s.match_tiebreak && s.tb && s.tb[W] > s.tb[L])).length;
    // the set scores are in the lead and the match-flow chart: the development is told, not read out again
    story.push(`${story.length ? `Against ${lS}, ${wS}` : wS} lost the ${sets[0].tb ? 'opening-set tiebreak' : 'opening set'} and then ${restWon === rest.length ? (rest.length === 2 ? 'won the next two sets' : `won all ${NUMW[rest.length] || rest.length} sets that followed`) : 'won the match from there'}.`);
  }
  if (is('deciding_tiebreak')) story.push(`The deciding set went to a tiebreak, and ${wS} won it.`);
  const paras = [why.join(' '), story.join(' ')].filter(Boolean);
  if (paras.length) sections.push({ id: 'why_it_mattered', heading: 'Why it mattered', paragraphs: paras });

  // WHAT THE RESULT SAYS — results-based Match DNA v2 frozen before the match. Every class (a brief gets ONE tight
  // paragraph): the player's own stored record (W-L where the snapshot stores it, else its stored win % and sample);
  // never a percentile, a tour comparison or the rating model's probability in prose (code-rendered modules hold those)
  const wid = w.players[0]?.id;
  const lid = l.players[0]?.id;
  const mW = packet.match_dna?.[wid];
  const mL = packet.match_dna?.[lid];
  if (mW && !plural(w)) {
    const read = [];
    const mw = mW.metrics?.match_win_rate;
    const mlw = mL?.metrics?.match_win_rate;
    const t10 = mW.metrics?.top10_win_rate;
    const y = mW.windows?.['52w'];
    const dnaWhen = `Match DNA snapshot dated ${mW.as_of}, built only from earlier results`;
    if (mw?.record) read.push(`Going into the match, ${wS}'s ${dnaWhen}, showed ${mw.record.W}-${mw.record.L} in singles in our archive${y && y.W + y.L ? `, ${y.W}-${y.L} over the previous ${y.weeks} weeks` : ''}.`);
    if (lr && lr <= 10 && t10?.record && t10.record.W + t10.record.L) read.push(`Before this match ${wS} was ${t10.record.W}-${t10.record.L} against top-10 opponents in our archive (${dnaWhen}).`);
    else if (t10?.record && t10.record.W + t10.record.L) read.push(`Against top-10 opponents ${wS} was ${t10.record.W}-${t10.record.L} in our archive.`);
    const dec = mW.metrics?.deciding_set_win_rate;
    if ((is('comeback') || is('deciding_tiebreak')) && dec?.record) read.push(`${wS} had won ${dec.record.W} of ${dec.record.W + dec.record.L} deciding sets in our archive before this one.`);
    if (mlw?.record) read.push(`${lS} came in at ${mlw.record.W}-${mlw.record.L}.`);
    else if (!plural(l) && mlw?.pct != null && mw?.pct != null && mlw.sample_matches && mw.sample_matches) {
      const loserStronger = mlw.pct > mw.pct;
      read.push(`${loserStronger ? lS : wS} came in with the stronger stored match-win profile: ${loserStronger ? `${mlw.pct}% of ${mlw.sample_matches}` : `${mw.pct}% of ${mw.sample_matches}`} archived matches won, against ${loserStronger ? `${mw.pct}% of ${mw.sample_matches} for ${wS}` : `${mlw.pct}% of ${mlw.sample_matches} for ${lS}`}.`);
    }
    const brief = !atLeastC(storyClass, 'full');
    const keep = brief ? read.slice(0, 2) : read;
    // archived head-to-head is context in every class (one sentence in a brief; the full section below otherwise)
    if (brief && packet.h2h?.prior_meetings?.length) keep.push(`In our records (from ${packet.h2h.coverage_from}) they had met ${packet.h2h.prior_meetings.length} time${packet.h2h.prior_meetings.length === 1 ? '' : 's'} before, with ${wS} winning ${packet.h2h.wins}.`);
    if (keep.length >= (brief ? 1 : 2)) sections.push({ id: 'player_read', heading: `What the result says about ${wS}`, paragraphs: [keep.join(' ')] });
  }
  // CONTEXT FALLBACK (no Match DNA paragraph): archived H2H and each player's most recent previous result in our archive
  // (names, rounds and tournaments only — no computed counts), so a packet that proves context is never told thinly
  if (!sections.some((s) => s.id === 'player_read')) {
    const ctx = [];
    if (packet.h2h?.prior_meetings?.length && !atLeastC(storyClass, 'full')) ctx.push(`In our records (from ${packet.h2h.coverage_from}) ${wS} and ${lS} had met ${packet.h2h.prior_meetings.length} time${packet.h2h.prior_meetings.length === 1 ? '' : 's'} before, with ${wS} winning ${packet.h2h.wins}.`);
    const lastOf = (side) => { const pid = side.players[0]?.id; const rows = (packet.recent_form?.[pid] || []).filter((r) => r.result === 'W' || r.result === 'L'); return rows[0] || null; };
    const evName = (r) => String(r.tournament || '').replace(/\bUs Open\b/, 'US Open');
    for (const [side, nm] of [[l, lS], [w, wS]]) {
      if (plural(side)) continue;
      const r = lastOf(side);
      if (r && r.opponent?.length) ctx.push(`${nm}'s previous match in our archive before this tournament was a ${r.result === 'W' ? 'win over' : 'loss to'} ${r.opponent.map((o) => o.name).join(' / ')}${r.tournament ? ` at ${evName(r)}` : ''}${r.round_label ? ` (${r.round_label})` : ''}.`);
    }
    if (ctx.length) sections.push({ id: 'player_read', heading: 'Form and context', paragraphs: [ctx.slice(0, brief0(storyClass) ? 2 : 3).join(' ')] });
  }

  // SURFACE AND MATCHUP CONTEXT — sourced surface only (never inferred from a tournament name)
  if (atLeastC(storyClass, 'full') && t.surface) {
    const sW = mW?.surface?.record;
    const sL = mL?.surface?.record;
    const bits = [];
    if (sW && sW.W + sW.L) bits.push(`On ${t.surface} courts ${wS} was ${sW.W}-${sW.L} in our archive before this match`);
    if (sL && sL.W + sL.L) bits.push(`${lS} ${sL.W}-${sL.L}`);
    const dW = packet.dna?.[wid];
    const dL = packet.dna?.[lid];
    let tech = null;
    if (dW && dL) {
      const shared = Object.keys(dW.metrics).filter((k) => dL.metrics[k]);
      const pick = shared.filter((k) => ['service_points_won', 'return_points_won', 'hold_rate', 'break_rate'].includes(k)).slice(0, 2);
      const LABEL = { service_points_won: 'service points won', return_points_won: 'return points won', hold_rate: 'service games held', break_rate: 'return games broken' };
      if (pick.length) tech = `From match statistics, the stored Technical DNA had ${pick.map((k) => `${wS} at ${dW.metrics[k].pct}% ${LABEL[k] || k} against ${dL.metrics[k].pct}% for ${lS}`).join(', and ')}.`;
    }
    const paras = [bits.length ? `${bits.join('; ')}.` : null, tech].filter(Boolean);
    if (paras.length) sections.push({ id: 'surface', heading: 'Surface and matchup context', paragraphs: paras });
  }

  // HEAD-TO-HEAD
  if (atLeastC(storyClass, 'full') && packet.h2h?.prior_meetings.length) {
    const h = packet.h2h;
    const last = h.prior_meetings[0];
    sections.push({ id: 'h2h', heading: 'Head-to-head', paragraphs: [`In our archive (from ${h.coverage_from}), ${wS} and ${lS} had met ${h.prior_meetings.length} time${h.prior_meetings.length === 1 ? '' : 's'} before, with ${wS} winning ${h.wins}. Their previous meeting in our records was at ${last.tournament} ${last.year}, a ${last.result === 'W' ? 'win' : 'loss'} for ${wS} (${last.score}).`] });
  }

  // PATH THROUGH THE DRAW
  // the draw-path MODULE renders every score; the prose names the main-draw journey only (qualifying is already told
  // in "Why it mattered") and never reads the scores out again
  if (atLeastC(storyClass, 'full') && dp.main.length) {
    sections.push({ id: 'path', heading: `Path through ${t.name}`, paragraphs: [`${dp.qual.length ? `After ${qN}, ` : ''}${wS} ${dp.main.length === 1 ? 'had already beaten' : 'had beaten'} ${andList(dp.main.map((r) => `${r.opponent.map((o) => o.name).join(' / ')} (${r.round_label})`))} before this match.`] });
  }

  // WHAT'S NEXT — only when the draw already shows it
  if (packet.next?.opponent.length) sections.push({ id: 'next', heading: 'What comes next', paragraphs: [`${wS} plays ${packet.next.opponent.map((o) => o.name).join(' / ')} in ${theRound(packet.next.round_label)}.`] });

  sections.push({ id: 'method', heading: 'Source & method', paragraphs: [methodText(packet, prov)] });

  const dek = m.status === 'walkover'
    ? `${lName} withdrew before ${theRound(m.round_label)}; ${wName} ${v(w, 'moves', 'move')} on.`
    : `${wS} won ${setLine(m.sets, W)}${m.duration ? ` in ${durTxt(m.duration)}` : ''} in ${theRound(m.round_label)} of ${t.name}.`;
  const keyStat = kind === 'upset' && lr ? { label: 'Ranking gap', value: wr ? `No. ${wr} def. No. ${lr}` : `Unranked def. No. ${lr}` } : kind === 'marathon' ? { label: 'Duration', value: durTxt(m.duration) } : m.score ? { label: 'Score', value: setLine(m.sets, W) } : null;
  return { headline: headlineFor(kind, P), dek, sections, key_stat: keyStat, story_type: kind, desk: deskFor(m.event_type, t), primary_player_id: wid, player_ids: [...w.players, ...l.players].map((p) => p.id), match_id: m.id, tournament: { slug: t.slug, year: t.year, name: t.name } };
}

// Match evidence wording from the frozen provenance: a source is called official only when it is.
function methodText(packet, prov) {
  const up = packet.provenance?.upstream || [];
  const result = up.find((u) => /result/.test(u.what)) || up[0] || null;
  const stats = up.find((u) => /statistics/.test(u.what)) || null;
  const src = (u) => (u.classification === 'secondary' ? `a secondary source (${String(u.family).toUpperCase()})` : `the official ${String(u.family).toUpperCase()} feed`);
  const legacy = result && !result.classification; // packets frozen before provenance was recorded
  const bits = [];
  if (legacy) bits.push(`Result, set scores and match statistics come from the official ${up.map((u) => u.family.toUpperCase()).join(', ')} feed, archived by PropBetEdge.`);
  else {
    if (result) bits.push(`The result and set scores come from ${src(result)}, archived by PropBetEdge.`);
    if (stats) bits.push(`Match statistics come from ${src(stats)}.`);
  }
  if (prov) bits.push(`Rankings are ${prov.phrase} in force at the start of the tournament, not today's${prov.classification === 'secondary' ? `, taken from a secondary source (${String(prov.source_family || 'unknown').toUpperCase()}) rather than an official tour release` : ''}.`);
  bits.push('Match DNA and Technical DNA values are stored snapshots built only from matches before this one. Nothing in this story is estimated or inferred.');
  return bits.join(' ');
}

function composeRanking(packet, storyClass = 'full') {
  const p = packet.player;
  const f = packet.event.facts;
  const s = surname(p);
  const prov = provenanceOf(packet);
  const list = LIST_LABEL[f.list] || f.list;
  const official = prov?.classification === 'official';
  const tier = packet.event.kind === 'new_no1' ? 'No. 1' : `the Top ${f.tier ?? packet.event.kind.replace('enters_top', '')}`;
  // official lists are "the WTA singles rankings"; a secondary-source list is "the ATP singles list" (our archive)
  const noun = official ? `${list} rankings` : `${list} list`;
  const headline = packet.event.kind === 'new_no1' ? `${p.name} is the new No. 1 on the ${noun}` : `${p.name} moves into ${tier} of the ${noun}`;
  const moved = f.previous_rank ? `from No. ${f.previous_rank}` : 'from outside the previous list';
  const method = official
    ? `Both lists are the official ${list} rankings as published, archived by PropBetEdge on their publication dates.`
    : `Both lists are ${prov.phrase}: weekly lists from a secondary source (${String(prov.source_family || 'unknown').toUpperCase()}), not an official tour release, dated to the Monday each took effect${prov.truncated ? ` and holding the top ${prov.depth} only` : ''}.`;
  const sections = [
    { id: 'what_happened', heading: 'What happened', paragraphs: [`${p.name} is No. ${f.rank} on ${official ? `the ${list} list` : prov.phrase} dated ${f.list_date}, up ${moved} on the list dated ${f.previous_list_date}.`] },
    { id: 'method', heading: 'Source & method', paragraphs: [`${method} We compare consecutive archived lists only and make no claim about ${s}'s ranking before the lists our archive holds.`] }
  ];
  const md = packet.match_dna?.[p.id];
  const mw = md?.metrics?.match_win_rate;
  const y = md?.windows?.['52w'];
  if (atLeastC(storyClass, 'full') && mw?.record) sections.splice(1, 0, { id: 'player_read', heading: `What the results say about ${s}`, paragraphs: [`${s}'s results-based Match DNA (snapshot dated ${md.as_of}, built before the list) showed ${mw.record.W}-${mw.record.L} in singles in our archive${y && y.W + y.L ? `, ${y.W}-${y.L} over the previous ${y.weeks} weeks` : ''}.`] });
  if (packet.ranking_history?.length > 2) sections.splice(1, 0, { id: 'trajectory', heading: 'Ranking trajectory', paragraphs: [`Our archive holds ${packet.ranking_history.length} weekly lists for ${s} up to ${f.list_date}; the chart shows each of them.`] });
  return { headline, dek: `${s} is No. ${f.rank} on the ${list} list dated ${f.list_date}.`, sections, key_stat: { label: 'New ranking', value: `No. ${f.rank}` }, story_type: packet.event.kind, desk: 'rankings', primary_player_id: p.id, player_ids: [p.id], match_id: null, tournament: null };
}

/** PREVIEW frame (editorial overhaul 2026-10-03): identity, desk, headline/dek and Source & Method. The deterministic
 *  prose is a fact-safe lead only — a preview needs an argument, so it publishes only with editor prose that passes the
 *  editorial gate (the frame alone is held, never shipped). */
function composePreview(packet, storyClass = 'full') {
  const m = packet.match;
  const t = packet.tournament;
  const A = packet.participants.A;
  const B = packet.participants.B;
  const aS = team(A, true);
  const bS = team(B, true);
  const tier = tierLabel(packet);
  const prov = provenanceOf(packet);
  const rk = (side) => (rankTxt(side.players[0]) ? ` (${rankTxt(side.players[0])})` : '');
  const lead = `${team(A)}${rk(A)} and ${team(B)}${rk(B)} meet in ${theRound(m.round_label)} of ${theEvent(t, tier)}${t.city && !String(t.name).startsWith(t.city) ? ` in ${t.city}` : ''}.`;
  const up = packet.provenance?.upstream || [];
  const src = up[0] ? (up[0].classification === 'secondary' ? `a secondary source (${String(up[0].family).toUpperCase()})` : `the official ${String(up[0].family).toUpperCase()} feed`) : 'our archive';
  const method = [`The draw, schedule and earlier results come from ${src}, archived by PropBetEdge.`, prov ? `Rankings are ${prov.phrase} in force at the start of the tournament${prov.classification === 'secondary' ? `, taken from a secondary source (${String(prov.source_family || 'unknown').toUpperCase()}) rather than an official tour release` : ''}.` : null, 'Match DNA values are stored snapshots built only from matches before this one. This preview states no pick and no probability.'].filter(Boolean).join(' ');
  const sections = [{ id: 'lead', heading: '', paragraphs: [lead] }, { id: 'method', heading: 'Source & method', paragraphs: [method] }];
  return { headline: `${aS} vs ${bS}: ${t.name} ${m.round_label} preview`, dek: `${cap(m.round_label)} · ${t.name}${tier ? ` (${tier})` : ''}.`, sections, key_stat: { label: 'Round', value: cap(m.round_label) }, story_type: 'preview', desk: deskFor(m.event_type, t), primary_player_id: A.players[0].id, player_ids: [...A.players, ...B.players].map((p) => p.id), match_id: m.id, tournament: { slug: t.slug, year: t.year, name: t.name } };
}

/** storyClass (brief | full | deep) sets the depth: sections appear only when the class calls for them AND the frozen
 *  packet supports them; nothing is padded to reach a length. */
export function compose(packet, { storyClass = 'full' } = {}) {
  return { ...(packet.preview ? composePreview(packet, storyClass) : packet.match ? composeMatch(packet, storyClass) : composeRanking(packet, storyClass)), story_class: storyClass, compose_version: COMPOSE_VERSION };
}

export function slugFor(article, packet) {
  const base = article.headline.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `${base}-${packet.event.event_id.split(':')[1].slice(0, 6)}`;
}
