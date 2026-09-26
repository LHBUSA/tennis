// Canonical player identity. One PropBetEdge player UUID per human; names are never identity.
// Contract: docs/TENNIS_IDENTITY.md.
//
// Resolution is deterministic and conservative:
//   1. exact provider external id already on the crosswalk         -> resolved (external_id)
//   2. normalized full name + exact date of birth (+ nationality if both sides have one),
//      and exactly ONE candidate                                     -> resolved (name_dob)
//   3. anything else (name only, several candidates, conflicting DOB) -> unresolved / ambiguous
// Nothing fuzzy ever writes into a player record. Unresolved rows go to the reconciliation queue.

export const PBE_TENNIS_NAMESPACE = '6b3d5c1e-4f0a-5e2b-9c7d-7e1a2b3c4d5e';

const FOLD = { ø: 'o', Ø: 'o', ł: 'l', Ł: 'l', ß: 'ss', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', đ: 'd', Đ: 'd', ð: 'd', þ: 'th', ı: 'i', ħ: 'h' };

/** Accent/punctuation-insensitive comparison form. "Félix Auger-Aliassime" -> "felix auger aliassime". */
export function normalizeName(name) {
  return String(name || '')
    .replace(/[øØłŁßæÆœŒđĐðþıħ]/g, (c) => FOLD[c])
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[-‐‑–—.,_/]/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Alias keys a feed spelling may take. Feeds print "SINNER J.", "J. Sinner", "Sinner, Jannik".
 * These keys only ever NARROW candidates for human/deterministic review — they never resolve alone.
 */
export function aliasKeys({ first_name, last_name, display_name }) {
  const keys = new Set();
  const f = normalizeName(first_name);
  const l = normalizeName(last_name);
  if (f && l) {
    keys.add(`${f} ${l}`);
    keys.add(`${l} ${f}`);
    keys.add(`${l} ${f[0]}`);
    keys.add(`${f[0]} ${l}`);
  }
  if (display_name) keys.add(normalizeName(display_name));
  return [...keys].filter(Boolean);
}

/** Parse "Sinner, Jannik" / "SINNER J." / "J. Sinner" into a lookup key form. */
export function feedNameKey(raw) {
  const s = String(raw || '').trim();
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((x) => x.trim());
    return normalizeName(`${last} ${first}`);
  }
  return normalizeName(s);
}

export function externalKey(provider, id) {
  if (!provider || id === undefined || id === null || String(id).trim() === '') throw new Error('external id requires provider + id');
  return `${String(provider).toLowerCase()}:${String(id).trim().toUpperCase()}`;
}

/**
 * Resolve one source-side identity against a crosswalk index.
 * index = { byExternal: Map(externalKey -> pbe_player_id), players: [{ pbe_player_id, full_name, dob, nationality }] }
 * candidate = { provider, provider_id, full_name, dob?, nationality? }
 */
export function resolveIdentity(candidate, index) {
  if (candidate.provider && candidate.provider_id) {
    const hit = index.byExternal.get(externalKey(candidate.provider, candidate.provider_id));
    if (hit) return { status: 'resolved', pbe_player_id: hit, method: 'external_id', evidence: [externalKey(candidate.provider, candidate.provider_id)] };
  }
  const name = normalizeName(candidate.full_name);
  const sameName = index.players.filter((p) => normalizeName(p.full_name) === name);
  if (!sameName.length) return { status: 'unresolved', reason: 'no_candidate', candidates: [] };
  if (!candidate.dob) return { status: 'unresolved', reason: 'name_only_is_not_identity', candidates: sameName.map((p) => p.pbe_player_id) };
  const dobMatch = sameName.filter((p) => p.dob === candidate.dob);
  const natOk = dobMatch.filter((p) => !p.nationality || !candidate.nationality || p.nationality === candidate.nationality);
  if (natOk.length === 1) {
    return { status: 'resolved', pbe_player_id: natOk[0].pbe_player_id, method: 'name_dob', evidence: [`name:${name}`, `dob:${candidate.dob}`, ...(candidate.nationality ? [`nat:${candidate.nationality}`] : [])] };
  }
  if (natOk.length > 1) return { status: 'ambiguous', reason: 'multiple_name_dob_matches', candidates: natOk.map((p) => p.pbe_player_id) };
  return { status: 'unresolved', reason: dobMatch.length ? 'nationality_conflict' : 'dob_conflict', candidates: sameName.map((p) => p.pbe_player_id) };
}

// ---- deterministic UUIDv5 (RFC 9562) ------------------------------------------------------------
// A player's UUID is minted once from the FOUNDING external id (e.g. "wta:320760"), so the graph is
// rebuildable from the raw archive. Later crosswalk ids attach to that UUID; merges keep the survivor.

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  return Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
}

export async function uuidv5(name, namespace = PBE_TENNIS_NAMESPACE) {
  const ns = uuidToBytes(namespace);
  const nm = new TextEncoder().encode(name);
  const buf = new Uint8Array(ns.length + nm.length);
  buf.set(ns);
  buf.set(nm, ns.length);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', buf)).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const mintPlayerId = (provider, providerId) => uuidv5(`player:${externalKey(provider, providerId)}`);
