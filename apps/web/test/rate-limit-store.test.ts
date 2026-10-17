/**
 * THREAT_MODEL R9: rate limits shared through the database. Two limiter instances stand in for two web
 * instances (or one instance before and after a restart) on the same database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, migrate, rowsOf, type DbHandle } from '@neighborline/db';
import { SharedRateLimiter, enforceLimit, sharedStoreAllowed } from '../lib/server/security/rate-limit';

let h: DbHandle;
beforeAll(async () => {
  h = createDb({ memory: true });
  await migrate(h.db);
});
afterAll(async () => h.close());

const secret = () => Buffer.alloc(32, 3);
const req = (ip: string) => new Request('http://x/api/intake/a/text', { method: 'POST', headers: { 'x-forwarded-for': ip } });
const instance = (now: () => number = () => 0) => {
  const l = new SharedRateLimiter(now, secret);
  l.attach(h.db);
  return l;
};
const outcome = (p: Promise<void>) => p.then(() => 'ok' as const, (e: { status?: number }) => (e.status === 429 ? ('429' as const) : Promise.reject(e)));

describe('shared rate-limit store (Postgres token buckets)', () => {
  it('two instances spend from one budget: the visitor bucket (8) holds across both', async () => {
    const [a, b] = [instance(), instance()];
    expect(a.store).toBe('postgres');
    const results: string[] = [];
    for (let i = 0; i < 10; i++) results.push(await outcome(enforceLimit(req('7.7.7.1'), 'ai', { visitorTag: 'a1a1a1a1a1a1', env: {}, limiter: i % 2 ? b : a })));
    expect(results.filter((r) => r === 'ok')).toHaveLength(8);
    expect(results.slice(8)).toEqual(['429', '429']);
  });

  it('parallel requests across two instances never exceed the bucket', async () => {
    const [a, b] = [instance(), instance()];
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => outcome(enforceLimit(req('7.7.7.2'), 'ai', { visitorTag: 'b2b2b2b2b2b2', env: {}, limiter: i % 2 ? b : a }))),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(8);
  });

  it('a restart does not refill: a new instance sees what the old one spent', async () => {
    const before = instance();
    for (let i = 0; i < 4; i++) await enforceLimit(req('7.7.7.3'), 'reconcile', { env: {}, limiter: before });
    const after = instance(); // fresh process memory, same database
    await expect(enforceLimit(req('7.7.7.3'), 'reconcile', { env: {}, limiter: after })).rejects.toMatchObject({ status: 429 });
  });

  it('stores HMAC-ed keys: no IP address or visitor tag at rest', async () => {
    const l = instance();
    await enforceLimit(req('198.51.100.77'), 'intake', { visitorTag: 'c3c3c3c3c3c3', env: {}, limiter: l });
    const keys = rowsOf<{ key: string }>(await h.db.execute(sql`SELECT key FROM rate_limit_buckets`)).map((r) => r.key);
    expect(keys.some((k) => k.startsWith('intake:ip:'))).toBe(true);
    expect(keys.join(' ')).not.toContain('198.51.100.77');
    expect(keys.join(' ')).not.toContain('c3c3c3c3c3c3');
    expect(l.storeKey('voice:caller:+15035550101')).toMatch(/^voice:caller:[A-Za-z0-9_-]{32}$/);
  });

  it('falls back to in-process buckets when the database fails, never to no limit', async () => {
    const broken = createDb({ memory: true });
    await broken.close();
    const l = new SharedRateLimiter(() => 0, secret);
    l.attach(broken.db);
    const results: string[] = [];
    for (let i = 0; i < 6; i++) results.push(await outcome(enforceLimit(req('7.7.7.4'), 'reconcile', { env: {}, limiter: l })));
    expect(results).toEqual(['ok', 'ok', 'ok', 'ok', '429', '429']);
  });

  it('detached, it is the in-memory limiter; RATE_LIMIT_STORE=memory opts out of the shared store', async () => {
    const l = instance();
    l.attach(null);
    expect(l.store).toBe('memory');
    expect(sharedStoreAllowed({ RATE_LIMIT_STORE: 'memory' })).toBe(false);
    expect(sharedStoreAllowed({})).toBe(true);
  });
});
