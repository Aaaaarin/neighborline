/**
 * Boot-time migrator over the embedded SQL (src/migrations.generated.ts ← drizzle/*.sql).
 * Each migration runs in its own transaction and is recorded with its SHA-256; a migration
 * edited after it was applied is a hard error (never silently diverge schemas).
 */
import { sql } from 'drizzle-orm';
import { sha256Hex } from '@neighborline/core';
import type { Db } from './client.js';
import { MIGRATIONS } from './migrations.generated.js';

export const MIGRATIONS_TABLE = 'nl_migrations';

type Row = { tag: string; hash: string };

/** Normalizes driver result shapes (postgres-js returns an array, PGlite returns { rows }). */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export async function migrate(
  db: Db,
  migrations: ReadonlyArray<{ tag: string; sql: string }> = MIGRATIONS,
): Promise<{ applied: string[] }> {
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (tag text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`),
  );
  const done = new Map(
    rowsOf<Row>(await db.execute(sql.raw(`SELECT tag, hash FROM ${MIGRATIONS_TABLE}`))).map((r) => [r.tag, r.hash]),
  );
  const applied: string[] = [];
  for (const m of migrations) {
    const hash = sha256Hex(m.sql);
    const prior = done.get(m.tag);
    if (prior !== undefined) {
      if (prior !== hash) throw new Error(`migration ${m.tag} was modified after being applied`);
      continue;
    }
    const statements = m.sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
    await db.transaction(async (tx) => {
      for (const s of statements) await tx.execute(sql.raw(s));
      await tx.execute(sql`INSERT INTO ${sql.raw(MIGRATIONS_TABLE)} (tag, hash) VALUES (${m.tag}, ${hash})`);
    });
    applied.push(m.tag);
  }
  return { applied };
}
