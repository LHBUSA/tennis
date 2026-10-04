// ATP recalibration study (docs/research/ATP_RECALIBRATION_PROTOCOL.md): the holdout guard. Study code reads ATP
// entries ONLY through developmentEntries(); the holdout (2023-01-01 .. data end) opens only with a committed frozen
// config, an explicit --holdout flag, and once.
import fs from 'node:fs';
import crypto from 'node:crypto';

export const HOLDOUT_FROM = '2023-01-01';
export const FROZEN = 'docs/evidence/atp-recal/frozen.json';
export const MARKER = 'docs/evidence/atp-recal/holdout-opened.json';

/** Development entries only; throws if any holdout-dated entry would be returned. */
export function developmentEntries(entries) {
  const dev = entries.filter((e) => e.day < HOLDOUT_FROM);
  for (const e of dev) if (!(e.day < HOLDOUT_FROM)) throw new Error('holdout leak');
  return dev;
}

/** The holdout, once: needs --holdout, a frozen config whose sha256 is committed in it, and no prior opening. */
export function openHoldout(entries, { argv = process.argv, readFile = fs.readFileSync, exists = fs.existsSync, writeFile = fs.writeFileSync, now = new Date().toISOString() } = {}) {
  if (!argv.includes('--holdout')) throw new Error('holdout is closed: pass --holdout after the method is frozen and the owner approved');
  if (!exists(FROZEN)) throw new Error(`holdout is closed: ${FROZEN} (frozen method, coefficients, tau) is not committed`);
  if (exists(MARKER)) throw new Error('holdout was already evaluated once; a re-run is a new protocol version');
  const frozen = readFile(FROZEN, 'utf8');
  const sha256 = crypto.createHash('sha256').update(frozen).digest('hex');
  writeFile(MARKER, JSON.stringify({ opened_at: now, frozen_sha256: sha256 }, null, 1));
  return { frozen: JSON.parse(frozen), sha256, holdout: entries.filter((e) => e.day >= HOLDOUT_FROM) };
}
