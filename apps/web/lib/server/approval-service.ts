/**
 * Web side of two-person approval. It records organizer signatures (db.createOrGetApproval →
 * db.addApproverTx) and, when the record is complete, asks the APPROVER PROCESS to execute it.
 *
 * This module holds no PayPal Payouts client and no Payouts credentials, and it does not create
 * payout batches: apps/approver is the only process that can (enforced by
 * lib/server/least-privilege.test.ts). The approver re-derives everything that matters — the approval
 * hash, ≥ 2 distinct organizers, their passkey signatures, the amounts (core.computeAmount from the
 * policy and history it reads itself) and the rail checks — before it calls PayPal, so a bug or a
 * compromise here cannot pay a different amount, destination or number of approvers than the record.
 */
import { approvalPayload, hasBlockingFlag, type Group, type HelpRequest, type PayoutBatch, type PayoutItem } from '@neighborline/core';
import {
  RepoError,
  addApproverTx,
  contentFromRequests,
  createOrGetApproval,
  getApproval,
  getBatch,
  getRequest,
  listApprovalsForRequest,
  listItemsForRequest,
  listOrganizers,
  type BatchWithItems,
  type Db,
} from '@neighborline/db';
import type { ExecuteRequest } from '@neighborline/approver/protocol';
import type { ApprovalResult } from '../types';
import { ApproverClient, ApproverRefusal, type Env } from './approver-client';
import type { EventBus } from './engine/events';
import { nowIso } from './engine/events';
import { HttpError } from './errors';

export interface ApprovalDeps {
  db: Db;
  group: Group;
  bus: EventBus;
}

/** A batch this call actually handed to PayPal (the caller sends "we're sending it" messages once). */
export interface SentBatch {
  batch: PayoutBatch;
  items: PayoutItem[];
  requests: HelpRequest[];
}

export type ApproveOutcome = ApprovalResult & { sent?: SentBatch };

export class ApprovalService {
  readonly approver: ApproverClient;
  private readonly inflight = new Map<string, Promise<{ bw: BatchWithItems; sent?: SentBatch }>>();

  constructor(env: Env) {
    this.approver = new ApproverClient(env);
  }

  /**
   * Record one signed tap. Idempotent and race-safe: concurrent taps on the same request (a double
   * tap, two organizers at once) all return 200 with the same approval / batch. A tap that loses a
   * race (the request moved on to approved/paying between our read and our write) is re-run against
   * the fresh state instead of failing with 409 (QA P2-1).
   */
  async approve(d: ApprovalDeps, input: { requestIds: string[]; organizerId: string; deviceLabel: string }, depth = 0): Promise<ApproveOutcome> {
    const required = d.group.requiredApprovals;
    const org = (await listOrganizers(d.db, d.group.id)).find((o) => o.id === input.organizerId);
    if (!org) throw new HttpError(403, 'Unknown organizer');
    const ids = [...new Set(input.requestIds)];
    const reqs: HelpRequest[] = [];
    for (const id of ids) {
      const r = await getRequest(d.db, id);
      if (!r || r.groupId !== d.group.id) throw new HttpError(404, `No request ${id}`);
      reqs.push(r);
    }
    for (const r of reqs) {
      const block = r.railFlags.find((f) => f.severity === 'block');
      if (block) throw new HttpError(409, `Blocked by rail protection: ${block.detail}`);
    }

    // Idempotent: a tap after execution (or a retry after a crash) returns / resumes the original batch.
    const existing = await listItemsForRequest(d.db, ids[0]!);
    if (existing.length) {
      const bw = await getBatch(d.db, existing[existing.length - 1]!.batchId);
      if (bw) {
        const approval = await getApproval(d.db, bw.batch.approvalId);
        const out = bw.batch.paypalBatchId ? { bw } : await this.execute(d, bw.batch.approvalId);
        return { ...this.result(approval?.id ?? bw.batch.approvalId, approval?.approvers.length ?? required, required, out.bw), ...(out.sent ? { sent: out.sent } : {}) };
      }
    }
    for (const r of reqs) {
      if (r.status !== 'awaiting_approval' && r.status !== 'approved') throw new HttpError(409, `This request is ${r.status.replace('_', ' ')} and can’t be approved.`);
    }
    if (reqs.some((r) => hasBlockingFlag(r.railFlags))) throw new HttpError(409, 'Blocked by rail protection');

    for (let attempt = 0; attempt < 2; attempt++) {
      let approvalId: string;
      if (reqs.every((r) => r.status === 'approved')) {
        const live = (await listApprovalsForRequest(d.db, ids[0]!)).filter((a) => a.status === 'complete').at(-1);
        if (!live) throw new HttpError(409, 'Approved, but the approval record is missing');
        approvalId = live.id;
      } else {
        try {
          approvalId = (await createOrGetApproval(d.db, { requestIds: ids, actor: org.id })).approval.id;
        } catch (err) {
          if (err instanceof RepoError) {
            if (depth < 3 && (await this.movedOn(d, ids))) return this.approve(d, input, depth + 1);
            throw new HttpError(409, `Not ready for approval: ${err.message}`);
          }
          throw err;
        }
      }
      const r = await addApproverTx(d.db, { approvalId, organizerId: org.id, deviceLabel: input.deviceLabel });
      if (!r.ok) {
        if (r.reason === 'NOT_AN_ORGANIZER' || r.reason === 'INVALID_APPROVER') throw new HttpError(403, 'Unknown organizer');
        if (r.reason === 'ALREADY_EXECUTED') {
          if (depth < 3) return this.approve(d, input, depth + 1);
          throw new HttpError(409, 'This approval was already executed.');
        }
        // CONTENT_CHANGED / VOID: the request changed after the first signature → start a fresh approval.
        continue;
      }
      const count = r.approval.approvers.length;
      if (r.changed) d.bus.emit({ type: 'approval.added', at: nowIso(), approvalId, organizerId: org.id, count }, ids);
      if (!r.complete) return { approvalId, count, required, executed: false };
      const out = await this.execute(d, approvalId);
      return { ...this.result(approvalId, count, required, out.bw), ...(out.sent ? { sent: out.sent } : {}) };
    }
    throw new HttpError(409, 'The request changed while it was being approved. Review it again.');
  }

  /** Did a concurrent tap move these requests past awaiting_approval (so re-reading will find its result)? */
  private async movedOn(d: ApprovalDeps, ids: string[]): Promise<boolean> {
    for (const id of ids) {
      const r = await getRequest(d.db, id);
      if (r && ['approved', 'paying', 'paid', 'unclaimed'].includes(r.status)) return true;
    }
    return false;
  }

  private result(approvalId: string, count: number, required: number, bw: BatchWithItems): ApprovalResult {
    return { approvalId, count, required, executed: true, batchId: bw.batch.id, senderBatchId: bw.batch.senderBatchId };
  }

  /** Single-flight per approval inside this process (the approver is single-flight and idempotent too). */
  private execute(d: ApprovalDeps, approvalId: string) {
    let p = this.inflight.get(approvalId);
    if (!p) {
      p = this.send(d, approvalId).finally(() => this.inflight.delete(approvalId));
      this.inflight.set(approvalId, p);
    }
    return p;
  }

  /** The request the approver gets: "look at approval X", with the canonical payload we believe it covers. */
  private async executeRequest(db: Db, approvalId: string): Promise<{ req: ExecuteRequest; requests: HelpRequest[] }> {
    const approval = await getApproval(db, approvalId);
    if (!approval) throw new HttpError(404, 'Approval record not found');
    const requests = (await Promise.all(approval.requestIds.map((id) => getRequest(db, id)))).filter((r): r is HelpRequest => !!r);
    let payload: ExecuteRequest['payload'];
    try {
      payload = approvalPayload(contentFromRequests(requests)) as unknown as ExecuteRequest['payload'];
    } catch (err) {
      throw new HttpError(409, `Can’t execute: ${err instanceof Error ? err.message : err}`);
    }
    return {
      requests,
      req: {
        approvalId,
        hash: approval.hash,
        payload,
        approvers: approval.approvers.map((a) => ({
          organizerId: a.organizerId,
          at: a.at,
          deviceLabel: a.deviceLabel,
          assertion: a.assertion ? { kind: a.assertion.kind, credentialId: a.assertion.credentialId } : null,
        })),
      },
    };
  }

  /**
   * The approver reported `paypal_unknown`: PayPal may or may not have accepted the batch (timeout).
   * The batch stays UNKNOWN (never FAILED) and we ask the approver again a few times; it re-checks
   * policy and re-sends the SAME sender_batch_id, which PayPal answers with the original batch.
   */
  private scheduleResolve(d: ApprovalDeps, approvalId: string, attempt = 0) {
    const delays = [5_000, 30_000, 120_000, 600_000];
    const ms = delays[attempt];
    if (ms === undefined) return;
    const t = setTimeout(() => {
      this.execute(d, approvalId).catch((err) => {
        if (err instanceof ApproverRefusal && err.code === 'paypal_unknown') this.scheduleResolve(d, approvalId, attempt + 1);
      });
    }, ms);
    t.unref?.();
  }

  private async send(d: ApprovalDeps, approvalId: string): Promise<{ bw: BatchWithItems; sent?: SentBatch }> {
    const { req, requests } = await this.executeRequest(d.db, approvalId);
    let res;
    try {
      res = await this.approver.execute(req);
    } catch (err) {
      if (err instanceof ApproverRefusal && err.code === 'paypal_unknown') this.scheduleResolve(d, approvalId);
      throw err;
    }
    const bw = await getBatch(d.db, res.batchId);
    if (!bw) throw new HttpError(502, 'The approval service reported a batch this server cannot find');
    if (!res.sentNow) return { bw };
    const ids = bw.items.map((i) => i.requestId);
    d.bus.emit(
      { type: 'payout.batch_created', at: nowIso(), batchId: bw.batch.id, senderBatchId: bw.batch.senderBatchId, paypalBatchId: res.paypalBatchId, itemCount: bw.items.length, totalCents: res.totalCents },
      ids,
    );
    for (const it of bw.items) {
      d.bus.emit(
        { type: 'payout.item_updated', at: nowIso(), itemId: it.id, requestId: it.requestId, status: 'PENDING', ...(it.paypalItemId ? { paypalItemId: it.paypalItemId } : {}) },
        [it.requestId],
      );
    }
    return { bw, sent: { batch: bw.batch, items: bw.items, requests: requests.filter((r) => ids.includes(r.id)) } };
  }

  /** Read-only poll of one of our batches through the approver (webhook safety net, sandbox on localhost). */
  pollBatch(batchId: string) {
    return this.approver.poll(batchId).then((r) => r.items);
  }

  /** Cancel an UNCLAIMED item through the approver; the money returns to the fund. */
  async cancelUnclaimed(d: ApprovalDeps, input: { batchId: string; itemId: string; organizerId?: string }): Promise<PayoutItem> {
    const bw = await getBatch(d.db, input.batchId);
    const item = bw?.items.find((i) => i.id === input.itemId);
    if (!item) throw new HttpError(404, 'No such payout item');
    if (item.status !== 'UNCLAIMED') throw new HttpError(409, 'Only unclaimed items can be cancelled');
    await this.approver.cancelUnclaimed(item.id, { batchId: input.batchId, ...(input.organizerId ? { organizerId: input.organizerId } : {}) });
    return item;
  }
}
