// Level-3 DNA gate: tour-specific latest snapshot date, live evaluation (29 held, 30 published, falls closed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tourDnaStatus, latestAsOfForGender, DNA_MIN_QUALIFIED } from '../workers/tennis-api/src/v2.js';

// fake PostgREST: honours as_of=eq., tennis_players.gender=eq., order=as_of.desc, limit/offset
function store(rows) {
  return {
    async select(table, q) {
      if (table !== 'tennis_dna_snapshots') return [];
      const g = (q.match(/tennis_players\.gender=eq\.(\w)/) || [])[1];
      const d = (q.match(/as_of=eq\.([\d-]+)/) || [])[1];
      let out = rows.filter((r) => (!g || r.gender === g) && (!d || r.as_of === d));
      if (/order=as_of\.desc/.test(q)) out = [...out].sort((a, b) => (a.as_of < b.as_of ? 1 : -1));
      const off = Number((q.match(/offset=(\d+)/) || [])[1] || 0);
      const lim = Number((q.match(/limit=(\d+)/) || [])[1] || 1000);
      return out.slice(off, off + lim).map((r) => ({ as_of: r.as_of, metrics: { service_points_won: { value: 0.6, confidence: r.conf } }, tennis_players: { gender: r.gender } }));
    }
  };
}
const snaps = (gender, as_of, qualified, extraLow = 3) => [
  ...Array.from({ length: qualified }, () => ({ gender, as_of, conf: 'medium' })),
  ...Array.from({ length: extraLow }, () => ({ gender, as_of, conf: 'low' }))
];

test('each tour gates on its own latest snapshot date (no cross-tour coupling)', async () => {
  const s = store([...snaps('F', '2026-09-27', 40), ...snaps('M', '2026-09-26', 17), ...snaps('F', '2026-09-26', 12)]);
  assert.equal(await latestAsOfForGender(s, 'M'), '2026-09-26');
  assert.equal(await latestAsOfForGender(s, 'F'), '2026-09-27');
  const atp = await tourDnaStatus(s, 'M');
  const wta = await tourDnaStatus(s, 'F');
  assert.deepEqual([atp.as_of, atp.qualified, atp.ready], ['2026-09-26', 17, false], 'ATP counts its Sep 26 snapshots, not the WTA Sep 27 date');
  assert.deepEqual([wta.as_of, wta.qualified, wta.ready], ['2026-09-27', 40, true]);
});

test('29 -> held, 30 -> published automatically; a newer snapshot below 30 fails closed', async () => {
  assert.equal(DNA_MIN_QUALIFIED, 30);
  assert.equal((await tourDnaStatus(store(snaps('M', '2026-10-01', 29)), 'M')).ready, false);
  assert.equal((await tourDnaStatus(store(snaps('M', '2026-10-01', 30)), 'M')).ready, true);
  const dropped = await tourDnaStatus(store([...snaps('M', '2026-10-01', 30), ...snaps('M', '2026-10-02', 29)]), 'M');
  assert.deepEqual([dropped.as_of, dropped.qualified, dropped.ready], ['2026-10-02', 29, false], 'the newer legitimate snapshot governs; no stale publication');
});
