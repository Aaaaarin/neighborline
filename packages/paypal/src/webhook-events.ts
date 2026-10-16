/**
 * Typed webhook events. `parseWebhookEvent` validates the envelope + the resource fields we rely on (zod,
 * passthrough for everything else) and returns a discriminated union on `kind`.
 */
import { z } from 'zod';
import { fromPayPalValue } from './money.js';
import { itemStatusFromEvent, mapBatchStatus, type BatchStatus, type PayoutItemStatus } from './payout-status.js';
import { normalizeItem, type NormalizedPayoutItem } from './payouts.js';

const Envelope = z
  .object({
    id: z.string().min(1),
    event_type: z.string().min(1),
    create_time: z.string().optional(),
    resource_type: z.string().optional(),
    resource_version: z.string().optional(),
    summary: z.string().optional(),
    resource: z.record(z.unknown()),
  })
  .passthrough();

const Money = z.object({ currency: z.string(), value: z.string() });
const Amount = z.object({ currency_code: z.string(), value: z.string() });

const PayoutItemResource = z
  .object({
    payout_item_id: z.string(),
    payout_batch_id: z.string(),
    transaction_status: z.string().optional(),
    transaction_id: z.string().optional(),
    sender_batch_id: z.string().optional(),
    payout_item: z.object({ amount: Money, receiver: z.string(), sender_item_id: z.string().optional(), recipient_wallet: z.string().optional(), recipient_type: z.string().optional() }).passthrough(),
  })
  .passthrough();

const PayoutBatchResource = z
  .object({
    batch_header: z
      .object({ payout_batch_id: z.string(), batch_status: z.string(), sender_batch_header: z.object({ sender_batch_id: z.string().optional() }).passthrough().optional() })
      .passthrough(),
  })
  .passthrough();

const OrderResource = z.object({ id: z.string(), status: z.string(), purchase_units: z.array(z.object({ custom_id: z.string().optional(), amount: Amount.optional() }).passthrough()).optional() }).passthrough();
const CaptureResource = z
  .object({ id: z.string(), status: z.string(), amount: Amount, custom_id: z.string().optional(), supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional() }).passthrough().optional() }).passthrough().optional() })
  .passthrough();
const SubscriptionResource = z.object({ id: z.string(), plan_id: z.string().optional(), status: z.string(), custom_id: z.string().optional() }).passthrough();
const SaleResource = z.object({ id: z.string(), amount: z.object({ total: z.string(), currency: z.string() }).passthrough(), billing_agreement_id: z.string().optional(), custom: z.string().optional() }).passthrough();

interface Base {
  eventId: string;
  eventType: string;
  createTime: string | undefined;
  raw: unknown;
}

export type WebhookEvent =
  | (Base & { kind: 'payout_item'; status: PayoutItemStatus; item: NormalizedPayoutItem })
  | (Base & { kind: 'payout_batch'; batchId: string; status: BatchStatus; senderBatchId: string | undefined })
  | (Base & { kind: 'order_approved'; orderId: string; customId: string | undefined; amountCents: number | undefined; currency: string | undefined })
  | (Base & { kind: 'capture_completed'; captureId: string; orderId: string | undefined; customId: string | undefined; amountCents: number; currency: string })
  | (Base & { kind: 'subscription_activated'; subscriptionId: string; planId: string | undefined; customId: string | undefined })
  | (Base & { kind: 'sale_completed'; saleId: string; subscriptionId: string | undefined; customId: string | undefined; amountCents: number; currency: string })
  | (Base & { kind: 'unknown' });

export class WebhookParseError extends Error {
  override name = 'WebhookParseError';
}

/** Parse a raw webhook body (string or parsed object). Throws WebhookParseError on malformed known events. */
export function parseWebhookEvent(input: string | unknown): WebhookEvent {
  let json: unknown = input;
  if (typeof input === 'string') {
    try {
      json = JSON.parse(input);
    } catch {
      throw new WebhookParseError('webhook body is not valid JSON');
    }
  }
  const env = Envelope.safeParse(json);
  if (!env.success) throw new WebhookParseError(`invalid webhook envelope: ${env.error.issues[0]?.message ?? 'unknown'}`);
  const e = env.data;
  const base: Base = { eventId: e.id, eventType: e.event_type, createTime: e.create_time, raw: json };
  const parse = <T extends z.ZodTypeAny>(schema: T): z.infer<T> => {
    const r = schema.safeParse(e.resource);
    if (!r.success) throw new WebhookParseError(`${e.event_type}: unexpected resource shape (${r.error.issues[0]?.path.join('.')}: ${r.error.issues[0]?.message})`);
    return r.data;
  };

  const itemStatus = itemStatusFromEvent(e.event_type);
  if (itemStatus) {
    const r = parse(PayoutItemResource);
    return { ...base, kind: 'payout_item', status: itemStatus, item: normalizeItem(r as Parameters<typeof normalizeItem>[0]) };
  }
  if (e.event_type.startsWith('PAYMENT.PAYOUTSBATCH.')) {
    const r = parse(PayoutBatchResource);
    return { ...base, kind: 'payout_batch', batchId: r.batch_header.payout_batch_id, status: mapBatchStatus(r.batch_header.batch_status), senderBatchId: r.batch_header.sender_batch_header?.sender_batch_id };
  }
  switch (e.event_type) {
    case 'CHECKOUT.ORDER.APPROVED': {
      const r = parse(OrderResource);
      const pu = r.purchase_units?.[0];
      return { ...base, kind: 'order_approved', orderId: r.id, customId: pu?.custom_id, amountCents: pu?.amount ? fromPayPalValue(pu.amount.value, pu.amount.currency_code) : undefined, currency: pu?.amount?.currency_code };
    }
    case 'PAYMENT.CAPTURE.COMPLETED': {
      const r = parse(CaptureResource);
      return { ...base, kind: 'capture_completed', captureId: r.id, orderId: r.supplementary_data?.related_ids?.order_id, customId: r.custom_id, amountCents: fromPayPalValue(r.amount.value, r.amount.currency_code), currency: r.amount.currency_code };
    }
    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      const r = parse(SubscriptionResource);
      return { ...base, kind: 'subscription_activated', subscriptionId: r.id, planId: r.plan_id, customId: r.custom_id };
    }
    case 'PAYMENT.SALE.COMPLETED': {
      const r = parse(SaleResource);
      return { ...base, kind: 'sale_completed', saleId: r.id, subscriptionId: r.billing_agreement_id, customId: r.custom, amountCents: fromPayPalValue(r.amount.total, r.amount.currency), currency: r.amount.currency };
    }
    default:
      return { ...base, kind: 'unknown' };
  }
}
