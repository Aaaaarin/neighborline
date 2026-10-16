/**
 * Approvals: created from requests' current content (hash-pinned), signed by distinct
 * organizers under a row lock, voided automatically if anything material changed.
 */
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  addApprover,
  approvalHash,
  hasBlockingFlag,
  type AddApproverResult,
  type Approval,
  type ApprovalContent,
  type Approver,
  type HelpRequest,
  type RequestStatus,
} from '@neighborline/core';
import type { Executor, Tx } from '../client.js';
import { approvalSignatures, approvals, groups, organizers, requests } from '../schema.js';
import { RepoError, inTx, iso, newId } from '../util.js';
import { appendAudit } from './audit.js';
import { listApprovalAssertions } from './credentials.js';
import { toHelpRequest } from './requests.js';

type ApprovalRow = typeof approvals.$inferSelect;

async function loadApproval(ex: Executor, row: ApprovalRow): Promise<Approval> {
  const sigs = await ex
    .select()
    .from(approvalSignatures)
    .where(eq(approvalSignatures.approvalId, row.id))
    .orderBy(asc(approvalSignatures.at), asc(approvalSignatures.organizerId));
  const assertions = sigs.length ? await listApprovalAssertions(ex, row.hash) : new Map();
  return {
    id: row.id,
    requestIds: row.requestIds,
    approvers: sigs.map((s) => {
      const assertion = assertions.get(s.organizerId);
      return { organizerId: s.organizerId, at: iso(s.at), deviceLabel: s.deviceLabel, ...(assertion ? { assertion } : {}) };
    }),
    totalCents: row.totalCents,
    policyVersionId: row.policyVersionId,
    hash: row.hash,
    status: row.status,
  };
}

export async function getApproval(ex: Executor, id: string): Promise<Approval | null> {
  const [row] = await ex.select().from(approvals).where(eq(approvals.id, id));
  return row ? loadApproval(ex, row) : null;
}

/** Why a request cannot be put into an approval (null = approvable). */
export function approvabilityProblem(r: HelpRequest, allowed: readonly RequestStatus[] = ['awaiting_approval']): string | null {
  if (!allowed.includes(r.status)) return `request ${r.id} is ${r.status}`;
  if (!r.computed || r.computed.amountCents <= 0) return `request ${r.id} has no computed amount`;
  if (!r.payoutDestination) return `request ${r.id} has no payout destination`;
  if (!r.policyVersionId) return `request ${r.id} has no policy version`;
  if (hasBlockingFlag(r.railFlags)) return `request ${r.id} has a blocking rail flag`;
  return null;
}

/** Build approval content from the requests' current rows. */
export function contentFromRequests(reqs: readonly HelpRequest[]): ApprovalContent {
  const versions = new Set(reqs.map((r) => r.policyVersionId));
  if (versions.size !== 1) throw new RepoError('NOT_APPROVABLE', 'requests use different policy versions');
  return {
    policyVersionId: reqs[0]?.policyVersionId as string,
    items: reqs.map((r) => ({
      requestId: r.id,
      amountCents: r.computed?.amountCents ?? 0,
      destination: r.payoutDestination as NonNullable<HelpRequest['payoutDestination']>,
    })),
  };
}

async function loadRequests(ex: Executor, ids: readonly string[], lock = false): Promise<HelpRequest[]> {
  if (ids.length === 0) return [];
  const q = ex.select().from(requests).where(inArray(requests.id, [...ids]));
  const rows = lock ? await q.for('update') : await q;
  return rows.map(toHelpRequest);
}

/**
 * Idempotent: the same requests with the same content return the same live approval.
 * Throws RepoError('NOT_APPROVABLE') if any request is not ready for approval.
 */
export async function createOrGetApproval(
  ex: Executor,
  input: { requestIds: readonly string[]; actor?: string },
): Promise<{ approval: Approval; content: ApprovalContent; created: boolean }> {
  const ids = [...new Set(input.requestIds)].sort();
  if (ids.length === 0) throw new RepoError('INVALID', 'requestIds must not be empty');
  return inTx(ex, async (tx) => {
    const reqs = await loadRequests(tx, ids);
    if (reqs.length !== ids.length) throw new RepoError('NOT_FOUND', 'some requests do not exist');
    const groupIds = new Set(reqs.map((r) => r.groupId));
    if (groupIds.size !== 1) throw new RepoError('NOT_APPROVABLE', 'requests belong to different groups');
    for (const r of reqs) {
      const problem = approvabilityProblem(r);
      if (problem) throw new RepoError('NOT_APPROVABLE', problem);
    }
    const content = contentFromRequests(reqs);
    const hash = approvalHash(content);
    const live = async () => (await tx.select().from(approvals).where(and(eq(approvals.hash, hash), ne(approvals.status, 'void'))))[0];
    const existing = await live();
    if (existing) return { approval: await loadApproval(tx, existing), content, created: false };

    const id = newId('apr');
    const inserted = await tx
      .insert(approvals)
      .values({
        id,
        groupId: reqs[0]?.groupId as string,
        requestIds: ids,
        totalCents: content.items.reduce((a, i) => a + i.amountCents, 0),
        policyVersionId: content.policyVersionId,
        hash,
      })
      .onConflictDoNothing()
      .returning();
    const row = inserted[0] ?? (await live());
    if (!row) throw new RepoError('CONFLICT', 'could not create approval');
    if (inserted[0]) {
      await appendAudit(tx, {
        actor: input.actor ?? 'system',
        action: 'approval.created',
        entityType: 'approval',
        entityId: row.id,
        data: { requestIds: ids, totalCents: row.totalCents, hash },
      });
    }
    return { approval: await loadApproval(tx, row), content, created: inserted.length > 0 };
  });
}

/**
 * Void every pending (not yet complete) approval that covers any of these requests,
 * e.g. after a new policy version re-prices them: their signatures covered the old amounts.
 */
export async function voidOpenApprovalsForRequests(ex: Executor, requestIds: readonly string[], opts: { reason: string; actor: string }): Promise<string[]> {
  if (!requestIds.length) return [];
  return inTx(ex, async (tx) => {
    const voided: string[] = [];
    for (const id of new Set(requestIds)) {
      const rows = await tx
        .select()
        .from(approvals)
        .where(and(sql`${approvals.requestIds} @> ${JSON.stringify([id])}::jsonb`, eq(approvals.status, 'pending')));
      for (const r of rows) {
        if (voided.includes(r.id)) continue;
        await markVoid(tx, r.id, opts.reason, opts.actor);
        voided.push(r.id);
      }
    }
    return voided;
  });
}

async function markVoid(tx: Tx, approvalId: string, reason: string, actor: string): Promise<void> {
  await tx.update(approvals).set({ status: 'void', updatedAt: new Date() }).where(eq(approvals.id, approvalId));
  await appendAudit(tx, { actor, action: 'approval.voided', entityType: 'approval', entityId: approvalId, data: { reason } });
}

/**
 * Record one organizer's approval inside a transaction with the approval row locked.
 * - same organizer twice → ok, changed=false (double tap)
 * - requests changed since creation → approval voided, ok=false CONTENT_CHANGED
 * - second distinct organizer → status complete, requests → approved
 */
export async function addApproverTx(
  ex: Executor,
  input: { approvalId: string; organizerId: string; deviceLabel: string; at?: Date },
): Promise<AddApproverResult> {
  return inTx(ex, async (tx) => {
    const [row] = await tx.select().from(approvals).where(eq(approvals.id, input.approvalId)).for('update');
    if (!row) throw new RepoError('NOT_FOUND', `approval ${input.approvalId} not found`);
    const approval = await loadApproval(tx, row);
    const [group] = await tx.select().from(groups).where(eq(groups.id, row.groupId));
    const orgIds = (await tx.select({ id: organizers.id }).from(organizers).where(eq(organizers.groupId, row.groupId))).map((o) => o.id);

    // Recompute content from the live rows; a status change counts as a content change too.
    const reqs = await loadRequests(tx, row.requestIds, true);
    const allowed: RequestStatus[] = approval.status === 'complete' ? ['approved'] : ['awaiting_approval'];
    const stale = reqs.length !== row.requestIds.length || reqs.some((r) => approvabilityProblem(r, allowed) !== null);
    let currentContent: ApprovalContent | undefined;
    try {
      currentContent = stale ? undefined : contentFromRequests(reqs);
    } catch {
      currentContent = undefined;
    }
    if (approval.status !== 'void' && approval.status !== 'executed' && !currentContent) {
      await markVoid(tx, row.id, 'requests changed or are no longer approvable', input.organizerId);
      return { ok: false, approval: { ...approval, status: 'void' }, reason: 'CONTENT_CHANGED' };
    }

    const approver: Approver = {
      organizerId: input.organizerId,
      at: (input.at ?? new Date()).toISOString(),
      deviceLabel: input.deviceLabel,
    };
    const result = addApprover(approval, approver, {
      required: group?.requiredApprovals ?? 2,
      eligibleOrganizerIds: orgIds,
      ...(currentContent ? { currentContent } : {}),
    });
    if (!result.ok) {
      if (result.reason === 'CONTENT_CHANGED') await markVoid(tx, row.id, 'approved content changed', input.organizerId);
      return result;
    }
    if (!result.changed) return result;

    await tx
      .insert(approvalSignatures)
      .values({ approvalId: row.id, organizerId: input.organizerId.trim(), at: new Date(approver.at), deviceLabel: approver.deviceLabel })
      .onConflictDoNothing();
    await tx.update(approvals).set({ status: result.approval.status, updatedAt: new Date() }).where(eq(approvals.id, row.id));
    await appendAudit(tx, {
      actor: input.organizerId,
      action: 'approval.signed',
      entityType: 'approval',
      entityId: row.id,
      data: { deviceLabel: input.deviceLabel, count: result.approval.approvers.length, hash: row.hash },
      ...(input.at ? { at: input.at } : {}),
    });
    if (result.complete && approval.status !== 'complete') {
      const now = input.at ?? new Date();
      await tx.update(requests).set({ status: 'approved', updatedAt: now }).where(inArray(requests.id, row.requestIds));
      await appendAudit(tx, {
        actor: 'system',
        action: 'approval.complete',
        entityType: 'approval',
        entityId: row.id,
        data: { approvers: result.approval.approvers.map((a) => a.organizerId), requestIds: row.requestIds },
        at: now,
      });
    }
    return result;
  });
}

export async function listApprovalsForRequest(ex: Executor, requestId: string): Promise<Approval[]> {
  const rows = await ex
    .select()
    .from(approvals)
    .where(sql`${approvals.requestIds} @> ${JSON.stringify([requestId])}::jsonb`)
    .orderBy(asc(approvals.createdAt));
  return Promise.all(rows.map((r) => loadApproval(ex, r)));
}
