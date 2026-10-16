/**
 * Monthly donations via Catalog Products + Billing Plans. `ensure*` calls are idempotent so they can run at
 * boot or in a setup script: the product has a fixed id, plans are matched by (product, name, price).
 */
import { PayPalApiError } from './errors.js';
import { seg, type PayPalClient } from './client.js';
import { fromPayPalValue, toPayPalValue } from './money.js';

export const DEFAULT_DONATION_TIERS_CENTS = [1000, 2500, 5000] as const;

export interface EnsureProductInput {
  /** Stable product id (6–50 chars) so repeated runs find it. */
  id: string;
  name: string;
  description?: string;
  type?: 'SERVICE' | 'DIGITAL' | 'PHYSICAL';
  /** PayPal product_category enum value, if you know the right one. Omitted by default. */
  category?: string;
}

export interface PlanSummary {
  id: string;
  productId: string;
  name: string;
  status: string;
  amountCents: number | undefined;
  currency: string | undefined;
}

export interface SubscriptionSummary {
  id: string;
  status: string;
  planId: string | undefined;
  customId: string | undefined;
  subscriberEmail: string | undefined;
  nextBillingTime: string | undefined;
  lastPaymentCents: number | undefined;
  approveUrl: string | undefined;
  raw: unknown;
}

interface WirePlan {
  id: string;
  product_id: string;
  name: string;
  status: string;
  billing_cycles?: Array<{ pricing_scheme?: { fixed_price?: { value: string; currency_code: string } } }>;
}

export const planName = (amountCents: number, currency = 'USD') => `Monthly donation ${toPayPalValue(amountCents, currency)} ${currency}`;

function toPlanSummary(p: WirePlan): PlanSummary {
  const fp = p.billing_cycles?.[0]?.pricing_scheme?.fixed_price;
  return { id: p.id, productId: p.product_id, name: p.name, status: p.status, amountCents: fp ? fromPayPalValue(fp.value, fp.currency_code) : undefined, currency: fp?.currency_code };
}

export class SubscriptionsApi {
  constructor(private readonly client: PayPalClient) {}

  async ensureProduct(input: EnsureProductInput): Promise<{ id: string; created: boolean }> {
    try {
      const res = await this.client.request<{ id: string }>({ path: `/v1/catalogs/products/${seg(input.id)}` });
      return { id: res.data.id, created: false };
    } catch (err) {
      if (!(err instanceof PayPalApiError) || err.status !== 404) throw err;
    }
    const res = await this.client.request<{ id: string }>({
      method: 'POST',
      path: '/v1/catalogs/products',
      requestId: `product-${input.id}`,
      prefer: 'return=representation',
      body: {
        id: input.id,
        name: input.name,
        type: input.type ?? 'SERVICE',
        ...(input.description ? { description: input.description } : {}),
        ...(input.category ? { category: input.category } : {}),
      },
    });
    return { id: res.data.id, created: true };
  }

  async listPlans(productId: string): Promise<PlanSummary[]> {
    const out: PlanSummary[] = [];
    for (let page = 1; page <= 50; page++) {
      const res = await this.client.request<{ plans?: WirePlan[]; total_pages?: number }>({
        path: '/v1/billing/plans',
        query: { product_id: productId, page_size: 20, page, total_required: true },
        prefer: 'return=representation',
      });
      out.push(...(res.data.plans ?? []).map(toPlanSummary));
      if (page >= (res.data.total_pages ?? 1)) break;
    }
    return out;
  }

  /** Find an ACTIVE monthly plan for this exact price, or create one. */
  async ensureMonthlyPlan(input: { productId: string; amountCents: number; currency?: string; name?: string }): Promise<PlanSummary & { created: boolean }> {
    const currency = input.currency ?? 'USD';
    const name = input.name ?? planName(input.amountCents, currency);
    const existing = (await this.listPlans(input.productId)).find(
      (p) => p.status === 'ACTIVE' && p.name === name && (p.amountCents === undefined || p.amountCents === input.amountCents),
    );
    if (existing) return { ...existing, created: false };
    const res = await this.client.request<WirePlan>({
      method: 'POST',
      path: '/v1/billing/plans',
      requestId: `plan-${input.productId}-${currency}-${input.amountCents}`,
      prefer: 'return=representation',
      body: {
        product_id: input.productId,
        name,
        description: `Recurring monthly donation of ${toPayPalValue(input.amountCents, currency)} ${currency}`,
        status: 'ACTIVE',
        billing_cycles: [
          {
            frequency: { interval_unit: 'MONTH', interval_count: 1 },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: { fixed_price: { value: toPayPalValue(input.amountCents, currency), currency_code: currency } },
          },
        ],
        payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
      },
    });
    return { ...toPlanSummary(res.data), amountCents: input.amountCents, currency, created: true };
  }

  /** Alias of ensureMonthlyPlan. */
  ensurePlan(input: { productId: string; amountCents: number; currency?: string; name?: string }): Promise<PlanSummary & { created: boolean }> {
    return this.ensureMonthlyPlan(input);
  }

  /** Ensure the product and one plan per tier ($10/$25/$50 by default); returns cents → plan id. */
  async ensureDonationTiers(input: { product: EnsureProductInput; tiersCents?: readonly number[]; currency?: string }): Promise<Record<number, string>> {
    const { id: productId } = await this.ensureProduct(input.product);
    const out: Record<number, string> = {};
    for (const cents of input.tiersCents ?? DEFAULT_DONATION_TIERS_CENTS) {
      out[cents] = (await this.ensureMonthlyPlan({ productId, amountCents: cents, ...(input.currency ? { currency: input.currency } : {}) })).id;
    }
    return out;
  }

  async getSubscription(id: string): Promise<SubscriptionSummary> {
    const res = await this.client.request<{
      id: string;
      status: string;
      plan_id?: string;
      custom_id?: string;
      subscriber?: { email_address?: string };
      billing_info?: { next_billing_time?: string; last_payment?: { amount?: { value: string; currency_code: string } } };
      links?: Array<{ href: string; rel: string }>;
    }>({ path: `/v1/billing/subscriptions/${seg(id)}` });
    const d = res.data;
    const last = d.billing_info?.last_payment?.amount;
    return {
      id: d.id,
      status: d.status,
      planId: d.plan_id,
      customId: d.custom_id,
      subscriberEmail: d.subscriber?.email_address,
      nextBillingTime: d.billing_info?.next_billing_time,
      lastPaymentCents: last ? fromPayPalValue(last.value, last.currency_code) : undefined,
      approveUrl: d.links?.find((l) => l.rel === 'approve')?.href,
      raw: d,
    };
  }
}
