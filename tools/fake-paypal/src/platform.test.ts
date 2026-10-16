import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFakePayPal, type FakePayPal } from './server.js';
import { getToken, startWebhookReceiver } from './test-helpers.js';

let fake: FakePayPal;
let receiver: Awaited<ReturnType<typeof startWebhookReceiver>>;
let token: string;

beforeAll(async () => {
  receiver = await startWebhookReceiver();
  fake = await createFakePayPal({ webhookTargetUrl: receiver.url, autoProcess: false });
  token = await getToken(fake.url);
});
afterEach(() => {
  fake.reset();
  receiver.received.length = 0;
});
afterAll(async () => {
  await fake.close();
  await receiver.close();
});

const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${fake.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as any };
};

describe('oauth', () => {
  it('rejects missing/expired bearer tokens with 401', async () => {
    const res = await fetch(`${fake.url}/v1/payments/payouts/X`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).name).toBe('AUTHENTICATION_FAILURE');
    const t = await getToken(fake.url);
    await fetch(`${fake.url}/__fake/tokens/expire`, { method: 'POST' });
    const expired = await fetch(`${fake.url}/v1/payments/payouts/X`, { headers: { authorization: `Bearer ${t}` } });
    expect(expired.status).toBe(401);
    token = await getToken(fake.url);
  });
});

describe('webhook verification', () => {
  async function deliverOne() {
    const created = await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'nl_w' }, items: [{ recipient_type: 'EMAIL', amount: { value: '5.00', currency: 'USD' }, receiver: 'a@example.com' }] });
    await fetch(`${fake.url}/__fake/batches/${created.body.batch_header.payout_batch_id}/process`, { method: 'POST' });
    await fake.idle();
    return receiver.received.find((r) => r.event.event_type === 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED')!;
  }
  const verifyBody = (h: Record<string, string>, eventJson: string, webhookId = fake.config.webhookId) =>
    `{"auth_algo":${JSON.stringify(h['paypal-auth-algo'])},"cert_url":${JSON.stringify(h['paypal-cert-url'])},"transmission_id":${JSON.stringify(h['paypal-transmission-id'])},"transmission_sig":${JSON.stringify(h['paypal-transmission-sig'])},"transmission_time":${JSON.stringify(h['paypal-transmission-time'])},"webhook_id":${JSON.stringify(webhookId)},"webhook_event":${eventJson}}`;

  it('returns SUCCESS for an event it delivered, FAILURE when tampered or wrong webhook_id', async () => {
    const wh = await deliverOne();
    expect((await api('POST', '/v1/notifications/verify-webhook-signature', verifyBody(wh.headers, wh.rawBody))).body.verification_status).toBe('SUCCESS');
    const tampered = wh.rawBody.replace('"5.00"', '"500.00"');
    expect((await api('POST', '/v1/notifications/verify-webhook-signature', verifyBody(wh.headers, tampered))).body.verification_status).toBe('FAILURE');
    expect((await api('POST', '/v1/notifications/verify-webhook-signature', verifyBody(wh.headers, wh.rawBody, 'OTHERWEBHOOK'))).body.verification_status).toBe('FAILURE');
  });

  it('simulate-event delivers a sample event that can NOT be verified (like real PayPal)', async () => {
    const res = await api('POST', '/v1/notifications/simulate-event', { webhook_id: fake.config.webhookId, event_type: 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED' });
    expect(res.status).toBe(202);
    expect(res.body.event_type).toBe('PAYMENT.PAYOUTS-ITEM.UNCLAIMED');
    await fake.idle();
    const wh = receiver.received[0]!;
    expect((await api('POST', '/v1/notifications/verify-webhook-signature', verifyBody(wh.headers, wh.rawBody))).body.verification_status).toBe('FAILURE');
  });
});

describe('orders', () => {
  const order = { intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: '25.00' }, custom_id: 'don_1' }] };

  it('create → approve → capture, emits APPROVED + CAPTURE.COMPLETED; capture before approval is ORDER_NOT_APPROVED', async () => {
    const created = await api('POST', '/v2/checkout/orders', order, { 'PayPal-Request-Id': 'o-1' });
    expect(created.status).toBe(201);
    expect(created.body.links.find((l: any) => l.rel === 'approve')).toBeTruthy();
    const early = await api('POST', `/v2/checkout/orders/${created.body.id}/capture`);
    expect(early.body.details[0].issue).toBe('ORDER_NOT_APPROVED');
    await fetch(`${fake.url}/__fake/orders/${created.body.id}/approve`, { method: 'POST' });
    const cap = await api('POST', `/v2/checkout/orders/${created.body.id}/capture`, {}, { 'PayPal-Request-Id': 'cap-1' });
    expect(cap.status).toBe(201);
    expect(cap.body.purchase_units[0].payments.captures[0]).toMatchObject({ status: 'COMPLETED', custom_id: 'don_1' });
    const again = await api('POST', `/v2/checkout/orders/${created.body.id}/capture`);
    expect(again.body.details[0].issue).toBe('ORDER_ALREADY_CAPTURED');
    const replay = await api('POST', '/v2/checkout/orders', order, { 'PayPal-Request-Id': 'o-1' });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(created.body.id);
    await fake.idle();
    expect(receiver.received.map((r) => r.event.event_type)).toEqual(['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED']);
  });

  it('honors PayPal-Mock-Response for documented order issues', async () => {
    const created = await api('POST', '/v2/checkout/orders', order);
    const res = await api('POST', `/v2/checkout/orders/${created.body.id}/capture`, {}, { 'PayPal-Mock-Response': '{"mock_application_codes":"INSTRUMENT_DECLINED"}' });
    expect(res.status).toBe(422);
    expect(res.body.details[0].issue).toBe('INSTRUMENT_DECLINED');
  });
});

describe('transaction search', () => {
  it('enforces the 31-day window and returns payouts (T0001) and captures (T0006)', async () => {
    const tooWide = await api('GET', '/v1/reporting/transactions?start_date=2026-01-01T00:00:00Z&end_date=2026-03-01T00:00:00Z');
    expect(tooWide.status).toBe(400);
    expect(tooWide.body.name).toBe('INVALID_REQUEST');

    const created = await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'nl_ts' }, items: [{ recipient_type: 'EMAIL', amount: { value: '150.00', currency: 'USD' }, receiver: 'a@example.com' }] });
    await fetch(`${fake.url}/__fake/batches/${created.body.batch_header.payout_batch_id}/process`, { method: 'POST' });
    const o = await api('POST', '/v2/checkout/orders', { intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: '25.00' } }] });
    await fetch(`${fake.url}/__fake/orders/${o.body.id}/approve`, { method: 'POST' });
    await api('POST', `/v2/checkout/orders/${o.body.id}/capture`);
    const start = new Date(Date.now() - 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const end = new Date(Date.now() + 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const res = await api('GET', `/v1/reporting/transactions?start_date=${start}&end_date=${end}&fields=all`);
    const infos = res.body.transaction_details.map((d: any) => d.transaction_info);
    expect(infos.map((i: any) => [i.transaction_event_code, i.transaction_amount.value])).toEqual([
      ['T0001', '-150.00'],
      ['T0006', '25.00'],
    ]);

    fake.config.reportingLagMs = 3 * 3_600_000;
    const lagged = await api('GET', `/v1/reporting/transactions?start_date=${start}&end_date=${end}`);
    expect(lagged.body.transaction_details).toHaveLength(0);
    fake.config.reportingLagMs = 0;
  });
});
