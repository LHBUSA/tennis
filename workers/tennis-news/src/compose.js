// Deterministic article writer — tennis-compose/1.0.0. PURE: packet in, article out.
//
// Same philosophy as the WNBA newsroom: no language model. Every sentence is assembled from frozen packet
// fields, so every number in the prose is a packet value (the gates still verify that independently).
// The writer never states a reason for a retirement or withdrawal, an injury, a feeling, a motive, a
// quote, a price or a "first"/"career-best" claim — the packet cannot prove any of those.

export const COMPOSE_VERSION = 'tennis-compose/1.0.0';

const other = (s) => (s === 'A' ? 'B' : 'A');
const surname = (p) => p?.last_name ? p.last_name.split(' ').map((w) => (w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ') : String(p?.name || '').split(' ').slice(-1)[0];
const team = (side, short = false) => (side?.players || []).map((p) => (short ? surname(p) : p.name)).join(short ? '/' : ' and ');
const rankTxt = (p) => (Number.isFinite(p?.rank?.rank) ? `No. ${p.rank.rank}` : null);
const plural = (side) => (side?.players || []).length > 1;
const v = (side, one, many) => (plural(side) ? many : one);
const setLine = (sets, W) => sets.map((s) => (s.match_tiebreak && s.tb ? `[${s.tb[W]}-${s.tb[other(W)]}]` : `${s[W]}-${s[other(W)]}${s.tb ? `(${Math.min(s.tb.A, s.tb.B)})` : ''}`)).join(', ');
const durTxt = (d) => (!d ? null : d.hours ? `${d.hours} hour${d.hours === 1 ? '' : 's'}${d.minutes ? ` ${d.minutes} minute${d.minutes === 1 ? '' : 's'}` : ''}` : `${d.minutes} minutes`);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const theEvent = (t) => `${t.name}${t.level ? ` (${t.level}${t.surface ? `, ${t.indoor ? 'indoor ' : ''}${t.surface}` : ''})` : ''}`;
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const DESK = { WS: 'wta', WD: 'doubles', MS: 'grand-slams', MD: 'doubles', XD: 'doubles' };

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

function composeMatch(packet) {
  const m = packet.match;
  const t = packet.tournament;
  const W = m.winner_side;
  const L = other(W);
  const w = packet.participants[W];
  const l = packet.participants[L];
  const P = { W, L, w, l, t, m, event: packet.event };
  const kind = packet.event.kind;
  const wName = team(w);
  const lName = team(l);
  const wS = team(w, true);
  const lS = team(l, true);
  const sections = [];

  // WHAT HAPPENED
  const how = m.status === 'retired' ? `after ${lS} retired with the score at ${setLine(m.sets, W)}` : m.status === 'walkover' ? `by walkover` : setLine(m.sets, W);
  const lead = m.status === 'walkover'
    ? `${wName} advanced past the ${m.round_label} of ${theEvent(t)} by walkover: ${lName} withdrew before the match. The source does not give a reason, and we do not state one.`
    : `${wName}${!plural(w) && rankTxt(w.players[0]) ? `, ranked ${rankTxt(w.players[0])},` : ''} beat ${lName}${!plural(l) && rankTxt(l.players[0]) ? ` (${rankTxt(l.players[0])})` : ''} ${how} in the ${m.round_label} of ${theEvent(t)}${t.city && !String(t.name).startsWith(t.city) ? ` in ${t.city}` : ''}.`;
  const what = [lead];
  if (m.status === 'retired') what.push(`${lS} did not finish the match. The official result records a retirement and no cause; we do not speculate about one.`);
  if (m.duration && m.status !== 'walkover') what.push(`The match lasted ${durTxt(m.duration)}.`);
  sections.push({ id: 'what_happened', heading: 'What happened', paragraphs: what });

  // MATCH DATA
  if (packet.stats && m.status !== 'walkover') {
    const sw = packet.stats[W];
    const sl = packet.stats[L];
    const paras = [statSentence(wS, sw, lS), statSentence(lS, sl, wS)].filter(Boolean);
    if (sw.return_points_won && sl.return_points_won) paras.push(`On return, ${wS} won ${sw.return_points_won.pct}% of points against serve (${sw.return_points_won.n} of ${sw.return_points_won.d}); ${lS} won ${sl.return_points_won.pct}% (${sl.return_points_won.n} of ${sl.return_points_won.d}).`);
    if (Number.isFinite(sw.total_points_won) && Number.isFinite(sl.total_points_won)) paras.push(`Across the match ${wS} won ${sw.total_points_won} points to ${lS}'s ${sl.total_points_won}.`);
    if (paras.length) sections.push({ id: 'match_data', heading: 'Match data', paragraphs: paras });
  }

  // WHY IT MATTERED
  const why = [];
  const lr = plural(l) ? null : l.players[0]?.rank?.rank ?? null;
  const wr = plural(w) ? null : w.players[0]?.rank?.rank ?? null;
  if (kind === 'upset' && lr) why.push(wr ? `On the official list in force when the tournament began, ${wS} was ranked No. ${wr} and ${lS} No. ${lr}.` : `${wS} was not ranked on the official list in force when the tournament began; ${lS} was No. ${lr}.`);
  if (kind === 'seed_upset') why.push(`${lS} was the No. ${l.seed} seed; ${wS} was unseeded.`);
  if (kind === 'qualifier_run') why.push(`${wS} entered the main draw as a ${packet.event.facts.entry === 'LL' ? 'lucky loser' : 'qualifier'}.`);
  if (kind === 'title' || kind === 'doubles_title') why.push(`The final was the last match of ${t.name} ${t.year}.`);
  if (kind === 'comeback') why.push(`${wS} lost the first set ${m.sets[0][W]}-${m.sets[0][L]} and still won the match.`);
  if (kind === 'deciding_tiebreak') why.push(`The deciding set went to a tiebreak, and ${wS} won it.`);
  if (packet.draw_path?.matches.length) why.push(`It was ${wS}'s ${ord(packet.draw_path.matches.length + 1)} win of the tournament.`);
  if (why.length) sections.push({ id: 'why_it_mattered', heading: 'Why it mattered', paragraphs: why });

  // TENNIS DNA (stored snapshot before the match)
  const wid = w.players[0]?.id;
  const lid = l.players[0]?.id;
  const dW = packet.dna?.[wid];
  const dL = packet.dna?.[lid];
  if (dW && dL) {
    const shared = Object.keys(dW.metrics).filter((k) => dL.metrics[k]);
    const pick = shared.filter((k) => ['service_points_won', 'return_points_won', 'hold_rate', 'break_rate'].includes(k)).slice(0, 2);
    const LABEL = { service_points_won: 'service points won', return_points_won: 'return points won', hold_rate: 'service games held', break_rate: 'return games broken' };
    if (pick.length) sections.push({ id: 'dna', heading: 'Tennis DNA', paragraphs: [`Going in, the stored Tennis DNA snapshots (dated ${dW.as_of} and ${dL.as_of}, built only from earlier matches) had ${pick.map((k) => `${wS} at ${dW.metrics[k].pct}% ${LABEL[k] || k} against ${dL.metrics[k].pct}% for ${lS}`).join(', and ')}.`] });
  }

  // HEAD-TO-HEAD
  if (packet.h2h?.prior_meetings.length) {
    const h = packet.h2h;
    const last = h.prior_meetings[0];
    sections.push({ id: 'h2h', heading: 'Head-to-head', paragraphs: [`In our archive (from ${h.coverage_from}), ${wS} and ${lS} had met ${h.prior_meetings.length} time${h.prior_meetings.length === 1 ? '' : 's'} before, with ${wS} winning ${h.wins}. Their previous meeting in our records was at ${last.tournament} ${last.year}, a ${last.result === 'W' ? 'win' : 'loss'} for ${wS} (${last.score}).`] });
  }

  // PATH THROUGH THE DRAW
  if (packet.draw_path?.matches.length) {
    sections.push({ id: 'path', heading: 'Path through the draw', paragraphs: [packet.draw_path.matches.map((r) => `${cap(r.round_label)}: ${r.result === 'W' ? 'beat' : 'lost to'} ${r.opponent.map((o) => o.name).join(' / ')}${r.score ? ` ${r.score}` : ''}`).join('. ') + '.'] });
  }

  // WHAT'S NEXT — only when the draw already shows it
  if (packet.next?.opponent.length) sections.push({ id: 'next', heading: "What's next", paragraphs: [`${wS} plays ${packet.next.opponent.map((o) => o.name).join(' / ')} in the ${packet.next.round_label}.`] });

  sections.push({ id: 'method', heading: 'Evidence & method', paragraphs: [`Result, set scores and match statistics come from the official ${packet.provenance.upstream.map((u) => u.family.toUpperCase()).join(', ')} feed, archived by PropBetEdge. Rankings are the official list in force at the start of the tournament, not today's. Tennis DNA values are stored snapshots built from matches before this one. Nothing in this story is estimated or inferred.`] });

  const dek = m.status === 'walkover'
    ? `${lName} withdrew before the ${m.round_label}; ${wName} ${v(w, 'moves', 'move')} on.`
    : `${wS} won ${setLine(m.sets, W)}${m.duration ? ` in ${durTxt(m.duration)}` : ''} in the ${m.round_label} of ${t.name}.`;
  const keyStat = kind === 'upset' && lr ? { label: 'Ranking gap', value: wr ? `No. ${wr} def. No. ${lr}` : `Unranked def. No. ${lr}` } : kind === 'marathon' ? { label: 'Duration', value: durTxt(m.duration) } : m.score ? { label: 'Score', value: setLine(m.sets, W) } : null;
  return { headline: headlineFor(kind, P), dek, sections, key_stat: keyStat, story_type: kind, desk: t.level === 'Grand Slam' ? 'grand-slams' : DESK[m.event_type] || 'wta', primary_player_id: wid, player_ids: [...w.players, ...l.players].map((p) => p.id), match_id: m.id, tournament: { slug: t.slug, year: t.year, name: t.name } };
}

function composeRanking(packet) {
  const p = packet.player;
  const f = packet.event.facts;
  const s = surname(p);
  const list = f.list === 'wta_singles' ? 'WTA singles' : 'WTA doubles';
  const tier = packet.event.kind === 'new_no1' ? 'No. 1' : `the Top ${packet.event.kind.replace('enters_top', '')}`;
  const headline = packet.event.kind === 'new_no1' ? `${p.name} is the new No. 1 in the ${list} rankings` : `${p.name} moves into ${tier} of the ${list} rankings`;
  const moved = f.previous_rank ? `from No. ${f.previous_rank}` : 'from outside the previous list';
  const sections = [
    { id: 'what_happened', heading: 'What happened', paragraphs: [`${p.name} is ranked No. ${f.rank} in the ${list} list dated ${f.list_date}, up ${moved} on the list dated ${f.previous_list_date}.`] },
    { id: 'method', heading: 'Evidence & method', paragraphs: [`Both lists are the official ${list} rankings as published, archived by PropBetEdge on their publication dates. We compare consecutive archived lists only; we make no claim about ${s}'s career-best ranking until our ranking archive covers the full career.`] }
  ];
  if (packet.ranking_history?.length > 2) sections.splice(1, 0, { id: 'trajectory', heading: 'Ranking trajectory', paragraphs: [`Our archive holds ${packet.ranking_history.length} weekly lists for ${s} up to ${f.list_date}; the chart shows each of them.`] });
  return { headline, dek: `${s} is No. ${f.rank} on the ${list} list dated ${f.list_date}.`, sections, key_stat: { label: 'New ranking', value: `No. ${f.rank}` }, story_type: packet.event.kind, desk: 'rankings', primary_player_id: p.id, player_ids: [p.id], match_id: null, tournament: null };
}

export function compose(packet) {
  return { ...(packet.match ? composeMatch(packet) : composeRanking(packet)), compose_version: COMPOSE_VERSION };
}

export function slugFor(article, packet) {
  const base = article.headline.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `${base}-${packet.event.event_id.split(':')[1].slice(0, 6)}`;
}
