/**
 * The manual rail's one operation: record that a batch PayPal refused at the account level (FAILED_RAIL)
 * was handed over another way (cash, a check from the sponsor, other).
 *
 * Authority is exactly that of a PayPal payout: the approval's two distinct organizers and their passkey
 * signatures are re-verified from the database, the content is rebuilt from the request rows and the
 * policy is re-run (verify.ts). On top: the group must have turned on "switch to manual recording", the
 * recording organizer must belong to the group, and a receipt note is required. Nothing here has a
 * PayPal client or moves money; the items become SUCCESS with actor `manual-rail:<organizer>` and the
 * batch MANUAL, so the ledger and report show the hand-over, labelled, and reconcile skips it.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { redactPII } from '@neighborline/core';
import { appendAudit, approvals, auditLog, getApproval, getBatch, listOrganizers, payoutBatches, upsertItemFromEvent, type BatchWithItems, type Db } from '@neighborline/db';
import { ApproverFailure, type ApproverDeps } from './approver.js';
import { RAIL_FALLBACK_ACTION, type ApproverError, type RecordManualRequest, type RecordManualResponse } from './protocol.js';
import { railBatchFor, type ManualRail } from './rails.js';
import { verifyApprovalRecord } from './verify.js';

const ACTOR = 'approver';

/** The group's "switch to manual recording" setting: newest audit row wins; off unless an organizer turned it on. */
export async function manualFallbackOn(db: Db, groupId: string): Promise<boolean> {
  const [row] = await db
    .select({ data: auditLog.data })
    .from(auditLog)
    .where(and(eq(auditLog.action, RAIL_FALLBACK_ACTION), eq(auditLog.entityId, groupId)))
    .orderBy(desc(auditLog.seq))
    .limit(1);
  return row?.data.manualFallback === true;
}

export interface ManualCtx {
  db: Db;
  deps: Pick<ApproverDeps, 'config' | 'env' | 'log'>;
  rail: ManualRail;
  now: Date;
}

export async function recordManualPayout(c: ManualCtx, batchId: string, req: RecordManualRequest): Promise<RecordManualResponse> {
  const { db } = c;
  const bw = await getBatch(db, batchId);
  if (!bw) throw new ApproverFailure(404, 'not_found', `no batch ${batchId}`);
  const approval = await getApproval(db, bw.batch.approvalId);
  if (!approval) throw new ApproverFailure(404, 'not_found', 'approval not found');
  const refuse = async (status: number, code: ApproverError['code'], msg: string): Promise<never> => {
    c.deps.log('warn', 'manual.refused', { batchId, code, reason: msg });
    await appendAudit(db, { actor: ACTOR, action: 'approver.manual_refused', entityType: 'payout_batch', entityId: batchId, data: { code, reason: msg, organizerId: req.organizerId } }).catch(() => {});
    throw new ApproverFailure(status, code, msg);
  };
  if (bw.batch.status === 'MANUAL') {
    const [prev] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'approver.manual_recorded'), eq(auditLog.entityId, batchId)))
      .orderBy(desc(auditLog.seq))
      .limit(1);
    return manualResponse(bw, approval.id, String(prev?.data.reference ?? ''), (prev?.data.method as RecordManualResponse['method']) ?? req.method, String(prev?.data.recordedBy ?? ''), prev?.at ?? c.now, false);
  }
  // Only a batch PayPal refused at the account level: certainly nothing was sent. Never UNKNOWN (it may
  // have been paid), never FAILED for an ordinary reason, never anything PayPal accepted.
  if (bw.batch.status !== 'FAILED_RAIL' || bw.batch.paypalBatchId) {
    return refuse(409, 'manual_not_allowed', `Only a payout PayPal refused at the account level can be recorded by hand; this one is ${bw.batch.status}.`);
  }
  const [rowA] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
  if (!rowA) return refuse(404, 'not_found', 'approval not found');
  if (!(await manualFallbackOn(db, rowA.groupId))) return refuse(409, 'manual_not_allowed', 'This group has not turned on manual recording for when PayPal is unavailable.');
  if (!(await listOrganizers(db, rowA.groupId)).some((o) => o.id === req.organizerId)) return refuse(403, 'unauthorized', 'Only an organizer of this group can record a manual payout');

  const v = await verifyApprovalRecord(db, { approval, groupId: rowA.groupId, hash: approval.hash, demoMode: c.deps.config.demoMode, env: c.deps.env, now: c.now });
  if (!v.ok) return refuse(v.status, v.code, v.message);
  let result;
  try {
    result = await c.rail.send(railBatchFor(v.group, v.requests, bw), { attestation: { method: req.method, receiptNote: req.receiptNote, recordedBy: req.organizerId } });
  } catch (err) {
    return refuse(400, 'manual_not_allowed', err instanceof Error ? err.message : String(err));
  }
  if (result.rail !== 'manual') return refuse(500, 'internal', 'the manual rail returned a PayPal result');
  // Compare-and-set: a concurrent PayPal re-send (which first claims FAILED_RAIL → CREATING) wins or loses cleanly.
  const at = c.now;
  const [claimed] = await db
    .update(payoutBatches)
    .set({ status: 'MANUAL', updatedAt: at })
    .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.status, 'FAILED_RAIL'), isNull(payoutBatches.paypalBatchId)))
    .returning();
  if (!claimed) return refuse(409, 'manual_not_allowed', 'This payout changed meanwhile (it is being re-sent to PayPal).');
  for (const it of bw.items) await upsertItemFromEvent(db, { senderItemId: it.senderItemId, status: 'SUCCESS', at, actor: `manual-rail:${req.organizerId}` });
  const totalCents = bw.items.reduce((t, i) => t + i.amountCents, 0);
  await appendAudit(db, {
    actor: ACTOR,
    action: 'approver.manual_recorded',
    entityType: 'payout_batch',
    entityId: batchId,
    data: {
      approvalId: approval.id,
      approvalHash: approval.hash,
      senderBatchId: bw.batch.senderBatchId,
      rail: 'manual',
      movedMoney: false,
      reference: result.reference,
      method: req.method,
      receiptNote: redactPII(result.attestation.receiptNote),
      recordedBy: req.organizerId,
      totalCents,
      itemCount: bw.items.length,
      approvers: v.sigs.map((s) => ({ organizerId: s.organizerId, signature: s.signature })),
      checks: ['failed_rail', 'group_fallback_on', 'organizer', 'distinct_organizers', 'signatures', 'content_from_db', 'policy_recheck', 'receipt_note'],
    },
    at,
  });
  c.deps.log('info', 'manual.recorded', { batchId, approvalId: approval.id, method: req.method, totalCents, items: bw.items.length });
  return manualResponse((await getBatch(db, batchId)) ?? bw, approval.id, result.reference, req.method, req.organizerId, at, true);
}

function manualResponse(bw: BatchWithItems, approvalId: string, reference: string, method: RecordManualResponse['method'], recordedBy: string, at: Date, recordedNow: boolean): RecordManualResponse {
  return {
    batchId: bw.batch.id,
    approvalId,
    status: 'MANUAL',
    rail: 'manual',
    reference,
    method,
    recordedBy,
    recordedAt: at.toISOString(),
    totalCents: bw.items.reduce((t, i) => t + i.amountCents, 0),
    itemCount: bw.items.length,
    recordedNow,
    movedMoney: false,
  };
}
