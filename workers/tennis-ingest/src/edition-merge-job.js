// Canonical edition consolidation (lane edition_merge; docs/TENNIS_DATA_MODEL.md "Context layer").
// An ESPN WTA event written before its official WTA edition could be proven left its rows in ESPN's own
// ("shadow") edition. Once tennis_source_mappings proves the event = an official edition (provider espn_wta,
// method shared_matches, confidence high), every ESPN-owned WS / WD row of the shadow edition is:
//   - MERGED into the official row of the same match (same event, stage and participant pair; exactly one) —
//     external ids move, the ESPN row is removed (tennis_source_changes kind duplicate_merged); or
//   - MOVED into the official edition (draw, surface / indoor of the official edition) when the official edition
//     has no such match (kind edition_moved); two or more candidates -> left in place (ambiguous).
// Men's rows of a combined event's ESPN edition are never touched. A shadow edition left with no rows and no
// other reference is removed and its ESPN id repointed to the official edition.

import { inList } from '../../shared/store/postgrest.js';
import { drawId } from '../../shared/canonical/ids.js';
import { naturalKey } from './writer.js';

const ST = 'em:state';

async function workList(store) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const rows = await store.select('tennis_source_mappings', `select=external_id,canonical_id,evidence&entity_type=eq.edition&provider=eq.espn_wta&status=eq.mapped&confidence=eq.high&method=eq.shared_matches&order=external_id.asc&limit=1000&offset=${off}`);
    for (const r of rows) { const sh = r.evidence?.espn_edition; if (sh && sh !== r.canonical_id) out.push({ ev: r.external_id, shadow: sh, official: r.canonical_id }); }
    if (rows.length < 1000) return out;
  }
}

async function rowsOf(store, editionId) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const rows = await store.select('tennis_matches', `select=match_id,event_type,round,format_key,source_family,tennis_match_participants(side,participant_key)&edition_id=eq.${editionId}&event_type=in.(WS,WD)&order=match_id.asc&limit=1000&offset=${off}`);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const keyOf = (m) => { const p = (s) => (m.tennis_match_participants || []).find((x) => x.side === s)?.participant_key; const a = p('A'); const b = p('B'); return a && b ? naturalKey(m.event_type, m.round, a, b) : null; };
const stageOf = (round) => (round === 'RR' ? 'round_robin' : /^Q-/.test(String(round || '')) ? 'qualifying' : 'main');

export async function mergeOne(ctx, item, { dry = false } = {}) {
  const store = ctx.store;
  const [off] = await store.select('tennis_tournament_editions', `select=edition_id,surface,indoor&edition_id=eq.${item.official}`);
  if (!off) return { ...item, skipped: 'official_missing' };
  const shadowRows = (await rowsOf(store, item.shadow)).filter((m) => m.source_family === 'espn');
  const official = await rowsOf(store, item.official);
  const byKey = new Map();
  for (const m of official) { const k = keyOf(m); if (!k) continue; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(m.match_id); }
  const merges = [];
  const moves = [];
  let ambiguous = 0;
  for (const m of shadowRows) {
    const k = keyOf(m);
    const c = k ? byKey.get(k) || [] : [];
    if (c.length === 1) merges.push({ from: m.match_id, into: c[0] });
    else if (c.length === 0 && k) moves.push(m);
    else ambiguous += 1;
  }
  const out = { ...item, shadow_rows: shadowRows.length, merged: merges.length, moved: moves.length, ambiguous };
  if (dry) return out;
  const now = new Date().toISOString();
  for (const mg of merges) {
    await store.req('PATCH', `tennis_match_external_ids?match_id=eq.${mg.from}`, { body: { match_id: mg.into } });
  }
  if (merges.length) {
    const ids = merges.map((x) => x.from);
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100);
      for (const t of ['tennis_match_events', 'tennis_sets', 'tennis_match_participants', 'tennis_match_stats']) await store.del(t, `match_id=${inList(part)}`);
      await store.del('tennis_matches', `match_id=${inList(part)}`);
    }
    await store.insert('tennis_source_changes', merges.map((mg) => ({ entity_type: 'match', entity_id: mg.from, field: 'row', kind: 'duplicate_merged', from_value: null, to_value: mg.into, source_family: 'espn', capture_id: null, observed_at: now })));
  }
  // moves grouped by (event, stage): one draw per group, one PATCH per 100 rows
  const groups = new Map();
  for (const m of moves) { const g = `${m.event_type}|${stageOf(m.round)}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(m); }
  for (const [g, list] of groups) {
    const [et, stage] = g.split('|');
    const did = await drawId(item.official, et, stage);
    await store.upsert('tennis_draws', [{ draw_id: did, edition_id: item.official, event_type: et, stage, format_key: list[0].format_key || 'unknown' }], { onConflict: 'draw_id', ignore: true });
    for (let i = 0; i < list.length; i += 100) {
      const part = list.slice(i, i + 100).map((m) => m.match_id);
      await store.req('PATCH', `tennis_matches?match_id=${inList(part)}`, { body: { edition_id: item.official, draw_id: did, surface: off.surface, indoor: off.indoor, updated_at: now } });
    }
  }
  if (moves.length) await store.insert('tennis_source_changes', moves.map((m) => ({ entity_type: 'match', entity_id: m.match_id, field: 'edition_id', kind: 'edition_moved', from_value: item.shadow, to_value: item.official, source_family: 'espn', capture_id: null, observed_at: now })));
  // an emptied shadow edition (no rows of any event left, nothing else pointing at it) is removed
  const left = await store.count('tennis_matches', `edition_id=eq.${item.shadow}`);
  if (left === 0) {
    const refs = (await store.count('tennis_broadcasts', `edition_id=eq.${item.shadow}`)) + (await store.count('tennis_draw_slots', `edition_id=eq.${item.shadow}`));
    if (refs === 0) {
      await store.req('PATCH', `tennis_edition_external_ids?edition_id=eq.${item.shadow}`, { body: { edition_id: item.official } });
      await store.del('tennis_edition_attributes', `edition_id=eq.${item.shadow}`);
      await store.del('tennis_draws', `edition_id=eq.${item.shadow}`);
      await store.del('tennis_tournament_editions', `edition_id=eq.${item.shadow}`);
      await store.insert('tennis_source_changes', [{ entity_type: 'edition', entity_id: item.shadow, field: 'row', kind: 'edition_merged', from_value: null, to_value: item.official, source_family: 'espn', capture_id: null, observed_at: now }]);
      out.shadow_removed = true;
    }
  }
  return out;
}

/** Bounded unit over the work list (rebuilt when exhausted or a day old). dry=true only counts. */
export async function editionMergeStep(ctx, { items = 20, dry = false } = {}) {
  let st = (await ctx.kv.get(ST, 'json')) || { i: 0, list: [], built_at: null, totals: {} };
  if (!st.list.length || st.i >= st.list.length || !st.built_at || Date.now() - Date.parse(st.built_at) > 86400e3) st = { i: 0, list: await workList(ctx.store), built_at: new Date().toISOString(), totals: {} };
  const out = [];
  let i = st.i;
  for (let n = 0; n < items && i < st.list.length; n += 1, i += 1) {
    const r = await mergeOne(ctx, st.list[i], { dry });
    out.push(r);
    for (const k of ['shadow_rows', 'merged', 'moved', 'ambiguous']) st.totals[k] = (st.totals[k] || 0) + (r[k] || 0);
    if (r.shadow_removed) st.totals.shadow_removed = (st.totals.shadow_removed || 0) + 1;
  }
  if (!dry) { st.i = i; await ctx.kv.put(ST, JSON.stringify(st)); }
  return { dry, position: i, list: st.list.length, totals: st.totals, items: out.slice(0, 5), done: i >= st.list.length };
}
