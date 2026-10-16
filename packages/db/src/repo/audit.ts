/**
 * Append-only, hash-chained audit log. Each row commits to the previous row's hash, so any
 * edit, deletion or reordering is detectable by `verifyAuditChain`. The DB also rejects
 * UPDATE/DELETE/TRUNCATE via trigger (migration 0001).
 */
import { asc, desc, sql } from 'drizzle-orm';
import { canonicalJson, sha256Hex } from '@neighborline/core';
import type { Executor } from '../client.js';
import { auditLog } from '../schema.js';
import { inTx } from '../util.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditInput {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  data?: Record<string, unknown>;
  at?: Date;
}

export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
  prevHash: string;
  rowHash: string;
}

export function auditRowHash(e: Omit<AuditEntry, 'seq' | 'rowHash'>): string {
  return sha256Hex(
    canonicalJson({
      prevHash: e.prevHash,
      at: e.at,
      actor: e.actor,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      data: e.data,
    }),
  );
}

const toEntry = (r: typeof auditLog.$inferSelect): AuditEntry => ({
  seq: r.seq,
  at: r.at.toISOString(),
  actor: r.actor,
  action: r.action,
  entityType: r.entityType,
  entityId: r.entityId,
  data: r.data,
  prevHash: r.prevHash,
  rowHash: r.rowHash,
});

export async function appendAudit(ex: Executor, input: AuditInput): Promise<AuditEntry> {
  return inTx(ex, async (tx) => {
    // Serialize appenders so two writers never chain onto the same predecessor.
    await tx.execute(sql`LOCK TABLE ${auditLog} IN SHARE ROW EXCLUSIVE MODE`);
    const [last] = await tx.select({ rowHash: auditLog.rowHash }).from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
    // Round-trip through JSON so what we hash is exactly what jsonb stores.
    const data = JSON.parse(JSON.stringify(input.data ?? {})) as Record<string, unknown>;
    const at = new Date(Math.floor((input.at ?? new Date()).getTime()));
    const body = {
      at: at.toISOString(),
      actor: input.actor,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      data,
      prevHash: last?.rowHash ?? GENESIS_HASH,
    };
    const rowHash = auditRowHash(body);
    const [row] = await tx
      .insert(auditLog)
      .values({ ...body, at, rowHash })
      .returning();
    return toEntry(row as typeof auditLog.$inferSelect);
  });
}

export async function listAudit(ex: Executor, opts: { limit?: number } = {}): Promise<AuditEntry[]> {
  const rows = await ex.select().from(auditLog).orderBy(asc(auditLog.seq)).limit(opts.limit ?? 10_000);
  return rows.map(toEntry);
}

export type ChainVerification = { ok: true; count: number; head: string } | { ok: false; brokenAtSeq: number; reason: string };

/** Pure verification over entries in seq order (exported for tests and the /trust page). */
export function verifyEntries(entries: readonly AuditEntry[]): ChainVerification {
  let prev = GENESIS_HASH;
  for (const e of entries) {
    if (e.prevHash !== prev) return { ok: false, brokenAtSeq: e.seq, reason: 'prev_hash does not match previous row' };
    if (auditRowHash(e) !== e.rowHash) return { ok: false, brokenAtSeq: e.seq, reason: 'row_hash does not match row contents' };
    prev = e.rowHash;
  }
  return { ok: true, count: entries.length, head: prev };
}

export async function verifyAuditChain(ex: Executor): Promise<ChainVerification> {
  return verifyEntries(await listAudit(ex, { limit: Number.MAX_SAFE_INTEGER }));
}
