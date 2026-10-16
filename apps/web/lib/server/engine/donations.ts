/**
 * Donations in: Orders v2 (PayPal / Venmo / Pay Later via the JS SDK) and monthly Subscriptions.
 * Fake mode runs the same server path against tools/fake-paypal; the "donor approves in the PayPal
 * popup" step is simulated through its control plane.
 */
import { createHash } from 'node:crypto';
import { recordDonation } from '@neighborline/db';
import type { DonationCapture, DonationOrder, DonationSource, SubscriptionPlan } from '../../types';
import { HttpError } from '../errors';
import type { BaseCtx } from './context';
import { nowIso } from './events';

export interface DonationState {
  orders: Map<string, { amountCents: number; source: DonationSource }>;
  tiers: Promise<Record<number, string>> | null;
}

const donorKey = (s: string | undefined) => (s ? `donor_${createHash('sha256').update(s.toLowerCase()).digest('hex').slice(0, 16)}` : null);
const simulated = (ctx: BaseCtx) => ctx.cfg.paypalMode !== 'sandbox';

export async function createDonationOrder(ctx: BaseCtx, st: DonationState, input: { amountCents: number; source: DonationSource }): Promise<DonationOrder> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 100 || input.amountCents > 1_000_000) throw new HttpError(400, 'Amount must be between $1 and $10,000');
  const order = await ctx.paypal.orders.createDonationOrder({
    amountCents: input.amountCents,
    description: `Gift to ${ctx.gen.group.name}`,
    customId: `${ctx.gen.group.slug}:${input.source.toLowerCase()}`,
    brandName: ctx.gen.group.name,
  });
  st.orders.set(order.id, { amountCents: input.amountCents, source: input.source });
  return { orderId: order.id, amountCents: input.amountCents, simulated: simulated(ctx) };
}

export async function captureDonationOrder(ctx: BaseCtx, st: DonationState, orderId: string): Promise<DonationCapture> {
  const known = st.orders.get(orderId);
  if (ctx.fake && known) {
    // Fake mode only: stand in for the donor clicking "Pay" in the PayPal / Venmo popup.
    await ctx.fake.approveOrder(orderId, known.source === 'VENMO' ? 'venmo' : 'paypal').catch(() => {});
  }
  const cap = await ctx.paypal.orders.captureOrder(orderId);
  const completed = cap.captureStatus === 'COMPLETED' || cap.status === 'COMPLETED';
  const amountCents = cap.amountCents ?? known?.amountCents ?? 0;
  const source: DonationSource = cap.fundingSource === 'venmo' ? 'VENMO' : (known?.source ?? 'PAYPAL');
  if (completed && amountCents > 0) {
    const { created } = await recordDonation(ctx.db, {
      groupId: ctx.gen.group.id,
      amountCents,
      source,
      donorKey: donorKey(cap.payerEmail),
      paypalOrderId: orderId,
      transactionId: cap.captureId ?? null,
    });
    if (created) ctx.bus.emit({ type: 'donation.captured', at: nowIso(), amountCents, source }, []);
  }
  return { orderId, status: completed ? 'COMPLETED' : 'DECLINED', captureId: cap.captureId ?? '', amountCents, simulated: simulated(ctx) };
}

export async function getSubscriptionPlan(ctx: BaseCtx, st: DonationState, input: { amountCents: number }): Promise<SubscriptionPlan> {
  const env = ctx.env[`PAYPAL_PLAN_ID_${input.amountCents / 100}`] ?? ctx.env.PAYPAL_PLAN_ID;
  if (env) return { planId: env, amountCents: input.amountCents, simulated: simulated(ctx) };
  try {
    st.tiers ??= ctx.paypal.subscriptions.ensureDonationTiers({ product: { id: 'NEIGHBORLINE-DONATION', name: 'Neighborline monthly gift' } });
    const tiers = await st.tiers;
    return { planId: tiers[input.amountCents] ?? null, amountCents: input.amountCents, simulated: simulated(ctx) };
  } catch {
    st.tiers = null;
    return { planId: null, amountCents: input.amountCents, simulated: true };
  }
}

export async function recordSubscription(ctx: BaseCtx, input: { subscriptionId: string; amountCents: number }): Promise<{ ok: boolean; simulated: boolean }> {
  const sim = input.subscriptionId.startsWith('SIM-');
  if (!sim) {
    const sub = await ctx.paypal.subscriptions.getSubscription(input.subscriptionId).catch(() => null);
    if (!sub || !['ACTIVE', 'APPROVED'].includes(sub.status)) throw new HttpError(409, 'PayPal does not show this subscription as active yet');
  }
  const { created } = await recordDonation(ctx.db, {
    groupId: ctx.gen.group.id,
    amountCents: input.amountCents,
    source: 'SUBSCRIPTION',
    paypalSubscriptionId: input.subscriptionId,
    donorKey: donorKey(input.subscriptionId),
  });
  if (created) ctx.bus.emit({ type: 'donation.captured', at: nowIso(), amountCents: input.amountCents, source: 'SUBSCRIPTION' }, []);
  return { ok: true, simulated: sim || simulated(ctx) };
}
