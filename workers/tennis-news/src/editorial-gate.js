// EDITORIAL ACCEPTANCE GATE — tennis-editorial-gate/1.0.0. PURE. (Owner brief 2026-10-03: "Prose leads. Data supports.")
//
// The factual gates (gates.js) decide whether a story is TRUE. This gate decides whether it is FINISHED: a reader must
// get a complete, compelling tennis story from the text alone, with every chart attached to the point it proves and
// interpreted. A failure is a HOLD for new stories and a refusal for rewrites — never a relaxed bar.
//
// Standard: "If all the charts disappeared, would this still be an excellent tennis article?"

import { storyAngle, PROSE_TARGETS, availableVisuals } from './angle.js';

export const EDITORIAL_GATE_VERSION = 'tennis-editorial-gate/1.0.0';

const WORDS = (t) => String(t || '').trim().split(/\s+/).filter(Boolean);
const wc = (t) => WORDS(t).length;
const NUM = /(?<![\w.])\d+(?:\.\d+)?%?/g;
// a scoreline ("6-7(7), 6-4, 6-3") or a W-L record ("4-20") is ONE fact for density purposes, not five numbers
const SCORELINE = /(?<![\w.])\d{1,4}-\d{1,4}(?:\(\d{1,2}\))?(?:,?\s+\d{1,2}-\d{1,2}(?:\(\d{1,2}\))?)*/g;
const nums = (t) => { const s = String(t).replace(/\b(19|20)\d{2}\b/g, ' '); const lines = s.match(SCORELINE) || []; return [...lines, ...(s.replace(SCORELINE, ' ').match(NUM) || [])]; };
// "No. 66" is a ranking, not a sentence end (the abbreviation is restored after splitting)
const sentences = (p) => String(p).replace(/\bNo\.\s(?=\d)/g, 'No§ ').split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/).map((s) => s.replace(/No§ /g, 'No. ')).filter((s) => s.trim());
const STOP = new Set('the a an and or of in on at to for with by from as was were is are be been his her their its it that this than then over into after before against while which who'.split(' '));
const bag = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)));
const jaccard = (a, b) => { const A = bag(a); const B = bag(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n += 1; return n / (A.size + B.size - n); };

/** Body sections a reader reads as the story (Source & Method is evidence, not narrative). */
export const bodySections = (article) => (article?.sections || []).filter((s) => s.id !== 'method');
export const proseWords = (article) => bodySections(article).reduce((t, s) => t + (s.paragraphs || []).reduce((u, p) => u + wc(p), 0), 0);

// Template headings of the fact-safe writer (tennis-compose 4.x): a story built from these is a template, not a story.
const TEMPLATE_HEADINGS = new Set(['what happened', 'why it mattered', 'what comes next', 'the match in numbers', 'head-to-head', 'how the match turned', 'form and context', 'surface and matchup context', "what's next", 'what the result says']);
// Shot-level / positional tennis vocabulary. Our sources hold no shot or position data (PBECAST_LIVE_CAPABILITY_AUDIT):
// a claim about a forehand, the net or court position is invented however plausible it sounds.
const TACTICAL = /\b(forehands?|backhands?|volley(s|ed|ing)?|drop[- ]shots?|slices?|sliced|lobs?|lobbed|crosscourt|cross-court|down the line|inside[- ]out|baseline|serve[- ]and[- ]volley|net rush\w*|rushed the net|came (to|into) the net|approach shots?|footwork|movement|court position|kick serve|serve speed|mph|km\/h|rall(y|ies) length|long rallies|short rallies|groundstrokes?|wide serve|body serve|t[- ]serve|second-serve returns? (deep|short)|attack(ed|ing)? the (backhand|forehand|second serve)|targeted the|went after the)\b/i;
const NET_OK = /\bnet points?\b/i; // allowed only when the packet counts net points
const PREDICT = /\b(will|should|is expected to|are expected to|is likely to|are likely to|bound to|poised to|set to)\s+(win|beat|prevail|advance|reach|take|lose|edge|dominate|cruise)\b|\b(our pick|tipped to|we predict|predicted to)\b/i;
const CONNECTIVE = /\b(because|which|so|while|after|when|meaning|but|yet|despite|though|although|enough|instead|until|before|even|only|still|whereas|leaving|turning|giving|making|keeping|without|unlike|rather|since|once|then|and that)\b/i;
const SET_REF = /\b(opening set|first set|second set|third set|fourth set|fifth set|deciding set|final set|set (one|two|three|four|five|1|2|3|4|5)|the opener|opening-set|first-set|second-set|third-set|tiebreak|match tiebreak)\b/gi;
// Wording the factual rules REQUIRE (provenance, archive scope): never a "stock phrase" failure.
const COMPLIANCE = /(x archive|archive in force|in force at|at the start of|our archive|our records|in force when|propbetedge archive|list in force|singles list|doubles list|match dna snapshot|built only from|secondary source|before the match|before this match|start of the tournament|the tournament began)/i;

/** Normalised word stream for phrasing comparison: names -> X, numbers -> N (so two stories about different players
 *  that share a sentence frame still collide). */
export function phrasingTokens(text) {
  const out = [];
  for (const s of sentences(text)) {
    const ws = WORDS(s);
    ws.forEach((w, i) => {
      const t = w.replace(/^[^\w]+|[^\w%]+$/g, '');
      if (!t) return;
      if (/\d/.test(t)) out.push('N');
      else if (i > 0 && /^[A-Z][a-z'’-]+/.test(t) && !/^(I|No)$/.test(t)) out.push('X');
      else out.push(t.toLowerCase());
    });
    out.push('|');
  }
  return out;
}
export function shingles(text, n = 6) {
  const t = phrasingTokens(text);
  const out = new Set();
  for (let i = 0; i + n <= t.length; i += 1) {
    const g = t.slice(i, i + n);
    if (g.includes('|')) continue;
    if (g.filter((x) => x === 'X' || x === 'N').length >= 3) continue;
    if (/\bno N\b/.test(g.join(' '))) continue; // a ranking statement ("X was No. 8 and Y No. 11") is a fact frame, not stock prose
    const s = g.join(' ');
    if (COMPLIANCE.test(s)) continue;
    out.add(s);
  }
  return out;
}
const articleText = (a) => bodySections(a).flatMap((s) => [s.heading || '', ...(s.paragraphs || []), s.visual_note || '']).join('\n');

/**
 * Stock phrasing across the newsroom: 6-word frames (names/numbers normalised) this story shares with at least
 * `minArticles` OTHER published stories. corpus = [{ slug, text }].
 */
export function stockPhrases(article, corpus = [], { minArticles = 2 } = {}) {
  const mine = shingles(articleText(article));
  const counts = new Map();
  for (const c of corpus) {
    const theirs = c.shingles || shingles(c.text || '');
    for (const g of mine) if (theirs.has(g)) counts.set(g, (counts.get(g) || 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= minArticles).map(([g, n]) => ({ phrase: g, articles: n })).sort((a, b) => b.articles - a.articles);
}

/** Visual blocks a story renders inline: declared visuals (narrative layout) or, for legacy stories, every plan module. */
export function inlineVisuals(article, plan) {
  const declared = bodySections(article).filter((s) => s.visual).map((s) => s.visual);
  if (declared.length || article?.layout === 'narrative/1') return { layout: 'narrative', ids: [plan?.layout === 'narrative/1' && (plan?.module_ids || []).includes('preview_card') ? 'preview_card' : 'scoreboard', ...declared.filter((v) => v !== 'scoreboard' && v !== 'preview_card')] };
  const ids = [];
  for (const m of plan?.modules || []) {
    if (m.id === 'method') continue;
    if (m.id === 'charts') ids.push(...(m.data?.charts || []).map((c) => c.id));
    else ids.push(m.id);
  }
  if (plan?.glance) ids.push('glance');
  if (plan?.intelligence) ids.push('intelligence');
  return { layout: 'legacy', ids };
}

/**
 * editorialGate(article, packet, { plan, storyClass, corpus, angle }) ->
 *   { version, pass, failures: [{ gate, detail }], metrics }
 */
export function editorialGate(article, packet, { plan = null, storyClass = article?.story_class || 'brief', corpus = [], angle = null } = {}) {
  const failures = [];
  const fail = (gate, detail) => failures.push({ gate, detail });
  const A = angle || storyAngle(packet, plan, storyClass);
  const target = A.target || PROSE_TARGETS.news;
  const secs = bodySections(article);
  const paras = secs.flatMap((s) => (s.paragraphs || []).map((p) => ({ id: s.id, p: String(p) })));
  const words = paras.reduce((t, x) => t + wc(x.p), 0);
  const allText = paras.map((x) => x.p).join(' ');
  const iv = inlineVisuals(article, plan);
  const visualsN = iv.ids.length;
  const numCount = nums(allText).length;
  const per100 = words ? Math.round((numCount / words) * 1000) / 10 : 0;

  // 1. length: genuine narrative prose against the story's tier
  if (words < target.min) fail('thin_prose', `${words} words of narrative prose; a ${target.label} needs at least ${target.min}`);
  if (words > target.max) fail('bloated_prose', `${words} words; a ${target.label} stops at ${target.max}`);
  // 2. mostly structured data: too many visual blocks for the prose that carries them
  const wpv = visualsN ? Math.round(words / visualsN) : words;
  if (visualsN >= 3 && wpv < 110) fail('mostly_structured', `${visualsN} visual blocks for ${words} words (${wpv} words per visual; needs >= 110)`);
  // 3. charts without interpretation + rhythm (narrative layout: every declared visual is attached and read)
  if (iv.layout === 'narrative') {
    const avail = plan ? availableVisuals(plan) : null;
    const seen = new Set();
    let since = 0;
    secs.forEach((s, i) => {
      since += (s.paragraphs || []).reduce((t, p) => t + wc(p), 0);
      if (i === 0 && !s.visual) { since = 0; return; } // the scoreboard / matchup card follows the lead
      if (!s.visual) return;
      if (seen.has(s.visual)) fail('duplicate_visual', s.visual);
      seen.add(s.visual);
      if (avail && !avail.has(s.visual)) fail('unknown_visual', s.visual);
      if (wc(s.visual_note) < 18) fail('chart_without_interpretation', `${s.visual}: ${wc(s.visual_note)} words of interpretation (needs >= 18)`);
      if (i > 0 && since < 80) fail('rhythm', `only ${since} words of prose before the ${s.visual} visual (needs >= 80 between major visuals)`);
      since = 0;
    });
    if (seen.size > 4) fail('too_many_visuals', `${seen.size} visuals inline (max 4; the rest belong in the data appendix)`);
    if (wc(paras[0]?.p) < 35) fail('thin_lead', `${wc(paras[0]?.p)}-word opening paragraph`);
  } else if (visualsN >= 3) fail('chart_without_interpretation', `legacy layout: ${visualsN} modules placed by section id with no interpretation`);
  // 4. database writing: number density, number chains, paragraphs that only restate numbers
  if (per100 > 7) fail('database_writing', `${per100} numbers per 100 words (max 7)`);
  for (const x of paras) {
    const n = nums(x.p).length;
    if (n >= 7) fail('database_writing', `${x.id}: ${n} numbers in one paragraph`);
    const ss = sentences(x.p);
    const numbered = ss.filter((s) => nums(s).length).length;
    if (ss.length >= 3 && numbered / ss.length >= 0.75 && wc(x.p) / ss.length < 22) fail('database_writing', `${x.id}: a chain of short numeric sentences`);
    // "merely restates numbers": every sentence carries a figure and nothing connects them into an argument
    if (n >= 3 && ss.every((s) => nums(s).length) && !CONNECTIVE.test(x.p)) fail('restates_numbers', `${x.id}: "${x.p.slice(0, 90)}"`);
  }
  // 5. template intro / metric lead
  const lead = paras[0]?.p || '';
  const first = sentences(lead)[0] || '';
  const sides = packet?.participants ? ['A', 'B'].map((s) => (packet.participants[s]?.players || []).flatMap((p) => [p.name, p.last_name ? p.last_name.charAt(0) + p.last_name.slice(1).toLowerCase() : null, String(p.name || '').split(' ').slice(-1)[0]]).filter(Boolean)) : [[], []];
  const nameRe = (xs) => (xs.length ? `(?:${xs.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})` : '(?!)');
  const anyName = nameRe([...sides[0], ...sides[1]]);
  if (packet?.match && !packet.preview && new RegExp(`^${anyName}[^.]{0,60}?\\b(beat|beats|defeated|defeats|downed|edged|edges|overcame|ousted)\\b[^.]*\\d+-\\d+`, 'i').test(first)) fail('template_intro', `"${first.slice(0, 120)}"`);
  if (/\b(match dna|percentile|pbe rating|recorded a)\b/i.test(first)) fail('template_intro', `metric lead: "${first.slice(0, 120)}"`);
  // 6. story angle: the opening must carry the story the evidence chose
  const opening = paras.slice(0, 2).map((x) => x.p).join(' ');
  if (A.angle?.keywords && A.angle.keywords !== '.' && !new RegExp(A.angle.keywords, 'i').test(opening)) fail('no_story_angle', `angle ${A.angle.id}: the opening two paragraphs never reach /${A.angle.keywords}/`);
  // 7. recap: how the match developed (at least two set references, two of them in one paragraph)
  if (A.type === 'recap' && packet?.match?.status !== 'walkover' && (packet?.match?.sets || []).length >= 2) {
    const refs = new Set((allText.match(SET_REF) || []).map((x) => x.toLowerCase().replace('-', ' ')));
    const dense = paras.some((x) => new Set((x.p.match(SET_REF) || []).map((y) => y.toLowerCase())).size >= 2);
    if (refs.size < 2 || !dense) fail('recap_no_development', `set references: ${[...refs].join(', ') || 'none'}`);
  }
  // 8. preview: an argument, not a stat dump; never a prediction
  if (A.type === 'preview') {
    if (!/\b(question|whether|test|tests|case for|if |which of|who )\b/i.test(opening)) fail('preview_no_argument', 'the opening states no question or thesis');
    const fam = [/\bform\b|\bprevious\b|\blast (match|week|tournament)\b/i, /\bthis week\b|\bpath\b|\bon the way\b|\bround\b/i, /\bNo\.\s*\d+|\branked\b/i, /\b\d{1,4}-\d{1,4}\b/, /\b(met|meeting|head-to-head)\b/i, /\b(hard|clay|grass|indoor|surface)\b/i].filter((re) => re.test(allText)).length;
    if (fam < 3) fail('preview_no_argument', `only ${fam} evidence families argued (needs >= 3 of form, path, ranking, records, H2H, surface)`);
    const pr = allText.match(PREDICT);
    if (pr) fail('preview_prediction', pr[0]);
  }
  // 9. conclusion repeats the opening
  if (paras.length >= 3 && jaccard(paras[0].p, paras.at(-1).p) >= 0.45) fail('conclusion_repeats_opening', `jaccard ${jaccard(paras[0].p, paras.at(-1).p).toFixed(2)}`);
  // 10. headings: duplicated, or the fixed template frame
  const heads = secs.map((s) => String(s.heading || '').trim().toLowerCase()).filter(Boolean);
  const dupH = heads.find((h, i) => heads.indexOf(h) !== i);
  if (dupH) fail('duplicate_heading', dupH);
  const tmpl = heads.filter((h) => TEMPLATE_HEADINGS.has(h) || [...TEMPLATE_HEADINGS].some((t) => h.startsWith(t)));
  if (tmpl.length >= 2) fail('template_headings', tmpl.join(' | '));
  // 11. unsupported tactical claims (no shot or position data exists)
  const tac = articleText(article).match(TACTICAL);
  if (tac) fail('unsupported_tactical', tac[0]);
  const net = articleText(article).match(NET_OK);
  if (net && !['A', 'B'].some((s) => packet?.stats?.[s]?.net_points_won)) fail('unsupported_tactical', net[0]);
  // 11b. system meta-language ("the supplied record", "the packet"): journalism never narrates its own inputs
  const meta = articleText(article).match(/\b(the packet|evidence packet|supplied (path )?records?|source record|the data provided|provided data|not included in the (supplied|available|path)|supplied surface labels?|(statistics|data|scores?) in the source|the source (does|did) not|stored path)\b/i);
  if (meta) fail('meta_language', meta[0]);
  // 12. repeated phrasing across the newsroom
  const stock = stockPhrases(article, corpus);
  if (stock.length >= 3) fail('repeated_phrasing', stock.slice(0, 4).map((x) => `"${x.phrase}" (${x.articles})`).join('; '));

  return {
    version: EDITORIAL_GATE_VERSION, pass: failures.length === 0, failures,
    metrics: { prose_words: words, target_min: target.min, target_max: target.max, tier: A.tier, angle: A.angle?.id || null, layout: iv.layout, inline_visuals: visualsN, words_per_visual: wpv, numbers_per_100_words: per100, interpreted_visuals: secs.filter((s) => s.visual && wc(s.visual_note) >= 18).length, stock_phrases: stock.length }
  };
}
