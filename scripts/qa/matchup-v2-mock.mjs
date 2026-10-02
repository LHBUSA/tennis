// Builds faithful /v1/matchups/:id payloads for QA from REAL stored snapshots (read-only SQL exports) using the API's
// own functions (modelBlock, contextBlock, serveReturn, explain + matchup-intel). Used only to QA the entitled UI when
// no legitimate All Access session exists on this machine; production serves the same shape from tennis-api.
//   node scripts/qa/matchup-v2-mock.mjs <match.json> <snapshots.json> <summary.json> <TOUR> <out.json>
import fs from 'node:fs';
import { modelBlock, contextBlock, serveReturn, explain, MATCHUP_VERSION } from '../../workers/tennis-api/src/matchup.js';
import { DNA_METRICS, TECH_METRICS, compareMetrics, edgeMap, collision, whyStack, EDGE_MAP_VERSION } from '../../workers/tennis-api/src/matchup-intel.js';

const [matchFile, snapFile, sumFile, tour, out] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(matchFile, 'utf8')).data;
const rows = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
const S = JSON.parse(fs.readFileSync(sumFile, 'utf8'));
const pa = m.sides.A.players[0];
const pb = m.sides.B.players[0];
const g = (pid, v, s) => rows.find((r) => r.pbe_player_id === pid && r.definition_version === v && r.surface === s)?.metrics || null;
const slice = (pid) => Object.fromEntries(['all', 'hard', 'clay', 'grass'].map((s) => { const x = g(pid, 2, s); return [s, x ? { r: x._rating, w: x._profile?.windows, wae: x.wins_above_expectation, aor: x.avg_opponent_rank, m: x } : null]; }).filter(([, v]) => v));
const a = slice(pa.id);
const b = slice(pb.id);
const surface = ['hard', 'clay', 'grass'].includes(m.tournament?.surface) ? m.tournament.surface : null;
const model = modelBlock(S.tours[tour], a, b, surface);
const ctx = contextBlock(a, b, surface);
const strip = (x) => Object.fromEntries(Object.entries(x || {}).filter(([k]) => !k.startsWith('_')));
const tA = { as_of: rows.find((r) => r.pbe_player_id === pa.id && r.definition_version === 1)?.as_of, metrics: g(pa.id, 1, 'all') };
const tB = { as_of: rows.find((r) => r.pbe_player_id === pb.id && r.definition_version === 1)?.as_of, metrics: g(pb.id, 1, 'all') };
const faceoff = compareMetrics(DNA_METRICS, strip(a.all?.m), strip(b.all?.m));
const technical = compareMetrics(TECH_METRICS, tA.metrics, tB.metrics);
const map = edgeMap({ dna: faceoff.rows, tech: technical.rows, form: ctx.form, surface: ctx.surface });
const surfRow = (x) => Object.fromEntries(['hard', 'clay', 'grass'].map((k) => [k, x?.[k]?.r ? { rating: x[k].r.value, rated_matches: x[k].r.rated_matches, vs_overall: x[k].r.value - (x.all?.r?.value ?? x[k].r.value) } : null]));
const data = {
  as_of: rows[0]?.as_of, tour, matchup_version: MATCHUP_VERSION, match: m, fixture: 'upcoming', model, why: explain(m, model, ctx),
  intel: { edge_map_version: EDGE_MAP_VERSION, faceoff: { rows: faceoff.rows, withheld: faceoff.withheld, basis: 'Match DNA v2 (results-based), each player within their own tour; rows only where both values are medium/high confidence' }, technical: { rows: technical.rows, withheld: technical.withheld, basis: 'Technical DNA v1 from match statistics' }, collision: collision(tA.metrics, tB.metrics), edge_map: map, why: whyStack(model, map, { A: pa.name, B: pb.name }), surface_profile: { tournament_surface: surface, A: surfRow(a), B: surfRow(b), note: surface ? null : 'the edition’s surface is not sourced: every surface profile is shown, none is singled out, and no surface edge is computed' }, h2h_by_surface: null },
  context: { ...ctx, serve_return: serveReturn(tA, tB), rest: { A: null, B: null, basis: 'completed singles matches in the stored ledger before the match day' }, travel: { A: null, B: null } },
  h2h: { model_input: false, record: { A: 0, B: 0 }, meetings: [], total: 0, note: 'head-to-head is descriptive and deliberately NOT a model feature (QA mock: meetings not loaded)' }
};
fs.writeFileSync(out, JSON.stringify({ ok: true, data, meta: { source: ['pbe_derived'], fetched_at: new Date().toISOString(), freshness: 'CURRENT', semantics: 'QA mock built from stored snapshots with the API functions', degraded: [] } }));
console.log(out, 'model', model.status, JSON.stringify(model.probability), 'basis', model.basis, '| faceoff', faceoff.rows.length, 'tech', technical.rows.length, 'collision', data.intel.collision.available, '| tally', JSON.stringify(map.tally));
