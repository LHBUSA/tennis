// Factual gates — tennis-gates/1.0.0. PURE. A failure is a HOLD; nothing publishes around a gate.
// Ported from the UFC newsroom (two-class number grounding, banned phrases, entity checks) and extended
// with tennis-specific checks: score re-validation, point-in-time ranking/DNA/form, photo identity.

import { parseScore } from '../../shared/canonical/scoring.js';

export const GATES_VERSION = 'tennis-gates/3.0.0';

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
  [/\b(odds|favou?rite|underdog|bet|bets|betting|bettors?|wager\w*|sportsbook|moneyline|spread|line moved)\b|[+-]\d{3}\b/i, 'unsupported_market'],
  [/\b(first|maiden|debut)\s+(title|final|trophy|semifinal|quarterfinal|win over)|career[- ](high|best)|personal best|record\b|all-time|historic/i, 'unsupported_first_or_record'],
  [/[“”"]/, 'unsupported_quote'],
  [/\b(our model|win probability|projected|fair price|edge of)\b/i, 'unsupported_model'],
  // tour-relative claims: the packet carries individual measurements only (no peer percentiles), so any
  // comparison with the tour is unsupported (Tennis DNA publication rule 2026-09-26)
  [/\b(\d{1,2}(st|nd|rd|th)\s+percentile|percentile|top\s+\d{1,2}\s*(%|per\s*cent)|(best|highest|lowest|worst|strongest|weakest)\s+(on|in)\s+(the\s+)?(tour|wta|atp|field)|among\s+the\s+(best|elite|top)\b|above[- ]average|below[- ]average|tour[- ]average|tour[- ]leading|league[- ]leading)/i, 'unsupported_comparative'],
  [/\b(in the world of|it remains to be seen|only time will tell|a testament to|speaks volumes|make no mistake|at the end of the day|the perfect storm|sent shockwaves|stunned the world)\b/i, 'cliche']
];

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
          if (!allowed.has(t)) fail('numeric_grounding', `${t} not in packet. In: "${sentence.slice(0, 160)}"`);
        }
      }
    }
  }

  // 2. banned / unsupported claims
  for (const [re, gate] of BANNED) { const hit = text.match(re); if (hit) fail(gate, hit[0]); }

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
      const re = new RegExp(`\\b(${nm}|${p.name})\\b[^.]{0,40}?\\b(beat|beats|defeated|defeats|won the match|wins the|edged|edges|outlasted|outlasts|advanced|advances|knocked out|reaches|reached)\\b`, 'i');
      const hit = text.match(re);
      if (hit && !new RegExp(`\\b(against|by|to|over)\\b`, 'i').test(hit[0].slice(nm.length))) fail('wrong_winner', hit[0].slice(0, 120));
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
