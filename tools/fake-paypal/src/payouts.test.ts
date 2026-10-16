import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFakePayPal, type FakePayPal } from './server.js';
import { getToken, startWebhookReceiver } from './test-helpers.js';

let fake: FakePayPal;
let receiver: Awaited<ReturnType<typeof startWebhookReceiver>>;
let token: string;

beforeAll(async () => {
  receiver = await startWebhookReceiver();
  fake = await createFakePayPal({ webhookTargetUrl: receiver.url, autoProcess: false, seed: 7 });
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
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as any };
};

const item = (receiver: string, extra: Record<string, unknown> = {}) => ({
  recipient_type: 'EMAIL',
  amount: { value: '150.00', currency: 'USD' },
  receiver,
  sender_item_id: `item_${receiver}`,
  note: 'Mutual aid',
  ...extra,
});

describe('payouts', () => {
  it('creates a PENDING batch with PayPal-shaped ids and links', async () => {
    const res = await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'nl_a' }, items: [item('a@example.com')] });
    expect(res.status).toBe(201);
    expect(res.body.batch_header.payout_batch_id).toMatch(/^[A-Z0-9]{13}$/);
    expect(res.body.batch_header.batch_status).toBe('PENDING');
    expect(res.body.links[0]).toMatchObject({ rel: 'self', method: 'GET' });
  });

  it('rejects a reused sender_batch_id with USER_BUSINESS_ERROR linking to the original batch', async () => {
    const first = await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'nl_dup' }, items: [item('a@example.com')] });
    const dup = await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'nl_dup' }, items: [item('a@example.com')] });
    expect(dup.status).toBe(400);
    expect(dup.body.name).toBe('USER_BUSINESS_ERROR');
    expect(dup.body.debug_id).toMatch(/^[0-9a-f]{13}$/);
    expect(dup.body.details[0].link[0].href).toContain(`/v1/payments/payouts/${first.body.batch_header.payout_batch_id}`);
  });

  it('replays the original batch (latest state) for the same PayPal-Request-Id', async () => {
    const body = { sender_batch_header: { sender_batch_id: 'nl_req' }, items: [item('a@example.com')] };
    const a = await api('POST', '/v1/payments/payouts', body, { 'PayPal-Request-Id': 'req-1' });
    await fetch(`${fake.url}/__fake/batches/${a.body.batch_header.payout_batch_id}/process`, { method: 'POST' });
    const b = await api('POST', '/v1/payments/payouts', body, { 'PayPal-Request-Id': 'req-1' });
    expect(b.status).toBe(201);
    expect(b.body.batch_header.payout_batch_id).toBe(a.body.batch_header.payout_batch_id);
    expect(b.body.batch_header.batch_status).toBe('SUCCESS');
  });

  it('requires a note for Venmo and only allows USER_HANDLE with Venmo', async () => {
    const res = await api('POST', '/v1/payments/payouts', {
      sender_batch_header: { sender_batch_id: 'nl_v' },
      items: [item('@lan', { recipient_type: 'USER_HANDLE', recipient_wallet: 'VENMO', note: '' }), item('@x', { recipient_type: 'USER_HANDLE' })],
    });
    expect(res.status).toBe(400);
    expect(res.body.name).toBe('VALIDATION_ERROR');
    const fields = res.body.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['items[0].note', 'items[1].recipient_type']));
  });

  it('honors documented negative-test values in items[0].note', async () => {
    const res = await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'nl_neg' }, items: [item('a@example.com', { note: 'ERRPYO005' })] });
    expect(res.status).toBe(422);
    expect(res.body.name).toBe('INSUFFICIENT_FUNDS');
    const batch = await api('GET', '/v1/payments/payouts/ERRPYOB004');
    expect(batch.body.batch_header.batch_status).toBe('DENIED');
  });

  it('applies deterministic outcomes and emits signed item + batch webhooks in order', async () => {
    const created = await api('POST', '/v1/payments/payouts', {
      sender_batch_header: { sender_batch_id: 'nl_mix' },
      items: [
        item('lan@example.com'),
        item('rosa.unclaimed@example.com'),
        item('@new-to-venmo-ana', { recipient_type: 'USER_HANDLE', recipient_wallet: 'VENMO' }),
        item('x@onhold.example'),
        item('y@blocked.example'),
      ],
    });
    const id = created.body.batch_header.payout_batch_id;
    await fetch(`${fake.url}/__fake/batches/${id}/process`, { method: 'POST' });
    await fake.idle();
    const batch = await api('GET', `/v1/payments/payouts/${id}?total_required=true`);
    expect(batch.body.total_items).toBe(5);
    expect(batch.body.items.map((i: any) => i.transaction_status)).toEqual(['SUCCESS', 'UNCLAIMED', 'UNCLAIMED', 'ONHOLD', 'BLOCKED']);
    expect(batch.body.items[1].errors.name).toBe('RECEIVER_UNREGISTERED');
    expect(receiver.received.map((r) => r.event.event_type)).toEqual([
      'PAYMENT.PAYOUTSBATCH.PROCESSING',
      'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
      'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
      'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
      'PAYMENT.PAYOUTS-ITEM.HELD',
      'PAYMENT.PAYOUTS-ITEM.BLOCKED',
      'PAYMENT.PAYOUTSBATCH.SUCCESS',
    ]);
    const h = receiver.received[0]!.headers;
    for (const k of ['paypal-transmission-id', 'paypal-transmission-time', 'paypal-transmission-sig', 'paypal-cert-url', 'paypal-auth-algo']) expect(h[k]).toBeTruthy();
    expect(receiver.received[0]!.event.resource).not.toHaveProperty('items'); // batch webhooks carry no item info
  });

  it('claim control flips UNCLAIMED → SUCCESS and emits SUCCEEDED; cancel only works on UNCLAIMED', async () => {
    const created = await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'nl_c' }, items: [item('a.unclaimed@example.com'), item('b.unclaimed@example.com'), item('ok@example.com')] });
    await fetch(`${fake.url}/__fake/batches/${created.body.batch_header.payout_batch_id}/process`, { method: 'POST' });
    const batch = await api('GET', `/v1/payments/payouts/${created.body.batch_header.payout_batch_id}`);
    const [a, b, ok] = batch.body.items.map((i: any) => i.payout_item_id);
    await fake.idle();
    receiver.received.length = 0;
    await fetch(`${fake.url}/__fake/claim/${a}`, { method: 'POST' });
    expect((await api('GET', `/v1/payments/payouts-item/${a}`)).body.transaction_status).toBe('SUCCESS');
    const cancel = await api('POST', `/v1/payments/payouts-item/${b}/cancel`);
    expect(cancel.body.transaction_status).toBe('RETURNED');
    const bad = await api('POST', `/v1/payments/payouts-item/${ok}/cancel`);
    expect(bad.status).toBe(400);
    expect(bad.body.name).toBe('ITEM_INCORRECT_STATUS');
    await fake.idle();
    expect(receiver.received.map((r) => r.event.event_type)).toEqual(['PAYMENT.PAYOUTS-ITEM.SUCCEEDED', 'PAYMENT.PAYOUTS-ITEM.CANCELED']);
  });

  it('auto-processes after the configured delay', async () => {
    fake.config.autoProcess = true;
    fake.config.processingDelayMs = 30;
    try {
      const created = await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'nl_auto' }, items: [item('a@example.com')] });
      await new Promise((r) => setTimeout(r, 80));
      const b = await api('GET', `/v1/payments/payouts/${created.body.batch_header.payout_batch_id}`);
      expect(b.body.batch_header.batch_status).toBe('SUCCESS');
    } finally {
      fake.config.autoProcess = false;
    }
  });
});

describe('configured unclaimed receivers', () => {
  it('treats receivers listed in unclaimedReceivers as having no PayPal account yet', async () => {
    const { decideOutcome } = await import('./outcomes.js');
    expect(decideOutcome('Rosa.M.Delgado@example.com', ['rosa.m.delgado@example.com'])).toBe('UNCLAIMED');
    expect(decideOutcome('rosa.m.delgado@example.com')).toBe('SUCCESS');
    const res = await fetch(`${fake.url}/__fake/config`, { method: 'POST', body: JSON.stringify({ unclaimedReceivers: ['late@example.com'] }) });
    expect((await res.json()).unclaimedReceivers).toEqual(['late@example.com']);
  });
});
