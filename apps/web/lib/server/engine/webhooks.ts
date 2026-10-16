/**
 * POST /api/webhooks/paypal: verify the signature over the raw bytes (paypal.webhooks →
 * verify-webhook-signature), then apply AT LEAST ONCE: db.beginWebhookEvent records the event id and
 * says new | retry | done; the event is marked processed only after its effects are applied. If the
 * apply throws, we answer 500, PayPal retries, and the retry ('retry') applies it again. Every effect
 * is idempotent (monotonic item state machine; donations keyed by order/transaction id), so applying
 * twice is harmless; acknowledging without applying is what must never happen (QA P2-7).
 * PayPal retries for days, so anything unknown is acknowledged and ignored.
 */
import { itemStatusForWebhookEvent } from '@neighborline/core';
import { parseWebhookEvent, WebhookParseError } from '@neighborline/paypal';
import { beginWebhookEvent, markWebhookProcessed, recordDonation, updateBatch } from '@neighborline/db';
import { HttpError } from '../errors';
import type { BaseCtx } from './context';
import { nowIso } from './events';
import { batchByPaypalId, findItem } from './queries';
import { applyItemStatus } from './settle';

export async function handleWebhook(ctx: BaseCtx, input: { headers: Record<string, string>; rawBody: string }): Promise<{ verified: boolean; eventType: string }> {
  let eventType = 'UNKNOWN';
  try {
    eventType = (JSON.parse(input.rawBody) as { event_type?: string }).event_type ?? 'UNKNOWN';
  } catch {
    throw new HttpError(400, 'Body is not JSON');
  }
  const webhookId = ctx.paypal.env.webhookId;
  let verified = webhookId ? (await ctx.paypal.webhooks.verifyWebhookSignature({ headers: input.headers, rawBody: input.rawBody, webhookId })).verified : false;
  // Payout events are delivered to the separate Payouts app's webhook; only the approver holds that
  // app's webhook id and credentials, so it verifies them for us (read-only).
  if (!verified && eventType.startsWith('PAYMENT.PAYOUTS')) verified = await ctx.verifyPayoutsWebhook(input);
  if (!verified) return { verified: false, eventType };

  let ev;
  try {
    ev = parseWebhookEvent(input.rawBody);
  } catch (err) {
    if (err instanceof WebhookParseError) throw new HttpError(400, err.message);
    throw err;
  }
  const resourceId = ev.kind === 'payout_item' ? ev.item.payoutItemId : ev.kind === 'payout_batch' ? ev.batchId : null;
  const state = await beginWebhookEvent(ctx.db, { id: ev.eventId, eventType: ev.eventType, resourceId, verified: true, raw: ev.raw });
  if (state === 'done') return { verified: true, eventType }; // duplicate delivery of an applied event

  if (ev.kind === 'payout_item') {
    const item = await findItem(ctx.db, { paypalItemId: ev.item.payoutItemId, senderItemId: ev.item.senderItemId });
    ctx.bus.emit({ type: 'webhook.verified', at: nowIso(), eventType: ev.eventType, eventId: ev.eventId }, item ? [item.requestId] : []);
    const status = itemStatusForWebhookEvent(ev.eventType) ?? ev.status;
    if (item) {
      await applyItemStatus(ctx, {
        paypalItemId: ev.item.payoutItemId,
        ...(ev.item.senderItemId ? { senderItemId: ev.item.senderItemId } : { senderItemId: item.senderItemId }),
        status,
        ...(ev.item.transactionId ? { transactionId: ev.item.transactionId } : {}),
        actor: 'paypal-webhook',
      });
    }
  } else {
    ctx.bus.emit({ type: 'webhook.verified', at: nowIso(), eventType: ev.eventType, eventId: ev.eventId }, []);
    if (ev.kind === 'payout_batch') {
      const b = await batchByPaypalId(ctx.db, ev.batchId);
      if (b && b.status !== ev.status) await updateBatch(ctx.db, b.id, { status: ev.status });
    } else if (ev.kind === 'capture_completed' && ev.orderId) {
      // Usually recorded already by our capture call; idempotent on order id / transaction id.
      const { created } = await recordDonation(ctx.db, { groupId: ctx.gen.group.id, amountCents: ev.amountCents, source: 'PAYPAL', paypalOrderId: ev.orderId, transactionId: ev.captureId });
      if (created) ctx.bus.emit({ type: 'donation.captured', at: nowIso(), amountCents: ev.amountCents, source: 'PAYPAL' }, []);
    }
  }
  await markWebhookProcessed(ctx.db, ev.eventId);
  return { verified: true, eventType: ev.eventType };
}
