/** `sandboxRealism` and `reportingNotReady`: what the real PayPal sandbox did on 2026-10-28 (packages/paypal/PAYPAL_NOTES.md). */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFakePayPal, type FakePayPal } from './server.js';
import { getToken } from './test-helpers.js';

let fake: FakePayPal;
let token: string;

beforeAll(async () => {
  fake = await createFakePayPal({ autoProcess: false, seed: 11 });
  token = await getToken(fake.url);
});
afterEach(() => {
  fake.reset();
  fake.config.sandboxRealism = false;
  fake.config.reportingNotReady = false;
});
afterAll(() => fake.close());

const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${fake.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as any };
};

const paypalItem = { recipient_type: 'EMAIL', recipient_wallet: 'PAYPAL', receiver: 'sb-personal@example.com', amount: { value: '1.01', currency: 'USD' }, note: 'Mutual aid', sender_item_id: 'p1' };
const venmo = (receiver: string, note = 'Mutual aid', type = 'USER_HANDLE') => ({ recipient_type: type, recipient_wallet: 'VENMO', receiver, amount: { value: '1.02', currency: 'USD' }, note, sender_item_id: `v_${receiver}` });

describe('sandboxRealism: Venmo', () => {
  it('is off by default: a Venmo item is accepted', async () => {
    expect((await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'off' }, items: [venmo('lan-test')] })).status).toBe(201);
  });

  it('refuses the whole batch when any item is Venmo (handle, @handle or email): 400 VALIDATION_ERROR', async () => {
    fake.config.sandboxRealism = true;
    for (const [i, v] of [venmo('lan-test'), venmo('@lan-test'), venmo('sb-personal@example.com', 'Mutual aid', 'EMAIL')].entries()) {
      const res = await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: `real_${i}` }, items: [paypalItem, v] });
      expect(res.status).toBe(400);
      expect(res.body.name).toBe('VALIDATION_ERROR');
      expect(res.body.details).toEqual([{ field: 'items[1].recipient_wallet', location: 'body', issue: 'Recipient wallet not supported in sandbox.' }]);
    }
    // Nothing was created: the PayPal item did not go out on its own either.
    expect(Object.keys((await (await fetch(`${fake.url}/__fake/state`)).json()).batches)).toEqual([]);
  });

  it('accepts the documented mock note POSPYO003 on a Venmo item (201 PENDING), and ERRPYO013 is refused like any Venmo item', async () => {
    fake.config.sandboxRealism = true;
    const ok = await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'mock' }, items: [venmo('lan-test', 'POSPYO003')] });
    expect(ok.status).toBe(201);
    expect(ok.body.batch_header.batch_status).toBe('PENDING');
    const err = await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'e13' }, items: [venmo('lan-test', 'ERRPYO013')] });
    expect([err.status, err.body.name, err.body.details[0].issue]).toEqual([400, 'VALIDATION_ERROR', 'Recipient wallet not supported in sandbox.']);
  });

  it('PayPal-wallet-only batches are unaffected', async () => {
    fake.config.sandboxRealism = true;
    expect((await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'pp' }, items: [paypalItem] })).status).toBe(201);
  });
});

describe('sandboxRealism: webhooks-events time format', () => {
  it('refuses a millisecond start_time without end_time, accepts second-precision start_time and end_time', async () => {
    fake.config.sandboxRealism = true;
    const ms = await api('GET', `/v1/notifications/webhooks-events?start_time=${encodeURIComponent('2026-10-28T10:00:00.123Z')}&page_size=10`);
    expect([ms.status, ms.body.name]).toEqual([400, 'VALIDATION_ERROR']);
    const noEnd = await api('GET', `/v1/notifications/webhooks-events?start_time=2026-10-28T10:00:00Z`);
    expect(noEnd.status).toBe(400);
    const ok = await api('GET', `/v1/notifications/webhooks-events?start_time=2026-10-28T10:00:00Z&end_time=2026-10-28T11:00:00Z`);
    expect(ok.status).toBe(200);
    fake.config.sandboxRealism = false;
    expect((await api('GET', `/v1/notifications/webhooks-events?start_time=${encodeURIComponent('2026-10-28T10:00:00.123Z')}`)).status).toBe(200);
  });
});

describe('reportingNotReady and cancel twice', () => {
  it('Transaction Search answers 404 INVALID_REQUEST "Data for the given start date is not available."', async () => {
    fake.config.reportingNotReady = true;
    const res = await api('GET', '/v1/reporting/transactions?start_date=2026-10-27T00:00:00Z&end_date=2026-10-28T00:00:00Z');
    expect([res.status, res.body.name, res.body.message]).toEqual([404, 'INVALID_REQUEST', 'Data for the given start date is not available.']);
  });

  it('a second cancel of the same item is ITEM_ALREADY_CANCELLED (ERRPYO007), not ITEM_INCORRECT_STATUS', async () => {
    const b = await api('POST', '/v1/payments/payouts', { sender_batch_header: { sender_batch_id: 'c2' }, items: [{ ...paypalItem, receiver: 'nobody.unclaimed@example.com' }] });
    await fetch(`${fake.url}/__fake/batches/${b.body.batch_header.payout_batch_id}/process`, { method: 'POST' });
    const itemId = (await api('GET', `/v1/payments/payouts/${b.body.batch_header.payout_batch_id}`)).body.items[0].payout_item_id;
    expect((await api('POST', `/v1/payments/payouts-item/${itemId}/cancel`)).status).toBe(200);
    const again = await api('POST', `/v1/payments/payouts-item/${itemId}/cancel`);
    expect([again.status, again.body.name]).toEqual([400, 'ITEM_ALREADY_CANCELLED']);
  });
});
