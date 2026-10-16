/**
 * Orders v2 subset: create, get, capture (+ buyer approval simulation). PayPal-Request-Id replays return 200
 * with the original order; PayPal-Mock-Response `mock_application_codes` simulates documented 422 issues.
 */
import { centsToValue, link, valueToCents, type FakeContext } from '../context.js';
import { ppError, unprocessable, validation } from '../errors.js';
import type { Ctx, Reply, Router } from '../http.js';
import type { CaptureRec, OrderRec } from '../state.js';
import { mockCode } from './mock.js';

const API = 'orders/v2';
/** Illustrative fee so capture breakdowns look real (fake only; not PayPal's nonprofit pricing). */
const feeFor = (cents: number) => Math.round(cents * 0.0199) + 49;

export function registerOrderRoutes(router: Router, ctx: FakeContext): void {
  router
    .add('POST', '/v2/checkout/orders', (c) => createOrder(ctx, c))
    .add('GET', '/v2/checkout/orders/:id', (c) => {
      mockOrderErrors(c, 'get');
      return { status: 200, body: orderView(ctx, requireOrder(ctx, c.params.id!)) };
    })
    .add('POST', '/v2/checkout/orders/:id/capture', (c) => captureOrder(ctx, c))
    // Buyer approval page the `approve` link points at (fake stands in for paypal.com checkout).
    .add('GET', '/checkoutnow', (c) => approvePage(ctx, c), { auth: false });
}

function requireOrder(ctx: FakeContext, id: string): OrderRec {
  const o = ctx.state.orders.get(id);
  if (!o) throw ppError(404, 'RESOURCE_NOT_FOUND', undefined, [{ field: 'order_id', value: id, location: 'path', issue: 'INVALID_RESOURCE_ID', description: 'Specified resource ID does not exist. Please check the resource ID and try again.' }], API);
  return o;
}

function mockOrderErrors(c: Ctx, op: 'create' | 'get' | 'capture'): void {
  const code = mockCode(c);
  if (!code) return;
  const table: Record<string, { ops: string[]; description: string }> = {
    INSTRUMENT_DECLINED: { ops: ['capture'], description: 'The instrument presented was either declined by the processor or bank, or it can\'t be used for this payment.' },
    ORDER_NOT_APPROVED: { ops: ['capture'], description: 'Payer has not yet approved the Order for payment.' },
    ORDER_ALREADY_CAPTURED: { ops: ['capture'], description: 'Order already captured. If \'intent=CAPTURE\' only one capture per order is allowed.' },
    DUPLICATE_INVOICE_ID: { ops: ['create', 'capture'], description: 'Duplicate Invoice ID detected. To avoid a potential duplicate transaction your account setting requires that Invoice Id be unique for each transaction.' },
    PAYER_ACTION_REQUIRED: { ops: ['capture'], description: 'Transaction cannot complete successfully, instruct the buyer to return to PayPal.' },
  };
  const spec = table[code];
  if (spec && spec.ops.includes(op)) throw unprocessable(code, spec.description, API);
}

export function orderView(ctx: FakeContext, o: OrderRec) {
  const links = [link(ctx, `/v2/checkout/orders/${o.id}`, 'self')];
  if (o.status === 'CREATED' || o.status === 'PAYER_ACTION_REQUIRED') {
    links.push({ href: `${ctx.baseUrl()}/checkoutnow?token=${o.id}`, rel: o.status === 'CREATED' ? 'approve' : 'payer-action', method: 'GET' });
    links.push(link(ctx, `/v2/checkout/orders/${o.id}`, 'update', 'PATCH'));
  }
  if (o.status === 'APPROVED') links.push(link(ctx, `/v2/checkout/orders/${o.id}/capture`, 'capture', 'POST'));
  const units = o.purchase_units.map((pu, i) => (i === 0 && o.capture ? { ...pu, payments: { captures: [captureView(ctx, o.capture)] } } : pu));
  return {
    id: o.id,
    intent: o.intent,
    status: o.status,
    ...(o.payer ? { payment_source: { [o.fundingSource ?? 'paypal']: { email_address: o.payer.email_address, account_id: o.payer.payer_id, name: o.payer.name } }, payer: o.payer } : {}),
    purchase_units: units,
    create_time: o.create_time,
    update_time: o.update_time,
    links,
  };
}

function captureView(ctx: FakeContext, cap: CaptureRec) {
  const gross = valueToCents(cap.amount.value) ?? 0;
  return {
    id: cap.id,
    status: cap.status,
    amount: cap.amount,
    final_capture: true,
    seller_protection: { status: 'NOT_ELIGIBLE' },
    seller_receivable_breakdown: {
      gross_amount: cap.amount,
      paypal_fee: { currency_code: cap.amount.currency_code, value: centsToValue(cap.feeCents) },
      net_amount: { currency_code: cap.amount.currency_code, value: centsToValue(gross - cap.feeCents) },
    },
    ...(cap.custom_id ? { custom_id: cap.custom_id } : {}),
    ...(cap.invoice_id ? { invoice_id: cap.invoice_id } : {}),
    links: [link(ctx, `/v2/payments/captures/${cap.id}`, 'self'), link(ctx, `/v2/payments/captures/${cap.id}/refund`, 'refund', 'POST')],
    create_time: cap.create_time,
    update_time: cap.create_time,
  };
}

function minimal(ctx: FakeContext, o: OrderRec, prefer: string | undefined) {
  if (prefer?.includes('return=representation')) return orderView(ctx, o);
  const v = orderView(ctx, o);
  return { id: v.id, status: v.status, links: v.links };
}

function createOrder(ctx: FakeContext, c: Ctx): Reply {
  const requestId = c.header('paypal-request-id');
  const key = requestId ? `orders:${requestId}` : undefined;
  const replay = key ? ctx.state.idempotency.get(key) : undefined;
  if (replay) return { status: 200, body: minimal(ctx, ctx.state.orders.get(replay.resourceId)!, c.header('prefer')) };
  mockOrderErrors(c, 'create');
  const body = c.json<{ intent?: string; purchase_units?: OrderRec['purchase_units']; payment_source?: Record<string, { experience_context?: Record<string, unknown> }> }>();
  if (body.intent !== 'CAPTURE' && body.intent !== 'AUTHORIZE') throw validation([{ field: '/intent', location: 'body', issue: 'MISSING_REQUIRED_PARAMETER', description: 'intent must be CAPTURE or AUTHORIZE.' }], API);
  const units = body.purchase_units;
  if (!Array.isArray(units) || units.length < 1 || units.length > 10) throw validation([{ field: '/purchase_units', location: 'body', issue: 'MISSING_REQUIRED_PARAMETER', description: 'purchase_units must contain 1-10 items.' }], API);
  units.forEach((pu, i) => {
    const cents = valueToCents(pu?.amount?.value);
    if (cents === null || cents <= 0 || !pu.amount.currency_code) throw validation([{ field: `/purchase_units/${i}/amount/value`, location: 'body', issue: 'INVALID_PARAMETER_VALUE', description: 'Amount must be a positive decimal string.' }], API);
  });
  if (body.payment_source && !requestId) {
    throw validation([{ field: 'PayPal-Request-Id', location: 'header', issue: 'PAYPAL_REQUEST_ID_REQUIRED', description: 'A PayPal-Request-Id is required if you are trying to process payment for an Order.' }], API);
  }
  const ts = ctx.iso();
  const source = body.payment_source ? Object.keys(body.payment_source)[0] : undefined;
  const order: OrderRec = {
    id: ctx.ids.order(),
    intent: body.intent,
    status: source ? 'PAYER_ACTION_REQUIRED' : 'CREATED',
    purchase_units: units.map((pu, i) => ({ reference_id: (pu.reference_id as string | undefined) ?? (i === 0 ? 'default' : String(i)), ...pu })),
    create_time: ts,
    update_time: ts,
  };
  if (source === 'venmo') order.fundingSource = 'venmo';
  const experience = source ? body.payment_source?.[source]?.experience_context : undefined;
  if (experience) order.experience = experience;
  ctx.state.orders.set(order.id, order);
  if (key) ctx.state.idempotency.set(key, { bodyHash: c.rawBody, resourceId: order.id });
  return { status: 201, body: minimal(ctx, order, c.header('prefer')) };
}

/** Simulates the buyer approving at PayPal/Venmo. Emits CHECKOUT.ORDER.APPROVED. */
export function approveOrder(ctx: FakeContext, id: string, opts: { payerEmail?: string; fundingSource?: 'paypal' | 'venmo' } = {}): OrderRec {
  const o = requireOrder(ctx, id);
  if (o.status !== 'CREATED' && o.status !== 'PAYER_ACTION_REQUIRED') return o;
  o.status = 'APPROVED';
  o.update_time = ctx.iso();
  o.fundingSource = opts.fundingSource ?? o.fundingSource ?? 'paypal';
  o.payer = { email_address: opts.payerEmail ?? 'donor@example.com', payer_id: ctx.ids.payoutBatch(), name: { given_name: 'Sandbox', surname: 'Donor' } };
  ctx.webhooks.emit('CHECKOUT.ORDER.APPROVED', 'checkout-order', orderView(ctx, o), `An order has been approved by buyer`, { resourceVersion: '2.0' });
  return o;
}

function approvePage(ctx: FakeContext, c: Ctx): Reply {
  const id = c.query.get('token') ?? '';
  const o = approveOrder(ctx, id, { fundingSource: c.query.get('funding') === 'venmo' ? 'venmo' : undefined });
  const ret = typeof o.experience?.return_url === 'string' ? o.experience.return_url : undefined;
  if (ret) return { status: 302, headers: { location: `${ret}${ret.includes('?') ? '&' : '?'}token=${o.id}&PayerID=${o.payer?.payer_id ?? ''}` } };
  return { status: 200, raw: { contentType: 'text/html; charset=utf-8', text: `<!doctype html><title>Fake PayPal</title><p>Order <code>${o.id}</code> approved in fake PayPal. You can close this tab.</p>` } };
}

function captureOrder(ctx: FakeContext, c: Ctx): Reply {
  const requestId = c.header('paypal-request-id');
  const key = requestId ? `capture:${requestId}` : undefined;
  if (key && ctx.state.idempotency.has(key)) return { status: 200, body: orderView(ctx, requireOrder(ctx, ctx.state.idempotency.get(key)!.resourceId)) };
  mockOrderErrors(c, 'capture');
  const o = requireOrder(ctx, c.params.id!);
  if (o.status === 'COMPLETED') throw unprocessable('ORDER_ALREADY_CAPTURED', 'Order already captured. If \'intent=CAPTURE\' only one capture per order is allowed.', API);
  if (o.status !== 'APPROVED') throw unprocessable('ORDER_NOT_APPROVED', 'Payer has not yet approved the Order for payment. Please redirect the payer to the \'rel\':\'approve\' url returned as part of the HATEOAS links within the Create Order call or provide a valid payment_source in the request.', API);
  const pu = o.purchase_units[0]!;
  const now = ctx.now();
  const gross = valueToCents(pu.amount.value)!;
  o.capture = {
    id: ctx.ids.capture(),
    status: 'COMPLETED',
    amount: { currency_code: pu.amount.currency_code, value: pu.amount.value },
    feeCents: feeFor(gross),
    create_time: ctx.iso(now),
    txnAtMs: now,
  };
  if (typeof pu.custom_id === 'string') o.capture.custom_id = pu.custom_id;
  if (typeof pu.invoice_id === 'string') o.capture.invoice_id = pu.invoice_id;
  o.status = 'COMPLETED';
  o.update_time = ctx.iso(now);
  if (key) ctx.state.idempotency.set(key, { bodyHash: c.rawBody, resourceId: o.id });
  const capture = { ...captureView(ctx, o.capture), supplementary_data: { related_ids: { order_id: o.id } } };
  ctx.webhooks.emit('PAYMENT.CAPTURE.COMPLETED', 'capture', capture, `Payment completed for $ ${pu.amount.value} ${pu.amount.currency_code}`, { resourceVersion: '2.0' });
  return { status: 201, body: orderView(ctx, o) };
}
