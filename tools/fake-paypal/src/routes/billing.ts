/** Catalog Products + Billing Plans + Subscriptions (minimal) with an approval simulator. */
import { centsToValue, link, valueToCents, type FakeContext } from '../context.js';
import { ppError, validation } from '../errors.js';
import type { Ctx, Reply, Router } from '../http.js';
import type { PlanRec, ProductRec, SaleRec, SubscriptionRec } from '../state.js';

const notFound = (field: string, id: string, api: string) =>
  ppError(404, 'RESOURCE_NOT_FOUND', undefined, [{ field, value: id, location: 'path', issue: 'INVALID_RESOURCE_ID', description: 'Invalid resource id.' }], api);

export function registerBillingRoutes(router: Router, ctx: FakeContext): void {
  router
    .add('POST', '/v1/catalogs/products', (c) => createProduct(ctx, c))
    .add('GET', '/v1/catalogs/products/:id', (c) => {
      const p = ctx.state.products.get(c.params.id!);
      if (!p) throw notFound('product_id', c.params.id!, 'catalog-products/v1');
      return { status: 200, body: productView(ctx, p) };
    })
    .add('POST', '/v1/billing/plans', (c) => createPlan(ctx, c))
    .add('GET', '/v1/billing/plans', (c) => listPlans(ctx, c))
    .add('GET', '/v1/billing/plans/:id', (c) => {
      const p = ctx.state.plans.get(c.params.id!);
      if (!p) throw notFound('plan_id', c.params.id!, 'subscriptions/v1');
      return { status: 200, body: planView(ctx, p, true) };
    })
    .add('POST', '/v1/billing/subscriptions', (c) => createSubscription(ctx, c))
    .add('GET', '/v1/billing/subscriptions/:id', (c) => ({ status: 200, body: subscriptionView(ctx, requireSub(ctx, c.params.id!)) }))
    .add('GET', '/__fake/approve/subscription/:id', (c) => {
      const s = activateSubscription(ctx, c.params.id!);
      return { status: 200, raw: { contentType: 'text/html; charset=utf-8', text: `<!doctype html><p>Subscription <code>${s.id}</code> is ${s.status} in fake PayPal.</p>` } };
    }, { auth: false });
}

function productView(ctx: FakeContext, p: ProductRec) {
  return { ...p, links: [link(ctx, `/v1/catalogs/products/${p.id}`, 'self'), link(ctx, `/v1/catalogs/products/${p.id}`, 'edit', 'PATCH')] };
}

function createProduct(ctx: FakeContext, c: Ctx): Reply {
  const b = c.json<Partial<ProductRec>>();
  const api = 'catalog-products/v1';
  if (!b.name) throw validation([{ field: '/name', location: 'body', issue: 'MISSING_REQUIRED_PARAMETER', description: 'name is required.' }], api);
  if (b.id !== undefined && (b.id.length < 6 || b.id.length > 50)) throw validation([{ field: '/id', location: 'body', issue: 'INVALID_STRING_LENGTH', description: 'id must be 6-50 characters.' }], api);
  if (b.id && ctx.state.products.has(b.id)) {
    throw ppError(422, 'UNPROCESSABLE_ENTITY', undefined, [{ field: '/id', location: 'body', issue: 'DUPLICATE_RESOURCE_IDENTIFIER', description: 'A resource with this id already exists.' }], api);
  }
  const ts = ctx.iso();
  const p: ProductRec = { id: b.id ?? ctx.ids.product(), name: b.name, type: b.type ?? 'PHYSICAL', create_time: ts, update_time: ts };
  if (b.description) p.description = b.description;
  if (b.category) p.category = b.category;
  ctx.state.products.set(p.id, p);
  return { status: 201, body: productView(ctx, p) };
}

function planView(ctx: FakeContext, p: PlanRec, full: boolean) {
  const links = [link(ctx, `/v1/billing/plans/${p.id}`, 'self'), link(ctx, `/v1/billing/plans/${p.id}`, 'edit', 'PATCH')];
  if (!full) return { id: p.id, product_id: p.product_id, name: p.name, status: p.status, description: p.description, usage_type: p.usage_type, create_time: p.create_time, links };
  return { ...p, links };
}

function createPlan(ctx: FakeContext, c: Ctx): Reply {
  const b = c.json<Partial<PlanRec>>();
  const api = 'subscriptions/v1';
  if (!b.product_id || !ctx.state.products.has(b.product_id)) throw ppError(422, 'UNPROCESSABLE_ENTITY', undefined, [{ field: '/product_id', location: 'body', issue: 'INVALID_PRODUCT_ID', description: 'Invalid product id.' }], api);
  if (!b.name || !Array.isArray(b.billing_cycles) || b.billing_cycles.length === 0) {
    throw validation([{ field: '/billing_cycles', location: 'body', issue: 'MISSING_REQUIRED_PARAMETER', description: 'name and billing_cycles are required.' }], api);
  }
  const ts = ctx.iso();
  const p: PlanRec = {
    id: ctx.ids.plan(),
    product_id: b.product_id,
    name: b.name,
    status: b.status ?? 'ACTIVE',
    billing_cycles: b.billing_cycles,
    usage_type: 'LICENSED',
    create_time: ts,
    update_time: ts,
  };
  if (b.description) p.description = b.description;
  if (b.payment_preferences) p.payment_preferences = b.payment_preferences;
  ctx.state.plans.set(p.id, p);
  return { status: 201, body: planView(ctx, p, Boolean(c.header('prefer')?.includes('return=representation'))) };
}

function listPlans(ctx: FakeContext, c: Ctx): Reply {
  const productId = c.query.get('product_id');
  const pageSize = Math.min(20, Math.max(1, Number(c.query.get('page_size') ?? '10')));
  const page = Math.max(1, Number(c.query.get('page') ?? '1'));
  const all = [...ctx.state.plans.values()].filter((p) => !productId || p.product_id === productId);
  const full = Boolean(c.header('prefer')?.includes('return=representation'));
  const slice = all.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  return {
    status: 200,
    body: {
      plans: slice.map((p) => planView(ctx, p, full)),
      ...(c.query.get('total_required') === 'true' ? { total_items: all.length, total_pages: totalPages } : {}),
      links: [link(ctx, `/v1/billing/plans?page_size=${pageSize}&page=${page}`, 'self')],
    },
  };
}

function requireSub(ctx: FakeContext, id: string): SubscriptionRec {
  const s = ctx.state.subscriptions.get(id);
  if (!s) throw notFound('subscription_id', id, 'subscriptions/v1');
  return s;
}

function subscriptionView(ctx: FakeContext, s: SubscriptionRec) {
  const last = s.sales.at(-1);
  const links = [link(ctx, `/v1/billing/subscriptions/${s.id}`, 'self')];
  if (s.status === 'APPROVAL_PENDING') links.unshift({ href: `${ctx.baseUrl()}/__fake/approve/subscription/${s.id}`, rel: 'approve', method: 'GET' });
  return {
    id: s.id,
    plan_id: s.plan_id,
    status: s.status,
    ...(s.custom_id ? { custom_id: s.custom_id } : {}),
    start_time: s.start_time,
    quantity: '1',
    subscriber: s.subscriber ?? { email_address: 'donor@example.com', payer_id: 'FAKEPAYER0001', name: { given_name: 'Sandbox', surname: 'Donor' } },
    ...(s.status === 'ACTIVE'
      ? {
          billing_info: {
            outstanding_balance: { currency_code: last?.currency ?? 'USD', value: '0.00' },
            ...(last ? { last_payment: { amount: { currency_code: last.currency, value: centsToValue(last.amountCents) }, time: last.create_time } } : {}),
            next_billing_time: ctx.iso(ctx.now() + 30 * 86_400_000),
            failed_payments_count: 0,
          },
        }
      : {}),
    plan_overridden: false,
    create_time: s.create_time,
    update_time: s.update_time,
    links,
  };
}

function createSubscription(ctx: FakeContext, c: Ctx): Reply {
  const b = c.json<{ plan_id?: string; custom_id?: string; subscriber?: Record<string, unknown> }>();
  if (!b.plan_id || !ctx.state.plans.has(b.plan_id)) throw ppError(422, 'UNPROCESSABLE_ENTITY', undefined, [{ field: '/plan_id', location: 'body', issue: 'INVALID_PLAN_ID', description: 'Invalid plan id.' }], 'subscriptions/v1');
  const ts = ctx.iso();
  const s: SubscriptionRec = { id: ctx.ids.subscription(), plan_id: b.plan_id, status: 'APPROVAL_PENDING', create_time: ts, update_time: ts, start_time: ts, sales: [] };
  if (b.custom_id) s.custom_id = b.custom_id;
  if (b.subscriber) s.subscriber = b.subscriber;
  ctx.state.subscriptions.set(s.id, s);
  return { status: 201, body: subscriptionView(ctx, s) };
}

function planPriceCents(plan: PlanRec | undefined): { cents: number; currency: string } {
  const cycle = (plan?.billing_cycles[0] ?? {}) as { pricing_scheme?: { fixed_price?: { value?: string; currency_code?: string } } };
  const fp = cycle.pricing_scheme?.fixed_price;
  return { cents: valueToCents(fp?.value) ?? 0, currency: fp?.currency_code ?? 'USD' };
}

/** Buyer approves → ACTIVE, first cycle charged: BILLING.SUBSCRIPTION.ACTIVATED + PAYMENT.SALE.COMPLETED. */
export function activateSubscription(ctx: FakeContext, id: string): SubscriptionRec {
  const s = requireSub(ctx, id);
  if (s.status !== 'APPROVAL_PENDING' && s.status !== 'APPROVED') return s;
  s.status = 'ACTIVE';
  s.update_time = ctx.iso();
  ctx.webhooks.emit('BILLING.SUBSCRIPTION.ACTIVATED', 'subscription', subscriptionView(ctx, s), 'Subscription activated', { resourceVersion: '2.0' });
  const { cents, currency } = planPriceCents(ctx.state.plans.get(s.plan_id));
  const now = ctx.now();
  const sale: SaleRec = { id: ctx.ids.transaction(), amountCents: cents, currency, create_time: ctx.iso(now), txnAtMs: now, billing_agreement_id: s.id };
  if (s.custom_id) sale.custom = s.custom_id;
  s.sales.push(sale);
  ctx.webhooks.emit('PAYMENT.SALE.COMPLETED', 'sale', saleView(ctx, sale), `Payment completed for $ ${centsToValue(cents)} ${currency}`, { resourceVersion: '1.0' });
  return s;
}

function saleView(ctx: FakeContext, sale: SaleRec) {
  return {
    id: sale.id,
    state: 'completed',
    amount: { total: centsToValue(sale.amountCents), currency: sale.currency, details: { subtotal: centsToValue(sale.amountCents) } },
    payment_mode: 'INSTANT_TRANSFER',
    protection_eligibility: 'ELIGIBLE',
    transaction_fee: { value: '0.00', currency: sale.currency },
    billing_agreement_id: sale.billing_agreement_id,
    ...(sale.custom ? { custom: sale.custom } : {}),
    create_time: sale.create_time,
    update_time: sale.create_time,
    links: [link(ctx, `/v1/payments/sale/${sale.id}`, 'self')],
  };
}
