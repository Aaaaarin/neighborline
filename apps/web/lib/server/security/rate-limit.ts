/**
 * In-memory token buckets (QA P1-7, P2-18). One process serves the hosted demo, so a per-process
 * limiter is honest protection against one visitor or one IP burning the live-model budget or
 * flooding intake; it is not a distributed limiter (documented in THREAT_MODEL R9).
 *
 * Every limited call spends one token from up to three buckets: per IP, per visitor (cookie) and, for
 * live AI, one global bucket. Any empty bucket refuses with 429 + Retry-After.
 */
import { HttpError } from '../errors';

export interface BucketSpec {
  /** Burst size. */
  capacity: number;
  /** Seconds to earn one token back. */
  refillSeconds: number;
}

/**
 * Limits per class. "ai" is charged on top of "intake" when AI_MODE=live (every transcription,
 * extraction, translation or policy draft costs real money).
 */
export const LIMITS = {
  intake: { ip: { capacity: 30, refillSeconds: 20 }, visitor: { capacity: 15, refillSeconds: 30 } },
  ai: { ip: { capacity: 12, refillSeconds: 60 }, visitor: { capacity: 8, refillSeconds: 90 }, global: { capacity: 400, refillSeconds: 9 } },
  demo: { ip: { capacity: 20, refillSeconds: 10 }, visitor: { capacity: 12, refillSeconds: 15 } },
  approve: { ip: { capacity: 60, refillSeconds: 2 }, visitor: { capacity: 40, refillSeconds: 3 } },
  passkey: { ip: { capacity: 20, refillSeconds: 15 }, visitor: { capacity: 15, refillSeconds: 20 } },
  reconcile: { ip: { capacity: 4, refillSeconds: 60 } },
  donate: { ip: { capacity: 20, refillSeconds: 15 } },
} satisfies Record<string, { ip?: BucketSpec; visitor?: BucketSpec; global?: BucketSpec }>;

export type LimitClass = keyof typeof LIMITS;

interface Bucket {
  tokens: number;
  at: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  /** Spend one token; returns seconds to wait when empty (0 = allowed, token spent). */
  take(key: string, spec: BucketSpec): number {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.evict(t);
      b = { tokens: spec.capacity, at: t };
      this.buckets.set(key, b);
    }
    const earned = ((t - b.at) / 1000) / spec.refillSeconds;
    b.tokens = Math.min(spec.capacity, b.tokens + earned);
    b.at = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - b.tokens) * spec.refillSeconds);
  }

  /** Check several buckets; spends from all only if every one has a token. */
  takeAll(entries: Array<[string, BucketSpec]>): number {
    const t = this.now();
    let wait = 0;
    for (const [key, spec] of entries) {
      const b = this.buckets.get(key);
      const tokens = b ? Math.min(spec.capacity, b.tokens + ((t - b.at) / 1000) / spec.refillSeconds) : spec.capacity;
      if (tokens < 1) wait = Math.max(wait, Math.ceil((1 - tokens) * spec.refillSeconds));
    }
    if (wait) return wait;
    for (const [key, spec] of entries) this.take(key, spec);
    return 0;
  }

  private evict(t: number) {
    // Drop the stalest quarter; full buckets carry no information anyway.
    const entries = [...this.buckets.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of entries.slice(0, Math.ceil(entries.length / 4))) this.buckets.delete(k);
    void t;
  }

  reset() {
    this.buckets.clear();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __neighborlineLimiter: RateLimiter | undefined;
}

export const limiter = (): RateLimiter => (globalThis.__neighborlineLimiter ??= new RateLimiter());

export class RateLimitError extends HttpError {
  readonly headers: Record<string, string>;
  constructor(readonly retryAfterSeconds: number) {
    super(429, `Too many requests from this device. Try again in ${retryAfterSeconds} s.`);
    this.headers = { 'retry-after': String(retryAfterSeconds) };
  }
}

/**
 * The client IP. Behind Render's proxy the LAST X-Forwarded-For entry is the address Render saw
 * (earlier entries are whatever the client claimed); TRUST_PROXY_HOPS (default 1) says how many
 * proxies to trust. With no header (local dev, tests) everyone is 'local'.
 */
export function clientIp(req: Request, env: Record<string, string | undefined> = process.env): string {
  const xff = req.headers.get('x-forwarded-for');
  if (!xff) return req.headers.get('x-real-ip') ?? 'local';
  const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
  const hops = Math.max(1, Number(env.TRUST_PROXY_HOPS) || 1);
  return parts[Math.max(0, parts.length - hops)] ?? 'local';
}

/** Throws RateLimitError when any bucket for this caller is empty. RATE_LIMITS=off disables (tests, e2e). */
export function enforceLimit(req: Request, cls: LimitClass, opts: { visitorTag?: string | null; env?: Record<string, string | undefined> } = {}): void {
  const env = opts.env ?? process.env;
  if ((env.RATE_LIMITS ?? '').toLowerCase() === 'off') return;
  const spec = LIMITS[cls] as { ip?: BucketSpec; visitor?: BucketSpec; global?: BucketSpec };
  const entries: Array<[string, BucketSpec]> = [];
  if (spec.ip) entries.push([`${cls}:ip:${clientIp(req, env)}`, spec.ip]);
  if (spec.visitor && opts.visitorTag) entries.push([`${cls}:v:${opts.visitorTag}`, spec.visitor]);
  if (spec.global) entries.push([`${cls}:global`, spec.global]);
  const wait = limiter().takeAll(entries);
  if (wait) throw new RateLimitError(wait);
}
