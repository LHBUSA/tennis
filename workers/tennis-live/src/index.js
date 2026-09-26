// tennis-live — Live match state runtime (TennisCast). Owns active-match cadence and the normalized live/replay event stream.
// Skeleton: /health and an empty run ledger only. It does no work until its inputs exist
// (no live source adapter is in production yet; TennisCast is off); see docs/STATUS.md.

import { json, notConfigured } from '../../shared/envelope.js';
import { health } from '../../shared/health.js';

export const VERSION = '0.1.0';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/health' || path === '/') return json(await health({ worker: 'tennis-live', version: VERSION, env, deps: ['TENNIS_STATE', 'TENNIS_SOURCE'], extra: { active: false, reason: 'no live source adapter is in production yet; TennisCast is off' } }), { headers: { 'cache-control': 'no-store' } });
    if (path === '/v1/live/runs') return json(notConfigured('tennis-live run ledger', ['no live source adapter is in production yet; TennisCast is off']));
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  }
};
