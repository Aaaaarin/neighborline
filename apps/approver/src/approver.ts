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
 *      calls PayPal Payouts, records the PayPal ids, and appends a hash-chained audit entry.
 * A second call for the same approval returns the same batch without calling PayPal again.
 */
import { eq } from 'drizzle-orm';
import {
  approvalHash,
  approvalPayload,
  canonicalJson,
  distinctApprovers,
  sha256Hex,
  type Group,
  type HelpRequest,
  type Lang,
  type PayoutItem,
} from '@neighborline/core';
import {
  RepoError,
  appendAudit,
  approvals,
  contentFromRequests,
  createBatch,
  getApproval,
  getBatch,
  getGroup,
  getRequest,
  listOrganizers,
  payoutBatches,
  payoutItems,
  setPaypalItemId,
  updateBatch,
  type BatchWithItems,
  type Db,
} from '@neighborline/db';
import { isAmbiguousPayPalError, type PayoutItemInput, type PayoutsApi, type WebhooksApi } from '@neighborline/paypal';
import { checkAssertions } from './assertions.js';
import type { ApproverConfig, Env } from './config.js';
import type { Logger } from './log.js';
import type { ApproverError, CancelUnclaimedRequest, CancelUnclaimedResponse, ExecuteRequest, ExecuteResponse, PollResponse, VerifyWebhookRequest, VerifyWebhookResponse } from './protocol.js';
import { recheckPolicy } from './recheck.js';

export class ApproverFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ApproverError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ApproverFailure';
  }
}

export interface ApproverDeps {
  /** Current database handle (a function so tests can follow a demo reset). */
  db: () => Db | Promise<Db>;
  payouts: PayoutsApi;
  /** WebhooksApi on the Payouts app's credentials (for /v1/verify-webhook). */
  webhooks?: WebhooksApi;
  config: Pick<ApproverConfig, 'requirePasskeys' | 'demoMode'> & { webhookId?: string | undefined };
  /** Read for WebAuthn origin rules (WEBAUTHN_ORIGIN, WEBAUTHN_RP_ID, APP_BASE_URL, DEMO_MODE). */
  env: Env;
  log: Logger;
  now?: () => Date;
}

/** Mutual aid is neither goods nor services (PayPal defaults to GOODS when `purpose` is omitted). */
export const PAYOUT_PURPOSE = 'NON_GOODS_OR_SERVICES' as const;
/** PayPal notification_language for recipients without an account (only locales PayPal lists). */
const NOTIFICATION_LANG: Partial<Record<Lang, string>> = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', zh: 'zh-CN', ru: 'ru-RU', ko: 'ko-KR' };
const ACTOR = 'approver';

export class Approver {
  private readonly inflight = new Map<string, Promise<ExecuteResponse>>();

  constructor(private readonly deps: ApproverDeps) {}

  /** Single-flight per approval: concurrent calls share one PayPal call. */
  execute(req: ExecuteRequest): Promise<ExecuteResponse> {
    let p = this.inflight.get(req.approvalId);
    if (!p) {
      p = this.executeOnce(req).finally(() => this.inflight.delete(req.approvalId));
      this.inflight.set(req.approvalId, p);
    }
    return p;
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
    if (existing?.paypalBatchId) {
      const bw = (await getBatch(db, existing.id))!;
      this.deps.log('info', 'execute.idempotent', { approvalId: approval.id, batchId: existing.id, senderBatchId: existing.senderBatchId });
      return this.response(approval.id, hash, bw, false, approval.approvers.map((a) => ({ organizerId: a.organizerId, signature: a.assertion?.kind ?? 'unsigned' })));
    }

    if (!existing && approval.status !== 'complete') return fail(409, 'not_complete', `approval is ${approval.status}, not complete`);
    const group = await getGroup(db, row.groupId);
    if (!group) return fail(404, 'not_found', 'group not found');
    const required = Math.max(2, group.requiredApprovals);
    const organizerIds = new Set((await listOrganizers(db, group.id)).map((o) => o.id));
    const counted = approval.approvers.filter((a) => organizerIds.has(a.organizerId));
    if (distinctApprovers(counted) < required) {
      return fail(403, 'too_few_approvers', `needs ${required} distinct organizers; the record has ${distinctApprovers(counted)}`);
    }
    const claimed = [...new Set(req.approvers.map((a) => a.organizerId))].sort();
    const recorded = [...new Set(approval.approvers.map((a) => a.organizerId))].sort();
    if (claimed.join('\n') !== recorded.join('\n')) return fail(409, 'approver_mismatch', 'the approvers in the request do not match the approval record');

    // 3. Signatures over the hash, re-verified with the organizers' public keys.
    const sigs = await checkAssertions(db, { approvers: counted, approvalHash: hash, requestIds: approval.requestIds, demoMode: this.deps.config.demoMode, env: this.deps.env });
    const bad = sigs.filter((s) => !s.ok);
    if (bad.length) return fail(403, 'assertion_invalid', bad.map((s) => `${s.organizerId}: ${s.reason}`).join('; '));

    // 4. Content from the request rows, read here.
    const requests: HelpRequest[] = [];
    for (const id of approval.requestIds) {
      const r = await getRequest(db, id);
      if (!r || r.groupId !== group.id) return fail(409, 'tampered', `request ${id} is missing or belongs to another group`);
      requests.push(r);
    }
    let dbHash: string;
    try {
      dbHash = approvalHash(contentFromRequests(requests));
    } catch (err) {
      return fail(409, 'tampered', `requests no longer form a valid approval: ${err instanceof Error ? err.message : err}`);
    }
    if (dbHash !== hash) return fail(409, 'tampered', 'the requests changed after they were approved (amount, destination or policy differs)');

    // 5. Policy re-check from first principles — before the first send AND before any re-send of a
    // batch whose earlier attempt failed or ended UNKNOWN (the batch's own requests are excluded from
    // history and today's spend, so a retry is judged exactly like the first attempt).
    const re = await recheckPolicy(db, { group, policyVersionId: approval.policyVersionId, requests, demoMode: this.deps.config.demoMode, now: this.now() });
    if (!re.ok) return fail(409, 'policy_violation', re.problems.join('; '));
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
    const note = `Mutual aid from your neighbors at ${a.group.name}. No need to pay it back.`;
    const items: PayoutItemInput[] = bw.items.map((it) => {
      const lang = a.requests.find((r) => r.id === it.requestId)?.lang;
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
      const res = await this.deps.payouts.createBatch({ senderBatchId: bw.batch.senderBatchId, emailSubject: `Your neighbors at ${a.group.name} sent you help`, items });
      paypalBatchId = res.batchId;
      await updateBatch(db, bw.batch.id, { paypalBatchId, status: res.status === 'CREATING' ? 'PENDING' : res.status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
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
    try {
      const details = await this.deps.payouts.getBatch(paypalBatchId);
      for (const it of details.items) if (it.senderItemId) await setPaypalItemId(db, it.senderItemId, it.payoutItemId);
    } catch {
      /* item ids also arrive with the item webhooks */
    }
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

  private response(approvalId: string, hash: string, bw: BatchWithItems, sentNow: boolean, approvers: ExecuteResponse['approvers']): ExecuteResponse {
    return {
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
    if (req.organizerId && !organizers.some((o) => o.id === req.organizerId)) throw new ApproverFailure(403, 'unauthorized', 'Only an organizer of this group can cancel a payout');
    if (item.status !== 'UNCLAIMED') throw new ApproverFailure(409, 'not_cancellable', 'Only unclaimed items can be cancelled');
    if (!item.paypalItemId) throw new ApproverFailure(409, 'not_cancellable', 'PayPal has not assigned this item an id yet');
    try {
      await this.deps.payouts.cancelUnclaimedItem(item.paypalItemId);
    } catch (err) {
      throw new ApproverFailure(502, 'paypal_error', `PayPal refused the cancel: ${err instanceof Error ? err.message : err}`);
    }
    await appendAudit(db, { actor: req.organizerId ?? 'web (no organizer id)', action: 'approver.cancel_unclaimed', entityType: 'payout_item', entityId: item.id, data: { paypalItemId: item.paypalItemId, amountCents: item.amountCents } });
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
