// Proves the staged Supabase migration applies cleanly and enforces its invariants (PGlite, in-memory
// Postgres). This is the "proven" half of "staged/proven"; APPLY to Supabase needs owner approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { participantKey } from '../workers/shared/canonical/participant.js';

// the full chain, in order — exactly what the target ledger replays
const DIR = new URL('../supabase/migrations/', import.meta.url);
const SQL = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => fs.readFileSync(new URL(f, DIR), 'utf8')).join(String.fromCharCode(10));
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function db() {
  const pg = new PGlite();
  // the target guard requires the sports-project markers
  await pg.exec('create table ufc_bouts (id int); create table ufc_model_versions (id int); create role anon; create role authenticated;');
  await pg.exec(SQL);
  return pg;
}

const rejects = async (pg, sql, re) => {
  await assert.rejects(pg.query(sql), (e) => (re ? re.test(e.message) : true));
};

test('target guard refuses a project without the sports markers, or with identity tables', async () => {
  await assert.rejects(new PGlite().exec(SQL), /sports project/);
  const pg = new PGlite();
  await pg.exec('create table ufc_bouts (id int); create table ufc_model_versions (id int); create table pbe_sport_entitlements (id int);');
  await assert.rejects(pg.exec(SQL), /identity/);
});

test('migration applies; RLS enabled on every tennis table', async () => {
  const pg = await db();
  const t = await pg.query("select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'tennis\\_%' order by 1");
  assert.ok(t.rows.length >= 35, `tables: ${t.rows.length}`);
  for (const r of t.rows) assert.equal(r.rowsecurity, true, r.tablename);
});

test('participants: singles and deterministic pairs; malformed keys rejected', async () => {
  const pg = await db();
  for (const n of [1, 2, 3]) await pg.query(`insert into tennis_players (pbe_player_id, founding_external_key, full_name, gender) values ('${U(n)}', 'wta:${n}', 'Test Player ${n}', 'F')`);
  const single = participantKey([U(1)]);
  const pair = participantKey([U(3), U(2)]);
  await pg.query(`insert into tennis_participants values ('${single}', 'singles'), ('${pair}', 'pair')`);
  await pg.query(`insert into tennis_participant_members values ('${pair}', 1, '${U(2)}'), ('${pair}', 2, '${U(3)}')`);
  await rejects(pg, `insert into tennis_participant_members values ('${pair}', 3, '${U(1)}')`);
  await rejects(pg, `insert into tennis_participants values ('X:${U(1)}', 'singles')`);
  await rejects(pg, `insert into tennis_participants values ('S:${U(2)}', 'pair')`);
});

test('matches: a final result must name a winner; walkover without winner rejected', async () => {
  const pg = await db();
  await rejects(pg, `insert into tennis_matches (event_type, round, format_key, status, source_family) values ('WS', 'R1', 'BO3_TB7', 'completed', 'wta')`, /check/i);
  await pg.query(`insert into tennis_matches (event_type, round, format_key, status, winner_side, source_family) values ('WS', 'R1', 'BO3_TB7', 'completed', 'A', 'wta')`);
  await pg.query(`insert into tennis_matches (event_type, round, format_key, status, source_family) values ('MD', 'R1', 'DOUBLES_TOUR', 'scheduled', 'wimbledon')`);
});

test('picks are append-only and must lock before the match starts', async () => {
  const pg = await db();
  await pg.query(`insert into tennis_players (pbe_player_id, founding_external_key, full_name) values ('${U(1)}', 'wta:1', 'P')`);
  await pg.query(`insert into tennis_participants values ('S:${U(1)}', 'singles')`);
  const m = await pg.query(`insert into tennis_matches (event_type, round, format_key, status, source_family) values ('WS', 'R1', 'BO3_TB7', 'scheduled', 'wta') returning match_id`);
  const id = m.rows[0].match_id;
  await rejects(pg, `insert into tennis_picks (match_id, participant_key, market, selection, model_probability, model_version, confidence, locked_at, match_start_at) values ('${id}', 'S:${U(1)}', 'moneyline', 'A', 0.6, 'v0', 'low', '2026-09-27T10:00Z', '2026-09-27T09:00Z')`, /check/i);
  await rejects(pg, `insert into tennis_picks (match_id, participant_key, market, selection, price_american, model_probability, model_version, confidence, locked_at, match_start_at) values ('${id}', 'S:${U(1)}', 'moneyline', 'A', -110, 0.6, 'v0', 'low', '2026-09-27T08:00Z', '2026-09-27T09:00Z')`, /check/i);
  const p = await pg.query(`insert into tennis_picks (match_id, participant_key, market, selection, model_probability, model_version, confidence, locked_at, match_start_at) values ('${id}', 'S:${U(1)}', 'moneyline', 'A', 0.6, 'v0', 'low', '2026-09-27T08:00Z', '2026-09-27T09:00Z') returning pick_id`);
  await rejects(pg, `update tennis_picks set model_probability = 0.9 where pick_id = '${p.rows[0].pick_id}'`, /append-only/);
  await rejects(pg, `delete from tennis_picks where pick_id = '${p.rows[0].pick_id}'`, /append-only/);
  await rejects(pg, `insert into tennis_pick_corrections (pick_id, field, reason) values ('${p.rows[0].pick_id}', 'x', 'short')`, /check/i);
});

test('model evaluations enforce probabilities and a feature cutoff before generation (leakage control)', async () => {
  const pg = await db();
  const m = await pg.query(`insert into tennis_matches (event_type, round, format_key, status, source_family) values ('WS', 'R1', 'BO3_TB7', 'scheduled', 'wta') returning match_id`);
  const id = m.rows[0].match_id;
  await rejects(pg, `insert into tennis_model_evaluations (match_id, model_version, generated_at, p_a, p_b, feature_cutoff) values ('${id}', 'v0', '2026-09-27T08:00Z', 0.7, 0.4, '2026-09-27T07:00Z')`, /check/i);
  await rejects(pg, `insert into tennis_model_evaluations (match_id, model_version, generated_at, p_a, p_b, feature_cutoff) values ('${id}', 'v0', '2026-09-27T08:00Z', 0.6, 0.4, '2026-09-27T09:00Z')`, /check/i);
  await pg.query(`insert into tennis_model_evaluations (match_id, model_version, generated_at, p_a, p_b, feature_cutoff) values ('${id}', 'v0', '2026-09-27T08:00Z', 0.6, 0.4, '2026-09-27T07:00Z')`);
});

test('media: only rights-safe licenses; one approved photo per player; approved needs verification', async () => {
  const pg = await db();
  await pg.query(`insert into tennis_players (pbe_player_id, founding_external_key, full_name) values ('${U(1)}', 'atp:X', 'P')`);
  const row = (lic, approval, verified) => `insert into tennis_player_media (pbe_player_id, source_page_url, original_url, author, license, attribution, width, height, focal, identity_evidence, approval, verified_at) values ('${U(1)}', 'https://commons.wikimedia.org/wiki/File:x.jpg', 'https://upload.wikimedia.org/x.jpg', 'A', '${lic}', 'A / ${lic}', 800, 1000, '{}', '[]', '${approval}', ${verified ? "now()" : 'null'})`;
  await rejects(pg, row('CC BY-NC 2.0', 'pending', false), /check/i);
  await rejects(pg, row('CC BY 2.0', 'approved', false), /check/i);
  await pg.query(row('CC BY 2.0', 'approved', true));
  await rejects(pg, row('CC0', 'approved', true), /unique|duplicate/i);
});

test('player slugs: readable, accent-folded, collision-safe, never rewritten', async () => {
  const pg = await db();
  await pg.query(`insert into tennis_players (pbe_player_id, founding_external_key, full_name) values ('${U(1)}', 'wta:1', 'Iga Świątek'), ('${U(2)}', 'wta:2', 'Maria Sample')`);
  await pg.query(`insert into tennis_players (pbe_player_id, founding_external_key, full_name) values ('${U(3)}', 'wta:3', 'Maria Sample')`);
  const r = await pg.query('select pbe_player_id, slug from tennis_players order by pbe_player_id');
  assert.deepEqual(r.rows.map((x) => x.slug), ['iga-swiatek', 'maria-sample', 'maria-sample-000000']);
  await pg.query(`update tennis_players set full_name = 'Renamed' where pbe_player_id = '${U(1)}'`);
  assert.equal((await pg.query(`select slug from tennis_players where pbe_player_id = '${U(1)}'`)).rows[0].slug, 'iga-swiatek');
});

test('quality levels: Q2 sets only, Q3 with stats, Q4 with point events; views are security_invoker', async () => {
  const pg = await db();
  const m = (await pg.query(`insert into tennis_matches (event_type, round, format_key, status, winner_side, source_family) values ('WS','1','BO3_TB7','completed','A','wta') returning match_id`)).rows[0].match_id;
  await pg.query(`insert into tennis_sets (match_id, set_no, games_a, games_b) values ('${m}', 1, 6, 4)`);
  assert.equal((await pg.query(`select quality from tennis_match_quality where match_id='${m}'`)).rows[0].quality, 'Q2');
  await pg.query(`insert into tennis_match_stats (match_id, side, source_family, stats, captured_at) values ('${m}','A','wta','{}', now())`);
  assert.equal((await pg.query(`select quality from tennis_match_quality where match_id='${m}'`)).rows[0].quality, 'Q3');
  await pg.query(`insert into tennis_match_events (event_id, match_id, quality, event_sequence, event_type, source, observed_at, state) values ('e1','${m}','point_event',0,'ace','ausopen',now(),'{}')`);
  assert.equal((await pg.query(`select quality from tennis_match_quality where match_id='${m}'`)).rows[0].quality, 'Q4');
  await assert.rejects(pg.query(`insert into tennis_match_events (event_id, match_id, quality, event_sequence, event_type, source, observed_at, state) values ('e2','${m}','score_snapshot',0,'ace','wta',now(),'{}')`), /check/i);
  await assert.rejects(pg.query(`insert into tennis_match_events (event_id, match_id, quality, event_sequence, event_type, source, observed_at, state, serve_speed_kmh) values ('e3','${m}','score_snapshot',1,'score_update','wta',now(),'{}', 190)`), /check/i);
  await assert.rejects(pg.query(`update tennis_match_events set event_type='x' where event_id='e1'`), /append-only/);
  const v = await pg.query(`select reloptions from pg_class where relname='tennis_match_quality'`);
  assert.ok(String(v.rows[0].reloptions).includes('security_invoker=true'));
});

test('venues without venue precision cannot carry coordinates; broadcasts need https + scope', async () => {
  const pg = await db();
  await assert.rejects(pg.query(`insert into tennis_venues (venue_id, slug, city, precision, source_family, latitude, longitude) values (gen_random_uuid(), 'x', 'Paris', 'city', 'wta', 48.8, 2.3)`), /check/i);
  await assert.rejects(pg.query(`insert into tennis_broadcasts (territory, broadcaster, distribution_type, official_url, source, source_url, verified_at) values ('US','X','tv','https://x.test','s','https://s.test', now())`), /check/i);
});

test('context layer: a mapping needs id + confidence; unmapped carries none; surface values closed; bye has no player', async () => {
  const pg = await db();
  await pg.query(`insert into tennis_tournaments (tournament_id, slug, name, competition_key) values ('${U(1)}', 't', 'T', 'wta_250')`);
  await pg.query(`insert into tennis_tournament_editions (edition_id, tournament_id, year, competition_key, source_family) values ('${U(2)}', '${U(1)}', 2025, 'wta_250', 'wta')`);
  await pg.query(`insert into tennis_source_mappings (entity_type, provider, external_id, canonical_id, status, method, confidence, rule_version) values ('edition', 'espn_wta', '1-2025', '${U(2)}', 'mapped', 'shared_matches', 'high', 'v1')`);
  await pg.query(`insert into tennis_source_mappings (entity_type, provider, external_id, status, method, rule_version) values ('edition', 'espn_wta', '2-2025', 'unresolved', 'shared_matches', 'v1')`);
  await rejects(pg, `insert into tennis_source_mappings (entity_type, provider, external_id, status, method, confidence, rule_version) values ('edition', 'espn_wta', '3-2025', 'mapped', 'x', 'high', 'v1')`);
  await rejects(pg, `insert into tennis_source_mappings (entity_type, provider, external_id, status, method, confidence, rule_version) values ('edition', 'espn_wta', '4-2025', 'ambiguous', 'x', 'medium', 'v1')`);
  await pg.query(`insert into tennis_edition_attributes (edition_id, attribute, value, source, method) values ('${U(2)}', 'surface', 'clay', 'wta', 'direct')`);
  await rejects(pg, `insert into tennis_edition_attributes (edition_id, attribute, value, source, method) values ('${U(2)}', 'surface', 'red clay', 'x', 'direct')`);
  await rejects(pg, `insert into tennis_edition_attributes (edition_id, attribute, value, source, method) values ('${U(2)}', 'surface', 'clay', 'y', 'guessed')`);
  await rejects(pg, `insert into tennis_draw_slots (edition_id, event_type, draw, position, participant_key, bye, source) values ('${U(2)}', 'WS', 'main', 1, 'S:x', true, 'wta')`);
});
