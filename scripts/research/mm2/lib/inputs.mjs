// Matchup Model V2 research: turn the fetched production inputs (fetch-inputs.mjs) into the SAME ledger entries and
// ranking index the production DNA v2 build uses (dna-v2-job.js + dna-cache.js), via the production functions themselves.
import fs from 'node:fs';
import path from 'node:path';
import { ledgerEntry, byOrder, rankIndex } from '../../../../workers/shared/dna/match-dna.js';
import { atpTierIndex, TIER_KEY } from '../../../../workers/shared/atp-tiers.js';

export const DATA = process.env.MM2_DATA || 'D:/Workers/research-data/tennis-mm2';
const IN = path.join(DATA, 'inputs');
const read = (f) => JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8'));
const EVENT = { ATP: 'MS', WTA: 'WS' };
const LIST = { ATP: 'atp_singles', WTA: 'wta_singles' };

let shared = null;
async function base() {
  if (shared) return shared;
  const gender = new Map(read('players.json').map((p) => [p.pbe_player_id, p.gender]));
  const editions = new Map(read('editions.json').map((e) => [e.edition_id, e]));
  const tiers = await atpTierIndex();
  for (const [id, e] of editions) if (!e.competition_key && tiers.has(id)) editions.set(id, { ...e, competition_key: TIER_KEY[tiers.get(id).tier] });
  shared = { gender, editions, tourOf: (pid) => (gender.get(pid) === 'M' ? 'ATP' : gender.get(pid) === 'F' ? 'WTA' : null), manifest: read('manifest.json') };
  return shared;
}

/** One tour: { entries (sorted, seq set), rankAt, lists, editions, manifest }. Same conversion as dna-cache.js entryOf. */
export async function loadTour(tour) {
  const { tourOf, editions, manifest } = await base();
  const entries = [];
  let mismatched = 0;
  for (const p of '0123456789abcdef') {
    for (const raw of read(`ledger/${tour}/${p}.json`)) {
      const [match_id, edition_id, round, format_key, status, winner_side, scheduled_at, started_at, surface, source_family, packed, A, B] = raw;
      const e = ledgerEntry({ match_id, edition_id, event_type: EVENT[tour], round, format_key, status, winner_side, scheduled_at, started_at, surface, source_family, packed, A, B, edition: editions.get(edition_id) }, tourOf);
      if (e && e.tour === tour) { e.edition = edition_id; entries.push(e); } else if (e) mismatched += 1;
    }
  }
  entries.sort(byOrder);
  for (let i = 0; i < entries.length; i += 1) entries[i].seq = i;
  const rc = read(`ranks/${LIST[tour]}.json`);
  const lists = Object.entries(rc.snaps).map(([id, [date, size]]) => ({ date, size, ranks: new Map(rc.ranks[id] || []) }));
  return { entries, mismatched, rankAt: rankIndex(lists), lists, editions, manifest };
}
