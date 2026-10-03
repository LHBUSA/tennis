// Editorial classifier — tennis-classify/1.0.0. PURE (docs/NEWSROOM_V3.md).
//
// Replaces the single global materiality bar (60) with an explicit editorial class per event:
//   wire  — deterministic fact card on the live wire, no article
//   brief — material event with at least MIN_DIMS.brief meaningful evidence dimensions
//   full  — high-significance event with at least MIN_DIMS.full dimensions
//   deep  — major event with at least MIN_DIMS.deep dimensions
// Significance comes from event FACTS only (kind, tournament tier, round, point-in-time ranks/seeds, ranking tier
// crossed); evidence depth from the frozen PACKET only. Never from prose. Materiality stays an internal ordering
// value and is not an input here. A tier the source does not give (and the reviewed ATP registry does not list)
// stays unknown — never guessed from a name.

export const CLASSIFIER_VERSION = 'tennis-classify/1.1.0';

/** Every detected kind of one canonical story: the primary kind + facts.secondary_kinds (one article per match). */
export const kindsOf = (ev) => [ev?.kind, ...((ev?.facts?.secondary_kinds) || [])].filter(Boolean);
/** True when the story is (also) of kind k — accepts an event or a packet ({ event }). Use this, never kind === k, for context. */
export const hasKind = (x, k) => kindsOf(x?.event || x).includes(k);
export const CLASSES = Object.freeze(['wire', 'brief', 'full', 'deep']);
const RANK = { wire: 0, brief: 1, full: 2, deep: 3 };
export const atLeast = (c, min) => RANK[c] >= RANK[min];
const maxOf = (a, b) => (RANK[a] >= RANK[b] ? a : b);
const minOf = (a, b) => (RANK[a] <= RANK[b] ? a : b);
/** Meaningful evidence dimensions (beyond the result itself) a class needs. */
export const MIN_DIMS = Object.freeze({ brief: 2, full: 5, deep: 7 });
const SLAM_SLUGS = new Set(['australian-open', 'roland-garros', 'wimbledon', 'us-open']);
const TIER_RANK = { slam: 5, finals: 4, '1000': 4, '500': 3, '250': 2, tour: 2, '125': 1, itf: 0 };

/**
 * Tournament tier from stored facts: official edition level / competition key, else the reviewed ATP tier
 * registry (facts.edition_tier), else 'tour' for an ESPN ATP-league edition (that league lists ATP Tour events
 * only), else null (unknown).
 */
export function tierOf(f = {}) {
  const l = String(f.level || '').toLowerCase();
  const k = String(f.competition_key || '');
  const t = String(f.edition_tier || '');
  if (l === 'grand slam' || k === 'grand_slam' || SLAM_SLUGS.has(f.tournament_slug)) return 'slam';
  if (/finals/.test(l) || k === 'atp_finals' || k === 'wta_finals') return 'finals';
  if (/1000/.test(l) || k === 'wta_1000' || /1000/.test(t)) return '1000';
  if (/500/.test(l) || k === 'wta_500' || /\b500\b/.test(t)) return '500';
  if (/250/.test(l) || k === 'wta_250' || /\b250\b/.test(t)) return '250';
  if (/125/.test(l) || k === 'wta_125') return '125';
  if (/itf/.test(l) || /^itf/.test(k)) return 'itf';
  if (f.source_family === 'espn' && f.tour === 'atp' && !k) return 'tour';
  return null;
}

const roundCode = (r) => String(r || '').split('-').pop();
const isMain = (r) => !/^Q-/.test(String(r || ''));

/** Normalised facts for the rules (all optional; absent = unknown). */
export function contextOf(ev) {
  const f = ev.facts || {};
  const tier = tierOf(f);
  const round = roundCode(f.round);
  const main = f.round ? isMain(f.round) : true;
  const et = f.event_type || null;
  return {
    tier, T: tier ? TIER_RANK[tier] : 1, round, main, singles: et ? et === 'MS' || et === 'WS' : !/doubles/.test(ev.kind),
    late: main && (round === 'S' || round === 'F'), qf: main && round === 'Q', mid: main && /^[3-4]$/.test(round),
    loserRank: Number.isFinite(f.loser_rank) ? f.loser_rank : null, winnerRank: Number.isFinite(f.winner_rank) ? f.winner_rank : null,
    loserSeed: Number.isFinite(f.loser_seed) ? f.loser_seed : null, winnerUnranked: !!f.winner_unranked
  };
}

/** Significance class of one detected kind, from facts only. Returns [class, reason]. */
function kindClass(kind, c, f) {
  const lr = c.loserRank;
  const top = Math.min(lr ?? 999, c.winnerRank ?? 999);
  switch (kind) {
    case 'title':
      if (!c.singles) return kindClass('doubles_title', c, f);
      if (c.tier === 'slam') return ['deep', 'Grand Slam singles title'];
      if (c.tier === 'finals' || c.tier === '1000') return ['deep', `${c.tier === 'finals' ? 'Tour Finals' : '1000'} singles title`];
      if (c.tier === '500') return ['full', '500 singles title'];
      if (c.tier === '250' || c.tier === 'tour') return ['brief', `${c.tier === 'tour' ? 'ATP Tour (tier unlisted)' : '250'} singles title`];
      if (c.tier === '125') return ['brief', 'WTA 125 singles title'];
      if (c.tier === 'itf') return ['wire', 'ITF title (below the tour level we cover as stories)'];
      return ['brief', 'tour singles title (tier not given by the source)'];
    case 'doubles_title':
      if (c.tier === 'slam') return ['full', 'Grand Slam doubles title'];
      if (c.T >= 3) return ['brief', `${c.tier} doubles title`];
      if (c.tier === '250' || c.tier === 'tour') return ['brief', '250 doubles title (needs 4 evidence dimensions)', 4];
      return ['wire', 'doubles title below the 250 level or tier unknown'];
    case 'upset':
      if (!c.main) return ['wire', 'qualifying-round upset'];
      if (lr && lr <= 10) {
        if (c.tier === 'slam' && c.late) return ['deep', `top-10 upset in a Grand Slam ${c.round === 'F' ? 'final' : 'semifinal'}`];
        if (c.T >= 4 && (c.late || c.qf)) return ['full', `top-10 upset in a late round of a ${c.tier} event`];
        // 1.1.0: a top-10 player beaten by a player outside the top 50 at a 500+ event is significant in ANY main-draw
        // round (facts only: point-in-time ranks + reviewed tier; never a model probability or odds). Evidence still caps.
        if (c.singles && c.T >= 3 && c.winnerRank != null && c.winnerRank > 50) return ['full', `No. ${c.winnerRank} beat top-10 No. ${lr} at a ${c.tier} event`];
        return ['brief', `beat a top-10 player (No. ${lr})`];
      }
      if (lr && lr <= 20) {
        if (c.winnerUnranked) return ['brief', `unranked winner over No. ${lr}`];
        return c.T >= 3 || c.late || c.qf ? ['brief', `beat No. ${lr} at a ${c.tier || 'tour'} event${c.late || c.qf ? ' in a late round' : ''}`] : ['wire', `No. ${lr} upset in an early round of a smaller event`];
      }
      if (lr && lr <= 50 && ((c.late && c.T >= 2) || (c.T >= 4 && (c.qf || c.late)))) return ['brief', `beat No. ${lr} in a late round`];
      return ['wire', 'routine upset (rank gap without late-round or top-20 significance)'];
    case 'seed_upset':
      if (c.loserSeed && c.loserSeed <= 2) return c.T >= 4 && c.late ? ['full', `No. ${c.loserSeed} seed out in a late round of a ${c.tier} event`] : c.T >= 2 ? ['brief', `No. ${c.loserSeed} seed out at a ${c.tier} event`] : ['wire', `No. ${c.loserSeed} seed out below the 250 level`];
      return c.T >= 3 ? ['brief', `No. ${c.loserSeed} seed out at a ${c.tier} event`] : ['wire', 'lower seed out at a smaller event'];
    case 'retirement':
    case 'walkover':
      if (top <= 10) return c.T >= 4 && c.late ? ['full', `${kind} involving a top-10 player in a late round`] : ['brief', `${kind} involving a top-10 player`];
      if (c.late && c.T >= 3) return ['brief', `${kind} in a late round of a ${c.tier} event`];
      return ['wire', `routine ${kind} (only what the source records)`];
    case 'qualifier_run':
      if (f.reached === 'title' || f.reached === 'F') return ['brief', `${f.entry === 'LL' ? 'lucky loser' : 'qualifier'} reached the ${f.reached === 'title' ? 'title' : 'final'}`];
      if (f.reached === 'SF' && c.T >= 3) return ['brief', 'qualifier reached a semifinal at a 500+ event'];
      return ['wire', 'qualifier run below the final at a smaller event'];
    case 'comeback':
    case 'deciding_tiebreak':
    case 'marathon':
    case 'dominant': {
      const sig = (c.late && c.T >= 3) || (lr && lr <= 10 && c.T >= 3) || (c.tier === 'slam' && (c.qf || c.late));
      return sig ? ['brief', `${kind.replace('_', ' ')} with significance (${c.late ? 'late round' : 'top-10 opponent'} at a ${c.tier} event)`] : ['wire', `routine ${kind.replace('_', ' ')}`];
    }
    case 'preview': {
      // a scheduled singles match worth a story (editorial overhaul 2026-10-03): late rounds of tour-level events, or a
      // top-10 player in a quarterfinal+ at a 500+ event. Evidence still caps (full needs MIN_DIMS.full).
      const topIn = Math.min(f.a_rank ?? 999, f.b_rank ?? 999) <= 10;
      if (!c.singles || !c.main || c.tier === 'itf' || c.tier == null) return ['wire', 'preview: not a tour-level main-draw singles match'];
      if (c.late && c.T >= 1) return ['full', `${c.round === 'F' ? 'final' : 'semifinal'} at a ${c.tier} event`];
      if (c.qf && (c.T >= 3 || (topIn && c.T >= 2))) return ['full', `quarterfinal at a ${c.tier} event`];
      return ['wire', 'preview: round below the preview bar'];
    }
    case 'new_no1': return ['deep', 'new No. 1'];
    case 'enters_top10': return ['full', 'enters the top 10'];
    case 'enters_top20': return ['brief', 'enters the top 20'];
    case 'enters_top50': return f.previous_rank == null || f.previous_rank > 100 ? ['brief', `enters the top 50 from ${f.previous_rank == null ? 'outside the previous list' : `No. ${f.previous_rank}`}`] : ['wire', 'enters the top 50'];
    case 'enters_top100': return ['wire', 'enters the top 100'];
    default: return ['wire', `${kind}: fact card`];
  }
}

/**
 * Preliminary class at DETECTION (facts only). ev: { kind, facts }. Every kind of the match (facts.secondary_kinds)
 * is considered; the highest class wins (one canonical story per match).
 */
export function classifyEvent(ev) {
  const f = ev.facts || {};
  const c = contextOf(ev);
  const kinds = [ev.kind, ...(f.secondary_kinds || [])];
  let best = 'wire';
  const reasons = [];
  let needDims = null;
  for (const k of kinds) {
    const [cls, why, need] = kindClass(k, c, f);
    reasons.push(`${k}: ${why} -> ${cls}`);
    if (RANK[cls] > RANK[best]) { best = cls; needDims = need ?? null; }
  }
  return { surface: best, reasons, tier: c.tier, need_dims: needDims, publish_article: best !== 'wire', classifier_version: CLASSIFIER_VERSION };
}

/** Evidence dimensions present in a frozen packet (names only; 'result' is not counted as meaningful). */
export function evidenceDimensions(packet) {
  const d = [];
  if (!packet) return d;
  const m = packet.match;
  if (m || packet.player) d.push('result');
  if (m && ((m.sets || []).length >= 2 || (m.sets || []).some((s) => s.tb))) d.push('set_detail');
  if (packet.stats) d.push('match_statistics');
  if (packet.point_level) d.push('point_level');
  const parts = packet.participants ? ['A', 'B'].flatMap((s) => packet.participants[s]?.players || []) : [];
  if (parts.some((p) => Number.isFinite(p.rank?.rank)) || (packet.player && Number.isFinite(packet.event?.facts?.rank))) d.push('ranking_context');
  if (packet.match_dna && Object.keys(packet.match_dna).length) d.push('match_dna');
  if (packet.dna && Object.keys(packet.dna).length) d.push('technical_dna');
  if (packet.expectation) d.push('pre_match_expectation');
  if (packet.recent_form && Object.values(packet.recent_form).some((x) => x.length)) d.push('recent_form');
  if (packet.h2h?.prior_meetings?.length) d.push('h2h');
  if (packet.draw_path?.matches?.length || (packet.paths && Object.values(packet.paths).some((x) => x?.matches?.length))) d.push('draw_path');
  if (packet.tournament && (packet.tournament.level || packet.tournament.competition_key || packet.event?.facts?.edition_tier)) d.push('tournament_context');
  if (packet.next?.opponent?.length) d.push('next_opponent');
  if (packet.tournament?.surface && packet.match_dna && Object.values(packet.match_dna).some((x) => x.surface)) d.push('surface_context');
  if ((packet.ranking_history || []).length >= 3) d.push('ranking_history');
  if ((packet.prior_stories || []).length) d.push('prior_stories');
  return d;
}

const isTourSinglesTitle = (ev, pre) => ev.kind === 'title' && pre.tier !== 'itf' && contextOf(ev).singles;

/**
 * Final class at ENRICHMENT: the preliminary (significance) class capped by evidence depth. A legitimate tour singles
 * title is never below brief (owner rule). Returns { surface, reasons, importance, evidence_dimensions, publish_article,
 * capped_by_evidence, preliminary }.
 */
export function classifyStory(ev, packet) {
  const pre = classifyEvent(ev);
  const dims = evidenceDimensions(packet);
  const meaningful = dims.filter((x) => x !== 'result').length;
  let cap = meaningful >= MIN_DIMS.deep ? 'deep' : meaningful >= MIN_DIMS.full ? 'full' : meaningful >= MIN_DIMS.brief ? 'brief' : 'wire';
  if (pre.need_dims && meaningful < pre.need_dims) cap = 'wire';
  let surface = minOf(pre.surface, cap);
  const reasons = [...pre.reasons, `evidence: ${meaningful} meaningful dimension${meaningful === 1 ? '' : 's'} (${dims.filter((x) => x !== 'result').join(', ') || 'none'}) -> at most ${cap}`];
  if (isTourSinglesTitle(ev, pre) && !atLeast(surface, 'brief')) { surface = 'brief'; reasons.push('tour singles title: never below brief'); }
  const capped = RANK[surface] < RANK[pre.surface];
  if (capped) reasons.push(`capped_by_evidence (${pre.surface} -> ${surface})`);
  return { surface, reasons, importance: pre.surface, tier: pre.tier, evidence_dimensions: dims, publish_article: surface !== 'wire', capped_by_evidence: capped, preliminary: pre.surface, classifier_version: CLASSIFIER_VERSION };
}

/** One class_history entry. */
export const historyEntry = (stage, cls, reasons, at = new Date().toISOString()) => ({ stage, class: cls, at, reasons: reasons.slice(0, 12), classifier_version: CLASSIFIER_VERSION });
export { maxOf, minOf, RANK as CLASS_RANK };
