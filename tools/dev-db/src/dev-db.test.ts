import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { appendAudit, createDb, getGroupBySlug, listAudit, migrate, seedDemo, verifyAuditChain, type DbHandle } from '@neighborline/db';
import { createDevDb, type DevDb } from './index.js';

let dev: DevDb;
let a: DbHandle;
let b: DbHandle;

beforeAll(async () => {
  dev = await createDevDb({ port: 0, controlPort: 0 });
  a = createDb({ url: dev.url });
  b = createDb({ url: dev.url });
  await migrate(a.db);
  await seedDemo(a.db);
});
afterAll(async () => {
  await a?.close();
  await b?.close();
  await dev?.close();
});

describe('dev-db: one embedded Postgres shared by two processes over the wire protocol', () => {
  it('a second client sees what the first wrote', async () => {
    expect((await getGroupBySlug(b.db, 'eastside'))?.slug).toBe('eastside');
  });

  it('concurrent transactions from two clients keep the hash-chained audit log intact', async () => {
    const before = (await listAudit(a.db)).length;
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => appendAudit(i % 2 ? a.db : b.db, { actor: `t${i}`, action: 'test.concurrent', entityType: 'test', entityId: String(i) })),
    );
    expect((await listAudit(b.db)).length).toBe(before + 12);
    expect((await verifyAuditChain(a.db)).ok).toBe(true);
  });

  it('reset swaps in an empty database and clients reconnect', async () => {
    const g = await (await fetch(`${dev.controlUrl}/reset`, { method: 'POST' })).json();
    expect(g).toMatchObject({ ok: true, generation: 2 });
    let rows: unknown;
    for (let i = 0; i < 5; i++) {
      try {
        rows = await b.db.execute(sql`select count(*)::int as n from information_schema.tables where table_name = 'groups'`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    expect(JSON.stringify(rows)).toContain('"n":0');
  });
});
