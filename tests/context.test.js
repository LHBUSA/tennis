// Phase 5 context layer: sourced edition attributes, mappings, disagreement log (docs/TENNIS_DATA_MODEL.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFacts, DRAW_SHEETS } from '../workers/tennis-ingest/src/context-jobs.js';
import { tournamentId, tournamentKey, editionId } from '../workers/shared/canonical/ids.js';
import { MemStore } from './helpers/memstore.js';

const rec = (id, name, year, surface, indoor, level = 'WTA 250') => ({ provider_tournament_id: id, name, year, level, title: `${name} ${year}`, start_date: `${year}-05-01`, end_date: `${year}-05-08`, surface, surface_raw: surface, indoor, city: 'X' });

test('WTA edition facts: sourced attributes for held editions only; fill gaps; disagreement logged, stored value kept', async () => {
  const s = new MemStore();
  const eid = async (r) => editionId(await tournamentId(tournamentKey('wta', r.provider_tournament_id, r.name, r.level)), r.year);
  const a = rec('1038', 'MADRID', 2016, 'clay', false);
  const b = rec('1049', 'AUCKLAND', 2016, 'hard', false);
  const c = rec('9999', 'NOWHERE', 2016, 'grass', false);
  s.rows('tennis_tournament_editions').push({ edition_id: await eid(a), surface: null, indoor: null }, { edition_id: await eid(b), surface: 'clay', indoor: false });
  const w = await writeFacts(s, [a, b, c, { ...rec('1050', 'X', 2016, null, null), surface_raw: 'Artificial Grass' }], 'cap1');
  assert.equal(w.editions_known, 2); assert.equal(w.editions_unknown, 2);
  const ea = s.rows('tennis_tournament_editions')[0];
  assert.equal(ea.surface, 'clay'); assert.equal(ea.indoor, false);
  const eb = s.rows('tennis_tournament_editions')[1];
  assert.equal(eb.surface, 'clay', 'a stored value is never overwritten');
  const dis = s.rows('tennis_source_disagreements');
  assert.equal(dis.length, 1); assert.equal(dis[0].source_value, 'hard'); assert.equal(dis[0].derived_value, 'clay');
  const attrs = s.rows('tennis_edition_attributes');
  assert.ok(attrs.every((x) => x.source === 'wta' && x.method === 'direct' && x.capture_id === 'cap1'));
  assert.equal(attrs.filter((x) => x.attribute === 'surface').length, 2);
  const maps = s.rows('tennis_source_mappings');
  assert.ok(maps.every((m) => m.status === 'mapped' && m.confidence === 'high' && m.method === 'official_id'));
  assert.equal(maps.length, 4);
});

test('draw sheets: only allow-listed hosts and documents', () => {
  assert.equal(DRAW_SHEETS.ptl.url(2025, 7581, 'mds'), 'https://www.protennislive.com/posting/2025/7581/mds.pdf');
  assert.equal(DRAW_SHEETS.wta.url(2016, 1038, 'MDS'), 'https://wtafiles.wtatennis.com/pdf/draws/2016/1038/MDS.pdf');
  assert.deepEqual(Object.keys(DRAW_SHEETS), ['ptl', 'wta']);
});

test('WTA /records and /year: parsed as reported; a season outside coverage is absent (never zero)', async () => {
  const fs = await import('node:fs');
  const { playerRecords, playerYear } = await import('../workers/providers/wta-records.js');
  const r = playerRecords.parse(fs.readFileSync(new URL('./fixtures/wta/player-records-320760.json', import.meta.url), 'utf8'))[0];
  assert.equal(r.provider_player_id, '320760');
  const gs = r.payload.by_level.find((x) => x.level === 'GRAND SLAM');
  assert.deepEqual([gs.matches, gs.wins, gs.losses, gs.titles], [188, 149, 39, 6]);
  assert.deepEqual(r.payload.by_surface.map((x) => x.surface).sort(), ['carpet', 'clay', 'grass', 'hard']);
  assert.ok(r.payload.by_tournament.length > 10 && r.payload.by_tournament.every((t) => Array.isArray(t.years)));
  const y = playerYear.parse(fs.readFileSync(new URL('./fixtures/wta/player-year-320760-2021.json', import.meta.url), 'utf8'))[0];
  assert.equal(y.payload.year, 2021); assert.equal(y.payload.aces, 340); assert.equal(y.payload.matchcount, 69); assert.equal(y.payload.level, 'TOUR');
  assert.deepEqual(playerYear.parse(fs.readFileSync(new URL('./fixtures/wta/player-year-320760-2016.json', import.meta.url), 'utf8')), []);
});
