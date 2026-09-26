// Deterministic canonical ids (UUIDv5). Every canonical row id is a pure function of a stable source
// identity, so the graph rebuilds identically from the raw archive and writes are idempotent upserts.

import { uuidv5 } from './identity.js';

export const SLAMS = Object.freeze({ 'australian open': 'australian-open', 'roland garros': 'roland-garros', 'french open': 'roland-garros', wimbledon: 'wimbledon', 'us open': 'us-open' });

export const slugify = (s) => String(s || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Grand Slams are one tournament across every source; everything else is keyed by its provider id. */
export function tournamentKey(provider, providerId, name, level) {
  const slam = /grand slam/i.test(String(level || '')) || provider === 'wimbledon' || provider === 'ausopen' ? SLAMS[String(name || '').toLowerCase().trim()] : null;
  return slam ? `slam:${slam}` : `${provider}:${providerId}`;
}

export const tournamentId = (key) => uuidv5(`tournament:${key}`);
export const editionId = (tid, year) => uuidv5(`edition:${tid}:${year}`);
export const drawId = (eid, eventType, stage) => uuidv5(`draw:${eid}:${eventType}:${stage}`);
export const matchId = (provider, providerMatchId) => uuidv5(`match:${provider}:${providerMatchId}`);
export const snapshotId = (listKey, date) => uuidv5(`ranking:${listKey}:${date}`);

/** WTA calendar level -> competition_key (only levels observed in the WTA API). */
export function competitionFor(level) {
  const l = String(level || '').toLowerCase();
  if (l === 'grand slam') return 'grand_slam';
  if (l === 'wta 1000') return 'wta_1000';
  if (l === 'wta 500') return 'wta_500';
  if (l === 'wta 250') return 'wta_250';
  if (l === 'wta 125') return 'wta_125';
  if (l === 'itf') return 'itf_women';
  if (l.includes('finals')) return 'wta_finals';
  return null;
}

export const venueId = (city, country) => uuidv5(`venue:${slugify(city)}:${String(country || '').toLowerCase()}`);
