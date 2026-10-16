/**
 * One "generation" of the database: a migrated, seeded handle. Demo reset never deletes rows (the
 * audit log is append-only at the DB level, see NOTES-core); it builds a brand-new generation and
 * swaps the pointer. In-flight operations keep the generation they started with, so a reset in the
 * middle of a request can never mix two databases.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, getGroupBySlug, migrate, seedDemo, type Db, type DbHandle } from '@neighborline/db';
import type { Group } from '@neighborline/core';
import type { EngineConfig } from './env';
import { seedDemoQueue } from './demo-extras';

export interface DbGeneration {
  gen: number;
  db: Db;
  handle: DbHandle;
  kind: 'postgres' | 'pglite-memory' | 'pglite-dir';
  dir?: string;
  group: Group;
}

const DIR_PREFIX = 'db-';

/** Newest existing generation directory under PGLITE_DIR, or a new one. */
function pickDir(base: string, fresh: boolean): string {
  mkdirSync(base, { recursive: true });
  const existing = readdirSync(base).filter((d) => d.startsWith(DIR_PREFIX)).sort();
  if (!fresh && existing.length) return join(base, existing[existing.length - 1]!);
  return join(base, `${DIR_PREFIX}${Date.now().toString(36).padStart(10, '0')}`);
}

export async function openGeneration(cfg: EngineConfig, gen: number, opts: { fresh?: boolean; memory?: boolean } = {}): Promise<DbGeneration> {
  let handle: DbHandle;
  let kind: DbGeneration['kind'];
  let dir: string | undefined;
  if (cfg.databaseUrl && !opts.memory) {
    if (opts.fresh) throw new Error('reset needs the embedded database (unset DATABASE_URL)');
    handle = createDb({ url: cfg.databaseUrl });
    kind = 'postgres';
  } else if (cfg.pgliteDir && !opts.memory) {
    dir = pickDir(cfg.pgliteDir, !!opts.fresh);
    handle = createDb({ dataDir: dir });
    kind = 'pglite-dir';
  } else {
    handle = createDb({ memory: true });
    kind = 'pglite-memory';
  }
  await migrate(handle.db);
  const { group, policy, organizers } = await seedDemo(handle.db);
  await seedDemoQueue(handle.db, { group, policy, organizers });
  const fresh = (await getGroupBySlug(handle.db, cfg.groupSlug)) ?? group;
  return { gen, db: handle.db, handle, kind, ...(dir ? { dir } : {}), group: fresh };
}

/** Close an old generation once in-flight work has had time to finish; drop its directory. */
export function retireGeneration(g: DbGeneration, graceMs = 30_000): void {
  const t = setTimeout(() => {
    void g.handle
      .close()
      .catch(() => {})
      .finally(() => {
        if (g.dir) rmSync(g.dir, { recursive: true, force: true });
      });
  }, graceMs);
  t.unref?.();
}
