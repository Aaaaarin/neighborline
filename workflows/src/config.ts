/**
 * Runtime configuration for workflow tasks and the cron dispatcher.
 * Everything comes from env (render.yaml wires it); nothing here is secret except the HMAC key.
 */

export interface WorkflowConfig {
  /** Base URL of the Neighborline web app, without trailing slash. */
  baseUrl: string;
  /** HMAC key shared with the web app (NEIGHBORLINE_INTERNAL_SECRET). Never the approval secret. */
  internalSecret: string;
  /** Per-request timeout. Generous: a free-plan web service can take ~1 min to wake up. */
  requestTimeoutMs: number;
  /** Regenerate the donor transparency report after this many new payouts. */
  reportEveryNPayouts: number;
  /** PayPal Transaction Search visibility lag (PayPal documents up to 3h). */
  lagHours: number;
  /** How far back the nightly reconcile looks (overlapping nights re-check recent items). */
  reconcileLookbackHours: number;
  /** Size of each reconcile slice (each slice is its own retried task run). */
  reconcileSliceHours: number;
  /** Max per-item follow-up runs one sweep fans out (rest are picked up next hour). */
  maxFanout: number;
}

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} must be a positive number, got "${raw}"`);
  return n;
}

/**
 * Resolve the web app URL.
 * 1. NEIGHBORLINE_BASE_URL (explicit, e.g. https://neighborline.onrender.com) wins.
 * 2. NEIGHBORLINE_WEB_HOSTPORT (render.yaml `fromService … property: hostport`) → private network, plain HTTP.
 *    Only works when the web service is on a paid instance: free web services cannot RECEIVE private traffic.
 */
export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.NEIGHBORLINE_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const hostport = env.NEIGHBORLINE_WEB_HOSTPORT?.trim();
  if (hostport) return `http://${hostport}`;
  throw new Error('Set NEIGHBORLINE_BASE_URL (public URL) or NEIGHBORLINE_WEB_HOSTPORT (private network host:port).');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkflowConfig {
  const internalSecret = env.NEIGHBORLINE_INTERNAL_SECRET ?? '';
  if (internalSecret.length < 32) {
    throw new Error('NEIGHBORLINE_INTERNAL_SECRET must be set (>= 32 chars); render.yaml generates it in the neighborline-internal env group.');
  }
  return {
    baseUrl: resolveBaseUrl(env),
    internalSecret,
    requestTimeoutMs: num(env, 'NEIGHBORLINE_REQUEST_TIMEOUT_MS', 150_000),
    reportEveryNPayouts: num(env, 'REPORT_REFRESH_EVERY_N_PAYOUTS', 5),
    lagHours: num(env, 'PAYPAL_REPORTING_LAG_HOURS', 3),
    reconcileLookbackHours: num(env, 'RECONCILE_LOOKBACK_HOURS', 72),
    reconcileSliceHours: num(env, 'RECONCILE_SLICE_HOURS', 24),
    maxFanout: num(env, 'UNCLAIMED_MAX_FANOUT', 25),
  };
}
