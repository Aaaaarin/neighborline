import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from './client.js';
import { createDb } from './client.js';
import { migrate, rowsOf } from './migrate.js';
import { MIGRATIONS } from './migrations.generated.js';
import { readMigrationsFromDisk, renderGenerated } from './scripts/embed-migrations.js';
import { GENESIS_HASH, appendAudit, listAudit, verifyAuditChain, verifyEntries } from './repo/audit.js';
import { freshDb } from './test-db.js';

describe('migrations', () => {
  it('embedded migrations match drizzle/*.sql (run `pnpm --filter @neighborline/db generate`)', () => {
    const generated = readFileSync(new URL('./migrations.generated.ts', import.meta.url), 'utf8');
    expect(generated).toBe(renderGenerated(readMigrationsFromDisk()));
  });

  it('applies all migrations once and is idempotent', async () => {
    const h = createDb({ memory: true });
    expect((await migrate(h.db)).applied).toEqual(MIGRATIONS.map((m) => m.tag));
    expect((await migrate(h.db)).applied).toEqual([]);
    const tables = rowsOf<{ table_name: string }>(
      await h.db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`),
    ).map((r) => r.table_name);
    expect(tables).toEqual(
      expect.arrayContaining(['groups', 'organizers', 'policies', 'requests', 'approvals', 'approval_signatures', 'payout_batches', 'payout_items', 'donations', 'webhook_events', 'notifications', 'audit_log']),
    );
    await h.close();
  });

  it('refuses to run when an applied migration was edited', async () => {
    const h = createDb({ memory: true });
    await migrate(h.db);
    const edited = MIGRATIONS.map((m, i) => (i === 0 ? { ...m, sql: `${m.sql}\n-- edited` } : m));
    await expect(migrate(h.db, edited)).rejects.toThrow(/modified after being applied/);
    await h.close();
  });

  it('rowsOf normalizes driver result shapes', () => {
    expect(rowsOf([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(rowsOf({ rows: [{ a: 2 }] })).toEqual([{ a: 2 }]);
    expect(rowsOf({})).toEqual([]);
  });
});

describe('audit log', () => {
  let h: DbHandle;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it('chains rows from the genesis hash', async () => {
    const a = await appendAudit(h.db, { actor: 'org_a', action: 'test.one', entityType: 't', entityId: '1', data: { b: 2, a: [1, { z: true }] } });
    const b = await appendAudit(h.db, { actor: 'org_b', action: 'test.two', entityType: 't', entityId: '2' });
    expect(a.prevHash).toBe(GENESIS_HASH);
    expect(b.prevHash).toBe(a.rowHash);
    expect(a.rowHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyAuditChain(h.db)).toMatchObject({ ok: true, count: 2, head: b.rowHash });
  });

  it('stays valid under concurrent appends', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => appendAudit(h.db, { actor: 'x', action: 'burst', entityType: 't', entityId: String(i), data: { i } })),
    );
    const v = await verifyAuditChain(h.db);
    expect(v.ok).toBe(true);
  });

  it('works inside an outer transaction (savepoint)', async () => {
    await h.db.transaction(async (tx) => {
      await appendAudit(tx, { actor: 'x', action: 'nested', entityType: 't', entityId: 'n' });
    });
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
  });

  it('drops undefined values before hashing so stored == hashed', async () => {
    await appendAudit(h.db, { actor: 'x', action: 'undef', entityType: 't', entityId: 'u', data: { keep: 1, drop: undefined } });
    const last = (await listAudit(h.db)).at(-1);
    expect(last?.data).toEqual({ keep: 1 });
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
  });

  it('the database rejects UPDATE, DELETE and TRUNCATE', async () => {
    const failure = async (q: Promise<unknown>): Promise<string> => {
      try {
        await q;
        return 'no error';
      } catch (e) {
        const err = e as Error & { cause?: Error };
        return `${err.message} ${err.cause?.message ?? ''}`;
      }
    };
    expect(await failure(h.db.execute(sql`UPDATE audit_log SET actor = 'evil'`))).toMatch(/append-only \(UPDATE/);
    expect(await failure(h.db.execute(sql`DELETE FROM audit_log`))).toMatch(/append-only \(DELETE/);
    expect(await failure(h.db.execute(sql`TRUNCATE audit_log`))).toMatch(/append-only \(TRUNCATE/);
    expect((await listAudit(h.db)).length).toBeGreaterThan(0);
  });

  it('detects tampering, deletion and reordering', async () => {
    const entries = await listAudit(h.db);
    expect(verifyEntries(entries).ok).toBe(true);
    const tampered = entries.map((e, i) => (i === 1 ? { ...e, data: { ...e.data, sneaky: true } } : e));
    expect(verifyEntries(tampered)).toEqual({ ok: false, brokenAtSeq: entries[1]!.seq, reason: 'row_hash does not match row contents' });
    const deleted = entries.filter((_, i) => i !== 1);
    expect(verifyEntries(deleted)).toMatchObject({ ok: false, brokenAtSeq: entries[2]!.seq });
    const swapped = [entries[1]!, entries[0]!, ...entries.slice(2)];
    expect(verifyEntries(swapped).ok).toBe(false);
    expect(verifyEntries([])).toEqual({ ok: true, count: 0, head: GENESIS_HASH });
  });
});
