// Canonical writer: normalized records -> Supabase. Idempotent (deterministic ids + upserts), append-only
// lineage (captures, runs, changes), and fail-closed: anything that fails validation goes to
// tennis_ingest_holds and never touches canonical tables. A final match is never moved back to live.

import { mintPlayerId, externalKey } from '../../shared/canonical/identity.js';
import { normalizeMatch } from '../../shared/canonical/normalize.js';
import { diffRecord } from '../../shared/change-ledger.js';
import { diffSnapshots, snapshotOf, eventId, CONTRACT } from '../../shared/canonical/events.js';
import { inList } from '../../shared/store/postgrest.js';
import { tournamentKey, tournamentId, editionId, drawId, matchId, snapshotId, competitionFor, slugify, SLAMS, venueId } from '../../shared/canonical/ids.js';

const FINAL = new Set(['completed', 'retired', 'walkover']);
const now = () => new Date().toISOString();
const splitExt = (ext) => { const i = ext.indexOf(':'); return [ext.slice(0, i), ext.slice(i + 1)]; };

// ---- lineage -------------------------------------------------------------------------------------------
export async function recordCapture(store, capture) {
  if (!capture) return;
  await store.upsert('tennis_source_captures', [{
    capture_id: capture.capture_id, source_family: capture.source_family, adapter: capture.adapter, request_identity: capture.request_identity,
    url: capture.url, captured_at: capture.captured_at, http: capture.http, content_sha256: capture.content_sha256, bytes: capture.bytes,
    payload_key: capture.payload_key, parser_version: capture.parser_version, normalization_version: capture.normalization_version
  }], { onConflict: 'capture_id', ignore: true });
}

export async function recordRun(store, run) {
  await store.insert('tennis_source_runs', [{
    worker: 'tennis-ingest', adapter_key: run.key, source_family: run.family, started_at: run.started_at, finished_at: now(),
    state: run.state === 'ERROR' || run.state === 'BLOCKED_BY_ACCESS_CONTROL' || run.state === 'DEGRADED' || run.state === 'PASS' ? run.state : 'ERROR',
    http_status: run.http_status ?? null, records: run.record_count ?? null, error: run.error ? String(run.error).slice(0, 500) : null,
    capture_ids: run.capture?.capture_id ? [run.capture.capture_id] : []
  }]);
}

export async function hold(store, rows) {
  if (!rows.length) return;
  await store.upsert('tennis_ingest_holds', rows.map((r) => ({ ...r, last_seen_at: now() })), { onConflict: 'provider,entity_type,external_id' });
}

// ---- players -------------------------------------------------------------------------------------------
/** Players from an authoritative bio source (rankings, player endpoint): merge. */
export async function upsertPlayersFull(store, members, provider) {
  const byId = new Map();
  for (const m of members) {
    if (!m?.provider_id) continue;
    const id = await mintPlayerId(provider, m.provider_id);
    byId.set(id, {
      pbe_player_id: id, founding_external_key: externalKey(provider, m.provider_id),
      full_name: m.full_name || [m.first_name, m.last_name].filter(Boolean).join(' '), first_name: m.first_name || null, last_name: m.last_name || null,
      gender: m.gender || null, dob: m.dob || null, nationality: m.country && /^[A-Z]{3}$/.test(m.country) ? m.country : null, updated_at: now()
    });
  }
  const rows = [...byId.values()];
  await store.upsert('tennis_players', rows, { onConflict: 'pbe_player_id' });
  await store.upsert('tennis_player_external_ids', rows.map((r) => { const [p, e] = splitExt(r.founding_external_key); return { provider: p, external_id: e, pbe_player_id: r.pbe_player_id, method: 'founding', evidence: [r.founding_external_key] }; }), { onConflict: 'provider,external_id', ignore: true });
  return rows.length;
}

/** Players first seen in a match row: insert-if-missing only (never overwrite bio with thinner data). */
async function ensurePlayersFromIdentities(store, identities) {
  const rows = new Map();
  const ext = [];
  for (const i of identities) {
    if (i.status !== 'resolved') continue;
    const m = i.source;
    rows.set(i.pbe_player_id, {
      pbe_player_id: i.pbe_player_id, founding_external_key: i.external, full_name: [m.first_name, m.last_name].filter(Boolean).join(' ') || i.external,
      first_name: m.first_name || null, last_name: m.last_name || null, gender: m.gender || null,
      nationality: m.country && /^[A-Z]{3}$/.test(m.country) ? m.country : null, dob: null, updated_at: now()
    });
    const [p, e] = splitExt(i.external);
    ext.push({ provider: p, external_id: e, pbe_player_id: i.pbe_player_id, method: 'founding', evidence: [i.external] });
    if (m.provider !== p) ext.push({ provider: m.provider, external_id: String(m.provider_id), pbe_player_id: i.pbe_player_id, method: m.tour_id_method || (m.tour_id_evidence ? 'name_dob' : 'external_id'), evidence: [m.tour_id_evidence || `${m.provider}:${m.provider_id} embeds ${i.external}`] });
  }
  await store.upsert('tennis_players', [...rows.values()], { onConflict: 'pbe_player_id', ignore: true });
  const dedup = [...new Map(ext.map((x) => [`${x.provider}:${x.external_id}`, x])).values()];
  await store.upsert('tennis_player_external_ids', dedup, { onConflict: 'provider,external_id', ignore: true });
}

// ---- rankings ------------------------------------------------------------------------------------------
export async function writeRankingPage(store, rows, { captureId = null } = {}) {
  if (!rows.length) return { snapshot_id: null, rows: 0 };
  const { list_key: listKey, ranking_date: date } = rows[0];
  if (rows.some((r) => r.list_key !== listKey || r.ranking_date !== date)) throw new Error('mixed ranking lists in one page');
  await upsertPlayersFull(store, rows.map((r) => r.player), 'wta');
  const sid = await snapshotId(listKey, date);
  await store.upsert('tennis_ranking_snapshots', [{ snapshot_id: sid, list_key: listKey, ranking_date: date, source_family: 'wta', capture_id: captureId, row_count: 0, captured_at: now() }], { onConflict: 'snapshot_id', ignore: true });
  const out = [];
  for (const r of rows) out.push({ snapshot_id: sid, provider_player_id: r.player.provider_id, pbe_player_id: await mintPlayerId('wta', r.player.provider_id), rank: r.rank, tied: false, points: r.points, tournaments_played: r.tournaments_played, previous_rank: null }); // WTA `movement` sign convention unverified: not derived
  await store.upsert('tennis_rankings', out, { onConflict: 'snapshot_id,provider_player_id' });
  return { snapshot_id: sid, rows: out.length };
}

export async function finalizeSnapshot(store, sid) {
  const n = await store.count('tennis_rankings', `snapshot_id=eq.${sid}`);
  await store.req('PATCH', `tennis_ranking_snapshots?snapshot_id=eq.${sid}`, { body: { row_count: n } });
  return n;
}

// ---- calendar ------------------------------------------------------------------------------------------
export async function writeEditions(store, editions, provider = 'wta') {
  const tRows = new Map();
  const eRows = [];
  const venues = new Map();
  const tExt = [];
  const eExt = [];
  for (const e of editions) {
    const key = tournamentKey(provider, e.provider_tournament_id, e.name, e.level);
    const tid = await tournamentId(key);
    const slam = key.startsWith('slam:') ? key.slice(5) : null;
    const slug = slam || `${slugify(e.name)}${/^itf$/i.test(e.level || '') ? '-itf' : ''}`;
    tRows.set(tid, { tournament_id: tid, slug, name: slam ? Object.keys(SLAMS).find((k) => SLAMS[k] === slam).replace(/\b\w/g, (c) => c.toUpperCase()) : titleCase(e.name), competition_key: competitionFor(e.level), country: e.country && /^[A-Z]{3}$/.test(e.country) ? e.country : null, city: e.city ? titleCase(e.city) : null });
    tExt.push({ provider, external_id: String(e.provider_tournament_id), tournament_id: tid });
    const eid = await editionId(tid, e.year);
    let vid = null;
    if (e.city) {
      vid = await venueId(e.city, e.country);
      const country = e.country && /^[A-Z]{3}$/.test(e.country) ? e.country : null;
      venues.set(vid, { venue_id: vid, slug: `${slugify(e.city)}${country ? `-${country.toLowerCase()}` : ''}`, venue_name: null, city: titleCase(e.city), country, precision: 'city', source_family: provider, updated_at: now() });
    }
    eRows.push({ venue_id: vid, edition_id: eid, tournament_id: tid, year: e.year, competition_key: competitionFor(e.level), start_date: e.start_date, end_date: e.end_date, surface: e.surface, indoor: e.indoor, source_family: provider, name: e.title || e.name, level: e.level, city: e.city ? titleCase(e.city) : null, country: e.country && /^[A-Z]{3}$/.test(e.country) ? e.country : null, singles_draw_size: e.singles_draw_size, doubles_draw_size: e.doubles_draw_size, source_status: e.status, updated_at: now() });
    eExt.push({ provider, external_id: `${e.live_scoring_id || e.provider_tournament_id}-${e.year}`, edition_id: eid });
  }
  // slug collisions between distinct tournaments get the provider id appended (never a silent merge)
  const rows = [...tRows.values()];
  const existing = rows.length ? await store.select('tennis_tournaments', `select=tournament_id,slug&slug=${inList(rows.map((r) => r.slug))}`) : [];
  const taken = new Map(existing.map((x) => [x.slug, x.tournament_id]));
  const seen = new Map();
  for (const r of rows) {
    const clash = (taken.has(r.slug) && taken.get(r.slug) !== r.tournament_id) || (seen.has(r.slug) && seen.get(r.slug) !== r.tournament_id);
    if (clash) r.slug = `${r.slug}-${tExt.find((t) => t.tournament_id === r.tournament_id).external_id}`;
    seen.set(r.slug, r.tournament_id);
  }
  await store.upsert('tennis_venues', [...venues.values()], { onConflict: 'venue_id' });
  await store.upsert('tennis_tournaments', rows, { onConflict: 'tournament_id' });
  await store.upsert('tennis_tournament_external_ids', dedupe(tExt, (x) => `${x.provider}:${x.external_id}`), { onConflict: 'provider,external_id', ignore: true });
  await store.upsert('tennis_tournament_editions', dedupe(eRows, (x) => x.edition_id), { onConflict: 'edition_id' });
  await store.upsert('tennis_edition_external_ids', dedupe(eExt, (x) => `${x.provider}:${x.external_id}`), { onConflict: 'provider,external_id', ignore: true });
  return eRows.length;
}

const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const dedupe = (rows, k) => [...new Map(rows.map((r) => [k(r), r])).values()];

// ---- matches -------------------------------------------------------------------------------------------
/**
 * sourceMatches: provider-neutral SourceMatch records for ONE edition.
 * edition: { edition_id, surface, indoor }.
 */
export async function writeMatches(store, sourceMatches, edition, opts = {}) {
  return writeGroups(store, [{ edition, sourceMatches }], opts);
}

/**
 * Several editions in one batched pass (identical rules per edition): groups = [{ edition, sourceMatches }].
 * Cross-source matching, writes and hold resolution run once for all groups instead of once per edition.
 */
export async function writeGroups(store, groups, { captureId = null, dedupe: sourceDedupe = false } = {}) {
  const result = { written: 0, held: 0, changes: 0, skipped: 0, attached: 0, taken_over: 0, duplicate_candidates: 0 };
  const normalized = [];
  const holds = [];
  for (const { edition, sourceMatches } of groups) for (const sm of sourceMatches) {
    // matches without both sides decided yet (TBD slots) are not matches yet
    if (!(sm.sides?.A?.length && sm.sides?.B?.length) || sm.sides.A.some((m) => !m.provider_id || m.provider_id === 'undefined') || sm.sides.B.some((m) => !m.provider_id || m.provider_id === 'undefined')) { result.skipped += 1; continue; }
    if (!sm.status) { holds.push({ provider: sm.provider, entity_type: 'match', external_id: sm.provider_match_id, problems: sm.warnings || ['no_status'], payload: slim(sm), capture_id: captureId }); continue; }
    const n = await normalizeMatch(sm);
    if (!n.canonical) { holds.push({ provider: sm.provider, entity_type: 'match', external_id: sm.provider_match_id, problems: n.problems, payload: slim(sm), capture_id: captureId }); continue; }
    normalized.push({ sm, n, id: await matchId(sm.provider, sm.provider_match_id), ed: edition });
  }
  let attach = [];
  let alias = [];
  if (sourceDedupe && normalized.length) {
    const cs = await crossSource(store, normalized, holds, captureId);
    normalized.splice(0, normalized.length, ...cs.write);
    attach = cs.attach;
    alias = cs.alias;
    // duplicate rows found by the self-heal: external ids move to the surviving row, the lower row is removed
    for (const mg of cs.merges) {
      await store.req('PATCH', `tennis_match_external_ids?match_id=eq.${mg.from}`, { body: { match_id: mg.into } });
      for (const t of ['tennis_match_events', 'tennis_sets', 'tennis_match_participants', 'tennis_match_stats']) await store.del(t, `match_id=eq.${mg.from}`);
      await store.del('tennis_matches', `match_id=eq.${mg.from}`);
      await store.insert('tennis_source_changes', [{ entity_type: 'match', entity_id: mg.from, field: 'row', kind: 'duplicate_merged', from_value: null, to_value: mg.into, source_family: mg.provider, capture_id: captureId }]);
    }
    result.merged = cs.merges.length;
    result.duplicate_candidates = cs.duplicates;
    result.taken_over = cs.write.filter((x) => x.takeover).length;
    // a takeover may orient sides differently: the owner's participant rows are replaced, not merged
    for (const x of cs.write.filter((w) => w.takeover || w.reorient)) await store.del('tennis_match_participants', `match_id=eq.${x.id}`);
  }
  if (attach.length) {
    // the same real-world match already owned by a higher-precedence source: link the external id only
    await ensurePlayersFromIdentities(store, attach.flatMap((x) => x.n.identities));
    await store.upsert('tennis_match_external_ids', attach.map((x) => ({ provider: x.sm.provider, external_id: x.sm.provider_match_id, match_id: x.id })), { onConflict: 'provider,external_id', ignore: true });
    result.attached = attach.length;
  }
  if (normalized.length) {
    const prev = new Map((await store.select('tennis_matches', `select=match_id,status,score_text,winner_side,live_state,format_key,tennis_sets(set_no,games_a,games_b,tb_a,tb_b,is_match_tiebreak)&match_id=${inList(normalized.map((x) => x.id))}`)).map((r) => [r.match_id, r]));
    let keep = [];
    const changes = [];
    for (const x of normalized) {
      const p = prev.get(x.id);
      const next = { id: x.id, status: x.n.match.status, score: x.n.match.score_text, winner_side: x.n.match.winner_side };
      if (p && FINAL.has(p.status) && !FINAL.has(next.status)) {
        holds.push({ provider: x.sm.provider, entity_type: 'match', external_id: x.sm.provider_match_id, problems: [`source_regression:${p.status}->${next.status}`], payload: slim(x.sm), capture_id: captureId });
        continue;
      }
      if (p) for (const c of diffRecord('match', { id: x.id, status: p.status, score: p.score_text, winner_side: p.winner_side }, next)) changes.push({ ...c, source_family: x.sm.provider, capture_id: captureId, from_value: c.from, to_value: c.to });
      keep.push({ ...x, prev: p });
    }
    await ensurePlayersFromIdentities(store, keep.flatMap((x) => x.n.identities));
    const participants = [];
    const members = [];
    for (const x of keep) for (const side of ['A', 'B']) {
      const key = x.n.match.participants[side];
      participants.push({ participant_key: key, kind: key.startsWith('S:') ? 'singles' : 'pair' });
      for (const m of x.n.match.participants.members[side]) members.push({ participant_key: key, slot: m.slot, pbe_player_id: m.player_id });
    }
    await store.upsert('tennis_participants', dedupe(participants, (r) => r.participant_key), { onConflict: 'participant_key', ignore: true });
    await store.upsert('tennis_participant_members', dedupe(members, (r) => `${r.participant_key}:${r.slot}`), { onConflict: 'participant_key,slot', ignore: true });
    const draws = [];
    for (const x of keep) {
      x.draw_id = x.sm.stage ? await drawId(x.ed.edition_id, x.n.match.event_type, x.sm.stage) : null;
      if (x.draw_id) draws.push({ draw_id: x.draw_id, edition_id: x.ed.edition_id, event_type: x.n.match.event_type, stage: x.sm.stage, format_key: x.n.match.format_key || 'unknown' });
    }
    await store.upsert('tennis_draws', dedupe(draws, (r) => r.draw_id), { onConflict: 'draw_id', ignore: true });
    const matchRow = (x) => ({
      match_id: x.id, edition_id: x.ed.edition_id, draw_id: x.draw_id, event_type: x.n.match.event_type, round: x.n.match.round_code || 'unknown', format_key: x.n.match.format_key || 'unknown',
      status: x.n.match.status, winner_side: x.n.match.winner_side, end_reason: x.n.match.end_reason, scheduled_at: x.sm.scheduled_at || null, started_at: x.sm.started_at || null, court: x.sm.court_name || null, schedule_note: x.sm.schedule_note || null, score_text: x.n.match.score_text, duration_s: x.n.match.duration_s,
      surface: x.ed.surface ?? null, indoor: x.ed.indoor ?? null, source_family: x.sm.provider, live_state: x.n.match.live || null, source_updated_at: x.n.match.source_updated_at, updated_at: now()
    });
    const wo = keep.filter((x) => x.n.match.status === 'walkover');
    const rest = keep.filter((x) => x.n.match.status !== 'walkover');
    const rejected = new Set();
    // One malformed row must never fail the whole edition: on a data error, retry row by row and hold
    // only the rows Postgres rejects.
    const upsertMatches = async (list, row) => {
      try {
        await store.upsert('tennis_matches', list.map(row), { onConflict: 'match_id' });
      } catch (e) {
        if (e?.status !== 400) throw e;
        for (const x of list) {
          try { await store.upsert('tennis_matches', [row(x)], { onConflict: 'match_id' }); } catch (err) {
            if (err?.status !== 400) throw err;
            rejected.add(x.id);
            holds.push({ provider: x.sm.provider, entity_type: 'match', external_id: x.sm.provider_match_id, problems: [`db_rejected:${String(err.message).slice(0, 200)}`], payload: slim(x.sm), capture_id: captureId });
          }
        }
      }
    };
    // a match that just went final gets its statistics re-fetched (live values are provisional)
    const wentFinal = (x) => x.prev && !FINAL.has(x.prev.status) && FINAL.has(x.n.match.status) && x.n.match.status !== 'walkover';
    await upsertMatches(rest.filter((x) => !wentFinal(x)), matchRow);
    await upsertMatches(rest.filter(wentFinal), (x) => ({ ...matchRow(x), stats_status: 'pending' }));
    await upsertMatches(wo, (x) => ({ ...matchRow(x), stats_status: 'not_applicable' }));
    keep = keep.filter((x) => !rejected.has(x.id));
    await store.upsert('tennis_match_external_ids', keep.map((x) => ({ provider: x.sm.provider, external_id: x.sm.provider_match_id, match_id: x.id })), { onConflict: 'provider,external_id', ignore: true });
    await store.upsert('tennis_match_participants', keep.flatMap((x) => ['A', 'B'].map((side) => ({ match_id: x.id, side, participant_key: x.n.match.participants[side], seed: x.sm.seeds?.[side] ?? null, entry_type: x.sm.entry?.[side] || null }))), { onConflict: 'match_id,side' });
    const sets = keep.flatMap((x) => (x.n.match.sets || []).map((s, i) => ({ match_id: x.id, set_no: i + 1, games_a: s.games.A, games_b: s.games.B, tb_a: s.tiebreak?.A ?? null, tb_b: s.tiebreak?.B ?? null, tb_winner_points_derived: !!s.tiebreak?.winner_points_derived, is_match_tiebreak: !!s.is_match_tiebreak, winner_side: setWinner(s) })));
    await store.upsert('tennis_sets', sets, { onConflict: 'match_id,set_no' });
    // a score correction that removed a set: delete the stale tail (only for matches whose score changed)
    for (const x of keep.filter((k) => k.prev && k.prev.score_text !== k.n.match.score_text)) await store.del('tennis_sets', `match_id=eq.${x.id}&set_no=gt.${(x.n.match.sets || []).length}`);
    await writeSnapshotEvents(store, keep, captureId);
    if (changes.length) await store.insert('tennis_source_changes', changes.map((c) => ({ entity_type: c.entity_type, entity_id: c.entity_id, field: c.field, kind: c.kind, from_value: c.from_value, to_value: c.to_value, source_family: c.source_family, capture_id: c.capture_id })));
    result.written = keep.length;
    result.changes = changes.length;
    // a later clean observation resolves an earlier hold for the same source row
    const resolvedIds = [...keep, ...attach].map((x) => x.sm.provider_match_id);
    for (let i = 0; i < resolvedIds.length; i += 150) {
      const part = resolvedIds.slice(i, i + 150);
      await store.req('PATCH', `tennis_ingest_holds?entity_type=eq.match&provider=eq.${keep[0].sm.provider}&resolved_at=is.null&external_id=${inList(part)}`, { body: { resolved_at: now() } });
    }
  } else if (attach.length) {
    const ids = attach.map((x) => x.sm.provider_match_id);
    for (let i = 0; i < ids.length; i += 150) await store.req('PATCH', `tennis_ingest_holds?entity_type=eq.match&provider=eq.${attach[0].sm.provider}&resolved_at=is.null&external_id=${inList(ids.slice(i, i + 150))}`, { body: { resolved_at: now() } });
  }
  // aliases resolve to their first listing's final row (written, attached or taken over above)
  const live = alias.filter((a) => a.first.id);
  if (live.length) {
    const exists = new Set((await store.select('tennis_matches', `select=match_id&match_id=${inList([...new Set(live.map((a) => a.first.id))])}`)).map((r) => r.match_id));
    const rows = live.filter((a) => exists.has(a.first.id)).map((a) => ({ provider: a.x.sm.provider, external_id: a.x.sm.provider_match_id, match_id: a.first.id }));
    await store.upsert('tennis_match_external_ids', rows, { onConflict: 'provider,external_id', ignore: true });
    for (let i = 0; i < rows.length; i += 150) await store.req('PATCH', `tennis_ingest_holds?entity_type=eq.match&provider=eq.${rows[0].provider}&resolved_at=is.null&external_id=${inList(rows.slice(i, i + 150).map((r) => r.external_id))}`, { body: { resolved_at: now() } });
    result.aliased = rows.length;
  }
  await hold(store, dedupe(holds, (h) => `${h.provider}:${h.external_id}`));
  result.held = holds.length;
  return result;
}

// ---- cross-source duplicate prevention -------------------------------------------------------------------
// One real-world match = one canonical row, whichever sources report it. Identity of a match inside an
// edition: event type + stage (main / qualifying / round robin) + the two participant keys (a pair meets at
// most once per stage of one event). Official feeds outrank secondary ones (espn): a secondary row that finds
// an official row attaches its external id only (a result disagreement is recorded for review, the owner's
// row stands); an official row that finds a secondary-owned row takes it over (same match_id, official
// fields). Several candidates, a same-source collision or a round conflict is held — never merged.
// espn (secondary) < wta_history (official player-history rows: no ids, no stats, no times) < every per-match official feed
export const SOURCE_PRIORITY = Object.freeze({ espn: 1, wta_history: 2 });
export const sourcePriority = (p) => SOURCE_PRIORITY[p] ?? 3;
const stageOfRound = (round) => (round === 'RR' ? 'round_robin' : /^Q-/.test(String(round || '')) ? 'qualifying' : 'main');
export function naturalKey(eventType, round, a, b) {
  return `${eventType}|${stageOfRound(round)}|${[a, b].sort().join('~')}`;
}
const pairKey = (x) => naturalKey(x.n.match.event_type, x.n.match.round_code, x.n.match.participants.A, x.n.match.participants.B);

/** Winner-oriented games ("6-4 3-6 7-6 RET") from a stored A/B score text: orientation-free comparison. */
export function winnerGames(scoreText, winnerSide) {
  if (!scoreText) return null;
  const sets = [...String(scoreText).matchAll(/\[?(\d+)-(\d+)\]?/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const tail = /\b(RET|W\/O|DEF|ABD)\b/.exec(scoreText)?.[1] || '';
  // a retirement before the first game of a new set is printed "0-0 RET" by some sources, omitted by others
  if (tail && sets.length && sets.at(-1)[0] === 0 && sets.at(-1)[1] === 0) sets.pop();
  return [...sets.map(([a, b]) => (winnerSide === 'B' ? `${b}-${a}` : `${a}-${b}`)), tail].filter(Boolean).join(' ');
}

async function selectAll(store, table, query, page = 1000) {
  const out = [];
  for (let off = 0; ; off += page) {
    const rows = await store.select(table, `${query}&limit=${page}&offset=${off}`);
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

async function crossSource(store, normalized, holds, captureId) {
  const provider = normalized[0].sm.provider;
  const eds = [...new Set(normalized.map((x) => x.ed.edition_id))];
  // candidates: the stored rows of these editions that involve an incoming participant (a row with the same
  // natural key must), plus rows found by id (own deterministic id / an already linked external id)
  const extMap = new Map();
  const pm = normalized.map((x) => x.sm.provider_match_id);
  for (let i = 0; i < pm.length; i += 150) for (const r of await store.select('tennis_match_external_ids', `select=external_id,match_id&provider=eq.${provider}&external_id=${inList(pm.slice(i, i + 150))}`)) extMap.set(r.external_id, r.match_id);
  const cand = new Set();
  for (const x of normalized) { cand.add(x.id); if (extMap.has(x.sm.provider_match_id)) cand.add(extMap.get(x.sm.provider_match_id)); }
  const keys = [...new Set(normalized.flatMap((x) => [x.n.match.participants.A, x.n.match.participants.B]))];
  for (let i = 0; i < keys.length; i += 100) {
    for (const r of await selectAll(store, 'tennis_match_participants', `select=match_id,tennis_matches!inner(edition_id)&participant_key=${inList(keys.slice(i, i + 100))}&tennis_matches.edition_id=${inList(eds)}&order=match_id.asc,side.asc`)) cand.add(r.match_id);
  }
  const ids = [...cand];
  const rows = [];
  for (let i = 0; i < ids.length; i += 150) rows.push(...(await store.select('tennis_matches', `select=match_id,edition_id,event_type,round,status,score_text,winner_side,source_family&match_id=${inList(ids.slice(i, i + 150))}`)));
  const inPass = rows.filter((m) => eds.includes(m.edition_id));
  const byIdAll = new Map(inPass.map((m) => [m.match_id, { ...m, parts: {} }]));
  const pids = [...byIdAll.keys()];
  for (let i = 0; i < pids.length; i += 150) {
    for (const p of await store.select('tennis_match_participants', `select=match_id,side,participant_key&match_id=${inList(pids.slice(i, i + 150))}`)) if (byIdAll.has(p.match_id)) byIdAll.get(p.match_id).parts[p.side] = p.participant_key;
  }
  // per edition, exactly the maps the single-edition pass built
  const perEd = new Map(eds.map((e) => [e, { byId: new Map(), byKey: new Map() }]));
  for (const m of byIdAll.values()) {
    const E = perEd.get(m.edition_id);
    E.byId.set(m.match_id, m);
    if (!m.parts.A || !m.parts.B) continue;
    const k = naturalKey(m.event_type, m.round, m.parts.A, m.parts.B);
    if (!E.byKey.has(k)) E.byKey.set(k, []);
    E.byKey.get(k).push(m);
  }
  const write = [];
  const attach = [];
  const seen = new Map();
  const alias = [];
  const merges = [];
  let duplicates = 0;
  const dup = (x, problem) => { duplicates += 1; holds.push({ provider, entity_type: 'match', external_id: x.sm.provider_match_id, problems: [problem], payload: slim(x.sm), capture_id: captureId }); };
  for (const x of normalized) {
    const { byId, byKey } = perEd.get(x.ed.edition_id);
    const key = pairKey(x);
    const seenKey = `${x.ed.edition_id}|${key}`;
    if (seen.has(seenKey)) {
      // the source lists one match under two ids: link the second id only when round, winner and score are identical
      const f = seen.get(seenKey);
      const same = f.n.match.round_code === x.n.match.round_code && f.n.match.score_text === x.n.match.score_text && f.n.match.status === x.n.match.status
        && f.n.match.participants[f.n.match.winner_side] === x.n.match.participants[x.n.match.winner_side];
      if (same) alias.push({ x, first: f }); else dup(x, 'duplicate_candidate:twice_in_one_payload');
      continue;
    }
    seen.set(seenKey, x);
    // 1. this external id is already linked (idempotent re-ingest, including earlier attachments)
    // (a caller may prove the same match in ANOTHER edition, e.g. an ESPN row filed under ESPN's edition)
    let target = extMap.get(x.sm.provider_match_id) || x.sm.existing_match_id || (byId.has(x.id) ? x.id : null);
    // self-heal: our own/lower row found by id while THIS edition already holds the same match owned by an
    // equal-or-higher source -> merge into that row (ids moved, lower row removed, logged)
    if (target) {
      const others = (byKey.get(key) || []).filter((c) => c.match_id !== target);
      const mine = byId.get(target);
      const rn2 = (r) => String(r || '').replace(/^M-/, '');
      if (others.length === 1 && sourcePriority(others[0].source_family) >= sourcePriority(mine?.source_family || provider) && !(others[0].round && x.n.match.round_code && /^[QSF]$/.test(rn2(others[0].round)) && /^[QSF]$/.test(rn2(x.n.match.round_code)) && rn2(others[0].round) !== rn2(x.n.match.round_code))) {
        merges.push({ from: target, into: others[0].match_id, provider });
        target = others[0].match_id;
      }
    }
    // 2. the same match from another source, by natural key
    if (!target) {
      const cands = (byKey.get(key) || []).filter((c) => c.match_id !== x.id);
      if (cands.length > 1) { dup(x, `duplicate_candidate:${cands.length}_existing_rows`); continue; }
      if (cands.length === 1) {
        const c = cands[0];
        if (c.source_family === provider) { dup(x, `duplicate_candidate:same_source_other_id:${c.match_id}`); continue; }
        // WTA API rounds carry a stage prefix (M-1, M-Q ...): compared without it
        const rn = (r) => String(r || '').replace(/^M-/, '');
        // the WTA API's numeric round ids are its own (at a 128 draw its M-2 is round 1; qualifying may be a bare
        // 'Q-'): against a WTA API row only the stage (already in the key) and Q/S/F are compared
        const opaque = [c.source_family, provider].includes('wta') && (/^\d*$/.test(rn(c.round)) || /^Q-\d*$/.test(rn(c.round))) && (/^\d+$/.test(rn(x.n.match.round_code)) || /^Q-\d*$/.test(rn(x.n.match.round_code)));
        if (!opaque && c.round && c.round !== 'unknown' && x.n.match.round_code && rn(c.round) !== rn(x.n.match.round_code)) { dup(x, `duplicate_candidate:round_conflict:${c.source_family}=${c.round},${provider}=${x.n.match.round_code}:${c.match_id}`); continue; }
        target = c.match_id;
      }
    }
    if (!target) { write.push(x); continue; }
    x.id = target;
    const owner = byId.get(target) || (x.sm.existing_owner ? { source_family: x.sm.existing_owner, parts: {}, status: null, score_text: null } : null);
    // a re-listing with the sides the other way round: participant rows are replaced, not merged
    if (owner?.parts?.A && owner.parts.A !== x.n.match.participants.A) x.reorient = true;
    if (!owner || owner.source_family === provider) { write.push(x); continue; }
    // precedence never turns a match with games on the board into "not played": a higher-precedence walkover
    // against a played lower-precedence row attaches and is held as a disagreement (observed AO 2016 WD, ESPN
    // 0-6 3-6 vs WTA history reason D)
    const playedOwner = ['completed', 'retired'].includes(owner.status) && /[1-9]/.test(String(winnerGames(owner.score_text, owner.winner_side) || '').replace(/(RET|W\/O|DEF|ABD)/g, ''));
    if (sourcePriority(provider) > sourcePriority(owner.source_family) && !(x.n.match.status === 'walkover' && playedOwner)) { x.takeover = owner.source_family; write.push(x); continue; }
    attach.push(x);
    const ownWinner = owner.winner_side ? owner.parts[owner.winner_side] : null;
    const ourWinner = x.n.match.winner_side ? x.n.match.participants[x.n.match.winner_side] : null;
    const a = winnerGames(owner.score_text, owner.winner_side);
    const b = winnerGames(x.n.match.score_text, x.n.match.winner_side);
    if (ownWinner !== ourWinner || owner.status !== x.n.match.status || (a && b && a !== b)) {
      holds.push({ provider, entity_type: 'cross_source', external_id: x.sm.provider_match_id, problems: [`cross_source_disagreement: ${owner.source_family} ${owner.status} ${a || '-'} vs ${provider} ${x.n.match.status} ${b || '-'}${ownWinner !== ourWinner ? ' (winner differs)' : ''}`], payload: { match_id: target, owner: owner.source_family }, capture_id: captureId });
    }
  }
  return { write, attach, duplicates, alias, merges };
}

const prevSnapshot = (p) => snapshotOf({ status: p.status, live: p.live_state, sets: (p.tennis_sets || []).sort((a, b) => a.set_no - b.set_no).map((t) => ({ games: { A: t.games_a, B: t.games_b }, tiebreak: t.tb_a == null ? null : { A: t.tb_a, B: t.tb_b }, is_match_tiebreak: t.is_match_tiebreak })) });

/**
 * tennis_event/1.0.0 score_snapshot events: ONE per observed change of a live (or just-finished) match.
 * Matches first seen already final (backfill) get none — we did not observe them live.
 */
async function writeSnapshotEvents(store, keep, captureId) {
  const live = keep.filter((x) => x.n.match.status === 'in_progress' || (x.prev && x.prev.status === 'in_progress'));
  if (!live.length) return 0;
  const maxSeq = new Map();
  const seqRows = await store.select('tennis_match_events', `select=match_id,event_sequence&quality=eq.score_snapshot&match_id=${inList(live.map((x) => x.id))}&order=event_sequence.desc&limit=1000`);
  for (const r of seqRows) if (!maxSeq.has(r.match_id)) maxSeq.set(r.match_id, r.event_sequence);
  const rows = [];
  const observedAt = now();
  for (const x of live) {
    const prevSnap = x.prev ? prevSnapshot(x.prev) : null;
    const next = snapshotOf({ status: x.n.match.status, sets: x.n.match.sets, live: x.n.match.live });
    const e = diffSnapshots(prevSnap, next, x.n.match.format_key);
    if (!e) continue;
    const seq = (maxSeq.get(x.id) ?? -1) + 1;
    const lastSet = next.sets.length ? next.sets.length : null;
    rows.push({
      event_id: await eventId(x.id, 'score_snapshot', String(seq)), match_id: x.id, contract: CONTRACT, quality: 'score_snapshot', event_sequence: seq,
      event_type: e.event_type, source: x.sm.provider, source_event_id: null, observed_at: observedAt, event_at: null,
      set_number: lastSet, game_number: null, server_side: e.server_side, winner_side: e.winner_side, derivation: e.derivation,
      event_detail: e.event_detail, state: e.state, raw_source_ref: captureId
    });
  }
  await store.upsert('tennis_match_events', rows, { onConflict: 'event_id', ignore: true });
  return rows.length;
}

function setWinner(s) {
  if (s.is_match_tiebreak && s.tiebreak) return s.tiebreak.A > s.tiebreak.B ? 'A' : 'B';
  const { A, B } = s.games;
  if (Math.max(A, B) >= 6 && (Math.abs(A - B) >= 2 || Math.max(A, B) === 7)) return A > B ? 'A' : 'B';
  return null; // unfinished set (retirement / live)
}

const slim = (sm) => ({ provider_match_id: sm.provider_match_id, status: sm.status, sets: sm.sets, source_text: sm.source_text || null, warnings: sm.warnings || [] });

// ---- match stats ---------------------------------------------------------------------------------------
export async function writeMatchStats(store, id, rec, { captureId = null, capturedAt = now() } = {}) {
  if (!rec) {
    await store.req('PATCH', `tennis_matches?match_id=eq.${id}`, { body: { stats_status: 'unavailable' } });
    return 'unavailable';
  }
  if (rec.consistency_errors?.length) {
    await hold(store, [{ provider: rec.provider, entity_type: 'match_stats', external_id: rec.provider_match_id, problems: rec.consistency_errors, payload: null, capture_id: captureId }]);
    await store.req('PATCH', `tennis_matches?match_id=eq.${id}`, { body: { stats_status: 'held' } });
    return 'held';
  }
  await store.upsert('tennis_match_stats', ['A', 'B'].map((side) => ({ match_id: id, side, source_family: rec.provider, stats: { ...rec.sides[side], per_set: rec.per_set.map((p) => ({ set_no: p.set_no, ...p[side] })) }, capture_id: captureId, captured_at: capturedAt })), { onConflict: 'match_id,side,source_family' });
  await store.req('PATCH', `tennis_matches?match_id=eq.${id}`, { body: { stats_status: 'stored' } });
  return 'stored';
}

// ---- identity crosswalk (Wikidata) --------------------------------------------------------------------
/** Attach Wikidata QIDs and every other tour id Wikidata lists to players we already hold by tour id. */
export async function writeCrosswalk(store, rows) {
  let attached = 0;
  const byProvider = { wta: rows.filter((r) => r.external.wta), atp: rows.filter((r) => r.external.atp) };
  for (const [provider, list] of Object.entries(byProvider)) {
    for (let i = 0; i < list.length; i += 150) {
      const part = list.slice(i, i + 150);
      const ids = part.map((r) => String(r.external[provider]).toUpperCase());
      const hits = await store.select('tennis_player_external_ids', `select=external_id,pbe_player_id&provider=eq.${provider}&external_id=${inList(ids)}`);
      const map = new Map(hits.map((h) => [String(h.external_id).toUpperCase(), h.pbe_player_id]));
      const ext = [];
      for (const r of part) {
        const pid = map.get(String(r.external[provider]).toUpperCase());
        if (!pid) continue;
        const ev = [`wikidata:${r.provider_id} lists ${provider}:${r.external[provider]}`];
        ext.push({ provider: 'wikidata', external_id: r.provider_id, pbe_player_id: pid, method: 'external_id', evidence: ev });
        for (const [p, v] of Object.entries(r.external)) if (v && p !== provider) ext.push({ provider: p, external_id: String(v).toUpperCase(), pbe_player_id: pid, method: 'external_id', evidence: ev });
        if (r.commons_file) ext.push({ provider: 'commons_image', external_id: r.commons_file, pbe_player_id: pid, method: 'external_id', evidence: ev });
      }
      await store.upsert('tennis_player_external_ids', dedupe(ext, (x) => `${x.provider}:${x.external_id}`), { onConflict: 'provider,external_id', ignore: true });
      attached += new Set(ext.map((x) => x.pbe_player_id)).size;
      // date of birth from Wikidata (CC0) for players matched by EXACT tour id, only where none is stored:
      // identity evidence for name+DOB corroboration elsewhere; an existing DOB is never overwritten
      const dobs = new Map(part.map((r) => [map.get(String(r.external[provider]).toUpperCase()), /^\d{4}-\d{2}-\d{2}$/.test(r.dob || '') ? r.dob : null]).filter(([pid, d]) => pid && d));
      if (dobs.size) {
        const missing = await store.select('tennis_players', `select=pbe_player_id,founding_external_key,full_name&dob=is.null&pbe_player_id=${inList([...dobs.keys()])}`);
        if (missing.length) await store.upsert('tennis_players', missing.map((x) => ({ ...x, dob: dobs.get(x.pbe_player_id) })), { onConflict: 'pbe_player_id' });
      }
    }
  }
  return attached;
}
