/**
 * Database driver selection:
 *   DATABASE_URL set   → Postgres via `postgres` + drizzle-orm/postgres-js (Supabase/Render)
 *   otherwise          → PGlite (embedded Postgres, WASM) at PGLITE_DIR or ./.pglite
 *   { memory: true }   → in-memory PGlite (tests, demo reset)
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import postgres from 'postgres';
import { schema } from './schema.js';

export type Schema = typeof schema;
/** Driver-agnostic database handle used by every repository function. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Repository functions accept either the db or an open transaction. */
export type Executor = Db | Tx;

export interface CreateDbOptions {
  /** Force in-memory PGlite (ignores DATABASE_URL). */
  memory?: boolean;
  /** Postgres URL; defaults to process.env.DATABASE_URL. */
  url?: string;
  /** PGlite data dir; defaults to process.env.PGLITE_DIR or ./.pglite */
  dataDir?: string;
}

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  close: () => Promise<void>;
}

export function createDb(opts: CreateDbOptions = {}): DbHandle {
  const url = opts.memory ? undefined : (opts.url ?? process.env.DATABASE_URL);
  if (url) {
    const client = postgres(url, { max: 10, prepare: false, onnotice: () => {} });
    const db = drizzlePostgres(client, { schema }) as Db;
    return { db, kind: 'postgres', close: () => client.end({ timeout: 5 }) };
  }
  const client = opts.memory ? new PGlite() : new PGlite(opts.dataDir ?? process.env.PGLITE_DIR ?? './.pglite');
  const db = drizzlePglite(client, { schema }) as Db;
  return { db, kind: 'pglite', close: () => client.close() };
}
