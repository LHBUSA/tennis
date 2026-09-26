// Raw source evidence archive. Content-addressed so identical payloads are stored once and every
// normalized/derived record can point back to the exact bytes it came from. docs/ARCHITECTURE.md §Raw.
//
// R2 layout:
//   tennis-source/<family>/sha256/<aa>/<sha256>          immutable payload (put once, never overwritten)
//   tennis-source/<family>/captures/<yyyy-mm-dd>/<capture_id>.json   capture record (one per request)

export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const FAMILY = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function payloadKey(family, hash) {
  if (!FAMILY.test(family)) throw new Error(`invalid source family ${family}`);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('invalid sha256');
  return `tennis-source/${family}/sha256/${hash.slice(0, 2)}/${hash}`;
}

/** Canonical request identity: method + URL with sorted query params (so param order never splits history). */
export function requestIdentity(method, url) {
  const u = new URL(url);
  const params = [...u.searchParams.entries()].sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1));
  u.search = '';
  for (const [k, v] of params) u.searchParams.append(k, v);
  return `${method.toUpperCase()} ${u.toString()}`;
}

/**
 * Build the capture record for one fetch result (from SourceClient.get) and, when an R2 bucket is
 * bound, persist payload + record. Without a bucket it returns the record only (dry/local runs).
 */
export async function archiveCapture({ bucket = null, family, adapter, parserVersion, normalizationVersion = null, result, sourceTimestamp = null }) {
  const hash = await sha256Hex(result.body ?? '');
  const key = payloadKey(family, hash);
  const identity = requestIdentity('GET', result.url);
  const captureId = (await sha256Hex(`${identity}|${result.fetched_at}`)).slice(0, 24);
  const record = {
    capture_id: captureId,
    source_family: family,
    adapter,
    request_identity: identity,
    url: result.url,
    captured_at: result.fetched_at,
    http: { status: result.status, content_type: result.content_type, etag: result.etag || null, last_modified: result.last_modified || null, not_modified: !!result.not_modified, latency_ms: result.latency_ms },
    source_timestamp: sourceTimestamp,
    content_sha256: hash,
    bytes: result.bytes,
    payload_key: key,
    parser_version: parserVersion,
    normalization_version: normalizationVersion
  };
  if (bucket) {
    const existing = await bucket.head(key);
    if (!existing) await bucket.put(key, result.body, { httpMetadata: { contentType: result.content_type || 'application/octet-stream' }, customMetadata: { family, sha256: hash } });
    await bucket.put(`tennis-source/${family}/captures/${result.fetched_at.slice(0, 10)}/${captureId}.json`, JSON.stringify(record), { httpMetadata: { contentType: 'application/json' } });
  }
  return record;
}
