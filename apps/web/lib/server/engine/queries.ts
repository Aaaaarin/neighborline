/** Read helpers the repo layer doesn't expose (all read-only). */
import { and, asc, eq, gte, inArray, like, notInArray, or, sql } from 'drizzle-orm';
import type { PayoutItem } from '@neighborline/core';
import { approvalSignatures, approvals, groups, payoutBatches, payoutItems, requests, toBatch, toItem, type Db } from '@neighborline/db';
import { DEMO_PREFIX } from './context';

const NOT_SPENT = ['FAILED', 'RETURNED', 'CANCELED', 'BLOCKED', 'REFUNDED', 'REVERSED'];

/** Cents committed today by demo rehearsals (subtracted from the daily budget check). */
export async function demoSpentTodayCents(db: Db, groupId: string): Promise<number> {
  const [g] = await db.select({ tz: groups.timezone }).from(groups).where(eq(groups.id, groupId));
  const tz = g?.tz ?? 'America/Los_Angeles';
  const now = new Date().toISOString();
  const startOfDay = sql`(date_trunc('day', ${now}::timestamptz AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
  const [items] = await db
    .select({ total: sql<string | number | null>`coalesce(sum(${payoutItems.amountCents}), 0)` })
    .from(payoutItems)
    .innerJoin(requests, eq(requests.id, payoutItems.requestId))
    .where(and(eq(requests.groupId, groupId), like(requests.id, `${DEMO_PREFIX}%`), gte(payoutItems.createdAt, startOfDay), notInArray(payoutItems.status, NOT_SPENT)));
  const [approved] = await db
    .select({ total: sql<string | number | null>`coalesce(sum(${requests.amountCents}), 0)` })
    .from(requests)
    .where(and(eq(requests.groupId, groupId), like(requests.id, `${DEMO_PREFIX}%`), eq(requests.status, 'approved'), gte(requests.updatedAt, startOfDay)));
  return Number(items?.total ?? 0) + Number(approved?.total ?? 0);
}

export async function findItem(db: Db, ref: { paypalItemId?: string | undefined; senderItemId?: string | undefined }): Promise<PayoutItem | null> {
  const conds = [];
  if (ref.paypalItemId) conds.push(eq(payoutItems.paypalItemId, ref.paypalItemId));
  if (ref.senderItemId) conds.push(eq(payoutItems.senderItemId, ref.senderItemId));
  if (!conds.length) return null;
  const [row] = await db.select().from(payoutItems).where(or(...conds));
  return row ? toItem(row) : null;
}

export async function getItem(db: Db, id: string): Promise<PayoutItem | null> {
  const [row] = await db.select().from(payoutItems).where(eq(payoutItems.id, id));
  return row ? toItem(row) : null;
}

export async function allBatches(db: Db) {
  return (await db.select().from(payoutBatches).orderBy(asc(payoutBatches.createdAt))).map(toBatch);
}

export async function batchByPaypalId(db: Db, paypalBatchId: string) {
  const [row] = await db.select().from(payoutBatches).where(eq(payoutBatches.paypalBatchId, paypalBatchId));
  return row ? toBatch(row) : null;
}

/** Signature times per request (for approval-speed parity in the report). */
export async function signaturesByRequest(db: Db, groupId: string): Promise<Map<string, Date[]>> {
  const rows = await db
    .select({ requestIds: approvals.requestIds, at: approvalSignatures.at, status: approvals.status })
    .from(approvalSignatures)
    .innerJoin(approvals, eq(approvals.id, approvalSignatures.approvalId))
    .where(and(eq(approvals.groupId, groupId), inArray(approvals.status, ['complete', 'executed'])))
    .orderBy(asc(approvalSignatures.at));
  const out = new Map<string, Date[]>();
  for (const r of rows) for (const id of r.requestIds) out.set(id, [...(out.get(id) ?? []), r.at]);
  return out;
}

/** When each request reached awaiting_approval (from requests.updated_at is not enough — use the audit trail). */
export async function confirmedAtByRequest(db: Db): Promise<Map<string, Date>> {
  const rows = (await db.execute(
    sql`SELECT entity_id, min(at) AS at FROM audit_log WHERE action = 'request.status' AND data->>'to' = 'awaiting_approval' GROUP BY entity_id`,
  )) as unknown;
  const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
  const out = new Map<string, Date>();
  for (const r of list as Array<{ entity_id: string; at: string | Date }>) out.set(r.entity_id, new Date(r.at));
  return out;
}
