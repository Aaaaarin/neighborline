import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { DbHandle } from './client.js';
import { rowsOf } from './migrate.js';
import { deleteExpiredRateLimitBuckets, takeRateLimitTokens } from './repo/rate-limits.js';
import { freshDb } from './test-db.js';

let h: DbHandle;
beforeAll(async () => {
  h = await freshDb();
});
afterAll(async () => h.close());

const T0 = Date.parse('2026-10-17T12:00:00Z');
const at = (ms: number) => new Date(T0 + ms);
const one = (key: string, capacity = 2, refillSeconds = 60) => ({ key, capacity, refillSeconds });

describe('shared token buckets', () => {
  it('starts full, spends one per take, then refuses with the seconds until the next token', async () => {
    expect(await takeRateLimitTokens(h.db, [one('a')], at(0))).toBe(0);
    expect(await takeRateLimitTokens(h.db, [one('a')], at(0))).toBe(0);
    expect(await takeRateLimitTokens(h.db, [one('a')], at(0))).toBe(60);
    expect(await takeRateLimitTokens(h.db, [one('a')], at(30_000))).toBe(30);
    expect(await takeRateLimitTokens(h.db, [one('a')], at(60_000))).toBe(0);
  });

  it('refills over time but never above capacity', async () => {
    expect(await takeRateLimitTokens(h.db, [one('cap')], at(0))).toBe(0);
    // A day later the bucket holds capacity (2), not 1 + 1440.
    expect(await takeRateLimitTokens(h.db, [one('cap')], at(86_400_000))).toBe(0);
    expect(await takeRateLimitTokens(h.db, [one('cap')], at(86_400_000))).toBe(0);
    expect(await takeRateLimitTokens(h.db, [one('cap')], at(86_400_000))).toBeGreaterThan(0);
  });

  it('a clock that goes backwards earns nothing', async () => {
    expect(await takeRateLimitTokens(h.db, [one('skew', 1)], at(100_000))).toBe(0);
    expect(await takeRateLimitTokens(h.db, [one('skew', 1)], at(0))).toBeGreaterThan(0);
  });

  it('is all-or-nothing across buckets: a refused call spends from none', async () => {
    expect(await takeRateLimitTokens(h.db, [one('x', 1), one('y', 1)], at(0))).toBe(0);
    expect(await takeRateLimitTokens(h.db, [one('x', 1), one('z', 1)], at(0))).toBe(60);
    expect(await takeRateLimitTokens(h.db, [one('z', 1)], at(0))).toBe(0); // z was not spent by the refused call
  });

  it('a duplicated key counts once', async () => {
    expect(await takeRateLimitTokens(h.db, [one('dup', 1), one('dup', 1)], at(0))).toBe(0);
  });

  it('parallel takes never spend more than the bucket holds', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => takeRateLimitTokens(h.db, [one('par', 5, 600), one('par:global', 100, 1)], at(0))));
    expect(results.filter((w) => w === 0)).toHaveLength(5);
    expect(results.filter((w) => w > 0)).toHaveLength(20);
  });

  it('a single-use marker (capacity 1) passes once', async () => {
    const marker = { key: 'human:pow:abc', capacity: 1, refillSeconds: 3600 };
    const results = await Promise.all([0, 1, 2].map(() => takeRateLimitTokens(h.db, [marker], at(0))));
    expect(results.filter((w) => w === 0)).toHaveLength(1);
  });

  it('the TTL sweep deletes only buckets that would be full again', async () => {
    await takeRateLimitTokens(h.db, [one('ttl:short', 1, 1)], at(0));
    await takeRateLimitTokens(h.db, [one('ttl:long', 1, 3600)], at(0));
    const removed = await deleteExpiredRateLimitBuckets(h.db, at(10_000));
    expect(removed).toBeGreaterThanOrEqual(1);
    const keys = rowsOf<{ key: string }>(await h.db.execute(sql`SELECT key FROM rate_limit_buckets WHERE key LIKE 'ttl:%'`)).map((r) => r.key);
    expect(keys).toEqual(['ttl:long']);
  });

  it('rejects malformed specs', async () => {
    await expect(takeRateLimitTokens(h.db, [{ key: '', capacity: 1, refillSeconds: 1 }])).rejects.toThrow();
    await expect(takeRateLimitTokens(h.db, [{ key: 'k', capacity: 0, refillSeconds: 1 }])).rejects.toThrow();
    await expect(takeRateLimitTokens(h.db, [{ key: 'k', capacity: 1, refillSeconds: 0 }])).rejects.toThrow();
    expect(await takeRateLimitTokens(h.db, [])).toBe(0);
  });
});
