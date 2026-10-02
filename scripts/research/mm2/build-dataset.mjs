// Matchup Model V2 research — build and FREEZE the strictly as-of research dataset (DATASET_VERSION).
// Inputs: fetch-inputs.mjs output (production DNA v2 build inputs). Output (outside the repo, large):
//   $MM2_DATA/dataset/<tour>.jsonl   one row per gradeable match with a champion probability
//   $MM2_DATA/dataset/manifest.json  dataset_version, generated_at, input hashes, feature schema, counts,
//                                    exclusion reasons, per-tour and overall dataset hash (sha256 of row hashes)
// A rerun on the same inputs reproduces every hash (generated_at excluded from the hashes).
//   node --max-old-space-size=12000 scripts/research/mm2/build-dataset.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadTour, DATA } from './lib/inputs.mjs';
import { buildRows, FEATURE_VERSION, FEATURES_B, FEATURES_C, VARIANT, MIN_PRIOR, SURFACE_MIN } from './lib/features.mjs';

export const DATASET_VERSION = 'mm2-dataset/1';
const OUT = path.join(DATA, 'dataset');
fs.mkdirSync(OUT, { recursive: true });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const r6 = (x) => (x == null ? null : Math.round(x * 1e6) / 1e6);

/** Canonical row (fixed key order, 6-decimal numbers) -> { line, hash }. */
export function canonicalRow(r) {
  const f = {};
  for (const k of FEATURES_C) f[k] = r6(r.f[k]);
  const c = { match_id: r.match_id, tour: r.tour, scheduled_day: r.day, round_order: r.ro, round: r.round, edition: r.edition, surface: r.surface, level: r.level, winner: r.y ? 'A' : 'B', y: r.y,
    champion_probability: r6(r.champion), champion_overall_probability: r6(r.overall), champion_basis: r.blend ? 'surface_blend' : 'overall', rated_matches: [r.na, r.nb], tech_both: r.tech,
    feature_as_of: r.feature_as_of, feature_version: FEATURE_VERSION, features: f };
  const line = JSON.stringify(c);
  return { line, hash: sha(line) };
}

const stats = new Map();
for (const [id, side, , ...v] of JSON.parse(fs.readFileSync(path.join(DATA, 'inputs/match-stats.json'), 'utf8'))) { if (!stats.has(id)) stats.set(id, {}); stats.get(id)[side] = v; }

const manifest = { dataset_version: DATASET_VERSION, generated_at: new Date().toISOString(), feature_version: FEATURE_VERSION, feature_schema: { B: FEATURES_B, C: FEATURES_C },
  champion: { model: 'PBE Rating', method_version: 1, variant: VARIANT, min_prior: MIN_PRIOR, surface_min: SURFACE_MIN, rounding: 'ratings rounded as served (tennis-api modelBlock)' },
  inputs: JSON.parse(fs.readFileSync(path.join(DATA, 'inputs/manifest.json'), 'utf8')).files, tours: {} };
const tourHashes = [];
for (const tour of ['ATP', 'WTA']) {
  const t = await loadTour(tour);
  const { rows, exclusions } = buildRows(tour, t.entries, { stats });
  const hashes = [];
  const fd = fs.openSync(path.join(OUT, `${tour}.jsonl`), 'w');
  for (const r of rows) { const { line, hash } = canonicalRow(r); hashes.push(hash); fs.writeSync(fd, `${line}\n`); }
  fs.closeSync(fd);
  const h = sha(hashes.join('\n'));
  tourHashes.push(h);
  manifest.tours[tour] = { ledger_entries: t.entries.length, rows: rows.length, tech_rows: rows.filter((r) => r.tech).length, first_day: rows[0]?.day, last_day: rows.at(-1)?.day, exclusions: { ...exclusions, ledger_mismatched_tour: t.mismatched }, dataset_hash: h };
  console.log(tour, JSON.stringify(manifest.tours[tour]));
}
manifest.dataset_hash = sha(tourHashes.join('\n'));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('dataset_hash', manifest.dataset_hash);
