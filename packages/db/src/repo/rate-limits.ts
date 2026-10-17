/**
 * Shared token buckets (THREAT_MODEL R9): the web app's rate limits and single-use markers, kept in
 * Postgres so every web instance and every restart spends from the same budget.
 *
 * `takeRateLimitTokens` is all-or-nothing over several buckets (per IP + per visitor + global): in one
 * transaction a single UPSERT creates missing buckets full, refills existing ones from the time
 * elapsed, and row-locks them all (keys in sorted order, so two callers never deadlock on each other);
 * then, only if every bucket holds a whole token, one UPDATE spends one from each. A concurrent caller
 * on the same key waits on the row lock and then sees the spent value (READ COMMITTED re-reads the
 * latest row version for ON CONFLICT DO UPDATE), so N parallel requests can never spend more than the
 * bucket holds.
 *
 * Time comes from the caller (`now`), not from the database clock, so tests are deterministic; a
 * clock that goes backwards earns nothing (elapsed is clamped at 0) and never moves `updated_at` back.
 */
import { sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { rowsOf } from '../migrate.js';
import { inTx } from '../util.js';

export interface BucketTake {
  key: string;
  /** Burst size (whole tokens, ≥ 1). */
  capacity: number;
  /** Seconds to earn one token back. */
  refillSeconds: number;
}

const MAX_KEY = 200;

/** Buckets in a stable order, one entry per key (the first spec wins), validated. */
function normalize(entries: readonly BucketTake[]): BucketTake[] {
  const seen = new Map<string, BucketTake>();
  for (const e of entries) {
    if (!e.key || e.key.length > MAX_KEY) throw new Error('rate-limit key must be 1..200 characters');
    if (!(Number.isInteger(e.capacity) && e.capacity >= 1)) throw new Error('rate-limit capacity must be a positive integer');
    if (!(e.refillSeconds > 0)) throw new Error('rate-limit refillSeconds must be positive');
    if (!seen.has(e.key)) seen.set(e.key, e);
  }
  return [...seen.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const refillMs = (e: BucketTake) => Math.max(1, Math.round(e.refillSeconds * 1000));

/**
 * Spend one token from every bucket, or from none. Returns 0 when spent, otherwise the whole seconds
 * until every bucket has a token again (for Retry-After).
 */
export async function takeRateLimitTokens(ex: Executor, entries: readonly BucketTake[], now: Date = new Date()): Promise<number> {
  const list = normalize(entries);
  if (!list.length) return 0;
  const values = sql.join(
    list.map((e) => sql`(${e.key}::text, ${e.capacity}::int, ${refillMs(e)}::int)`),
    sql`, `,
  );
  const at = now.toISOString();
  return inTx(ex, async (tx) => {
    const rows = rowsOf<{ key: string; tokens: number | string }>(
      await tx.execute(sql`
        INSERT INTO rate_limit_buckets AS b (key, tokens, capacity, refill_ms, updated_at, expires_at)
        SELECT k, c, c, r, ${at}::timestamptz, ${at}::timestamptz + (c::bigint * r) * interval '1 millisecond'
        FROM (VALUES ${values}) AS t(k, c, r)
        ORDER BY k
        ON CONFLICT (key) DO UPDATE SET
          tokens = least(
            EXCLUDED.capacity::double precision,
            b.tokens + greatest(0, extract(epoch FROM (EXCLUDED.updated_at - b.updated_at)) * 1000) / EXCLUDED.refill_ms
          ),
          capacity = EXCLUDED.capacity,
          refill_ms = EXCLUDED.refill_ms,
          updated_at = greatest(b.updated_at, EXCLUDED.updated_at),
          expires_at = greatest(b.updated_at, EXCLUDED.updated_at) + (EXCLUDED.capacity::bigint * EXCLUDED.refill_ms) * interval '1 millisecond'
        RETURNING key, tokens`),
    );
    const tokens = new Map(rows.map((r) => [r.key, Number(r.tokens)]));
    let wait = 0;
    for (const e of list) {
      const t = tokens.get(e.key) ?? 0;
      if (t < 1) wait = Math.max(wait, Math.ceil((1 - t) * e.refillSeconds));
    }
    if (wait) return wait;
    const keys = sql.join(
      list.map((e) => sql`${e.key}`),
      sql`, `,
    );
    await tx.execute(sql`UPDATE rate_limit_buckets SET tokens = tokens - 1 WHERE key IN (${keys})`);
    return 0;
  });
}

/** TTL sweep: a bucket past `expires_at` would be full again, which is what an absent row means. */
export async function deleteExpiredRateLimitBuckets(ex: Executor, now: Date = new Date()): Promise<number> {
  const rows = rowsOf<{ key: string }>(await ex.execute(sql`DELETE FROM rate_limit_buckets WHERE expires_at < ${now.toISOString()}::timestamptz RETURNING key`));
  return rows.length;
}
