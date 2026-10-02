// Factual gates — tennis-gates/1.0.0. PURE. A failure is a HOLD; nothing publishes around a gate.
// Ported from the UFC newsroom (two-class number grounding, banned phrases, entity checks) and extended
// with tennis-specific checks: score re-validation, point-in-time ranking/DNA/form, photo identity.

import { parseScore } from '../../shared/canonical/scoring.js';

export const GATES_VERSION = 'tennis-gates/4.1.0';

const SKIP_KEY = /(^|_)(id|ids|url|slug|hash|key|token|image|square|wide|thumb|portrait|jpg|photo|source_page|license|capture|event_id|built_at|detector|version)$/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const URL = /https?:\/\/\S+/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/g;

/** Whole dates the packet holds (a date in prose must be one of them; its parts are NOT loose numbers). */
export function allowedDates(packet) {
  return new Set((JSON.stringify(packet).match(ISO_DATE) || []).map((d) => d.slice(0, 10)));
}

/** Every number a story may print: numeric leaves plus numbers inside packet strings (dates, scores). */
export function allowedNumbers(packet) {
  const set = new Set();
  const addStr = (s) => { for (const t of numberTokens(String(s).replace(UUID, ' ').replace(URL, ' '))) set.add(t); };
  const walk = (v, key = '') => {
    if (v === null || v === undefined) return;
    if (SKIP_KEY.test(key) && key !== 'rank') return;
    if (typeof v === 'number') { set.add(String(Number(v))); return; }
    if (typeof v === 'string') { addStr(v); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key)); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(packet);
  return set;
}

/** Numeric tokens in text: "6-4" -> 6,4; "58.3%" -> 58.3; "No. 12" -> 12; thousands commas stripped. */
export function numberTokens(text) {
  const s = String(text).replace(ISO_DATE, ' ').replace(/(\d),(\d{3})\b/g, '$1$2').replace(/(\d)[-–](?=\d)/g, '$1 ');
  return (s.match(/(?<![\w.])\d+(?:\.\d+)?/g) || []).map((t) => String(Number(t)));
}

const BANNED = [
  // unsupported cause / health / mind-reading — the packet can never prove these
  [/\b(injur\w*|ill(ness)?|medical|physio|trainer|pain|cramp\w*|blister\w*|fatigue\w*|sick|strain\w*|surgery|hurt)\b/i, 'unsupported_medical'],
  [/\b(mental(ly)?|motivat\w*|confiden\w*|nerves|nervous|emotion\w*|frustrat\w*|angry|hungry|desperate|determined|composure|belief)\b/i, 'unsupported_mentality'],
  [/\b(odds|favou?rite|underdog|bet|bets|betting|bettors?|wager\w*|sportsbook|moneyline|spread|line moved)\b|(?<![\d\w-])[+-]\d{3}\b/i, 'unsupported_market'],
  [/\b(first|maiden|debut)\s+(title|final|trophy|semifinal|quarterfinal|win over)|career[- ](high|best)|personal best|record\b|all-time|historic/i, 'unsupported_first_or_record'],
  [/[“”"]/, 'unsupported_quote'],
  [/\b(our model|win probability|projected|fair price|edge of)\b/i, 'unsupported_model'],
  // tour-relative claims: the packet carries individual measurements only (no peer percentiles), so any
  // comparison with the tour is unsupported (Tennis DNA publication rule 2026-09-26)
  [/\b(\d{1,2}(st|nd|rd|th)\s+percentile|percentile|top\s+\d{1,2}\s*(%|per\s*cent)|(best|highest|lowest|worst|strongest|weakest)\s+(on|in)\s+(the\s+)?(tour|wta|atp|field)|among\s+the\s+(best|elite|top)\b|above[- ]average|below[- ]average|tour[- ]average|tour[- ]leading|league[- ]leading)/i, 'unsupported_comparative'],
  [/\b(in the world of|it remains to be seen|only time will tell|a testament to|speaks volumes|make no mistake|at the end of the day|the perfect storm|sent shockwaves|stunned the world)\b/i, 'cliche']
];

// Win-loss records are packet data, not record-breaking claims (canary 2026-09-29: "a 67-107 record against top-50
// opponents", "pre-match record in our archive" were held as unsupported records). Only these phrasings are exempt.
const WL_RECORD = /\b\d{1,4}-\d{1,4}\s+record\b|\brecord\s+(of|at)\s+\d{1,4}-\d{1,4}\b|\b(pre-match|win-loss|W-L|head-to-head|H2H|surface|season|career)\s+record\b|\brecord\s+(in|from)\s+(our|the)\s+(archive|PropBetEdge)\b/gi;
// Form windows (last 10 matches, last 20 matches, 52 weeks) are the definition of the stored window, not a statistic.
const WINDOW = (t) => new RegExp(`\\blast\\s+${t}\\s+(matches|results|weeks)\\b|\\b${t}[- ]week\\b|\\b(over|in)\\s+(the\\s+)?(previous|past|last)\\s+${t}\\s+(matches|weeks)\\b`, 'i');
const WINDOW_SIZES = new Set(['10', '20', '52']);
// The losing finalist (semifinalist, quarterfinalist) did reach THIS match's round: "X reached the final" is true.
const ROUND_REACHED = { F: 'final|title match|championship match|title decider', S: 'semi-?finals?|last four', Q: 'quarter-?finals?|last eight' };

function prose(article) {
  return [article.headline, article.dek, ...article.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join('\n');
}

export function runGates(article, packet, { existingSignatures = new Set(), now = new Date().toISOString(), plan = null } = {}) {
  const failures = [];
  const fail = (gate, detail) => failures.push({ gate, detail });
  const text = prose(article);

  // 1. numeric grounding (class A = packet). Exempt: 0-5 and calendar years.
  const allowed = allowedNumbers(packet);
  const dates = allowedDates(packet);
  for (const d of text.match(ISO_DATE) || []) if (!dates.has(d.slice(0, 10))) fail('date_grounding', d);
  for (const sec of [{ paragraphs: [article.headline, article.dek] }, ...article.sections]) {
    for (const para of sec.paragraphs) {
      for (const sentence of String(para).split(/(?<=[.!?])\s+/)) {
        for (const t of numberTokens(sentence)) {
          const n = Number(t);
          if ((Number.isInteger(n) && n >= 0 && n <= 5) || (n >= 1990 && n <= 2100 && Number.isInteger(n))) continue;
          if (WINDOW_SIZES.has(t) && WINDOW(t).test(sentence)) continue;
          if (!allowed.has(t)) fail('numeric_grounding', `${t} not in packet. In: "${sentence.slice(0, 160)}"`);
        }
      }
    }
  }

  // 2. banned / unsupported claims
  for (const [re, gate] of BANNED) { const hit = (gate === 'unsupported_first_or_record' ? text.replace(WL_RECORD, ' ') : text).match(re); if (hit) fail(gate, hit[0]); }

  // 2a. provenance: a secondary source is never called official (ESPN-sourced ATP lists/results are real data, not
  //     an official tour publication)
  const rankProv = packet.ranking_provenance || null;
  const secondaryRank = rankProv ? rankProv.classification !== 'official' : /atp_/.test(String(packet.event?.facts?.list || ''));
  const officialRank = text.match(/\bofficial\b[^.]{0,40}\b(rank\w*|list|lists)\b|\b(ATP|WTA)\b[^.]{0,20}\bofficial\b/i);
  if (secondaryRank && officialRank) fail('unsupported_official_claim', officialRank[0]);
  const secondaryResult = (packet.provenance?.upstream || []).some((u) => u.classification === 'secondary' && !/list/.test(u.what));
  const officialResult = text.match(/\bofficial\b[^.]{0,40}\b(result|results|feed|score|scores|statistics|data)\b/i);
  if (secondaryResult && officialResult) fail('unsupported_official_claim', officialResult[0]);

  // 2b. rendering artifacts can never reach a reader
  const art = text.match(/\[object \w+\]|\bundefined\b|\bNaN\b|\bnull\b|$\{/);
  if (art) fail('render_artifact', art[0]);

  // 3. structure
  if (article.headline.length < 20 || article.headline.length > 140) fail('headline_length', String(article.headline.length));
  const words = text.split(/\s+/).length;
  if (words < (packet.match ? 90 : 50)) fail('too_thin', `${words} words`);

  // 4. entities: the primary player is in the headline; every named participant exists in the packet
  const names = packet.match ? ['A', 'B'].flatMap((s) => packet.participants[s].players) : [packet.player];
  const primary = names.find((p) => p.id === article.primary_player_id);
  if (!primary) fail('entity_primary', 'primary player not in packet');
  else if (!article.headline.includes(primary.last_name ? primary.last_name.split(' ')[0].charAt(0) + primary.last_name.split(' ')[0].slice(1).toLowerCase() : primary.name.split(' ').slice(-1)[0]) && !article.headline.includes(primary.name)) fail('entity_headline', 'primary surname missing from headline');
  for (const id of article.player_ids) if (!names.some((p) => p.id === id)) fail('entity_unknown_player', id);

  if (packet.match) {
    const m = packet.match;
    // 4b. result direction: the loser is never written as the subject of a winning verb
    const L = m.winner_side === 'A' ? 'B' : 'A';
    for (const p of packet.participants[L]?.players || []) {
      const sn = (p.last_name || p.name.split(' ').slice(-1)[0]).split(' ')[0];
      const nm = sn.charAt(0) + sn.slice(1).toLowerCase();
      const re = new RegExp(`\\b(${nm}|${p.name})\\b[^.\\n]{0,40}?\\b(beat|beats|defeated|defeats|won the match|wins the|edged|edges|outlasted|outlasts|advanced|advances|knocked out|reaches|reached)\\b`, 'i');
      const hit = text.match(re);
      const rd = ROUND_REACHED[String(m.round || '').split('-').pop()];
      const reachedThisRound = hit && /\breach(ed|es)\b/i.test(hit[0]) && rd && new RegExp(`\\breach(ed|es)\\s+(the\\s+)?(${rd})\\b`, 'i').test(text.slice(text.indexOf(hit[0])));
      if (hit && !reachedThisRound && !new RegExp(`\\b(against|by|to|over)\\b`, 'i').test(hit[0].slice(nm.length))) fail('wrong_winner', hit[0].slice(0, 120));
    }
    // 5. score: stored sets re-validated against the stored score text with the canonical parser
    if (m.status !== 'walkover' && m.score) {
      try {
        const parsed = parseScore(m.score, m.format);
        const sets = parsed.sets || parsed;
        const same = Array.isArray(sets) && sets.length === m.sets.length && sets.every((s, i) => {
          const g = s.games || s;
          return [g.A, g.B].sort().join() === [m.sets[i].A, m.sets[i].B].sort().join();
        });
        if (!same) fail('score_mismatch', `${m.score} vs stored sets`);
      } catch (e) { fail('score_unparseable', `${m.score}: ${e.message}`); }
    }
    if (!['completed', 'retired', 'walkover'].includes(m.status) || !m.winner_side) fail('match_not_final', m.status);
    // 6. point-in-time: ranks from a list dated on/before the tournament start; DNA before the match;
    //    form and H2H strictly before this tournament
    for (const p of names) if (p.rank && p.rank.list_date > packet.tournament.start_date) fail('ranking_after_event', `${p.name} list ${p.rank.list_date}`);
    for (const [pid, d] of Object.entries(packet.dna || {})) if (d.as_of > m.date) fail('dna_after_event', `${pid} ${d.as_of} > ${m.date}`);
    // Match DNA v2 and the rating expectation: snapshots strictly BEFORE the match day (never today's rating)
    for (const [pid, d] of Object.entries(packet.match_dna || {})) if (d.as_of >= m.date || (d.surface && d.surface.as_of >= m.date)) fail('match_dna_after_event', `${pid} ${d.as_of} >= ${m.date}`);
    if (packet.expectation && packet.expectation.as_of >= m.date) fail('expectation_after_event', `${packet.expectation.as_of} >= ${m.date}`);
    for (const rows of Object.values(packet.recent_form || {})) for (const r of rows) if (r.date && r.date > m.date) fail('form_after_event', r.match_id);
    for (const r of packet.h2h?.prior_meetings || []) if (r.match_id === m.id || (r.date && r.date > m.date)) fail('h2h_after_event', r.match_id);
  } else {
    const f = packet.event.facts;
    if (!f.list_date || !f.previous_list_date || f.previous_list_date >= f.list_date) fail('ranking_lists', `${f.previous_list_date} -> ${f.list_date}`);
    for (const r of packet.ranking_history || []) if (r.date > f.list_date) fail('ranking_after_event', r.date);
    for (const [pid, d] of Object.entries(packet.match_dna || {})) if (d.as_of >= f.list_date) fail('match_dna_after_event', `${pid} ${d.as_of} >= ${f.list_date}`);
  }

  // 7. media identity: an attached photo must be of the player it is shown for
  for (const p of names) if (p.photo && p.photo.player_id && p.photo.player_id !== p.id) fail('wrong_photo', `${p.name}`);

  // 8. dedupe on the real-world event
  if (existingSignatures.has(packet.canonical_signature)) fail('duplicate', packet.canonical_signature);

  // 9. additive value (V3): prose must add to the visuals and to itself, never restate them
  for (const f of additiveValueFailures(article, plan)) fail(f.gate, f.detail);

  // 10. V4 tennis-intelligence grounding: every serve/return/development claim needs the family that proves it
  for (const f of intelligenceFailures(text, packet)) fail(f.gate, f.detail);

  // 11. V4.1 context contract: a match story whose packet proves context must use it in prose
  for (const f of contextFailures(article, packet)) fail(f.gate, f.detail);

  return { version: GATES_VERSION, pass: failures.length === 0, failures, checked_at: now, words, numbers_checked: numberTokens(text).length };
}

// ---- additive-value gates (tennis-gates/3.0.0) ---------------------------------------------------------------
const STOP = new Set('the a an and or of in on at to for with by from as was were is are be been his her their its it that this than then over into after before against while which who'.split(' '));
const words = (t) => String(t).toLowerCase().replace(/[^a-z0-9%.\s-]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
function jaccard(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n += 1;
  return n / (A.size + B.size - n);
}
const bodyParas = (article) => article.sections.filter((s) => s.id !== 'method').flatMap((s) => s.paragraphs.map((p) => ({ id: s.id, p: String(p) })));
function chartNumbers(plan) {
  const sets = [];
  const charts = (plan?.modules || []).find((m) => m.id === 'charts')?.data?.charts || [];
  for (const c of charts) {
    const set = new Set();
    for (const row of c.series || []) for (const k of c.value_keys || []) if (Number.isFinite(row[k])) set.add(String(Number(row[k])));
    if (set.size) sets.push({ id: c.id, set });
  }
  return sets;
}
/**
 * restate_headline: a section paragraph that is essentially the headline + dek again.
 * duplicate_point:  two body paragraphs making the same point (high word overlap).
 * chart_narration:  a paragraph that reads out an adjacent chart (4+ figures, 80%+ of them one chart's values).
 */
export function additiveValueFailures(article, plan = null) {
  const out = [];
  const head = `${article.headline} ${article.dek || ''}`;
  const paras = bodyParas(article);
  for (const x of paras) if (words(x.p).length >= 8 && jaccard(x.p, head) >= 0.75) out.push({ gate: 'restate_headline', detail: `${x.id}: "${x.p.slice(0, 100)}"` });
  for (let i = 0; i < paras.length; i += 1) for (let j = i + 1; j < paras.length; j += 1) {
    if (words(paras[i].p).length >= 12 && words(paras[j].p).length >= 12 && jaccard(paras[i].p, paras[j].p) >= 0.7) out.push({ gate: 'duplicate_point', detail: `${paras[i].id} ~ ${paras[j].id}` });
  }
  const charts = chartNumbers(plan);
  if (charts.length) for (const x of paras) {
    const nums = numberTokens(x.p).filter((t) => !(Number.isInteger(Number(t)) && Number(t) >= 0 && Number(t) <= 5));
    if (nums.length < 4) continue;
    for (const c of charts) {
      const hit = nums.filter((t) => c.set.has(t)).length;
      if (hit / nums.length >= 0.8) { out.push({ gate: 'chart_narration', detail: `${x.id} reads out ${c.id} (${hit}/${nums.length} figures)` }); break; }
    }
  }
  return out;
}

// ---- V4 intelligence grounding (tennis-gates/4.0.0) --------------------------------------------------------------
const WORDNUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const sidesOf = (packet) => (packet.stats ? [packet.stats.A, packet.stats.B] : []);
/**
 * unsupported_stat_family: serve/return vocabulary without stored match statistics (or the specific count).
 * unsupported_momentum:    "momentum" (never provable) / turning-point language without an observed game sequence.
 * sequence_claim:        "first/opening/early break" needs a first break from a complete observed sequence.
 * run_claim:               "N straight/consecutive games" must equal the observed longest run (complete sequence only).
 * clean_hold_claim:        "never dropped serve", "did not face a break point", "saved every break point" must be true
 *                          for a player in the statistics.
 */
export function intelligenceFailures(text, packet) {
  const out = [];
  const f = (gate, detail) => out.push({ gate, detail });
  const hasStats = !!packet.stats;
  const dev = packet.match_development || null;
  const stat = text.match(/\b(aces?|double[- ]faults?|first[- ]serve|second[- ]serve|break[- ]points?|service games?|return games?|return points|service points)\b/i);
  if (stat && !hasStats) f('unsupported_stat_family', stat[0]);
  if (/\bunforced errors?\b/i.test(text) && !sidesOf(packet).some((s) => Number.isFinite(s?.unforced_errors))) f('unsupported_stat_family', 'unforced errors');
  if (/\b\d+\s+winners\b/i.test(text) && !sidesOf(packet).some((s) => Number.isFinite(s?.winners))) f('unsupported_stat_family', 'winners count');
  const broke = text.match(/\b(broke|broken|breaks? of serve|break of serve|broke back)\b/i);
  if (broke && !hasStats && !(dev && dev.breaks?.length)) f('unsupported_stat_family', broke[0]);
  // order claims need the whole sequence: stats totals and partial live coverage cannot say which break came first
  const first = text.match(/\b(first break|opening break|broke first|early break)\b/i);
  if (first && !dev?.first_break) f('sequence_claim', first[0]);
  const mo = text.match(/\bmomentum\b/i);
  if (mo) f('unsupported_momentum', mo[0]);
  const tp = text.match(/\b(turning point|turned the match|swung the match|swing of the match|shifted the match)\b/i);
  if (tp && !(dev && (dev.breaks?.length || dev.longest_run))) f('unsupported_momentum', tp[0]);
  for (const m of text.matchAll(/\b(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(straight|consecutive|successive|unanswered)\s+games\b/gi)) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDNUM[m[1].toLowerCase()];
    if (!(dev?.complete && dev.longest_run && dev.longest_run.games === n)) f('run_claim', m[0]);
  }
  const S = sidesOf(packet);
  const never = text.match(/\b(never|without)\s+(being\s+)?(dropp(ed|ing)\s+(her|his|their)?\s*serve|broken|losing\s+(her|his|their)?\s*serve)|\bheld\s+(every|all)\s+(of\s+)?(her|his|their)\s+service\s+games\b/i);
  if (never && !S.some((s) => s?.service_games_held?.d && s.service_games_held.n === s.service_games_held.d)) f('clean_hold_claim', never[0]);
  const noBp = text.match(/\b(did not|didn't|never)\s+face\s+a\s+break\s+point\b/i);
  if (noBp && !S.some((s) => s?.break_points_faced === 0)) f('clean_hold_claim', noBp[0]);
  const allSaved = text.match(/\bsaved\s+(every|all)\s+(of\s+)?(the\s+|her\s+|his\s+|their\s+)?(\d+\s+)?break\s+points?\b/i);
  if (allSaved && !S.some((s) => s?.break_points_saved?.d && s.break_points_saved.n === s.break_points_saved.d)) f('clean_hold_claim', allSaved[0]);
  return out;
}

// ---- V4.1 context contract (tennis-gates/4.1.0) ------------------------------------------------------------------
const lastWord = (n) => String(n || '').trim().split(/\s+/).slice(-1)[0];
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (p, names) => names.some((n) => n && new RegExp(`(^|[^\\p{L}])${esc(n)}(?![\\p{L}])`, 'iu').test(p));
const isComebackOrTb = (packet) => [packet.event?.kind, ...(packet.event?.facts?.secondary_kinds || [])].some((k) => k === 'comeback' || k === 'deciding_tiebreak');

/**
 * Context families a MATCH packet proves beyond the result and the ranking, each with the test a paragraph must meet to
 * count as using it. A family counts only when the packet holds the concrete values its test looks for.
 */
export function contextFamilies(packet) {
  const out = [];
  if (!packet?.match) return out;
  const dpNames = (packet.draw_path?.matches || []).flatMap((r) => (r.opponent || []).flatMap((o) => [o.name, lastWord(o.name)]));
  if (dpNames.length) out.push({ family: 'draw_path', test: (p) => mentions(p, dpNames) || /\bqualif\w*\b[^.]*\b(win|wins|won|beat|beating|over)\b|\bmain-draw win\b/i.test(p) });
  if (isComebackOrTb(packet) || packet.match_development) out.push({ family: 'match_development', test: (p) => /\b(opening|first)[- ]set\b|\bdeciding[- ]set\b|\bset down\b|\btiebreak\b|\bbroke\b|\bbreak of serve\b|\blongest run\b/i.test(p) });
  const recs = new Set(); const pcts = new Set();
  for (const md of Object.values(packet.match_dna || {})) for (const x of Object.values(md?.metrics || {})) { if (x?.record && x.record.W + x.record.L) recs.add(`${x.record.W}-${x.record.L}`); if (x?.pct != null && x.sample_matches) pcts.add(`${x.pct}%`); }
  if (recs.size || pcts.size) out.push({ family: 'match_dna', test: (p) => [...recs].some((r) => p.includes(r)) || [...pcts].some((x) => p.includes(x)) });
  const formNames = Object.values(packet.recent_form || {}).flat().flatMap((r) => (r.opponent || []).flatMap((o) => [o.name, lastWord(o.name)]));
  if (formNames.length) out.push({ family: 'recent_form', test: (p) => mentions(p, formNames) });
  if (packet.h2h?.prior_meetings?.length) out.push({ family: 'h2h', test: (p) => /\b(met|meeting|meetings|head-to-head)\b/i.test(p) });
  const statPcts = new Set(sidesOf(packet).flatMap((s) => Object.values(s || {}).map((x) => (x?.pct != null ? `${x.pct}%` : null)).filter(Boolean)));
  if (statPcts.size) out.push({ family: 'match_statistics', test: (p) => [...statPcts].some((x) => p.includes(x)) || /\bheld \d+ of \d+\b|\bconverted \d+ of \d+\b/i.test(p) });
  return out;
}

/**
 * thin_context: a published MATCH story whose packet proves at least one context family must have at least one body
 * paragraph that uses one (headline/score/ranking restatement and "Nth win" lines never count: they match no test).
 */
export function contextFailures(article, packet) {
  const fams = contextFamilies(packet);
  if (!fams.length) return [];
  const paras = article.sections.filter((s) => !['what_happened', 'method', 'next'].includes(s.id)).flatMap((s) => s.paragraphs.map(String));
  const used = fams.filter((f) => paras.some((p) => f.test(p))).map((f) => f.family);
  return used.length ? [] : [{ gate: 'thin_context', detail: `packet proves ${fams.map((f) => f.family).join(', ')} but no paragraph uses any of them` }];
}
