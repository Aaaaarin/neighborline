/** Sample resources for simulate-event (sample data only — not tied to real state, like PayPal's simulator). */
import { link, type FakeContext } from '../context.js';

export interface Sample {
  resourceType: string;
  resource: unknown;
  summary: string;
}

export function sampleResource(ctx: FakeContext, eventType: string): Sample | undefined {
  const now = ctx.iso();
  if (eventType.startsWith('PAYMENT.PAYOUTS-ITEM.')) {
    const status = { SUCCEEDED: 'SUCCESS', UNCLAIMED: 'UNCLAIMED', RETURNED: 'RETURNED', BLOCKED: 'BLOCKED', CANCELED: 'RETURNED', DENIED: 'FAILED', FAILED: 'FAILED', HELD: 'ONHOLD', REFUNDED: 'REFUNDED', REVERSED: 'REVERSED' }[eventType.split('.')[2] ?? ''];
    if (!status) return undefined;
    const id = ctx.ids.payoutItem();
    return {
      resourceType: 'payouts_item',
      summary: `Simulated ${eventType}`,
      resource: {
        payout_item_id: id,
        transaction_id: ctx.ids.transaction(),
        transaction_status: status,
        payout_item_fee: { currency: 'USD', value: '0.00' },
        payout_batch_id: ctx.ids.payoutBatch(),
        sender_batch_id: 'simulated_batch',
        payout_item: { recipient_type: 'EMAIL', amount: { currency: 'USD', value: '1.00' }, note: 'Simulated', receiver: 'simulated@example.com', sender_item_id: 'simulated_item', recipient_wallet: 'PAYPAL' },
        time_processed: now,
        links: [link(ctx, `/v1/payments/payouts-item/${id}`, 'item')],
      },
    };
  }
  if (eventType.startsWith('PAYMENT.PAYOUTSBATCH.')) {
    const status = { SUCCESS: 'SUCCESS', DENIED: 'DENIED', PROCESSING: 'PROCESSING' }[eventType.split('.')[2] ?? ''];
    if (!status) return undefined;
    const id = ctx.ids.payoutBatch();
    return {
      resourceType: 'payouts',
      summary: `Simulated ${eventType}`,
      resource: {
        batch_header: { payout_batch_id: id, batch_status: status, time_created: now, sender_batch_header: { sender_batch_id: 'simulated_batch' }, amount: { currency: 'USD', value: '1.00' }, fees: { currency: 'USD', value: '0.00' } },
        links: [link(ctx, `/v1/payments/payouts/${id}`, 'self')],
      },
    };
  }
  switch (eventType) {
    case 'CHECKOUT.ORDER.APPROVED':
      return { resourceType: 'checkout-order', summary: 'An order has been approved by buyer', resource: { id: ctx.ids.order(), intent: 'CAPTURE', status: 'APPROVED', purchase_units: [{ reference_id: 'default', amount: { currency_code: 'USD', value: '25.00' } }], create_time: now, links: [] } };
    case 'PAYMENT.CAPTURE.COMPLETED':
      return { resourceType: 'capture', summary: 'Payment completed for $ 25.00 USD', resource: { id: ctx.ids.capture(), status: 'COMPLETED', amount: { currency_code: 'USD', value: '25.00' }, final_capture: true, supplementary_data: { related_ids: { order_id: ctx.ids.order() } }, create_time: now, links: [] } };
    case 'BILLING.SUBSCRIPTION.ACTIVATED':
      return { resourceType: 'subscription', summary: 'Subscription activated', resource: { id: ctx.ids.subscription(), plan_id: ctx.ids.plan(), status: 'ACTIVE', create_time: now, links: [] } };
    case 'PAYMENT.SALE.COMPLETED':
      return { resourceType: 'sale', summary: 'Payment completed for $ 10.00 USD', resource: { id: ctx.ids.transaction(), state: 'completed', amount: { total: '10.00', currency: 'USD' }, billing_agreement_id: ctx.ids.subscription(), create_time: now, links: [] } };
    default:
      return undefined;
  }
}
