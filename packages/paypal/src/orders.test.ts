import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startFake, type FakeHarness } from '../test/fake.js';
import { buildDonationOrder } from './orders.js';

describe('buildDonationOrder (pure)', () => {
  it('builds a DONATION item with breakdown and only adds payment_source for redirect flows', () => {
    const sdk = buildDonationOrder({ amountCents: 2500, description: 'Ice storm fund', customId: 'don_1' });
    expect(sdk.purchase_units[0]).toMatchObject({
      custom_id: 'don_1',
      amount: { currency_code: 'USD', value: '25.00', breakdown: { item_total: { currency_code: 'USD', value: '25.00' } } },
      items: [{ category: 'DONATION', quantity: '1', unit_amount: { value: '25.00' } }],
    });
    expect(sdk).not.toHaveProperty('payment_source');
    const redirect = buildDonationOrder({ amountCents: 1000, description: 'x', returnUrl: 'https://app/return' });
    expect(redirect.payment_source?.paypal.experience_context).toMatchObject({ return_url: 'https://app/return', shipping_preference: 'NO_SHIPPING' });
  });
});

describe('Orders + Subscriptions against fake-paypal', () => {
  let h: FakeHarness;
  beforeAll(async () => {
    h = await startFake();
  });
  afterEach(() => {
    h.fake.reset();
  });
  afterAll(() => h.close());

  it('create → (donor approves) → capture; a double-tap capture returns the same capture', async () => {
    const order = await h.paypal.orders.createDonationOrder({ amountCents: 2500, description: 'Donation', customId: 'don_9' });
    expect(order.status).toBe('CREATED');
    expect(order.approveUrl).toContain(`token=${order.id}`);
    await h.control(`/__fake/orders/${order.id}/approve`, { fundingSource: 'venmo', payerEmail: 'donor@example.com' });
    const cap = await h.paypal.orders.captureOrder(order.id);
    expect(cap).toMatchObject({ status: 'COMPLETED', captureStatus: 'COMPLETED', amountCents: 2500, customId: 'don_9', fundingSource: 'venmo', payerEmail: 'donor@example.com', alreadyCaptured: false });
    const again = await h.paypal.orders.captureOrder(order.id);
    expect(again.captureId).toBe(cap.captureId);
    const otherKey = await h.paypal.orders.captureOrder(order.id, { requestId: 'different-key' });
    expect(otherKey).toMatchObject({ captureId: cap.captureId, alreadyCaptured: true });
  });

  it('ensureDonationTiers is idempotent ($10/$25/$50)', async () => {
    const product = { id: 'NEIGHBORLINE-DONATION', name: 'Neighborline monthly donation' };
    const first = await h.paypal.subscriptions.ensureDonationTiers({ product });
    expect(Object.keys(first)).toEqual(['1000', '2500', '5000']);
    const second = await h.paypal.subscriptions.ensureDonationTiers({ product });
    expect(second).toEqual(first);
    expect(h.fake.state.plans.size).toBe(3);
    const plans = await h.paypal.subscriptions.listPlans(product.id);
    expect(plans.map((p) => p.amountCents).sort()).toEqual([1000, 2500, 5000]);
  });

  it('getSubscription reflects activation and last payment', async () => {
    const tiers = await h.paypal.subscriptions.ensureDonationTiers({ product: { id: 'NEIGHBORLINE-DONATION', name: 'Monthly' } });
    const token = await h.paypal.client.getAccessToken();
    const created = (await (await fetch(`${h.fake.url}/v1/billing/subscriptions`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ plan_id: tiers[5000] }) })).json()) as { id: string };
    expect((await h.paypal.subscriptions.getSubscription(created.id)).status).toBe('APPROVAL_PENDING');
    await h.control(`/__fake/subscriptions/${created.id}/activate`);
    const sub = await h.paypal.subscriptions.getSubscription(created.id);
    expect(sub).toMatchObject({ status: 'ACTIVE', planId: tiers[5000], lastPaymentCents: 5000 });
  });
});
