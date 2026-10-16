/** Retry policy: pure functions so they can be unit-tested without timers. */

export interface RetryPolicy {
  /** Retries after the first attempt. */
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxRetries: 3, baseDelayMs: 300, maxDelayMs: 8_000 };

/** Only throttling and server errors are retried. 4xx (validation, business, duplicates) never are. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Network errors/timeouts are ambiguous (the request may have landed). Replaying is only safe when PayPal can
 * dedupe it: GET, or a write that carries a `PayPal-Request-Id`.
 */
export function isSafeToReplay(method: string, hasRequestId: boolean): boolean {
  return method === 'GET' || hasRequestId;
}

/** "Full jitter" exponential backoff: uniform in [0, min(max, base·2^attempt)]. `attempt` is 0-based. */
export function backoffDelayMs(attempt: number, policy: RetryPolicy, random: () => number = Math.random): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

/** `Retry-After` (seconds or HTTP date) → ms, capped. Undefined when absent/unparseable. */
export function retryAfterMs(header: string | null, now = Date.now(), capMs = 30_000): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.min(capMs, Math.max(0, secs * 1000));
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(capMs, Math.max(0, at - now)) : undefined;
}
