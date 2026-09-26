// Source-change ledger. Every meaningful upstream mutation of a canonical record becomes an observable,
// typed change row (and newsroom fuel). PURE diff; persistence lives in tennis_source_changes.

const RULES = {
  match: [
    { field: 'scheduled_at', kind: 'schedule_time_changed' },
    { field: 'court', kind: 'court_changed' },
    { field: 'side_a_key', kind: 'opponent_changed' },
    { field: 'side_b_key', kind: 'opponent_changed' },
    { field: 'status', kind: 'status_changed' },
    { field: 'score', kind: 'score_changed' },
    { field: 'winner_side', kind: 'result_changed' }
  ],
  draw_entry: [
    { field: 'participant_key', kind: 'draw_entry_replaced' },
    { field: 'entry_type', kind: 'entry_type_changed' },
    { field: 'seed', kind: 'seed_changed' },
    { field: 'withdrawn', kind: 'withdrawal' }
  ],
  ranking: [
    { field: 'rank', kind: 'ranking_update' },
    { field: 'points', kind: 'ranking_points_update' }
  ],
  player: [
    { field: 'full_name', kind: 'player_metadata_changed' },
    { field: 'nationality', kind: 'player_metadata_changed' },
    { field: 'dob', kind: 'player_metadata_changed' },
    { field: 'plays', kind: 'player_metadata_changed' }
  ],
  pair: [{ field: 'partner_id', kind: 'doubles_partner_changed' }]
};

const FINAL = new Set(['completed', 'retired', 'walkover']);

/**
 * diffRecord('match', prev, next) -> [{ entity_type, entity_id, field, kind, from, to }]
 * A score change on an already-final match is a `score_correction` (documented correction), not progress.
 */
export function diffRecord(entityType, prev, next, { idField = 'id' } = {}) {
  const rules = RULES[entityType];
  if (!rules) throw new Error(`no change rules for ${entityType}`);
  if (!prev) return [{ entity_type: entityType, entity_id: next[idField], field: '*', kind: 'created', from: null, to: null }];
  const out = [];
  for (const { field, kind } of rules) {
    const a = prev[field] ?? null;
    const b = next[field] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    let k = kind;
    if (entityType === 'match' && field === 'score' && FINAL.has(prev.status)) k = 'score_correction';
    if (entityType === 'match' && field === 'status' && b === 'retired') k = 'retirement';
    if (entityType === 'match' && field === 'status' && b === 'walkover') k = 'walkover';
    if (entityType === 'match' && field === 'status' && b === 'suspended') k = 'suspension';
    if (entityType === 'draw_entry' && field === 'entry_type' && b === 'LL') k = 'lucky_loser_entry';
    out.push({ entity_type: entityType, entity_id: next[idField], field, kind: k, from: a, to: b });
  }
  return out;
}
