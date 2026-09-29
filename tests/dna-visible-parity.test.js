// Tennis DNA VISIBLE parity (2026-09-29): the full DNA page renders the same architecture for both tours, and every
// legitimate hold is an explicit visible state — never a blank cell, a raw key or a silently missing module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surfaceRatingCell, surfaceTable, matchDnaSummary } from '../src/ui/match-dna.js';
import { profileBlock } from '../src/ui/player-profile.js';

const str = (x) => String(x);
const metric = (key, label) => ({ key, label, value: 0.8, confidence: 'high', percentile: 90, status: 'published' });
const surf = (surface, rating, W = 30, L = 10) => ({ surface, rating, form: { career: { W, L }, last10: { W: 7, L: 3 } }, metrics: [metric('match_win_rate', 'Match win %')] });

test('Surface PBE Rating cell: value + percentile, or the exact reason — never blank', () => {
  assert.match(str(surfaceRatingCell(surf('hard', { value: 2137, percentile: 99, status: 'published', rated_matches: 116 }), 'ATP')), /2137.*99th pct/s);
  assert.match(str(surfaceRatingCell(surf('clay', { value: 2200, percentile: null, status: 'published', rated_matches: 61 }), 'ATP')), /2200.*no percentile: no rated clay match in the last 365 days/s);
  assert.match(str(surfaceRatingCell(surf('grass', { value: 1500, percentile: null, status: 'published', rated_matches: 12 }), 'ATP')), /12 rated grass matches \(20 needed\)/);
  assert.match(str(surfaceRatingCell(surf('hard', { value: 2000, status: 'not_validated' }), 'ATP')), /Not published — the ATP surface model has not passed its out-of-sample validation gate/);
  assert.doesNotMatch(str(surfaceRatingCell(surf('hard', { value: 2000, status: 'not_validated' }), 'ATP')), /2000/, 'an unvalidated rating value is never shown');
  assert.match(str(surfaceRatingCell(surf('grass', null), 'WTA')), /not rated: no rated grass matches/);
});

test('By surface: discloses results without a sourced surface and states the surface-model gate for the tour', () => {
  const md = { tour: 'ATP', form: { career: { W: 290, L: 60 } }, by_surface: [surf('hard', { value: 2137, percentile: 99, status: 'published', rated_matches: 116 }, 101, 22), surf('clay', { value: 2200, percentile: null, status: 'published', rated_matches: 61 }, 55, 7)] };
  const h = str(surfaceTable(md));
  assert.match(h, /165 of 350 singles results have no sourced surface/);
  assert.match(h, /never inferred from a tournament name/);
  assert.match(h, /ATP surface PBE Ratings are published: the ATP surface blend beat the overall rating out of sample/);
  const held = str(surfaceTable({ ...md, by_surface: [surf('hard', { value: 1, status: 'not_validated' })] }));
  assert.match(held, /ATP surface PBE Ratings are not published/);
});

test('Tournament level & round: real labels for every tour key (ATP tiers from the registry), never raw keys', () => {
  const x = { W: 10, L: 2, set: 0.7, game: 0.55, wae: 0.1, n_rated: 12 };
  const h = str(profileBlock({ windows: {}, by_level: { atp_1000: x, atp_500: x, atp_250: x, wta_1000: x, wta_125: x, itf_women: x, grand_slam: x, unclassified: x }, by_round: {} }, { min_sample: 10 }, '2026-09-29'));
  for (const l of ['ATP Masters 1000', 'ATP 500', 'ATP 250', 'WTA 1000', 'WTA 125', 'ITF (women)', 'Grand Slams', 'Level not given by the source']) assert.ok(h.includes(l), l);
  assert.doesNotMatch(h, /\b(wta|atp|itf) (1000|500|250|125|women)\b/);
});

test('Overview Match DNA is visibly a summary with a strong route to the full Tennis DNA (same for both tours)', () => {
  const md = { families: [{ metrics: [metric('match_win_rate', 'Match win %')] }], sample: { matches: 358, first_day: '2020-02-17', last_day: '2026-09-09' }, as_of: '2026-09-29' };
  const h = str(matchDnaSummary(md, 'carlos-alcaraz'));
  assert.match(h, /<h2><a href="\/players\/carlos-alcaraz\/dna">Match DNA<\/a> <span class="tag">summary<\/span><\/h2>/);
  assert.match(h, /Open full Tennis DNA →/);
  assert.match(h, /Summary · Open full Match DNA, rating history, splits and surface intelligence →/);
});
