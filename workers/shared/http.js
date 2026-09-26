// Polite source client. Every adapter fetches through this — never raw fetch().
// docs/SOURCE_HYGIENE.md: per-host rate limit + concurrency, jitter, exponential backoff that honours
// Retry-After, conditional requests (ETag / Last-Modified), timeouts, and an honest User-Agent.
// It does NOT rotate identities, spoof browsers or retry through access-control challenges: a 403 or
// a challenge page is recorded as BLOCKED and the adapter degrades.

export const USER_AGENT = 'PropBetEdge-Tennis/0.1 (+https://tennis.propbetedge.ai/sources)';

const DEFAULT_POLICY = Object.freeze({ min_interval_ms: 1000, max_concurrency: 1, jitter_ms: 250, retries: 2, backoff_ms: 2000, timeout_ms: 15000 });

export class SourceBlockedError extends Error {
  constructor(url, status, why) {
    super(`blocked ${status} ${why} ${url}`);
    this.code = 'source_blocked';
    this.status = status;
  }
}

const CHALLENGE = [/cf-chl-/i, /challenge-platform/i, /_Incapsula_Resource/i, /Attention Required! \| Cloudflare/i, /px-captcha/i, /Access Denied.*akamai/is];

function secureJitter(maxMs) {
  if (!maxMs) return 0;
  const b = new Uint32Array(1);
  globalThis.crypto.getRandomValues(b);
  return b[0] % (maxMs + 1);
}

export class SourceClient {
  /**
   * @param {object} o
   * @param {Record<string, object>} [o.policies] host -> policy overrides
   * @param {typeof fetch} [o.fetch]
   * @param {(ms:number)=>Promise<void>} [o.sleep]
   * @param {()=>number} [o.now]
   */
  constructor({ policies = {}, fetch: f = (...a) => globalThis.fetch(...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), jitter = secureJitter } = {}) {
    this.policies = policies;
    this.fetch = f;
    this.sleep = sleep;
    this.now = now;
    this.jitter = jitter;
    this.hosts = new Map(); // host -> { next_at, active, queue }
    this.validators = new Map(); // url -> { etag, last_modified, body, content_type }
    this.stats = { requests: 0, not_modified: 0, retries: 0, blocked: 0 };
  }

  policy(host) {
    return { ...DEFAULT_POLICY, ...(this.policies[host] || {}) };
  }

  async slot(host) {
    const p = this.policy(host);
    let h = this.hosts.get(host);
    if (!h) { h = { next_at: 0, active: 0, waiters: [] }; this.hosts.set(host, h); }
    while (h.active >= p.max_concurrency) await new Promise((r) => h.waiters.push(r));
    h.active += 1;
    const wait = h.next_at - this.now();
    h.next_at = Math.max(this.now(), h.next_at) + p.min_interval_ms + this.jitter(p.jitter_ms);
    if (wait > 0) await this.sleep(wait);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      h.active -= 1;
      const w = h.waiters.shift();
      if (w) w();
    };
  }

  /**
   * GET with hygiene. Returns { url, status, ok, not_modified, content_type, etag, last_modified,
   * body (string), bytes, latency_ms, fetched_at, attempts }.
   */
  async get(url, { headers = {}, conditional = true } = {}) {
    const host = new URL(url).host;
    const p = this.policy(host);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const release = await this.slot(host);
      const started = this.now();
      let res;
      try {
        const h = { 'user-agent': USER_AGENT, accept: 'application/json, text/html;q=0.9, */*;q=0.5', ...headers };
        const v = conditional ? this.validators.get(url) : null;
        if (v?.etag) h['if-none-match'] = v.etag;
        if (v?.last_modified) h['if-modified-since'] = v.last_modified;
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), p.timeout_ms);
        try {
          const call = this.fetch; // detached: Workers reject fetch invoked with a foreign `this`
          res = await call(url, { headers: h, signal: ctl.signal, redirect: 'follow' });
        } finally {
          clearTimeout(timer);
        }
        this.stats.requests += 1;
        const latency = this.now() - started;
        if (res.status === 304 && v) {
          this.stats.not_modified += 1;
          return { url, status: 304, ok: true, not_modified: true, content_type: v.content_type, etag: v.etag, last_modified: v.last_modified, body: v.body, bytes: v.body.length, latency_ms: latency, fetched_at: new Date(this.now()).toISOString(), attempts: attempt };
        }
        const body = await res.text();
        const ct = res.headers.get('content-type') || '';
        if (res.status === 403 || CHALLENGE.some((re) => re.test(body.slice(0, 20000)))) {
          this.stats.blocked += 1;
          throw new SourceBlockedError(url, res.status, res.status === 403 ? 'forbidden' : 'challenge_page');
        }
        if ((res.status === 429 || res.status >= 500) && attempt <= p.retries) {
          this.stats.retries += 1;
          const ra = Number(res.headers.get('retry-after'));
          const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : p.backoff_ms * 2 ** (attempt - 1) + this.jitter(p.jitter_ms);
          release();
          await this.sleep(backoff);
          continue;
        }
        const etag = res.headers.get('etag');
        const lm = res.headers.get('last-modified');
        if (res.ok && (etag || lm)) this.validators.set(url, { etag, last_modified: lm, body, content_type: ct });
        return { url, status: res.status, ok: res.ok, not_modified: false, content_type: ct, etag, last_modified: lm, body, bytes: body.length, latency_ms: latency, fetched_at: new Date(this.now()).toISOString(), attempts: attempt };
      } catch (err) {
        if (err instanceof SourceBlockedError) throw err;
        if (attempt <= p.retries) {
          this.stats.retries += 1;
          release();
          await this.sleep(p.backoff_ms * 2 ** (attempt - 1) + this.jitter(p.jitter_ms));
          continue;
        }
        throw err;
      } finally {
        release(); // idempotent: the retry paths above release before sleeping
      }
    }
  }
}
