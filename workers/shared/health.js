// Uniform /health for every tennis Worker. Never exposes secret values — only whether a dependency
// is configured.

export function dependencyState(env, names) {
  const out = {};
  for (const n of names) out[n] = env && env[n] ? 'configured' : 'not_configured';
  return out;
}

export async function health({ worker, version, env, deps = [], extra = {} }) {
  let lastRun = null;
  if (env?.TENNIS_STATE) {
    try { lastRun = await env.TENNIS_STATE.get(`${worker}:last_run`, 'json'); } catch { lastRun = null; }
  }
  return {
    ok: true,
    worker,
    version,
    build: env?.BUILD_SHA || null,
    now: new Date().toISOString(),
    dependencies: dependencyState(env, deps),
    last_run: lastRun,
    ...extra
  };
}
