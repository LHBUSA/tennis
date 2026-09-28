// Official draw-sheet parsing (pdftotext -layout text of real sheets) and the edition proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHeader, parseSlots, proveDraw, parseDates } from '../scripts/context/drawsheet-parse.mjs';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/drawsheets/${n}`, import.meta.url), 'utf8');

test('headers: surface read from the sheet (never from the tournament name); dates corroborate only', () => {
  assert.equal(parseHeader(fx('ptl-2014-416-mds.txt')).surface, 'clay');
  assert.equal(parseHeader(fx('ptl-2025-7581-mds.txt')).surface, 'hard');
  assert.equal(parseHeader(fx('wta-2021-1038-mds.txt')).surface, 'clay');
  assert.equal(parseHeader('US Men\'s Clay Court Championship\n\nHouston, USA   5 - 11 April 2021   Hard\n1 1 X, Y').surface, 'hard', 'a surface word in the NAME is not the surface');
  assert.equal(parseHeader('Some Open\n\n  Hard, Clay\n').surface, null, 'two surfaces -> null');
  assert.deepEqual(parseDates('10 - 18 May 2014'), ['2014-05-18']);
});

test('draw rows: position vs seed by sequence, entry codes, byes, names printed on a neighbouring line, seed table ignored', () => {
  const a = parseSlots(fx('ptl-2014-416-mds.txt'));
  assert.ok(a.ok); assert.equal(a.size, 64);
  assert.deepEqual(a.slots.filter((s) => s.seed).map((s) => `${s.position}:${s.seed}`).slice(0, 4), ['1:1', '8:14', '9:9', '16:7']);
  assert.equal(a.slots.filter((s) => s.bye).length, 8);
  const b = parseSlots(fx('ptl-2025-7581-mds.txt'));
  assert.ok(b.ok); assert.equal(b.size, 32);
  assert.equal(b.slots[3].entry, 'NG'); assert.equal(b.slots[4].entry, 'Q');
  const w = parseSlots(fx('wta-2021-1038-mds.txt'));
  assert.ok(w.ok, 'a "PRIZE MONEY" header label above the draw does not end the page'); assert.equal(w.size, 64);
  assert.equal(w.slots[0].last, 'BARTY'); assert.equal(w.slots[0].seed, 1); assert.equal(w.slots[2].entry, 'LL');
});

test('proof: a sheet is used only when its first round is the edition\'s stored matches', () => {
  const p = parseSlots(fx('ptl-2025-7581-mds.txt'));
  const players = p.slots.filter((s) => !s.bye);
  const people = players.map((s, i) => ({ key: `S:${i}`, last: s.last.replace('...', ''), first: s.first }));
  const key = (pos) => people[players.findIndex((s) => s.position === pos)]?.key;
  const matches = [];
  for (let i = 1; i < 32; i += 2) if (key(i) && key(i + 1)) matches.push({ keys: [key(i), key(i + 1)] });
  const ok = proveDraw(p, people, matches);
  assert.ok(ok.proven); assert.equal(ok.confirmed, ok.checked);
  // the same sheet against another edition's matches (pairs shuffled) is refused
  const wrong = matches.map((m, i) => ({ keys: [m.keys[0], matches[(i + 1) % matches.length].keys[1]] }));
  assert.equal(proveDraw(p, people, wrong).proven, false);
  // unresolvable names (another tournament's field) -> not proven
  assert.equal(proveDraw(p, people.map((x) => ({ ...x, last: `${x.last}Z` })), matches).proven, false);
});
