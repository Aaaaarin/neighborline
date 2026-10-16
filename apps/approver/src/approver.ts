/**
 * The approval service. The only Neighborline code path that can create a PayPal payout.
 *
 * `execute` trusts nothing in the request except "please look at approval X". It then:
 *   1. recomputes the approval hash from the canonical payload it was sent, and requires it to
 *      equal both the claimed hash and the hash stored on the approval record;
 *   2. requires the record to be `complete` with ≥ max(2, group.requiredApprovals) DISTINCT current
 *      organizers, and the approver list it was sent to match the record;
 *   3. re-verifies each organizer's stored WebAuthn signature over that hash (assertions.ts);
 *   4. rebuilds the approval content from the request rows it reads itself, and requires the same hash
 *      (amounts and destinations come from the database, never from the web request);
 *   5. re-runs core.computeAmount + core.checkRail from the policy, history and handles it reads itself
 *      (recheck.ts): every amount must still be allowed, no block flag;
 *   6. derives sender_batch_id from the hash (core.senderBatchIdFor), creates the batch row
 *      (db.createBatch, which re-checks canExecute under row locks and is idempotent per approval),
 *      sends it on the payout rail (rails.ts: PayPal Payouts), records the PayPal ids, and appends a
 *      hash-chained audit entry.
 * A second call for the same approval returns the same batch without calling PayPal again.
 *
 * If PayPal refuses at the ACCOUNT level (the sponsor's account is restricted, locked or not authorized),
 * the batch becomes FAILED_RAIL (nothing was sent) and the web app alerts the organizers. When the
 * group turned on "switch to manual recording", `recordManual` lets an organizer record a cash/check
 * hand-over for that batch: steps 2–5 are re-run exactly as for PayPal (verify.ts), a receipt note is
 * required, and the manual rail records only; it never moves money.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { approvalPayload, canonicalJson, sha256Hex, type Group, type HelpRequest, type PayoutItem } from '@neighborline/core';
import {
  RepoError,
  appendAudit,
  approvals,
  createBatch,
  getApproval,
  getBatch,
  getRequest,
  listOrganizers,
  payoutBatches,
  payoutItems,
  setPaypalItemId,
  updateBatch,
  type BatchWithItems,
  type Db,
} from '@neighborline/db';
import { isAmbiguousPayPalError, type PayoutsApi, type WebhooksApi } from '@neighborline/paypal';
import type { ApproverConfig, Env } from './config.js';
import type { Logger } from './log.js';
import {
  type ApproverError,
  type CancelUnclaimedRequest,
  type CancelUnclaimedResponse,
  type ExecuteRequest,
  type ExecuteResponse,
  type PollResponse,
  type RecordManualRequest,
  type RecordManualResponse,
  type VerifyWebhookRequest,
  type VerifyWebhookResponse,
} from './protocol.js';
import { manualFallbackOn, recordManualPayout } from './manual.js';
import { ManualRail, PayPalPayoutsRail, RailUnavailable, railBatchFor, type PayoutRail } from './rails.js';

export { PAYOUT_PURPOSE } from './rails.js';
import { verifyApprovalRecord } from './verify.js';

export class ApproverFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ApproverError['code'],
    message: string,
    /** Extra fields for the error body (rail_unavailable: the FAILED_RAIL batch and PayPal's reason). */
    readonly extra: Pick<ApproverError, 'batchId' | 'railReason'> = {},
  ) {
    super(message);
    this.name = 'ApproverFailure';
  }
}

export interface ApproverDeps {
  /** Current database handle (a function so tests can follow a demo reset). */
  db: () => Db | Promise<Db>;
  payouts: PayoutsApi;
  /** The primary rail (default: PayPal Payouts over `payouts`). Tests inject a refusing rail. */
  rail?: PayoutRail;
  /** WebhooksApi on the Payouts app's credentials (for /v1/verify-webhook). */
  webhooks?: WebhooksApi;
  config: Pick<ApproverConfig, 'requirePasskeys' | 'demoMode'> & { webhookId?: string | undefined };
  /** Read for WebAuthn origin rules (WEBAUTHN_ORIGIN, WEBAUTHN_RP_ID, APP_BASE_URL, DEMO_MODE). */
  env: Env;
  log: Logger;
  now?: () => Date;
}

const ACTOR = 'approver';

export class Approver {
  private readonly inflight = new Map<string, Promise<ExecuteResponse>>();
  /** One money operation per approval at a time (execute, re-send, manual record). */
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly rail: PayoutRail;
  private readonly manual = new ManualRail();

  constructor(private readonly deps: ApproverDeps) {
    this.rail = deps.rail ?? new PayPalPayoutsRail(deps.payouts);
  }

  /** Single-flight per approval: concurrent calls share one PayPal call. */
  execute(req: ExecuteRequest): Promise<ExecuteResponse> {
    let p = this.inflight.get(req.approvalId);
    if (!p) {
      p = this.serial(req.approvalId, () => this.executeOnce(req)).finally(() => this.inflight.delete(req.approvalId));
      this.inflight.set(req.approvalId, p);
    }
    return p;
  }

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.locks.set(key, next);
    return next.finally(() => {
      if (this.locks.get(key) === next) this.locks.delete(key);
    });
  }

  private async refuse(db: Db, req: ExecuteRequest, f: ApproverFailure): Promise<never> {
    this.deps.log('warn', 'execute.refused', { approvalId: req.approvalId, code: f.code, reason: f.message });
    await appendAudit(db, {
      actor: ACTOR,
      action: 'approver.execute_refused',
      entityType: 'approval',
      entityId: req.approvalId,
      data: { code: f.code, reason: f.message, claimedHash: req.hash },
    }).catch(() => {});
    throw f;
  }

  private async executeOnce(req: ExecuteRequest): Promise<ExecuteResponse> {
    const db = await this.deps.db();
    const fail = (status: number, code: ApproverError['code'], msg: string) => this.refuse(db, req, new ApproverFailure(status, code, msg));

    // 1. The payload must be canonical and hash to the claimed hash.
    let rebuilt: string;
    try {
      rebuilt = canonicalJson(
        approvalPayload({
          policyVersionId: req.payload.policyVersionId,
          items: req.payload.items.map((i) => ({ requestId: i.requestId, amountCents: i.amountCents, destination: { wallet: i.wallet, type: i.recipientType, value: i.receiver } })),
        }),
      );
    } catch (err) {
      return fail(400, 'bad_request', `payload is not a valid approval: ${err instanceof Error ? err.message : err}`);
    }
    if (rebuilt !== canonicalJson(req.payload)) return fail(400, 'hash_mismatch', 'payload is not in canonical form (totals, order or normalization differ)');
    const hash = sha256Hex(rebuilt);
    if (hash !== req.hash) return fail(400, 'hash_mismatch', 'payload does not hash to the claimed approval hash');

    // 2. The approval record (read here, not from the request).
    const [row] = await db.select().from(approvals).where(eq(approvals.id, req.approvalId));
    const approval = row ? await getApproval(db, row.id) : null;
    if (!row || !approval) return fail(404, 'not_found', `no approval ${req.approvalId}`);
    if (approval.hash !== hash) return fail(409, 'tampered', 'the approval record was signed over different content than this request');

    // Idempotent re-execute: one approval → one batch.
    const [existing] = await db.select().from(payoutBatches).where(eq(payoutBatches.approvalId, approval.id));
    if (existing?.paypalBatchId || existing?.status === 'MANUAL') {
      const bw = (await getBatch(db, existing.id))!;
      this.deps.log('info', 'execute.idempotent', { approvalId: approval.id, batchId: existing.id, senderBatchId: existing.senderBatchId, status: existing.status });
      return this.response(approval.id, hash, bw, false, approval.approvers.map((a) => ({ organizerId: a.organizerId, signature: a.assertion?.kind ?? 'unsigned' })));
    }

    if (!existing && approval.status !== 'complete') return fail(409, 'not_complete', `approval is ${approval.status}, not complete`);
    // 2–5: distinct organizers, signatures, content from the db, policy re-check — before the first send
    // AND before any re-send of a batch whose earlier attempt failed, ended UNKNOWN or hit FAILED_RAIL.
    const v = await verifyApprovalRecord(db, {
      approval,
      groupId: row.groupId,
      hash,
      claimedApprovers: req.approvers.map((a) => a.organizerId),
      demoMode: this.deps.config.demoMode,
      env: this.deps.env,
      now: this.now(),
    });
    if (!v.ok) return fail(v.status, v.code, v.message);
    const { group, requests, sigs } = v;
    if (existing) this.deps.log('info', 'execute.resend', { approvalId: approval.id, batchId: existing.id, senderBatchId: existing.senderBatchId, previousStatus: existing.status });

    // 6. Batch row (idempotent, re-checks canExecute under locks) → PayPal.
    let bw: BatchWithItems;
    try {
      bw = await createBatch(db, { approvalId: approval.id, actor: ACTOR });
    } catch (err) {
      if (err instanceof RepoError) return fail(409, 'not_executable', err.message);
      throw err;
    }
    const signatures = sigs.map((s) => ({ organizerId: s.organizerId, signature: s.signature }));
    if (bw.batch.paypalBatchId) return this.response(approval.id, hash, bw, false, signatures);
    // A FAILED_RAIL batch is re-sent only if nobody recorded it by hand meanwhile (compare-and-set).
    if (bw.batch.status === 'FAILED_RAIL') {
      const [claimed] = await db
        .update(payoutBatches)
        .set({ status: 'CREATING', updatedAt: new Date() })
        .where(and(eq(payoutBatches.id, bw.batch.id), eq(payoutBatches.status, 'FAILED_RAIL'), isNull(payoutBatches.paypalBatchId)))
        .returning();
      if (!claimed) return fail(409, 'not_executable', 'this payout was recorded by hand or changed meanwhile; it will not be sent to PayPal');
    }
    return this.sendToPayPal(db, { approvalId: approval.id, hash, group, requests, bw, signatures });
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private async sendToPayPal(
    db: Db,
    a: { approvalId: string; hash: string; group: Group; requests: HelpRequest[]; bw: BatchWithItems; signatures: ExecuteResponse['approvers'] },
  ): Promise<ExecuteResponse> {
    const { bw } = a;
    const railBatch = railBatchFor(a.group, a.requests, bw);
    let paypalBatchId: string;
    let itemIds: Array<{ senderItemId: string; paypalItemId: string }> = [];
    try {
      const res = await this.rail.send(railBatch);
      if (res.rail !== 'paypal_payouts') throw new Error('the primary rail must be PayPal Payouts');
      paypalBatchId = res.paypalBatchId;
      itemIds = res.items;
      await updateBatch(db, bw.batch.id, { paypalBatchId, status: res.status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof RailUnavailable) {
        // Certainly nothing was sent: PayPal refused who is sending, not this batch. Organizers are
        // alerted (web app) and may retry later or, if the group allows it, record a manual hand-over.
        await updateBatch(db, bw.batch.id, { status: 'FAILED_RAIL' }).catch(() => {});
        const manual = await manualFallbackOn(db, a.group.id).catch(() => false);
        this.deps.log('error', 'execute.rail_unavailable', { approvalId: a.approvalId, senderBatchId: bw.batch.senderBatchId, reason: err.reason, debugId: err.debugId, manualFallback: manual });
        await appendAudit(db, {
          actor: ACTOR,
          action: 'approver.rail_unavailable',
          entityType: 'payout_batch',
          entityId: bw.batch.id,
          data: { approvalId: a.approvalId, senderBatchId: bw.batch.senderBatchId, rail: this.rail.kind, reason: err.reason, debugId: err.debugId ?? null, manualFallback: manual, error: msg.slice(0, 300) },
        }).catch(() => {});
        throw new ApproverFailure(
          503,
          'rail_unavailable',
          manual
            ? `PayPal refused the payout because of the sponsor's account (${err.reason}). Nothing was sent. This group records payouts by hand while PayPal is unavailable: record how the money was handed over.`
            : `PayPal refused the payout because of the sponsor's account (${err.reason}). Nothing was sent. Retry once PayPal clears the account, or turn on manual recording for this group.`,
          { batchId: bw.batch.id, railReason: err.reason },
        );
      }
      if (isAmbiguousPayPalError(err)) {
        // The request may have landed. Never call that FAILED (an organizer might then pay again by
        // other means). Keep the batch UNKNOWN: re-executing re-checks policy and re-sends the SAME
        // sender_batch_id + PayPal-Request-Id, which PayPal answers with the original batch if it exists.
        await updateBatch(db, bw.batch.id, { status: 'UNKNOWN' }).catch(() => {});
        this.deps.log('warn', 'execute.paypal_unknown', { approvalId: a.approvalId, senderBatchId: bw.batch.senderBatchId, error: msg });
        await appendAudit(db, { actor: ACTOR, action: 'approver.paypal_unknown', entityType: 'payout_batch', entityId: bw.batch.id, data: { senderBatchId: bw.batch.senderBatchId, error: msg.slice(0, 300) } }).catch(() => {});
        throw new ApproverFailure(504, 'paypal_unknown', 'PayPal didn’t confirm the payout batch in time. It may still go through; we’ll check again with the same batch id, so it can’t be paid twice.');
      }
      await updateBatch(db, bw.batch.id, { status: 'FAILED' }).catch(() => {});
      this.deps.log('error', 'execute.paypal_failed', { approvalId: a.approvalId, senderBatchId: bw.batch.senderBatchId, error: msg });
      await appendAudit(db, { actor: ACTOR, action: 'approver.paypal_failed', entityType: 'payout_batch', entityId: bw.batch.id, data: { senderBatchId: bw.batch.senderBatchId, error: msg.slice(0, 300) } }).catch(() => {});
      throw new ApproverFailure(502, 'paypal_error', `PayPal didn’t accept the payout batch: ${msg}`);
    }
    for (const it of itemIds) await setPaypalItemId(db, it.senderItemId, it.paypalItemId);
    const fresh = (await getBatch(db, bw.batch.id)) ?? bw;
    const total = fresh.items.reduce((s, i) => s + i.amountCents, 0);
    await appendAudit(db, {
      actor: ACTOR,
      action: 'approver.executed',
      entityType: 'payout_batch',
      entityId: fresh.batch.id,
      data: {
        approvalId: a.approvalId,
        approvalHash: a.hash,
        senderBatchId: fresh.batch.senderBatchId,
        paypalBatchId,
        totalCents: total,
        itemCount: fresh.items.length,
        approvers: a.signatures,
        checks: ['hash', 'distinct_organizers', 'signatures', 'content_from_db', 'policy_recheck', 'can_execute'],
      },
    });
    this.deps.log('info', 'execute.sent', { approvalId: a.approvalId, batchId: fresh.batch.id, senderBatchId: fresh.batch.senderBatchId, paypalBatchId, totalCents: total, items: fresh.items.length });
    return this.response(a.approvalId, a.hash, fresh, true, a.signatures);
  }

  /** Manual rail (manual.ts): record an organizer-attested hand-over for a FAILED_RAIL batch. Moves no money. */
  async recordManual(batchId: string, req: RecordManualRequest): Promise<RecordManualResponse> {
    const db = await this.deps.db();
    const [b] = await db.select().from(payoutBatches).where(eq(payoutBatches.id, batchId));
    if (!b) throw new ApproverFailure(404, 'not_found', `no batch ${batchId}`);
    return this.serial(b.approvalId, () => recordManualPayout({ db, deps: this.deps, rail: this.manual, now: this.now() }, batchId, req));
  }

  private response(approvalId: string, hash: string, bw: BatchWithItems, sentNow: boolean, approvers: ExecuteResponse['approvers']): ExecuteResponse {
    return {
      rail: bw.batch.status === 'MANUAL' ? 'manual' : 'paypal_payouts',
      approvalId,
      hash,
      batchId: bw.batch.id,
      senderBatchId: bw.batch.senderBatchId,
      paypalBatchId: bw.batch.paypalBatchId ?? '',
      sentNow,
      totalCents: bw.items.reduce((s, i) => s + i.amountCents, 0),
      itemCount: bw.items.length,
      approvers,
    };
  }

  /** Read-only: PayPal's view of one of OUR batches (webhook safety net / localhost sandbox). */
  async poll(batchId: string): Promise<PollResponse> {
    const db = await this.deps.db();
    const bw = await getBatch(db, batchId);
    if (!bw) throw new ApproverFailure(404, 'not_found', `no batch ${batchId}`);
    if (!bw.batch.paypalBatchId) throw new ApproverFailure(409, 'not_executable', 'batch has not been sent to PayPal');
    const items = await this.deps.payouts.listAllItems(bw.batch.paypalBatchId);
    return {
      batchId,
      paypalBatchId: bw.batch.paypalBatchId,
      items: items.map((i) => ({ payoutItemId: i.payoutItemId, status: i.status, ...(i.senderItemId ? { senderItemId: i.senderItemId } : {}), ...(i.transactionId ? { transactionId: i.transactionId } : {}) })),
    };
  }

  /** Cancel an UNCLAIMED item: the money returns to the fund. One organizer suffices (no money goes out). */
  async cancelUnclaimed(itemId: string, req: CancelUnclaimedRequest): Promise<CancelUnclaimedResponse> {
    const db = await this.deps.db();
    const [row] = await db.select().from(payoutItems).where(eq(payoutItems.id, itemId));
    if (!row || (req.batchId && row.batchId !== req.batchId)) throw new ApproverFailure(404, 'not_found', 'No such payout item');
    const item = (await getBatch(db, row.batchId))?.items.find((i) => i.id === itemId) as PayoutItem;
    const request = await getRequest(db, item.requestId);
    const organizers = request ? await listOrganizers(db, request.groupId) : [];
    // Re-checked here, not trusted from the web app: an organizer of this group, or in DEMO_MODE the visitor whose own demo run this pays.
    if (req.organizerId) {
      if (!organizers.some((o) => o.id === req.organizerId)) throw new ApproverFailure(403, 'unauthorized', 'Only an organizer of this group can cancel a payout');
    } else if (req.demoVisitorTag) {
      const tag = /^req_demo_([0-9a-f]{12})_[0-9a-f]+$/.exec(item.requestId)?.[1];
      if (!this.deps.config.demoMode || tag !== req.demoVisitorTag) throw new ApproverFailure(403, 'unauthorized', 'A demo visitor can cancel only the payout of their own demo run, and only in DEMO_MODE');
    } else {
      throw new ApproverFailure(403, 'unauthorized', 'Say which organizer cancels this payout');
    }
    if (item.status !== 'UNCLAIMED') throw new ApproverFailure(409, 'not_cancellable', 'Only unclaimed items can be cancelled');
    if (!item.paypalItemId) throw new ApproverFailure(409, 'not_cancellable', 'PayPal has not assigned this item an id yet');
    try {
      await this.deps.payouts.cancelUnclaimedItem(item.paypalItemId);
    } catch (err) {
      throw new ApproverFailure(502, 'paypal_error', `PayPal refused the cancel: ${err instanceof Error ? err.message : err}`);
    }
    await appendAudit(db, { actor: req.organizerId ?? `demo visitor ${req.demoVisitorTag}`, action: 'approver.cancel_unclaimed', entityType: 'payout_item', entityId: item.id, data: { paypalItemId: item.paypalItemId, amountCents: item.amountCents, ...(req.demoVisitorTag ? { demoVisitorTag: req.demoVisitorTag } : {}) } });
    this.deps.log('info', 'cancel.sent', { itemId: item.id, paypalItemId: item.paypalItemId });
    return { itemId: item.id, senderItemId: item.senderItemId, paypalItemId: item.paypalItemId, status: 'CANCELED' };
  }

  /** Verify a webhook sent to the Payouts app (its webhook id + credentials live only here). */
  async verifyWebhook(req: VerifyWebhookRequest): Promise<VerifyWebhookResponse> {
    const id = this.deps.config.webhookId;
    if (!id || !this.deps.webhooks) return { verified: false, reason: 'not_configured' };
    const v = await this.deps.webhooks.verifyWebhookSignature({ headers: req.headers, rawBody: req.rawBody, webhookId: id });
    return v.verified ? { verified: true } : { verified: false, reason: 'failed' };
  }
}
