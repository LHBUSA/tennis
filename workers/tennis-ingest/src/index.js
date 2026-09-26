// tennis-ingest — source acquisition runtime. docs/ARCHITECTURE.md §Ingest.
//
// Today it runs the read-only canary set from Cloudflare egress (which can differ from a workstation's)
// and archives every payload content-addressed to R2 when TENNIS_SOURCE is bound. It writes NO canonical
// rows: production ingestion of rights-restricted sources waits on the owner decision in
// docs/TENNIS_SOURCE_MATRIX.md. No cron trigger is configured; runs are manual (POST /v1/runs) until then.

import { json, notConfigured } from '../../shared/envelope.js';
import { health } from '../../shared/health.js';
import { SourceClient } from '../../shared/http.js';
import { runIsolated } from '../../shared/adapter.js';
import { archiveCapture } from '../../shared/archive.js';
import * as wta from '../../providers/wta.js';
import * as slams from '../../providers/slams.js';
import * as open from '../../providers/open.js';

export const VERSION = '0.1.0';

const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);

/** The Worker-side canary plan: small, bounded, one request per adapter. */
export function canaryPlan() {
  return [
    [wta.rankingsSingles, { pageSize: 5 }],
    [wta.rankingsDoubles, { pageSize: 5 }],
    [wta.calendar, { from: day(-7), to: day(21) }],
    [slams.wimbledonDraw, { year: 2025, eventCode: 'MS' }],
    [slams.ausopenDay, { year: 2026, day: 1 }],
    [open.wikidataCrosswalk, { limit: 5 }]
  ].map(([a, params]) => ({ ...a, request: () => a.request(params) }));
}

async function run(env) {
  const started = new Date().toISOString();
  const client = new SourceClient({ policies: { [wta.WTA_HOST]: wta.WTA_POLICY } });
  const archive = env.TENNIS_SOURCE
    ? ({ adapter, result }) => archiveCapture({ bucket: env.TENNIS_SOURCE, family: adapter.family, adapter: adapter.key, parserVersion: adapter.parser_version, result })
    : null;
  const results = await runIsolated(canaryPlan(), { client, archive }, { timeoutMs: 90000 });
  const summary = {
    worker: 'tennis-ingest',
    started_at: started,
    finished_at: new Date().toISOString(),
    egress: 'cloudflare',
    archived: !!archive,
    results: results.map((r) => ({ key: r.key, state: r.state, http_status: r.http_status ?? null, records: r.record_count ?? null, error: r.error ?? null, capture_id: r.capture?.capture_id ?? null }))
  };
  if (env.TENNIS_STATE) {
    await env.TENNIS_STATE.put('tennis-ingest:last_run', JSON.stringify(summary));
    await env.TENNIS_STATE.put(`tennis-ingest:run:${started}`, JSON.stringify(summary), { expirationTtl: 60 * 86400 });
  }
  return summary;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/health' || path === '/') return json(await health({ worker: 'tennis-ingest', version: VERSION, env, deps: ['TENNIS_STATE', 'TENNIS_SOURCE', 'INGEST_ADMIN_TOKEN'], extra: { mode: 'canary_only', canonical_writes: false } }), { headers: { 'cache-control': 'no-store' } });
    if (path === '/v1/runs' && request.method === 'GET') {
      if (!env.TENNIS_STATE) return json(notConfigured('tennis-ingest run ledger', ['TENNIS_STATE KV not bound']));
      return json({ ok: true, data: await env.TENNIS_STATE.get('tennis-ingest:last_run', 'json'), meta: { semantics: 'most recent canary run from Cloudflare egress' } }, { headers: { 'cache-control': 'no-store' } });
    }
    if (path === '/v1/runs' && request.method === 'POST') {
      const auth = request.headers.get('authorization') || '';
      if (!env.INGEST_ADMIN_TOKEN || auth !== `Bearer ${env.INGEST_ADMIN_TOKEN}`) return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      return json({ ok: true, data: await run(env) }, { headers: { 'cache-control': 'no-store' } });
    }
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env));
  }
};
