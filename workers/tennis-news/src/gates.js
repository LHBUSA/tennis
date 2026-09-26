// Factual gates — tennis-gates/1.0.0. PURE. A failure is a HOLD; nothing publishes around a gate.
// Ported from the UFC newsroom (two-class number grounding, banned phrases, entity checks) and extended
// with tennis-specific checks: score re-validation, point-in-time ranking/DNA/form, photo identity.

import { parseScore } from '../../shared/canonical/scoring.js';

export const GATES_VERSION = 'tennis-gates/1.0.0';

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
  [/\b(in the world of|it remains to be seen|only time will tell|a testament to|speaks volumes|make no mistake|at the end of the day|the perfect storm|sent shockwaves|stunned the world)\b/i, 'cliche']
];

function prose(article) {
  return [article.headline, article.dek, ...article.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join('\n');
}

export function runGates(article, packet, { existingSignatures = new Set(), now = new Date().toISOString() } = {}) {
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
    for (const rows of Object.values(packet.recent_form || {})) for (const r of rows) if (r.date && r.date > m.date) fail('form_after_event', r.match_id);
    for (const r of packet.h2h?.prior_meetings || []) if (r.match_id === m.id || (r.date && r.date > m.date)) fail('h2h_after_event', r.match_id);
  } else {
    const f = packet.event.facts;
    if (!f.list_date || !f.previous_list_date || f.previous_list_date >= f.list_date) fail('ranking_lists', `${f.previous_list_date} -> ${f.list_date}`);
    for (const r of packet.ranking_history || []) if (r.date > f.list_date) fail('ranking_after_event', r.date);
  }

  // 7. media identity: an attached photo must be of the player it is shown for
  for (const p of names) if (p.photo && p.photo.player_id && p.photo.player_id !== p.id) fail('wrong_photo', `${p.name}`);

  // 8. dedupe on the real-world event
  if (existingSignatures.has(packet.canonical_signature)) fail('duplicate', packet.canonical_signature);

  return { version: GATES_VERSION, pass: failures.length === 0, failures, checked_at: now, words, numbers_checked: numberTokens(text).length };
}
