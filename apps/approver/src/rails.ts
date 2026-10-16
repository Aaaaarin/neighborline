/**
 * Payout rails (JUDGE-PANEL-2 #10: "what is the fallback when the sponsor's PayPal is under review?").
 *
 * A rail is how an executed two-person approval reaches the neighbor:
 *   - `paypal_payouts` (primary): one PayPal Payouts batch, idempotent by sender_batch_id.
 *   - `manual` (fallback): an organizer-attested record that the money was handed over some other way
 *     (cash, a check from the sponsor, other). It NEVER moves money and has no credentials: it only
 *     records. It is allowed only for a batch PayPal refused at the account level (FAILED_RAIL, so
 *     certainly nothing was sent), only when the group turned the fallback on, and only with the same
 *     two re-verified passkey signatures as a PayPal payout plus a receipt note (approver.ts).
 *
 * Account-level PayPal errors (the sponsor's account is restricted, locked or not authorized for
 * Payouts) are told apart from ambiguous errors (timeouts, 5xx: the batch may have landed → UNKNOWN,
 * never FAILED_RAIL) and from ordinary rejections (validation, insufficient funds → FAILED).
 */
import type { Group, HelpRequest, Lang } from '@neighborline/core';
import type { BatchWithItems } from '@neighborline/db';
import {
  PayPalApiError,
  PayPalAuthError,
  isAmbiguousPayPalError,
  type BatchStatus,
  type PayoutItemInput,
  type PayoutsApi,
} from '@neighborline/paypal';

/** Mutual aid is neither goods nor services (PayPal defaults to GOODS when `purpose` is omitted). */
export const PAYOUT_PURPOSE = 'NON_GOODS_OR_SERVICES' as const;
/** PayPal notification_language for recipients without an account (only locales PayPal lists). */
const NOTIFICATION_LANG: Partial<Record<Lang, string>> = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', zh: 'zh-CN', ru: 'ru-RU', ko: 'ko-KR' };

export type RailKind = 'paypal_payouts' | 'manual';
export type ManualMethod = 'cash' | 'check' | 'other';

export interface RailItem extends Omit<PayoutItemInput, 'note' | 'purpose'> {
  senderItemId: string;
}

export interface RailBatch {
  senderBatchId: string;
  emailSubject: string;
  note: string;
  purpose: PayoutItemInput['purpose'];
  items: RailItem[];
}

/** What an organizer attests on the manual rail. Stored in the audit log; never sent anywhere. */
export interface ManualAttestation {
  method: ManualMethod;
  receiptNote: string;
  recordedBy: string;
}

export type RailResult =
  | { rail: 'paypal_payouts'; paypalBatchId: string; status: BatchStatus; items: Array<{ senderItemId: string; paypalItemId: string }> }
  | { rail: 'manual'; reference: string; attestation: ManualAttestation };

export interface PayoutRail {
  readonly kind: RailKind;
  /** false for the manual rail: it records an attestation and moves no money. */
  readonly movesMoney: boolean;
  send(batch: RailBatch, opts?: { attestation?: ManualAttestation }): Promise<RailResult>;
}

/**
 * Payouts error names that mean the SENDER's account (the fiscal sponsor's) can't pay right now, so no
 * retry with the same account will help until PayPal clears it. Names are PayPal's documented Payouts
 * negative-testing values (packages/paypal/PAYPAL_NOTES.md, "Payouts negative testing": ERRPYO001
 * SENDER_RESTRICTED, ERRPYO002 SENDER_EMAIL_UNCONFIRMED, ERRPYO003 AUTHORIZATION_ERROR, ERRPYO011
 * REQUIRED_SCOPE_MISSING, ERRPYO012 SENDER_LOCKED, ERRPYO040 CIP_NOT_VERIFIED) plus PayPal's common
 * REST 403 NOT_AUTHORIZED / PERMISSION_DENIED. ("ACCOUNT_RESTRICTED" is not a documented Payouts name;
 * SENDER_RESTRICTED is.) INSUFFICIENT_FUNDS is deliberately not here: topping up fixes it.
 */
export const ACCOUNT_LEVEL_ERRORS = new Set([
  'SENDER_RESTRICTED',
  'SENDER_LOCKED',
  'SENDER_EMAIL_UNCONFIRMED',
  'CIP_NOT_VERIFIED',
  'AUTHORIZATION_ERROR',
  'REQUIRED_SCOPE_MISSING',
  'NOT_AUTHORIZED',
  'PERMISSION_DENIED',
]);

/** The sponsor's PayPal can't pay at all right now (restricted, locked, credentials or permission revoked). */
export function accountLevelReason(err: unknown): string | null {
  if (isAmbiguousPayPalError(err)) return null;
  if (err instanceof PayPalAuthError) return `OAuth ${err.status} ${err.name}`;
  if (!(err instanceof PayPalApiError)) return null;
  const named = [err.name, ...err.details.map((d) => d.issue)].find((n) => ACCOUNT_LEVEL_ERRORS.has(n));
  if (named) return named;
  // Any 401/403 on a Payouts write is about who is sending, not about this batch.
  if (err.status === 401 || err.status === 403) return `HTTP ${err.status} ${err.name}`;
  return null;
}

/** PayPal refused at the account level: nothing was sent, and re-sending won't help until PayPal clears it. */
export class RailUnavailable extends Error {
  constructor(
    readonly reason: string,
    readonly debugId: string | undefined,
    override readonly cause: unknown,
  ) {
    super(`PayPal refused the payout at the account level (${reason}). Nothing was sent.`);
    this.name = 'RailUnavailable';
  }
}

export class PayPalPayoutsRail implements PayoutRail {
  readonly kind = 'paypal_payouts' as const;
  readonly movesMoney = true;

  constructor(private readonly payouts: PayoutsApi) {}

  /** Throws RailUnavailable for account-level refusals; other errors propagate unchanged (ambiguous → UNKNOWN). */
  async send(batch: RailBatch): Promise<RailResult> {
    let res;
    try {
      res = await this.payouts.createBatch({
        senderBatchId: batch.senderBatchId,
        emailSubject: batch.emailSubject,
        items: batch.items.map((i) => ({ ...i, note: batch.note, purpose: batch.purpose })),
      });
    } catch (err) {
      const reason = accountLevelReason(err);
      if (reason) throw new RailUnavailable(reason, err instanceof PayPalApiError ? err.debugId : undefined, err);
      throw err;
    }
    const items: Array<{ senderItemId: string; paypalItemId: string }> = [];
    try {
      const details = await this.payouts.getBatch(res.batchId);
      for (const it of details.items) if (it.senderItemId) items.push({ senderItemId: it.senderItemId, paypalItemId: it.payoutItemId });
    } catch {
      /* item ids also arrive with the item webhooks */
    }
    return { rail: 'paypal_payouts', paypalBatchId: res.batchId, status: res.status === 'CREATING' ? 'PENDING' : res.status, items };
  }
}

/** One batch row → what a rail sends (or records). Amounts and receivers come from the batch items (db). */
export function railBatchFor(group: Group, requests: readonly HelpRequest[], bw: BatchWithItems): RailBatch {
  return {
    senderBatchId: bw.batch.senderBatchId,
    emailSubject: `Your neighbors at ${group.name} sent you help`,
    note: `Mutual aid from your neighbors at ${group.name}. No need to pay it back.`,
    purpose: PAYOUT_PURPOSE,
    items: bw.items.map((it) => {
      const lang = requests.find((r) => r.id === it.requestId)?.lang;
      const nl = lang ? NOTIFICATION_LANG[lang] : undefined;
      return {
        senderItemId: it.senderItemId,
        amountCents: it.amountCents,
        receiver: it.receiver,
        recipientType: it.recipientType,
        wallet: it.wallet,
        ...(it.wallet === 'VENMO' ? { socialFeedPrivacy: 'PRIVATE' as const } : {}),
        ...(nl ? { notificationLanguage: nl } : {}),
      };
    }),
  };
}

export const MANUAL_METHODS: readonly ManualMethod[] = ['cash', 'check', 'other'];

/** The fallback: records an organizer's attestation. No client, no credentials, no network. */
export class ManualRail implements PayoutRail {
  readonly kind = 'manual' as const;
  readonly movesMoney = false;

  async send(batch: RailBatch, opts?: { attestation?: ManualAttestation }): Promise<RailResult> {
    const a = opts?.attestation;
    if (!a) throw new Error('the manual rail needs an organizer attestation');
    if (!MANUAL_METHODS.includes(a.method)) throw new Error(`unknown manual method ${a.method}`);
    if (a.receiptNote.trim().length < 8) throw new Error('a receipt note (who received it, how, when) is required');
    // A reference the organizers can write on the receipt: derived from the batch, never a PayPal id.
    return { rail: 'manual', reference: `MANUAL-${batch.senderBatchId.replace(/^nl_/, '').slice(0, 12).toUpperCase()}`, attestation: { ...a, receiptNote: a.receiptNote.trim() } };
  }
}
