// Story detection from the canonical tennis graph — PURE (docs/NEWSROOM.md "Events").
//
// Input is a set of facts the Worker already loaded (finished matches with ranks in force on the match
// date, consecutive official ranking lists). Output is candidate events with a deterministic id and a
// materiality score. A kind is only emitted when the stored facts PROVE it; kinds that need history we do
// not hold yet are listed in GATED_KINDS with the reason, never approximated.

export const DETECTOR_VERSION = 'tennis-detect/1.0.0';

// Kinds that need career-complete history. Our match history starts 2024-12; ranking history is still
// backfilling. "First" and "career-high" claims are unprovable until coverage says otherwise.
export const GATED_KINDS = Object.freeze({
  first_title: 'needs career-complete match history (ours starts 2024-12)',
  first_final: 'needs career-complete match history',
  first_top10_win: 'needs career-complete match history + point-in-time ranks for every past opponent',
  career_high: 'needs the player\'s full ranking history (backfill in progress)',
  draw_release: 'draws are not ingested yet',
  dna_movement: 'needs mature historical DNA snapshots'
});

const TOUR_WEIGHT = { 'Grand Slam': 30, 'WTA 1000': 22, 'WTA 500': 15, 'WTA 250': 10, 'WTA 125': 6 };
const tourWeight = (level) => TOUR_WEIGHT[level] ?? (/1000/.test(level || '') ? 22 : /500/.test(level || '') ? 15 : /250/.test(level || '') ? 10 : 5);
const ROUND_WEIGHT = { F: 18, S: 12, Q: 8 }; // round letter after the stage prefix (M-F, M-S, M-Q)
const roundOf = (code) => String(code || '').split('-').pop();
const isMain = (code) => !String(code || '').startsWith('Q-');

/** Stable id: kind + sorted entity ids + as_of. Reruns and additional publishers never duplicate. */
export async function eventId(kind, entityIds, asOf) {
  const text = `${kind}|${[...entityIds].sort().join(',')}|${asOf}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `${kind}:${[...new Uint8Array(buf)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
const other = (s) => (s === 'A' ? 'B' : 'A');

/**
 * m: { id, event_type, round, status, winner_side, retired_side, sets:[{A,B,tb}], duration_s, started_at,
 *      edition:{ id, level, name, surface, start_date }, sides:{ A:{ players:[{id,name}], rank, list_date, seed, entry }, B:{…} } }
 * Ranks are the official list IN FORCE on the match date (null = not in that list). Returns candidates.
 */
export async function detectMatchEvents(m) {
  const out = [];
  if (!['completed', 'retired', 'walkover'].includes(m.status) || !m.winner_side) return out;
  const W = m.winner_side;
  const L = other(W);
  const w = m.sides[W];
  const l = m.sides[L];
  const singles = m.event_type === 'WS' || m.event_type === 'MS';
  const ids = [...w.players, ...l.players].map((p) => p.id);
  const asOf = m.id;
  const base = tourWeight(m.edition?.level) + (isMain(m.round) ? ROUND_WEIGHT[roundOf(m.round)] || 0 : 0);
  const push = async (kind, materiality, facts) => out.push({ kind, event_id: await eventId(kind, [m.id], asOf), match_id: m.id, entity_ids: ids, occurred_at: m.started_at || m.edition?.start_date || null, materiality: clamp(materiality), facts, detector: DETECTOR_VERSION });

  if (m.status === 'walkover') {
    // a withdrawal is news only at the top of the draw; the reason is never stated (not in the source)
    if (singles && l.rank && l.rank <= 20) await push('walkover', base + 30 - l.rank, { withdrawn_side: L });
    return out;
  }

  if (singles && m.status === 'completed' && l.rank && l.rank <= 50) {
    const wr = w.rank;
    const gap = wr ? wr - l.rank : null;
    const ratio = wr ? wr / l.rank : null;
    if (!wr || (gap >= 25 && ratio >= 3)) {
      // unranked winner vs a Top-50 loser, or a large, relative ranking gap
      const size = wr ? Math.min(40, 10 * Math.log2(ratio)) : 40;
      await push('upset', base + size + (l.rank <= 10 ? 20 : l.rank <= 20 ? 10 : 0), { winner_rank: wr, loser_rank: l.rank, list_date: l.list_date, winner_unranked: !wr });
    }
  }
  if (singles && m.status === 'completed' && l.seed && !w.seed && isMain(m.round) && l.seed <= 4) {
    await push('seed_upset', base + 25 - l.seed * 3, { loser_seed: l.seed });
  }

  if (m.status === 'retired' && ((l.rank && l.rank <= 30) || (w.rank && w.rank <= 30))) {
    await push('retirement', base + 20, { retired_side: m.retired_side || L });
  }

  if (isMain(m.round) && roundOf(m.round) === 'F' && m.status !== 'walkover') {
    await push(singles ? 'title' : 'doubles_title', base + (singles ? 30 : 12), { champion_side: W });
  }

  // qualifier / lucky-loser runs: a Q or LL entrant winning into the quarterfinals or beyond
  const entry = String(w.entry || '').toUpperCase();
  if (singles && (entry === 'Q' || entry === 'LL') && isMain(m.round) && ['F', 'S', 'Q'].includes(roundOf(m.round))) {
    await push('qualifier_run', base + 15, { entry, reached: { Q: 'SF', S: 'F', F: 'title' }[roundOf(m.round)] });
  }

  const sets = m.sets || [];
  if (m.status === 'completed' && sets.length) {
    const lostFirst = sets[0][W] < sets[0][L];
    const decider = sets.length === (m.best_of || 3) || (m.best_of === 3 && sets.length === 3);
    if (lostFirst && decider) await push('comeback', base + 8 + (l.rank && l.rank <= 20 ? 10 : 0), { first_set: `${sets[0][W]}-${sets[0][L]}` });
    const last = sets[sets.length - 1];
    if (decider && last.tb) await push('deciding_tiebreak', base + 10, { final_set: `${last[W]}-${last[L]}` });
    const lost = sets.reduce((t, s) => t + s[L], 0);
    if (singles && lost <= 1 && sets.length >= 2 && l.rank && l.rank <= 100) await push('dominant', base + 5 + (lost === 0 ? 10 : 0), { games_lost: lost });
  }
  const marathonS = (m.best_of || 3) === 5 ? 4.5 * 3600 : 3 * 3600;
  if (m.duration_s && m.duration_s >= marathonS) await push('marathon', base + 10 + Math.min(20, (m.duration_s - marathonS) / 600), { duration_s: m.duration_s });
  return out;
}

/** Milestones from two consecutive official lists. prev/next: Map(player_id -> rank). */
export async function detectRankingEvents({ listKey, prevDate, nextDate, prev, next, names }) {
  const out = [];
  const tiers = [1, 10, 20, 50, 100];
  for (const [pid, rank] of next) {
    const before = prev.get(pid) ?? null;
    for (const t of tiers) {
      if (rank <= t && (before === null || before > t)) {
        const kind = t === 1 ? 'new_no1' : `enters_top${t}`;
        const materiality = { 1: 95, 10: 75, 20: 55, 50: 40, 100: 30 }[t];
        out.push({ kind, event_id: await eventId(kind, [pid], `${listKey}:${nextDate}`), entity_ids: [pid], occurred_at: nextDate, materiality, facts: { list: listKey, list_date: nextDate, previous_list_date: prevDate, rank, previous_rank: before, name: names?.get(pid) || null }, detector: DETECTOR_VERSION });
        break; // report only the highest tier crossed
      }
    }
  }
  return out;
}

/** Publish threshold: conservative at launch (brief §23). */
export const PUBLISH_MIN_MATERIALITY = 60;
