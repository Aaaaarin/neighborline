/**
 * The approval service — the ONLY server module allowed to construct a PayPal Payouts client
 * (enforced by lib/server/least-privilege.test.ts). It has no AI in it and executes a payout only
 * for a complete two-person approval record (db.addApproverTx → db.createBatch, which re-checks the
 * approval hash against the live requests and refuses blocked destinations).
 *
 * Least privilege in deployment: give it its own PayPal REST app via PAYPAL_PAYOUTS_CLIENT_ID /
 * PAYPAL_PAYOUTS_CLIENT_SECRET (falls back to PAYPAL_CLIENT_ID/SECRET), so the credentials used for
 * donations, webhooks and reporting cannot send money.
 */
import { hasBlockingFlag, type Group, type HelpRequest, type Lang, type PayoutBatch, type PayoutItem } from '@neighborline/core';
import {
  RepoError,
  addApproverTx,
  createBatch,
  createOrGetApproval,
  getApproval,
  getBatch,
  getRequest,
  listApprovalsForRequest,
  listItemsForRequest,
  listOrganizers,
  setPaypalItemId,
  updateBatch,
  type BatchWithItems,
  type Db,
} from '@neighborline/db';
import { PayPalClient, PayoutsApi, resolvePayPalEnv, type NormalizedPayoutItem, type PayoutItemInput } from '@neighborline/paypal';
import type { ApprovalResult } from '../types';
import { PAYOUT_PURPOSE } from './engine/constants';
import type { Env } from './engine/env';
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


/** PayPal notification_language for recipients without an account (only locales PayPal lists). */
const NOTIFICATION_LANG: Partial<Record<Lang, string>> = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', zh: 'zh-CN', ru: 'ru-RU', ko: 'ko-KR' };

export class ApprovalService {
  private readonly payouts: PayoutsApi;
  private readonly inflight = new Map<string, Promise<{ bw: BatchWithItems; sent?: SentBatch }>>();

  constructor(env: Env) {
    const r = resolvePayPalEnv(env);
    const clientId = (r.mode !== 'fake' && env.PAYPAL_PAYOUTS_CLIENT_ID) || r.clientId;
    const clientSecret = (r.mode !== 'fake' && env.PAYPAL_PAYOUTS_CLIENT_SECRET) || r.clientSecret;
    this.payouts = new PayoutsApi(new PayPalClient({ clientId, clientSecret, baseUrl: r.baseUrl }));
  }

  async approve(d: ApprovalDeps, input: { requestIds: string[]; organizerId: string; deviceLabel: string }): Promise<ApproveOutcome> {
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
          if (err instanceof RepoError) throw new HttpError(409, `Not ready for approval: ${err.message}`);
          throw err;
        }
      }
      const r = await addApproverTx(d.db, { approvalId, organizerId: org.id, deviceLabel: input.deviceLabel });
      if (!r.ok) {
        if (r.reason === 'NOT_AN_ORGANIZER' || r.reason === 'INVALID_APPROVER') throw new HttpError(403, 'Unknown organizer');
        if (r.reason === 'ALREADY_EXECUTED') return this.approve(d, input);
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

  private result(approvalId: string, count: number, required: number, bw: BatchWithItems): ApprovalResult {
    return { approvalId, count, required, executed: true, batchId: bw.batch.id, senderBatchId: bw.batch.senderBatchId };
  }

  /** Single-flight per approval: concurrent completions share one PayPal call. */
  private execute(d: ApprovalDeps, approvalId: string) {
    let p = this.inflight.get(approvalId);
    if (!p) {
      p = this.send(d, approvalId).finally(() => this.inflight.delete(approvalId));
      this.inflight.set(approvalId, p);
    }
    return p;
  }

  private async send(d: ApprovalDeps, approvalId: string): Promise<{ bw: BatchWithItems; sent?: SentBatch }> {
    let bw: BatchWithItems;
    try {
      bw = await createBatch(d.db, { approvalId, actor: 'approval-service' });
    } catch (err) {
      if (err instanceof RepoError) throw new HttpError(409, `Can’t execute: ${err.message}`);
      throw err;
    }
    if (bw.batch.paypalBatchId) return { bw };
    const requests = (await Promise.all(bw.items.map((i) => getRequest(d.db, i.requestId)))).filter((r): r is HelpRequest => !!r);
    const ids = requests.map((r) => r.id);
    const note = `Mutual aid from your neighbors at ${d.group.name}. No need to pay it back.`;
    const items: PayoutItemInput[] = bw.items.map((it) => {
      const lang = requests.find((r) => r.id === it.requestId)?.lang;
      const nl = lang ? NOTIFICATION_LANG[lang] : undefined;
      return {
        senderItemId: it.senderItemId,
        amountCents: it.amountCents,
        receiver: it.receiver,
        recipientType: it.recipientType,
        wallet: it.wallet,
        note,
        purpose: PAYOUT_PURPOSE,
        ...(it.wallet === 'VENMO' ? { socialFeedPrivacy: 'PRIVATE' as const } : {}),
        ...(nl ? { notificationLanguage: nl } : {}),
      };
    });

    let paypalBatchId: string;
    try {
      const res = await this.payouts.createBatch({ senderBatchId: bw.batch.senderBatchId, emailSubject: `Your neighbors at ${d.group.name} sent you help`, items });
      paypalBatchId = res.batchId;
      await updateBatch(d.db, bw.batch.id, { paypalBatchId, status: res.status === 'CREATING' ? 'PENDING' : res.status });
    } catch (err) {
      await updateBatch(d.db, bw.batch.id, { status: 'FAILED' }).catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpError(502, `PayPal didn’t accept the payout batch: ${msg}`);
    }
    try {
      const details = await this.payouts.getBatch(paypalBatchId);
      for (const it of details.items) if (it.senderItemId) await setPaypalItemId(d.db, it.senderItemId, it.payoutItemId);
    } catch {
      /* item ids also arrive with the item webhooks; the stage just shows them later */
    }
    bw = (await getBatch(d.db, bw.batch.id)) ?? bw;
    const total = bw.items.reduce((s, i) => s + i.amountCents, 0);
    d.bus.emit(
      { type: 'payout.batch_created', at: nowIso(), batchId: bw.batch.id, senderBatchId: bw.batch.senderBatchId, paypalBatchId, itemCount: bw.items.length, totalCents: total },
      ids,
    );
    for (const it of bw.items) {
      d.bus.emit(
        { type: 'payout.item_updated', at: nowIso(), itemId: it.id, requestId: it.requestId, status: 'PENDING', ...(it.paypalItemId ? { paypalItemId: it.paypalItemId } : {}) },
        [it.requestId],
      );
    }
    return { bw, sent: { batch: bw.batch, items: bw.items, requests } };
  }

  /** Read-only poll of a batch (fallback when no webhook URL is reachable, e.g. sandbox on localhost). */
  async pollBatch(paypalBatchId: string): Promise<NormalizedPayoutItem[]> {
    return this.payouts.listAllItems(paypalBatchId);
  }

  /** Cancel an UNCLAIMED item; the money returns to the fund. Returns the item for the caller to settle. */
  async cancelUnclaimed(d: ApprovalDeps, input: { batchId: string; itemId: string }): Promise<PayoutItem> {
    const bw = await getBatch(d.db, input.batchId);
    const item = bw?.items.find((i) => i.id === input.itemId);
    if (!item) throw new HttpError(404, 'No such payout item');
    if (item.status !== 'UNCLAIMED') throw new HttpError(409, 'Only unclaimed items can be cancelled');
    if (!item.paypalItemId) throw new HttpError(409, 'PayPal has not assigned this item an id yet');
    await this.payouts.cancelUnclaimedItem(item.paypalItemId);
    return item;
  }
}
