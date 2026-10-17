/**
 * Token buckets (QA P1-7, P2-18; THREAT_MODEL R9).
 *
 * Every limited call spends one token from up to three buckets: per IP, per visitor (cookie) and, for
 * live AI, one global bucket. Any empty bucket refuses with 429 + Retry-After.
 *
 * Where the buckets live: when the engine runs on a shared database (DATABASE_URL, or an on-disk
 * PGlite), `limiter()` keeps them in Postgres (`rate_limit_buckets`, one locking UPSERT per call,
 * @neighborline/db repo/rate-limits.ts), so every web instance and every restart spends from the same
 * budget. Without one (in-memory PGlite, ENGINE=mock, `next build`) or if the database errors, the
 * same buckets live in this process's memory. Keys are HMAC'd before they are stored, so the table
 * holds no IP addresses or phone numbers. RATE_LIMIT_STORE=memory forces the in-process store.
 */
import { deleteExpiredRateLimitBuckets, takeRateLimitTokens, type Executor } from '@neighborline/db';
import { HttpError } from '../errors';
import { errorText, log } from '../log';
import { hmac, sessionSecret } from '../passkeys/secret';

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
  /** Human-check challenges and proofs (cheap to issue; a proof costs the server 32 hashes). */
  human: { ip: { capacity: 30, refillSeconds: 10 }, visitor: { capacity: 12, refillSeconds: 20 } },
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

/** Anything that can spend from several buckets at once (the shared limiter, or a bare RateLimiter in tests). */
export interface TokenLimiter {
  takeAll(entries: Array<[string, BucketSpec]>): number | Promise<number>;
}

const SWEEP_EVERY_MS = 10 * 60_000;

/**
 * The process-wide limiter: Postgres when a shared database is attached, memory otherwise (and as the
 * fallback when the database errors, so a database hiccup degrades to per-process limits, never to none).
 */
export class SharedRateLimiter implements TokenLimiter {
  readonly memory: RateLimiter;
  private db: Executor | null = null;
  private lastSweep = 0;
  private warned = false;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly secret: () => Buffer = () => sessionSecret(),
  ) {
    this.memory = new RateLimiter(now);
  }

  /** Use this database for the buckets (null: back to memory). The engine calls it per database generation. */
  attach(db: Executor | null): void {
    this.db = db;
  }

  get store(): 'postgres' | 'memory' {
    return this.db ? 'postgres' : 'memory';
  }

  /** `ai:ip:1.2.3.4` → `ai:ip:<hmac>`: readable class, no personal data at rest. */
  storeKey(key: string): string {
    const prefix = key.split(':').slice(0, 2).join(':');
    return `${prefix}:${hmac(this.secret(), `neighborline/rate-limit/v1\n${key}`).slice(0, 32)}`;
  }

  async takeAll(entries: Array<[string, BucketSpec]>): Promise<number> {
    const db = this.db;
    if (!db) return this.memory.takeAll(entries);
    try {
      const wait = await takeRateLimitTokens(
        db,
        entries.map(([key, spec]) => ({ key: this.storeKey(key), capacity: spec.capacity, refillSeconds: spec.refillSeconds })),
        new Date(this.now()),
      );
      this.sweep(db);
      return wait;
    } catch (err) {
      if (!this.warned) log.warn('rate_limit.store_failed', { error: errorText(err), fallback: 'memory' });
      this.warned = true;
      return this.memory.takeAll(entries);
    }
  }

  /** Drop buckets that would be full again, at most every 10 minutes per process, off the request path. */
  private sweep(db: Executor): void {
    const t = this.now();
    if (t - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = t;
    void deleteExpiredRateLimitBuckets(db, new Date(t)).catch(() => {});
  }

  /** Tests: forget this process's buckets (the database rows are the database's). */
  reset() {
    this.memory.reset();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __neighborlineLimiter: SharedRateLimiter | undefined;
}

export const limiter = (): SharedRateLimiter => (globalThis.__neighborlineLimiter ??= new SharedRateLimiter());

/** RATE_LIMIT_STORE=memory keeps buckets in this process even with a shared database (default: auto). */
export const sharedStoreAllowed = (env: Record<string, string | undefined> = process.env): boolean => (env.RATE_LIMIT_STORE ?? 'auto').trim().toLowerCase() !== 'memory';

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
export async function enforceLimit(
  req: Request,
  cls: LimitClass,
  opts: { visitorTag?: string | null; env?: Record<string, string | undefined>; limiter?: TokenLimiter } = {},
): Promise<void> {
  const env = opts.env ?? process.env;
  if ((env.RATE_LIMITS ?? '').toLowerCase() === 'off') return;
  const spec = LIMITS[cls] as { ip?: BucketSpec; visitor?: BucketSpec; global?: BucketSpec };
  const entries: Array<[string, BucketSpec]> = [];
  if (spec.ip) entries.push([`${cls}:ip:${clientIp(req, env)}`, spec.ip]);
  if (spec.visitor && opts.visitorTag) entries.push([`${cls}:v:${opts.visitorTag}`, spec.visitor]);
  if (spec.global) entries.push([`${cls}:global`, spec.global]);
  const wait = await (opts.limiter ?? limiter()).takeAll(entries);
  if (wait) throw new RateLimitError(wait);
}
