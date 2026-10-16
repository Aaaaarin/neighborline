/**
 * Payouts v1 (PayPal + Venmo). Idempotency is layered:
 *   1. `sender_batch_id` — PayPal refuses reuse for 30 days, so a payout can never be paid twice.
 *   2. `PayPal-Request-Id` = sender_batch_id — replaying the same create returns the original batch.
 *   3. If PayPal answers "duplicate sender_batch_id", we follow the HATEOAS link in the error to the original
 *      batch and return it (`duplicate: true`); if no link is present we throw `DuplicateBatchError`.
 */
import { PayPalApiError, DuplicateBatchError, PayPalInputError } from './errors.js';
import { seg, type MockResponse, type PayPalClient } from './client.js';
import { fromPayPalValue, money, type PayPalMoney } from './money.js';
import { mapBatchStatus, mapTransactionStatus, type BatchStatus, type PayoutItemStatus } from './payout-status.js';

export const PAYOUT_PURPOSES = ['AWARDS', 'PRIZES', 'DONATIONS', 'GOODS', 'SERVICES', 'REBATES', 'CASHBACK', 'DISCOUNTS', 'NON_GOODS_OR_SERVICES'] as const;
export type PayoutPurpose = (typeof PAYOUT_PURPOSES)[number];
export type PayoutRecipientType = 'EMAIL' | 'PHONE' | 'USER_HANDLE' | 'PAYPAL_ID';
export type PayoutWallet = 'PAYPAL' | 'VENMO';
export type SocialFeedPrivacy = 'PRIVATE' | 'FRIENDS_ONLY' | 'PUBLIC';

export interface PayoutItemInput {
  /** Your id for this item (≤63 chars); appears in GET responses, webhooks and reports. */
  senderItemId: string;
  /** Integer minor units (cents). */
  amountCents: number;
  currency?: string;
  receiver: string;
  recipientType: PayoutRecipientType;
  wallet?: PayoutWallet;
  /** Shown to the recipient. REQUIRED for Venmo. ≤4000 ASCII / ≤1000 non-ASCII chars. */
  note?: string;
  purpose?: PayoutPurpose;
  /** Venmo only; we default to PRIVATE (also PayPal's default) and always send it explicitly. */
  socialFeedPrivacy?: SocialFeedPrivacy;
  /** e.g. 'es-US'; used only when the recipient has no PayPal account. */
  notificationLanguage?: string;
}

export interface CreateBatchInput {
  senderBatchId: string;
  emailSubject?: string;
  emailMessage?: string;
  items: PayoutItemInput[];
  /** Defaults to `senderBatchId`, so double-submits replay instead of erroring. */
  requestId?: string;
  mockResponse?: MockResponse;
}

export interface CreateBatchResult {
  batchId: string;
  status: BatchStatus;
  paypalStatus: string;
  senderBatchId: string;
  timeCreated: string | undefined;
  /** True when PayPal reported the sender_batch_id as already used and we resolved the original batch. */
  duplicate: boolean;
  raw: unknown;
}

export interface NormalizedPayoutItem {
  payoutItemId: string;
  payoutBatchId: string;
  senderBatchId: string | undefined;
  senderItemId: string | undefined;
  transactionId: string | undefined;
  activityId: string | undefined;
  status: PayoutItemStatus;
  paypalStatus: string;
  amountCents: number;
  currency: string;
  feeCents: number | undefined;
  receiver: string;
  recipientType: string | undefined;
  wallet: PayoutWallet;
  timeProcessed: string | undefined;
  /** PayPal's reason for UNCLAIMED/BLOCKED/FAILED items, e.g. RECEIVER_UNREGISTERED. */
  errorName: string | undefined;
  errorMessage: string | undefined;
  raw: unknown;
}

export interface BatchDetails {
  batchId: string;
  status: BatchStatus;
  paypalStatus: string;
  senderBatchId: string | undefined;
  timeCreated: string | undefined;
  timeCompleted: string | undefined;
  amountCents: number | undefined;
  feesCents: number | undefined;
  currency: string | undefined;
  items: NormalizedPayoutItem[];
  totalItems: number | undefined;
  totalPages: number | undefined;
  hasNextPage: boolean;
  raw: unknown;
}

const MAX_ITEMS = 15_000;
const isAscii = (s: string) => /^[\x00-\x7f]*$/.test(s);

function checkLen(value: string | undefined, max: number, field: string): void {
  if (value !== undefined && value.length > max) throw new PayPalInputError(`${field} exceeds ${max} characters`, field);
}

/** Pure: validate input and build the wire request. Throws PayPalInputError before anything is sent. */
export function buildPayoutRequest(input: CreateBatchInput) {
  if (!input.senderBatchId) throw new PayPalInputError('senderBatchId is required', 'senderBatchId');
  checkLen(input.senderBatchId, 256, 'senderBatchId');
  checkLen(input.emailSubject, 255, 'emailSubject');
  checkLen(input.emailMessage, 1000, 'emailMessage');
  if (input.items.length === 0 || input.items.length > MAX_ITEMS) throw new PayPalInputError(`A batch needs 1–${MAX_ITEMS} items`, 'items');
  const currencies = new Set(input.items.map((i) => (i.currency ?? 'USD').toUpperCase()));
  if (currencies.size > 1) throw new PayPalInputError('PayPal requires one currency per payout call; split the batch', 'items');
  const seen = new Set<string>();

  const items = input.items.map((it, idx) => {
    const f = (name: string) => `items[${idx}].${name}`;
    const wallet = it.wallet ?? 'PAYPAL';
    const currency = (it.currency ?? 'USD').toUpperCase();
    if (!Number.isSafeInteger(it.amountCents) || it.amountCents <= 0) throw new PayPalInputError('amountCents must be a positive integer', f('amountCents'));
    if (!it.senderItemId) throw new PayPalInputError('senderItemId is required', f('senderItemId'));
    checkLen(it.senderItemId, 63, f('senderItemId'));
    if (seen.has(it.senderItemId)) throw new PayPalInputError(`duplicate senderItemId "${it.senderItemId}"`, f('senderItemId'));
    seen.add(it.senderItemId);
    if (!it.receiver) throw new PayPalInputError('receiver is required', f('receiver'));
    checkLen(it.receiver, 127, f('receiver'));
    if (it.recipientType === 'USER_HANDLE' && wallet !== 'VENMO') throw new PayPalInputError('USER_HANDLE (Venmo username) requires wallet VENMO', f('recipientType'));
    if (wallet === 'VENMO' && !it.note?.trim()) throw new PayPalInputError('Venmo payouts require a note', f('note'));
    if (it.note !== undefined) checkLen(it.note, isAscii(it.note) ? 4000 : 1000, f('note'));
    if (it.purpose !== undefined && !PAYOUT_PURPOSES.includes(it.purpose)) throw new PayPalInputError(`invalid purpose "${it.purpose}"`, f('purpose'));
    if (it.socialFeedPrivacy && wallet !== 'VENMO') throw new PayPalInputError('socialFeedPrivacy only applies to Venmo', f('socialFeedPrivacy'));

    return {
      recipient_type: it.recipientType,
      amount: money(it.amountCents, currency),
      receiver: it.receiver,
      sender_item_id: it.senderItemId,
      recipient_wallet: wallet,
      ...(it.note !== undefined ? { note: it.note } : {}),
      ...(it.purpose ? { purpose: it.purpose } : {}),
      ...(it.notificationLanguage ? { notification_language: it.notificationLanguage } : {}),
      ...(wallet === 'VENMO' ? { application_context: { social_feed_privacy: it.socialFeedPrivacy ?? 'PRIVATE' } } : {}),
    };
  });

  return {
    sender_batch_header: {
      sender_batch_id: input.senderBatchId,
      ...(input.emailSubject ? { email_subject: input.emailSubject } : {}),
      ...(input.emailMessage ? { email_message: input.emailMessage } : {}),
    },
    items,
  };
}

/**
 * Recognise PayPal's "sender_batch_id already used" rejection. The error name is undocumented (observed:
 * 400 USER_BUSINESS_ERROR with a details issue mentioning sender_batch_id), so we match on content, not name.
 */
export function isDuplicateSenderBatchError(err: unknown): err is PayPalApiError {
  if (!(err instanceof PayPalApiError) || err.status < 400 || err.status >= 500) return false;
  if (err.hasIssue('SENDER_BATCH_ID_ALREADY_USED') || err.hasIssue('DUPLICATE_SENDER_BATCH_ID')) return true;
  return err.details.some((d) => /sender_batch_id/i.test(`${d.field ?? ''} ${d.issue} ${d.description ?? ''}`) && /exist|already|duplicate|used/i.test(`${d.issue} ${d.description ?? ''}`));
}

/** Find `/v1/payments/payouts/{id}` in any link array of an error body (details[].link, details[].links, links). */
export function findExistingBatchId(body: unknown): string | undefined {
  const hrefs: string[] = [];
  const visit = (v: unknown, depth: number): void => {
    if (depth > 4 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    const o = v as Record<string, unknown>;
    if (typeof o.href === 'string') hrefs.push(o.href);
    for (const k of ['details', 'link', 'links']) if (k in o) visit(o[k], depth + 1);
  };
  visit(body, 0);
  for (const href of hrefs) {
    const m = /\/v1\/payments\/payouts\/([A-Za-z0-9]+)(?:[/?#]|$)/.exec(href);
    if (m) return m[1];
  }
  return undefined;
}

interface WireItem {
  payout_item_id: string;
  transaction_id?: string;
  activity_id?: string;
  transaction_status?: string;
  payout_item_fee?: PayPalMoney;
  payout_batch_id: string;
  sender_batch_id?: string;
  payout_item: { recipient_type?: string; amount: PayPalMoney; receiver: string; sender_item_id?: string; recipient_wallet?: string };
  time_processed?: string;
  errors?: { name?: string; message?: string };
}

export function normalizeItem(w: WireItem): NormalizedPayoutItem {
  const currency = w.payout_item.amount.currency;
  return {
    payoutItemId: w.payout_item_id,
    payoutBatchId: w.payout_batch_id,
    senderBatchId: w.sender_batch_id,
    senderItemId: w.payout_item.sender_item_id,
    transactionId: w.transaction_id,
    activityId: w.activity_id,
    status: mapTransactionStatus(w.transaction_status),
    paypalStatus: w.transaction_status ?? 'UNKNOWN',
    amountCents: fromPayPalValue(w.payout_item.amount.value, currency),
    currency,
    feeCents: w.payout_item_fee ? fromPayPalValue(w.payout_item_fee.value, w.payout_item_fee.currency) : undefined,
    receiver: w.payout_item.receiver,
    recipientType: w.payout_item.recipient_type,
    wallet: (w.payout_item.recipient_wallet ?? 'PAYPAL').toUpperCase() === 'VENMO' ? 'VENMO' : 'PAYPAL',
    timeProcessed: w.time_processed,
    errorName: w.errors?.name,
    errorMessage: w.errors?.message,
    raw: w,
  };
}

interface WireBatch {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
    time_created?: string;
    time_completed?: string;
    sender_batch_header?: { sender_batch_id?: string };
    amount?: PayPalMoney;
    fees?: PayPalMoney;
  };
  items?: WireItem[];
  links?: Array<{ rel: string }>;
  total_items?: number;
  total_pages?: number;
}

export class PayoutsApi {
  constructor(private readonly client: PayPalClient) {}

  async createBatch(input: CreateBatchInput): Promise<CreateBatchResult> {
    const body = buildPayoutRequest(input);
    try {
      const res = await this.client.request<WireBatch>({
        method: 'POST',
        path: '/v1/payments/payouts',
        body,
        requestId: input.requestId ?? input.senderBatchId,
        ...(input.mockResponse ? { mockResponse: input.mockResponse } : {}),
      });
      const h = res.data.batch_header;
      return { batchId: h.payout_batch_id, status: mapBatchStatus(h.batch_status), paypalStatus: h.batch_status, senderBatchId: input.senderBatchId, timeCreated: h.time_created, duplicate: false, raw: res.data };
    } catch (err) {
      if (!isDuplicateSenderBatchError(err)) throw err;
      const existing = findExistingBatchId(err.body);
      if (!existing) throw new DuplicateBatchError(input.senderBatchId, err);
      const batch = await this.getBatch(existing, { pageSize: 1 });
      return { batchId: batch.batchId, status: batch.status, paypalStatus: batch.paypalStatus, senderBatchId: input.senderBatchId, timeCreated: batch.timeCreated, duplicate: true, raw: batch.raw };
    }
  }

  async getBatch(batchId: string, opts: { page?: number; pageSize?: number; totalRequired?: boolean } = {}): Promise<BatchDetails> {
    const res = await this.client.request<WireBatch>({
      path: `/v1/payments/payouts/${seg(batchId)}`,
      query: { page: opts.page ?? 1, page_size: opts.pageSize ?? 1000, total_required: opts.totalRequired ?? true },
    });
    const d = res.data;
    const h = d.batch_header;
    return {
      batchId: h.payout_batch_id,
      status: mapBatchStatus(h.batch_status),
      paypalStatus: h.batch_status,
      senderBatchId: h.sender_batch_header?.sender_batch_id,
      timeCreated: h.time_created,
      timeCompleted: h.time_completed,
      amountCents: h.amount ? fromPayPalValue(h.amount.value, h.amount.currency) : undefined,
      feesCents: h.fees ? fromPayPalValue(h.fees.value, h.fees.currency) : undefined,
      currency: h.amount?.currency,
      items: (d.items ?? []).map(normalizeItem),
      totalItems: d.total_items,
      totalPages: d.total_pages,
      hasNextPage: (d.links ?? []).some((l) => l.rel === 'next'),
      raw: d,
    };
  }

  /** Every item of a batch, following pagination. */
  async listAllItems(batchId: string, pageSize = 1000): Promise<NormalizedPayoutItem[]> {
    const out: NormalizedPayoutItem[] = [];
    for (let page = 1; page <= 1000; page++) {
      const b = await this.getBatch(batchId, { page, pageSize });
      out.push(...b.items);
      if (!b.hasNextPage || b.items.length === 0) break;
    }
    return out;
  }

  async getItem(payoutItemId: string): Promise<NormalizedPayoutItem> {
    const res = await this.client.request<WireItem>({ path: `/v1/payments/payouts-item/${seg(payoutItemId)}` });
    return normalizeItem(res.data);
  }

  /** Only UNCLAIMED items can be cancelled; the money returns to the sender (status RETURNED). */
  async cancelUnclaimedItem(payoutItemId: string): Promise<NormalizedPayoutItem> {
    const res = await this.client.request<WireItem>({ method: 'POST', path: `/v1/payments/payouts-item/${seg(payoutItemId)}/cancel`, requestId: `cancel-${payoutItemId}` });
    return normalizeItem(res.data);
  }
}
