/**
 * Payout batches and items. `createBatch` is idempotent per approval (sender_batch_id is
 * derived from the approval hash), and `upsertItemFromEvent` folds webhook/poll updates
 * through the core item state machine so late or duplicate events never regress state.
 */
import { and, asc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import {
  applyItemEvent,
  canExecute,
  canTransitionRequest,
  requestStatusForItem,
  senderBatchIdFor,
  senderItemIdFor,
  type PayoutBatch,
  type PayoutItem,
  type PayoutItemStatus,
  type RequestStatus,
} from '@neighborline/core';
import type { Executor } from '../client.js';
import { approvals, groups, payoutBatches, payoutItems, requests } from '../schema.js';
import { RepoError, inTx, iso, newId } from '../util.js';
import { appendAudit } from './audit.js';
import { approvabilityProblem, contentFromRequests, getApproval } from './approvals.js';
import { toHelpRequest } from './requests.js';

type BatchRow = typeof payoutBatches.$inferSelect;
type ItemRow = typeof payoutItems.$inferSelect;

export const toBatch = (r: BatchRow): PayoutBatch => ({
  id: r.id,
  approvalId: r.approvalId,
  senderBatchId: r.senderBatchId,
  ...(r.paypalBatchId ? { paypalBatchId: r.paypalBatchId } : {}),
  status: r.status as PayoutBatch['status'],
  createdAt: iso(r.createdAt),
});

export const toItem = (r: ItemRow): PayoutItem => ({
  id: r.id,
  batchId: r.batchId,
  requestId: r.requestId,
  senderItemId: r.senderItemId,
  ...(r.paypalItemId ? { paypalItemId: r.paypalItemId } : {}),
  amountCents: r.amountCents,
  wallet: r.wallet as PayoutItem['wallet'],
  receiver: r.receiver,
  recipientType: r.recipientType as PayoutItem['recipientType'],
  status: r.status as PayoutItemStatus,
  ...(r.transactionId ? { transactionId: r.transactionId } : {}),
  lastEventAt: iso(r.lastEventAt),
});

export interface BatchWithItems {
  batch: PayoutBatch;
  items: PayoutItem[];
}

async function loadBatch(ex: Executor, row: BatchRow): Promise<BatchWithItems> {
  const items = await ex.select().from(payoutItems).where(eq(payoutItems.batchId, row.id)).orderBy(asc(payoutItems.senderItemId));
  return { batch: toBatch(row), items: items.map(toItem) };
}

export async function getBatch(ex: Executor, id: string): Promise<BatchWithItems | null> {
  const [row] = await ex.select().from(payoutBatches).where(eq(payoutBatches.id, id));
  return row ? loadBatch(ex, row) : null;
}

export async function getBatchBySenderBatchId(ex: Executor, senderBatchId: string): Promise<BatchWithItems | null> {
  const [row] = await ex.select().from(payoutBatches).where(eq(payoutBatches.senderBatchId, senderBatchId));
  return row ? loadBatch(ex, row) : null;
}

/**
 * Create the payout batch for a complete approval (or return the existing one).
 * Marks the approval executed and moves its requests to 'paying'. Only the approval-service
 * should call this, right before calling PayPal with `batch.senderBatchId`.
 */
export async function createBatch(
  ex: Executor,
  input: { approvalId: string; actor?: string; now?: Date },
): Promise<BatchWithItems & { created: boolean }> {
  return inTx(ex, async (tx) => {
    const [aRow] = await tx.select().from(approvals).where(eq(approvals.id, input.approvalId)).for('update');
    if (!aRow) throw new RepoError('NOT_FOUND', `approval ${input.approvalId} not found`);
    const [existing] = await tx.select().from(payoutBatches).where(eq(payoutBatches.approvalId, aRow.id));
    if (existing) return { ...(await loadBatch(tx, existing)), created: false };

    const approval = await getApproval(tx, aRow.id);
    if (!approval) throw new RepoError('NOT_FOUND', 'approval vanished');
    const reqRows = await tx.select().from(requests).where(inArray(requests.id, aRow.requestIds)).for('update');
    const reqs = reqRows.map(toHelpRequest);
    const problem = reqs.length !== aRow.requestIds.length ? 'missing requests' : reqs.map((r) => approvabilityProblem(r, ['approved'])).find(Boolean);
    const [group] = await tx.select().from(groups).where(eq(groups.id, aRow.groupId));
    if (problem || !canExecute(approval, contentFromRequests(reqs), group?.requiredApprovals ?? 2)) {
      throw new RepoError('NOT_EXECUTABLE', problem ?? `approval ${aRow.id} is ${approval.status} or does not match its requests`);
    }

    const now = input.now ?? new Date();
    const batchId = newId('pb');
    const [bRow] = await tx
      .insert(payoutBatches)
      .values({ id: batchId, approvalId: aRow.id, senderBatchId: senderBatchIdFor(approval), status: 'CREATING', createdAt: now, updatedAt: now })
      .returning();
    await tx.insert(payoutItems).values(
      reqs.map((r) => {
        const dest = r.payoutDestination as NonNullable<typeof r.payoutDestination>;
        return {
          id: newId('pi'),
          batchId,
          requestId: r.id,
          senderItemId: senderItemIdFor(approval, r.id),
          amountCents: r.computed?.amountCents as number,
          wallet: dest.wallet,
          receiver: dest.value.trim(),
          recipientType: dest.type,
          status: 'PENDING',
          lastEventAt: now,
          createdAt: now,
        };
      }),
    );
    await tx.update(approvals).set({ status: 'executed', updatedAt: now }).where(eq(approvals.id, aRow.id));
    await tx.update(requests).set({ status: 'paying', updatedAt: now }).where(inArray(requests.id, aRow.requestIds));
    await appendAudit(tx, {
      actor: input.actor ?? 'approval-service',
      action: 'payout.batch_created',
      entityType: 'payout_batch',
      entityId: batchId,
      data: { approvalId: aRow.id, senderBatchId: bRow?.senderBatchId, totalCents: aRow.totalCents, items: reqs.length },
      at: now,
    });
    return { ...(await loadBatch(tx, bRow as BatchRow)), created: true };
  });
}

export async function updateBatch(
  ex: Executor,
  id: string,
  patch: { paypalBatchId?: string; status?: PayoutBatch['status'] },
): Promise<PayoutBatch> {
  const [row] = await ex
    .update(payoutBatches)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(payoutBatches.id, id))
    .returning();
  if (!row) throw new RepoError('NOT_FOUND', `batch ${id} not found`);
  return toBatch(row);
}

/** Attach PayPal's payout_item_id to our item (from the create-batch response). */
export async function setPaypalItemId(ex: Executor, senderItemId: string, paypalItemId: string): Promise<void> {
  await ex.update(payoutItems).set({ paypalItemId }).where(eq(payoutItems.senderItemId, senderItemId));
}

export interface ItemEventInput {
  senderItemId?: string;
  paypalItemId?: string;
  status: PayoutItemStatus;
  transactionId?: string;
  at?: Date;
  actor?: string;
}

export type ItemEventOutcome = {
  item: PayoutItem;
  changed: boolean;
  ignored?: 'duplicate' | 'stale';
  requestStatus: RequestStatus;
};

/** Idempotent, order-tolerant item update. Returns null if no matching item exists. */
export async function upsertItemFromEvent(ex: Executor, ev: ItemEventInput): Promise<ItemEventOutcome | null> {
  if (!ev.senderItemId && !ev.paypalItemId) throw new RepoError('INVALID', 'senderItemId or paypalItemId required');
  return inTx(ex, async (tx) => {
    const where = ev.paypalItemId
      ? eq(payoutItems.paypalItemId, ev.paypalItemId)
      : eq(payoutItems.senderItemId, ev.senderItemId as string);
    let [row] = await tx.select().from(payoutItems).where(where).for('update');
    if (!row && ev.paypalItemId && ev.senderItemId) {
      [row] = await tx.select().from(payoutItems).where(eq(payoutItems.senderItemId, ev.senderItemId)).for('update');
    }
    if (!row) return null;
    const at = ev.at ?? new Date();
    const result = applyItemEvent(row.status as PayoutItemStatus, ev.status);
    const set: Partial<typeof payoutItems.$inferInsert> = {};
    if (ev.paypalItemId && !row.paypalItemId) set.paypalItemId = ev.paypalItemId;
    if (ev.transactionId && !row.transactionId) set.transactionId = ev.transactionId;
    if (at > row.lastEventAt) set.lastEventAt = at;
    if (result.changed) {
      set.status = result.status;
      if (result.status === 'UNCLAIMED') set.wasUnclaimed = true;
      if (result.status === 'SUCCESS' && !row.successAt) set.successAt = at;
    }
    const [updated] = Object.keys(set).length
      ? await tx.update(payoutItems).set(set).where(eq(payoutItems.id, row.id)).returning()
      : [row];

    const [req] = await tx.select({ status: requests.status }).from(requests).where(eq(requests.id, row.requestId)).for('update');
    let requestStatus = (req?.status ?? 'paying') as RequestStatus;
    if (result.changed) {
      const target = requestStatusForItem(result.status);
      if (target !== requestStatus && canTransitionRequest(requestStatus, target)) {
        await tx.update(requests).set({ status: target, updatedAt: at }).where(eq(requests.id, row.requestId));
        requestStatus = target;
      }
      await appendAudit(tx, {
        actor: ev.actor ?? 'paypal-webhook',
        action: 'payout.item_status',
        entityType: 'payout_item',
        entityId: row.id,
        data: { from: row.status, to: result.status, requestId: row.requestId, requestStatus, transactionId: ev.transactionId ?? null },
        at,
      });
    }
    return {
      item: toItem(updated as ItemRow),
      changed: result.changed,
      ...(result.changed ? {} : { ignored: result.ignored }),
      requestStatus,
    };
  });
}

export async function listItemsForRequest(ex: Executor, requestId: string): Promise<PayoutItem[]> {
  const rows = await ex.select().from(payoutItems).where(eq(payoutItems.requestId, requestId)).orderBy(asc(payoutItems.createdAt));
  return rows.map(toItem);
}

export async function listItems(ex: Executor, filter: { status?: PayoutItemStatus[] } = {}): Promise<PayoutItem[]> {
  const rows = await ex
    .select()
    .from(payoutItems)
    .where(filter.status ? inArray(payoutItems.status, filter.status) : undefined)
    .orderBy(asc(payoutItems.createdAt));
  return rows.map(toItem);
}

const NOT_SPENT: PayoutItemStatus[] = ['FAILED', 'RETURNED', 'CANCELED', 'BLOCKED', 'REFUNDED', 'REVERSED'];

/**
 * Cents committed today (group timezone): payout items created today that did not bounce,
 * plus approved requests not yet batched. Feed into core computeAmount({ todaySpentCents }).
 */
export async function getTodaySpentCents(ex: Executor, groupId: string, opts: { now?: Date } = {}): Promise<number> {
  const [g] = await ex.select({ tz: groups.timezone }).from(groups).where(eq(groups.id, groupId));
  if (!g) throw new RepoError('NOT_FOUND', `group ${groupId} not found`);
  const now = (opts.now ?? new Date()).toISOString();
  const startOfDay = sql`(date_trunc('day', ${now}::timestamptz AT TIME ZONE ${g.tz}) AT TIME ZONE ${g.tz})`;
  const [items] = await ex
    .select({ total: sql<string | number | null>`coalesce(sum(${payoutItems.amountCents}), 0)` })
    .from(payoutItems)
    .innerJoin(requests, eq(requests.id, payoutItems.requestId))
    .where(and(eq(requests.groupId, groupId), gte(payoutItems.createdAt, startOfDay), notInArray(payoutItems.status, NOT_SPENT)));
  const [approved] = await ex
    .select({ total: sql<string | number | null>`coalesce(sum(${requests.amountCents}), 0)` })
    .from(requests)
    .where(and(eq(requests.groupId, groupId), eq(requests.status, 'approved'), gte(requests.updatedAt, startOfDay)));
  return Number(items?.total ?? 0) + Number(approved?.total ?? 0);
}
