// One-time bootstrap of the research-only shadow player state (research/mm2/state/<tour>.json) from the fetched
// inputs of the 2026-10-02 DNA v2 build, with the SAME shared function the daily build uses (tourStates). The daily
// build overwrites it from the next run on.  node --max-old-space-size=12000 scripts/research/mm2/bootstrap-state.mjs [cutoff]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ratingRun } from '../../../workers/shared/dna/match-dna.js';
import { tourStates } from '../../../workers/shared/research/mm2-profile.js';
import { loadTour } from './lib/inputs.mjs';
import { VARIANT } from './lib/features.mjs';

const CUTOFF = process.argv[2] || '2026-10-02';
const env = { ...process.env, NODE_OPTIONS: '--require D:/Workers/exfat-readlink.cjs' };
for (const tour of ['ATP', 'WTA']) {
  const t = await loadTour(tour);
  const run = ratingRun(t.entries, { variant: VARIANT[tour] });
  const byPlayer = new Map();
  for (const e of t.entries) for (const pid of [e.A, e.B]) { if (!byPlayer.has(pid)) byPlayer.set(pid, []); byPlayer.get(pid).push(e); }
  const s = tourStates(byPlayer, run, CUTOFF);
  const f = path.join(os.tmpdir(), `mm2-state-${tour}.json`);
  fs.writeFileSync(f, JSON.stringify({ ...s, tour, built_at: new Date().toISOString(), bootstrap: 'local replay of the 2026-10-02 build inputs' }));
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `tennis-source/research/mm2/state/${tour}.json`, '--remote', '--file', f, '--content-type', 'application/json'], { cwd: path.resolve('workers/tennis-api'), env, stdio: 'pipe', shell: process.platform === 'win32' });
  console.log(tour, 'players', Object.keys(s.players).length, 'bytes', fs.statSync(f).size);
}
