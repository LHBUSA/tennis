// R2 create-only SELF-TEST (Tennis Picks V2 ledger immutability proof on REAL R2, not a fake).
// Runs ONCE per SELFTEST_VERSION inside the existing */10 cron (scheduled.js) and stores its evidence in KV
// `picker:v2:r2-selftest:<version>`. It writes only under ledger/selftest/ — a prefix no picks reader lists — so it can
// never alter or appear in a pick record. Checks:
//   1. a conditional put (If-None-Match: *) creates a new key;
//   2. a second conditional put to the same key with DIFFERENT bytes is refused (returns null) and the stored bytes
//      and etag are unchanged;
//   3. five concurrent conditional puts to one fresh key: exactly one succeeds, the stored bytes are that writer's;
//   4. the ledger's createOnly() (head check + conditional put) returns true once, then false.
import { createOnly } from './picker-v2-atp.js';

export const SELFTEST_VERSION = 'r2-create-only/1';
export const SELFTEST_PREFIX = 'ledger/selftest/create-only/';
const COND = () => ({ httpMetadata: { contentType: 'application/json' }, onlyIf: new Headers({ 'if-none-match': '*' }) });

export async function r2CreateOnlySelftest(bucket, { now = new Date().toISOString(), nonce = crypto.randomUUID() } = {}) {
  const base = `${SELFTEST_PREFIX}${now.replace(/[:.]/g, '-')}-${nonce.slice(0, 8)}/`;
  const out = { schema: SELFTEST_VERSION, at: now, prefix: base, checks: {}, pass: false };
  // 1 + 2
  const k1 = `${base}single.json`;
  const b1 = JSON.stringify({ writer: 'first', at: now });
  const first = await bucket.put(k1, b1, COND());
  const h1 = await bucket.head(k1);
  let second, secondError = null;
  try { second = await bucket.put(k1, JSON.stringify({ writer: 'second-overwrite-attempt' }), COND()); } catch (e) { secondError = String(e?.message || e); }
  const h2 = await bucket.head(k1);
  const body2 = await (await bucket.get(k1))?.text();
  out.checks.create = { key: k1, created: first != null, etag: h1?.etag ?? null };
  out.checks.second_write_refused = { returned_null: second === null, threw: secondError, etag_after: h2?.etag ?? null, etag_unchanged: !!h1 && h1.etag === h2?.etag, bytes_unchanged: body2 === b1 };
  // 3: concurrent duplicate execution
  const k2 = `${base}concurrent.json`;
  const bodies = [0, 1, 2, 3, 4].map((i) => JSON.stringify({ writer: i, at: now }));
  const res = await Promise.all(bodies.map((b) => bucket.put(k2, b, COND()).catch((e) => ({ error: String(e?.message || e) }))));
  const winners = res.map((r, i) => (r && !r.error ? i : null)).filter((i) => i !== null);
  const stored = await (await bucket.get(k2))?.text();
  out.checks.concurrent = { key: k2, attempts: 5, succeeded: winners.length, errors: res.filter((r) => r?.error).length, stored_is_winner: winners.length === 1 && stored === bodies[winners[0]] };
  // 4: the ledger helper
  const k3 = `${base}ledger-helper.json`;
  const c1 = await createOnly(bucket, k3, { n: 1 });
  const c2 = await createOnly(bucket, k3, { n: 2 });
  const s3 = await (await bucket.get(k3))?.text();
  out.checks.create_only_helper = { key: k3, first: c1, second: c2, bytes_unchanged: s3 === JSON.stringify({ n: 1 }) };
  const c = out.checks;
  out.pass = c.create.created && c.second_write_refused.returned_null && c.second_write_refused.etag_unchanged && c.second_write_refused.bytes_unchanged
    && c.concurrent.succeeded === 1 && c.concurrent.stored_is_winner && c.create_only_helper.first === true && c.create_only_helper.second === false && c.create_only_helper.bytes_unchanged;
  return out;
}
