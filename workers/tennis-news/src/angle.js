// STORY ANGLE — tennis-angle/1.0.0. PURE. (Editorial overhaul, owner brief 2026-10-03: "Prose leads. Data supports.")
//
// The writer architecture is FACTS -> STORY ANGLE -> ARTICLE NARRATIVE -> VISUAL SUPPORT -> EVIDENCE:
//   FACTS      the frozen packet (packet.js) — the only fact source
//   ANGLE      this module: reads the facts, decides what the story IS (a thesis + ordered beats + the real turning
//              points the evidence proves), and only then chooses which visuals support that story
//   NARRATIVE  the editor (editorial.js) writes prose to the angle; charts never dictate its structure
//   VISUALS    each visual is attached by the narrative to the section it proves, with an interpretation
//   EVIDENCE   method + ledger (plan.js / gates.js)
// Nothing here prints a new number: the angle names facts by reference (set 1, the opening tiebreak, the return
// table) and copies packet values verbatim; it never computes a difference or a new percentage for prose.

export const ANGLE_VERSION = 'tennis-angle/1.0.0';

const other = (s) => (s === 'A' ? 'B' : 'A');
const surname = (p) => (p?.last_name ? p.last_name.split(' ').map((w) => (w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ') : String(p?.name || '').split(' ').slice(-1)[0]);
const sideName = (side) => (side?.players || []).map(surname).join('/');
const kinds = (packet) => [packet?.event?.kind, ...(packet?.event?.facts?.secondary_kinds || [])].filter(Boolean);
const has = (packet, k) => kinds(packet).includes(k);

/** Words of narrative prose a story must carry, by editorial tier (owner: features ~650-1,100; short news shorter). */
export const PROSE_TARGETS = Object.freeze({
  feature: { min: 650, max: 1150, label: 'feature' },
  news: { min: 350, max: 750, label: 'news story' },
  doubles: { min: 300, max: 650, label: 'doubles news story' },
  ranking: { min: 250, max: 650, label: 'ranking story' }
});

/**
 * Editorial tier from facts + class (never from prose): previews, full/deep stories, singles titles and top-10 /
 * top-two-seed upsets are FEATURES; doubles and rankings have their own (shorter) floors; everything else is news.
 */
export function storyTier(packet, storyClass = 'brief') {
  if (!packet) return 'news';
  if (packet.preview) return 'feature';
  if (!packet.match) return 'ranking';
  const doubles = ['WD', 'MD', 'XD'].includes(packet.match.event_type);
  if (doubles) return storyClass === 'deep' ? 'feature' : 'doubles';
  if (storyClass === 'full' || storyClass === 'deep') return 'feature';
  const f = packet.event?.facts || {};
  if (has(packet, 'title')) return 'feature';
  if ((has(packet, 'upset') && Number.isFinite(f.loser_rank) && f.loser_rank <= 10) || (has(packet, 'seed_upset') && Number.isFinite(f.loser_seed) && f.loser_seed <= 2)) return 'feature';
  return 'news';
}

/** Set-by-set facts oriented to the winner (W) — the backbone of "what happened", straight from the stored sets. */
export function setStory(packet) {
  const m = packet?.match;
  if (!m?.sets?.length || !m.winner_side) return [];
  const W = m.winner_side;
  const L = other(W);
  const n = m.sets.length;
  return m.sets.map((s, i) => {
    const mtb = !!s.match_tiebreak;
    const w = mtb ? s.tb?.[W] : s[W];
    const l = mtb ? s.tb?.[L] : s[L];
    const winner = w > l ? 'W' : l > w ? 'L' : null;
    const lo = Math.min(w ?? 0, l ?? 0);
    const margin = mtb ? 'match_tiebreak' : s.tb ? 'tiebreak' : Math.max(w, l) === 7 ? 'tight' : lo === 4 ? 'narrow' : lo >= 2 ? 'clear' : 'lopsided';
    return { set: i + 1, score: mtb ? `[${w}-${l}]` : `${w}-${l}${s.tb ? `(${Math.min(s.tb.A, s.tb.B)})` : ''}`, tiebreak: s.tb && !mtb ? `${s.tb[W]}-${s.tb[L]}` : null, extended_tiebreak: !!(s.tb && Math.max(s.tb.A, s.tb.B) > 7), winner, margin, deciding: i === n - 1 && n >= 3 && (m.best_of === 3 ? n === 3 : n === 5) };
  });
}

/**
 * The real turning points the evidence proves, in match order. Each is { at, what, basis } in plain words; `basis`
 * names the evidence family (set scores, observed games, match statistics) so the prose can say how we know.
 */
export function turningPoints(packet) {
  const out = [];
  const m = packet?.match;
  if (!m || m.status === 'walkover') return out;
  const W = m.winner_side;
  const wS = sideName(packet.participants?.[W]);
  const lS = sideName(packet.participants?.[other(W)]);
  const sets = setStory(packet);
  const who = (x) => (x === 'W' ? wS : lS);
  for (const s of sets) {
    const prev = sets[s.set - 2];
    if (s.margin === 'tiebreak') out.push({ at: `set ${s.set}`, what: `${who(s.winner)} won the set ${s.score} in a tiebreak (${s.tiebreak} from ${wS}'s side)${s.extended_tiebreak ? ', a tiebreak that went beyond 7 points' : ''}`, basis: 'set scores' });
    if (s.margin === 'match_tiebreak') out.push({ at: 'match tiebreak', what: `the match was decided in a match tiebreak, ${s.score} to ${who(s.winner)}`, basis: 'set scores' });
    if (prev && prev.winner !== s.winner && s.winner) out.push({ at: `set ${s.set}`, what: `the set went the other way: ${who(s.winner)} took set ${s.set} ${s.score} after ${who(prev.winner)} won set ${prev.set}`, basis: 'set scores' });
    if (prev && prev.winner === s.winner && ['tiebreak', 'tight'].includes(prev.margin) && ['clear', 'lopsided'].includes(s.margin)) out.push({ at: `set ${s.set}`, what: `after a tight set ${prev.set}, set ${s.set} was one-sided (${s.score})`, basis: 'set scores' });
    if (s.deciding) out.push({ at: `set ${s.set}`, what: `a deciding set, won ${s.score} by ${who(s.winner)}`, basis: 'set scores' });
  }
  const dev = packet.match_development;
  if (dev) {
    const side = (x) => (x === W ? wS : lS);
    if (dev.first_break) out.push({ at: `set ${dev.first_break.set}${Number.isFinite(dev.first_break.game) ? `, game ${dev.first_break.game}` : ''}`, what: `first break of serve, by ${side(dev.first_break.by)}`, basis: dev.source === 'point_by_point' ? 'point-by-point record' : 'live score observed game by game' });
    if (dev.complete && dev.longest_run) out.push({ at: dev.longest_run.from_set === dev.longest_run.to_set ? `set ${dev.longest_run.from_set}` : `sets ${dev.longest_run.from_set}-${dev.longest_run.to_set}`, what: `${dev.longest_run.games} straight games to ${side(dev.longest_run.side)} (the longest run of the match)`, basis: 'live score observed game by game' });
  }
  return out;
}

const pctOf = (x) => (x && Number.isFinite(x.pct) ? x.pct : null);
const gap = (a, b) => (a != null && b != null ? a - b : null);

/**
 * Candidate angles for a RESULT story, strongest first. Each: { id, thesis, keywords (RegExp source the opening
 * paragraphs must touch), visuals (preferred order) }. Thresholds read the packet only; no number is invented.
 */
function recapAngles(packet) {
  const m = packet.match;
  const W = m.winner_side;
  const L = other(W);
  const wS = sideName(packet.participants[W]);
  const lS = sideName(packet.participants[L]);
  const f = packet.event?.facts || {};
  const sets = setStory(packet);
  const st = packet.stats;
  const out = [];
  const add = (score, a) => out.push({ score, ...a });
  const lostFirst = sets[0]?.winner === 'L';
  if (m.status === 'retired') add(100, { id: 'retirement', thesis: `${lS} could not finish the match; the result records a retirement and no cause, so the story is the match as far as it went and what it means for ${wS}.`, keywords: 'retire|did not finish|could not finish', visuals: ['set_by_set', 'player_context', 'path'] });
  if (m.status === 'walkover') add(100, { id: 'walkover', thesis: `${wS} advanced without a ball struck; the story is the draw position and what comes next.`, keywords: 'walkover|withdr', visuals: ['path', 'player_context', 'next'] });
  if (lostFirst && sets.length >= 2) add(90, { id: 'comeback', thesis: `${wS} lost the opening set${sets[0].margin === 'tiebreak' ? ' in a tiebreak' : ''} and still won: the story is how the match turned after set 1.`, keywords: 'opening set|first set|set down|lost the (opening|first)|came back|recover|turned|after dropping', visuals: ['set_by_set', 'match_development', 'key_numbers', 'return_pressure', 'player_context'] });
  if (sets.at(-1)?.deciding && ['tiebreak', 'match_tiebreak'].includes(sets.at(-1).margin)) add(88, { id: 'deciding_tiebreak', thesis: `It came down to a deciding-set tiebreak, and ${wS} won it.`, keywords: 'tiebreak|deciding', visuals: ['set_by_set', 'key_numbers', 'serve_profile', 'player_context'] });
  if (has(packet, 'title') || has(packet, 'doubles_title')) add(80, { id: 'title_run', thesis: `${wS} won the title; the story is the final and the run that led to it.`, keywords: 'title|final|champion|trophy|crown', visuals: ['path', 'set_by_set', 'return_pressure', 'serve_profile', 'player_context', 'match_dna_comparison'] });
  if (has(packet, 'qualifier_run')) add(85, { id: 'qualifier_run', thesis: `${wS} came through ${f.entry === 'LL' ? 'qualifying as a lucky loser' : 'qualifying'} and kept winning; the story is the run.`, keywords: 'qualif|lucky loser', visuals: ['path', 'set_by_set', 'player_context', 'match_dna_comparison'] });
  if (st && W && L) {
    const rg = gap(pctOf(st[W].return_points_won), pctOf(st[L].return_points_won));
    const sg = gap(pctOf(st[W].service_points_won), pctOf(st[L].service_points_won));
    const bw = st[W].break_points_converted;
    const bl = st[L].break_points_converted;
    if (rg != null && rg >= 6) add(70 + Math.min(10, rg), { id: 'return_pressure', thesis: `${wS} won the match on return: the return-points and break-point lines separate the players more than anything else.`, keywords: 'return', visuals: ['return_pressure', 'serve_profile', 'set_by_set', 'player_context'] });
    if (sg != null && sg >= 8) add(68 + Math.min(10, sg), { id: 'serve_control', thesis: `${wS}'s serve carried the match: the service-points and holds lines show where it was won.`, keywords: 'serve|service|hold', visuals: ['serve_profile', 'return_pressure', 'set_by_set', 'player_context'] });
    if (bw?.d && bl?.d && bw.n > bl.n && bw.d <= bl.d) add(72, { id: 'break_point_edge', thesis: `The break points decided it: ${wS} converted more of them from no more chances than ${lS} had.`, keywords: 'break point', visuals: ['key_numbers', 'return_pressure', 'serve_profile', 'set_by_set'] });
    if (bw?.d && bl?.d && bl.d > bw.d && bw.n >= bl.n) add(74, { id: 'pressure_absorbed', thesis: `${lS} had more break-point chances and still lost: the story is ${wS} holding under break-point pressure.`, keywords: 'break point|under pressure|saved', visuals: ['serve_profile', 'key_numbers', 'return_pressure', 'set_by_set'] });
  }
  const lr = Number.isFinite(f.loser_rank) ? f.loser_rank : null;
  const wr = Number.isFinite(f.winner_rank) ? f.winner_rank : null;
  if ((has(packet, 'upset') || has(packet, 'seed_upset')) && (lr || f.loser_seed)) add(lr && lr <= 10 ? 84 : 76, { id: 'upset', thesis: `${wS} beat ${lS}${lr ? `, ranked No. ${lr}` : ''}${f.loser_seed ? ` and seeded No. ${f.loser_seed}` : ''}${wr ? ` from No. ${wr}` : ''}: the story is how the lower-ranked player got there and what the records said going in.`, keywords: 'seed|No\\.\\s*\\d+|rank|upset', visuals: ['player_context', 'match_dna_comparison', 'set_by_set', 'path'] });
  const dom = sets.length && sets.every((s) => s.winner === 'W') && sets.every((s) => ['clear', 'lopsided'].includes(s.margin));
  if (dom) add(60, { id: 'control', thesis: `${wS} controlled the match from start to finish in straight sets.`, keywords: 'straight sets|control|never|from the start', visuals: ['set_by_set', 'serve_profile', 'return_pressure', 'player_context'] });
  const wid = packet.participants[W]?.players?.[0]?.id;
  const form = (packet.recent_form?.[wid] || []).filter((r) => r.result === 'W' || r.result === 'L');
  if (form.length >= 4 && form.filter((r) => r.result === 'L').length >= 3) add(58, { id: 'form_turn', thesis: `${wS} arrived out of form in our archive (more losses than wins in the previous results) and turned it here.`, keywords: 'form|previous|before this|coming in|arrived', visuals: ['form', 'player_context', 'match_dna_comparison', 'set_by_set'] });
  add(10, { id: 'result', thesis: `${wS} beat ${lS}; the story is how the sets went and what the result means for ${wS}.`, keywords: '.', visuals: ['set_by_set', 'player_context', 'path'] });
  return out.sort((a, b) => b.score - a.score);
}

function previewAngles(packet) {
  const A = packet.participants.A;
  const B = packet.participants.B;
  const aS = sideName(A);
  const bS = sideName(B);
  const out = [];
  const h = packet.h2h;
  const ra = A.players[0]?.rank?.rank;
  const rb = B.players[0]?.rank?.rank;
  const pa = packet.draw_path?.[A.players[0]?.id]?.matches || [];
  const pb = packet.draw_path?.[B.players[0]?.id]?.matches || [];
  const qual = (rows) => rows.some((r) => /^Q-/.test(String(r.round || '')) || /qualifying/i.test(String(r.round_label || '')));
  if (h?.prior_meetings?.length) out.push({ score: 80, id: 'rematch', thesis: `${aS} and ${bS} have met before in our records; the preview is about what has changed since.`, keywords: 'met|meeting|head-to-head|last time', visuals: ['h2h', 'player_context', 'match_dna_comparison', 'form'] });
  if (qual(pa) || qual(pb)) out.push({ score: 78, id: 'qualifier_vs', thesis: `${qual(pa) ? aS : bS} came through qualifying; the question is whether that run of matches meets a fresher opponent.`, keywords: 'qualif', visuals: ['paths', 'player_context', 'form', 'match_dna_comparison'] });
  if (Number.isFinite(ra) && Number.isFinite(rb) && Math.abs(ra - rb) >= 25) out.push({ score: 70, id: 'ranking_gap', thesis: `A wide ranking gap (No. ${Math.min(ra, rb)} against No. ${Math.max(ra, rb)}); the preview tests whether this week's results and records narrow it.`, keywords: 'No\\.\\s*\\d+|rank', visuals: ['player_context', 'match_dna_comparison', 'paths', 'form'] });
  out.push({ score: 50, id: 'matchup', thesis: `Two players arriving by different routes: the preview weighs their path this week, recent form and archived records.`, keywords: 'path|form|record|this week', visuals: ['player_context', 'match_dna_comparison', 'paths', 'form'] });
  return out.sort((a, b) => b.score - a.score);
}

/** Visual ids a packet + plan can actually show (a visual absent from the plan is never offered to the writer). */
export function availableVisuals(plan) {
  const ids = new Set();
  for (const m of plan?.modules || []) {
    if (m.id === 'charts') for (const c of m.data?.charts || []) ids.add(c.id);
    else if (!['method', 'scoreboard', 'preview_card'].includes(m.id) && m.data) ids.add(m.id);
  }
  // the V4 tables supersede their bar-chart twins (same numbers): offer one of each, never both
  if (ids.has('serve_profile')) { ids.delete('serve_comparison'); ids.delete('serve_counts'); }
  if (ids.has('return_pressure')) ids.delete('return_comparison');
  if (ids.has('set_by_set')) ids.delete('match_flow');
  return ids;
}

/** What each visual shows, for the writer's interpretation (labels only, no new numbers). */
export const VISUAL_GUIDE = Object.freeze({
  scoreboard: 'the final scoreline by set',
  preview_card: 'the two players, seeds, ranks and the scheduled time',
  key_numbers: 'match control: total points, breaks of serve and break points for both players',
  set_by_set: 'every set: games, tiebreak scores, and points/breaks per set where the source counts them',
  match_development: 'breaks of serve in the order they happened (observed games only)',
  serve_profile: 'serve table: first serves in, points won behind first and second serve, holds, break points saved, aces, double faults',
  return_pressure: 'return table: points won against first and second serve, return points, break points earned and converted',
  player_context: 'each player: ranking at the start of the tournament, surface record, last 52 weeks, recent results',
  path: 'the draw path: every earlier match this week with scores',
  paths: "both players' matches earlier this week, with scores",
  h2h: 'earlier meetings in our archive',
  form: 'each player\'s five previous results before this tournament',
  next: 'the next scheduled opponent',
  match_dna_comparison: 'Match DNA going in: each player\'s archived win rates (matches, sets, deciding sets, tiebreaks, vs top 10/50) before this match',
  dna_comparison: 'Technical DNA going in: archived serve/return averages before this match',
  serve_comparison: 'serve percentages side by side', return_comparison: 'return percentages side by side', serve_counts: 'aces and double faults', match_flow: 'games by set',
  ranking_trajectory: 'the weekly ranking line up to this list'
});

/**
 * The story decision for one frozen packet + content plan. Returns
 * { version, type, tier, target, angle, secondary, beats, turning_points, sets, visuals: { available, suggested } }.
 */
export function storyAngle(packet, plan = null, storyClass = 'brief') {
  const type = packet?.preview ? 'preview' : packet?.match ? 'recap' : 'ranking';
  const tier = storyTier(packet, storyClass);
  const target = PROSE_TARGETS[tier];
  const available = availableVisuals(plan);
  let cands = [];
  let beats = [];
  if (type === 'recap') {
    cands = recapAngles(packet);
    beats = ['lead: what matters about this result (not the scoreline read out, not a metric)', 'how it unfolded: set by set in order, naming the real turning points below', 'why it happened: translate the evidence into tennis — the sentence first, the number as proof', 'what it means: tournament position, next opponent, form, ranking, what to watch'];
  } else if (type === 'preview') {
    cands = previewAngles(packet);
    beats = ['lead: the question this match answers (a thesis, not a prediction)', 'how each player got here this week (paths, scores)', 'the case for each side from form, records, surface and ranking', 'what decides it / what to watch — framed as questions the evidence raises, never a pick'];
  } else {
    cands = [{ id: 'ranking_move', thesis: 'A ranking move: the story is the results behind it and what the new position means.', keywords: 'rank|No\\.\\s*\\d+|list', visuals: ['ranking_trajectory'] }];
    beats = ['lead: the move and why it matters', 'the results behind it (archive records)', 'what the new position means'];
  }
  const [angle, ...rest] = cands;
  const pick = (ids) => ids.filter((id) => available.has(id));
  const suggested = [...new Set([...pick(angle?.visuals || []), ...rest.flatMap((a) => pick(a.visuals))])].slice(0, 4);
  const strip = ({ score, ...a }) => a;
  return { version: ANGLE_VERSION, type, tier, target, angle: angle ? strip(angle) : null, secondary: rest.filter((a) => a.id !== 'result').slice(0, 2).map(strip), beats, turning_points: type === 'recap' ? turningPoints(packet) : [], sets: type === 'recap' ? setStory(packet) : [], visuals: { available: [...available], suggested } };
}
