import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFakePayPal, type FakePayPal } from './server.js';
import { getToken, startWebhookReceiver } from './test-helpers.js';

let fake: FakePayPal;
let receiver: Awaited<ReturnType<typeof startWebhookReceiver>>;
let token: string;

beforeAll(async () => {
  receiver = await startWebhookReceiver();
  fake = await createFakePayPal({ autoProcess: false });
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

const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${fake.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as any };
};

const PAYOUT_EVENTS = [{ name: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED' }, { name: 'PAYMENT.PAYOUTSBATCH.SUCCESS' }];

async function payOne(senderBatchId: string) {
  const created = await api('POST', '/v1/payments/payouts', {
    sender_batch_header: { sender_batch_id: senderBatchId },
    items: [{ recipient_type: 'EMAIL', amount: { value: '1.00', currency: 'USD' }, receiver: 'sb-buyer@personal.example.com' }],
  });
  await fetch(`${fake.url}/__fake/batches/${created.body.batch_header.payout_batch_id}/process`, { method: 'POST' });
  await fake.idle();
}

describe('webhook subscriptions (POST/GET/PATCH/DELETE /v1/notifications/webhooks)', () => {
  it('creates, lists, reads, patches and deletes a subscription', async () => {
    const created = await api('POST', '/v1/notifications/webhooks', { url: receiver.url, event_types: PAYOUT_EVENTS });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^[A-Z0-9]{17}$/);
    expect(created.body.event_types.map((t: any) => t.name)).toEqual(PAYOUT_EVENTS.map((t) => t.name));
    expect((await api('GET', '/v1/notifications/webhooks')).body.webhooks).toHaveLength(1);
    expect((await api('GET', `/v1/notifications/webhooks/${created.body.id}`)).body.url).toBe(receiver.url);
    const patched = await api('PATCH', `/v1/notifications/webhooks/${created.body.id}`, [{ op: 'replace', path: '/event_types', value: [{ name: '*' }] }]);
    expect(patched.status).toBe(200);
    expect(patched.body.event_types[0].name).toBe('*');
    expect((await api('GET', `/v1/notifications/webhooks/${created.body.id}/event-types`)).body.event_types[0].name).toBe('*');
    expect((await api('DELETE', `/v1/notifications/webhooks/${created.body.id}`)).status).toBe(204);
    expect((await api('GET', `/v1/notifications/webhooks/${created.body.id}`)).status).toBe(404);
  });

  it('refuses a duplicate URL, an unknown event type and an 11th subscription', async () => {
    await api('POST', '/v1/notifications/webhooks', { url: receiver.url, event_types: PAYOUT_EVENTS });
    const dup = await api('POST', '/v1/notifications/webhooks', { url: receiver.url, event_types: PAYOUT_EVENTS });
    expect(dup).toMatchObject({ status: 400, body: { name: 'WEBHOOK_URL_ALREADY_EXISTS' } });
    const bad = await api('POST', '/v1/notifications/webhooks', { url: 'https://example.com/x', event_types: [{ name: 'PAYMENT.PAYOUTS-ITEM.REVERSED' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.details[0].issue).toBe('INVALID_EVENT_TYPE');
    for (let i = 0; i < 9; i++) expect((await api('POST', '/v1/notifications/webhooks', { url: `https://example.com/h${i}`, event_types: [{ name: '*' }] })).status).toBe(201);
    const over = await api('POST', '/v1/notifications/webhooks', { url: 'https://example.com/h-over', event_types: [{ name: '*' }] });
    expect(over.body.name).toBe('WEBHOOK_NUMBER_LIMIT_EXCEEDED');
  });

  it('lists the event types it can send (without REVERSED, like PayPal)', async () => {
    const names = (await api('GET', '/v1/notifications/webhooks-event-types')).body.event_types.map((t: any) => t.name);
    expect(names).toContain('PAYMENT.PAYOUTS-ITEM.UNCLAIMED');
    expect(names).toContain('BILLING.SUBSCRIPTION.ACTIVATED');
    expect(names).not.toContain('PAYMENT.PAYOUTS-ITEM.REVERSED');
  });
});

describe('delivery to subscriptions', () => {
  it('signs each subscription delivery with its own webhook id; it verifies only with that id', async () => {
    const sub = (await api('POST', '/v1/notifications/webhooks', { url: receiver.url, event_types: PAYOUT_EVENTS })).body;
    await payOne('nl_sub_1');
    const got = receiver.received.filter((r) => r.event.event_type === 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED');
    expect(got).toHaveLength(1);
    // Only the subscribed types arrive (no PROCESSING batch event).
    expect(receiver.received.map((r) => r.event.event_type).sort()).toEqual(['PAYMENT.PAYOUTS-ITEM.SUCCEEDED', 'PAYMENT.PAYOUTSBATCH.SUCCESS']);
    const h = got[0]!.headers;
    const verify = (webhookId: string) =>
      fetch(`${fake.url}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: `{"auth_algo":"${h['paypal-auth-algo']}","cert_url":"${h['paypal-cert-url']}","transmission_id":"${h['paypal-transmission-id']}","transmission_sig":"${h['paypal-transmission-sig']}","transmission_time":"${h['paypal-transmission-time']}","webhook_id":"${webhookId}","webhook_event":${got[0]!.rawBody}}`,
      }).then((r) => r.json() as Promise<any>);
    expect((await verify(sub.id)).verification_status).toBe('SUCCESS');
    expect((await verify(fake.config.webhookId)).verification_status).toBe('FAILURE');
  });

  it('lists events and resends one as a new, verifiable transmission', async () => {
    const sub = (await api('POST', '/v1/notifications/webhooks', { url: receiver.url, event_types: PAYOUT_EVENTS })).body;
    await payOne('nl_sub_2');
    const events = (await api('GET', '/v1/notifications/webhooks-events?event_type=PAYMENT.PAYOUTS-ITEM.SUCCEEDED&page_size=5')).body;
    expect(events.count).toBe(1);
    const ev = events.events[0];
    const before = receiver.received.length;
    const re = await api('POST', `/v1/notifications/webhooks-events/${ev.id}/resend`, { webhook_ids: [sub.id] });
    expect(re.status).toBe(202);
    await fake.idle();
    expect(receiver.received.length).toBe(before + 1);
    const again = receiver.received.at(-1)!;
    expect(again.event.id).toBe(ev.id);
    expect(again.headers['paypal-transmission-id']).not.toBe(receiver.received[0]!.headers['paypal-transmission-id']);
    expect((await api('POST', '/v1/notifications/webhooks-events/WH-NOPE/resend', {})).status).toBe(404);
  });

  it('simulate-event with a subscription id goes to that subscription and does not verify', async () => {
    const sub = (await api('POST', '/v1/notifications/webhooks', { url: receiver.url, event_types: [{ name: '*' }] })).body;
    const sim = await api('POST', '/v1/notifications/simulate-event', { webhook_id: sub.id, event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED' });
    expect(sim.status).toBe(202);
    await fake.idle();
    expect(receiver.received).toHaveLength(1);
    expect(fake.state.webhooks.at(-1)).toMatchObject({ webhookId: sub.id, simulated: true });
  });
});
