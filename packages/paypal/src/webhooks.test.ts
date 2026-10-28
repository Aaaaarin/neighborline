import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startFake, type FakeHarness } from '../test/fake.js';
import { applyItemStatus, type PayoutItemStatus } from './payout-status.js';
import { parseWebhookEvent, WebhookParseError } from './webhook-events.js';
import { buildVerifyRequestBody, webhookEventsQuery } from './webhooks.js';

interface Delivery {
  headers: Record<string, string>;
  rawBody: string;
}

let h: FakeHarness;
let deliveries: Delivery[];
let closeReceiver: () => Promise<void>;

beforeAll(async () => {
  deliveries = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
    deliveries.push({ headers, rawBody: Buffer.concat(chunks).toString('utf8') });
    res.writeHead(200).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  closeReceiver = () => new Promise((r) => server.close(() => r()));
  h = await startFake({ webhookTargetUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook` });
});
afterEach(() => {
  h.fake.reset();
  deliveries.length = 0;
});
afterAll(async () => {
  await h.close();
  await closeReceiver();
});

const webhookId = () => h.fake.config.webhookId;

async function runClaimStory() {
  const res = await h.paypal.payouts.createBatch({
    senderBatchId: 'nl_story',
    items: [
      { senderItemId: 'req_lan', amountCents: 15000, receiver: '@lan-nguyen', recipientType: 'USER_HANDLE', wallet: 'VENMO', note: 'Đã gửi $150' },
      { senderItemId: 'req_rosa', amountCents: 12000, receiver: 'rosa.unclaimed@example.com', recipientType: 'EMAIL', note: 'Ayuda mutua' },
    ],
  });
  await h.control(`/__fake/batches/${res.batchId}/process`);
  const rosa = (await h.paypal.payouts.listAllItems(res.batchId)).find((i) => i.senderItemId === 'req_rosa')!;
  await h.control(`/__fake/claim/${rosa.payoutItemId}`);
  await h.fake.idle();
  return res;
}

describe('verifyWebhookSignature', () => {
  it('verifies every genuine delivery using the raw body', async () => {
    await runClaimStory();
    expect(deliveries.length).toBe(5);
    for (const d of deliveries) {
      const r = await h.paypal.webhooks.verifyWebhookSignature({ headers: d.headers, rawBody: d.rawBody, webhookId: webhookId() });
      expect(r).toEqual({ verified: true, status: 'SUCCESS' });
    }
  });

  it('fails a tampered body, a wrong webhook id, and missing headers (no network call)', async () => {
    await runClaimStory();
    const d = deliveries.find((x) => x.rawBody.includes('PAYMENT.PAYOUTS-ITEM.SUCCEEDED'))!;
    const tampered = d.rawBody.replace('"150.00"', '"1500.00"');
    expect((await h.paypal.webhooks.verifyWebhookSignature({ headers: d.headers, rawBody: tampered, webhookId: webhookId() })).verified).toBe(false);
    expect((await h.paypal.webhooks.verifyWebhookSignature({ headers: d.headers, rawBody: d.rawBody, webhookId: 'SOMEONEELSE' })).verified).toBe(false);
    const before = h.calls.length;
    const { 'paypal-transmission-sig': _sig, ...noSig } = d.headers;
    expect(await h.paypal.webhooks.verifyWebhookSignature({ headers: noSig, rawBody: d.rawBody, webhookId: webhookId() })).toEqual({ verified: false, status: 'FAILURE', reason: 'missing_headers' });
    expect(h.calls.length).toBe(before);
  });

  it('splices the raw event bytes verbatim (no re-serialization) and rejects non-object bodies', () => {
    const headers = new Headers({ 'paypal-transmission-id': 't', 'paypal-transmission-time': 'x', 'paypal-transmission-sig': 's', 'paypal-cert-url': 'c', 'paypal-auth-algo': 'SHA256withRSA' });
    const raw = '{"id":"WH-1","event_type":"X","resource":{"note":"caf\\u00e9","v":1.50}}';
    const body = buildVerifyRequestBody({ headers, rawBody: raw, webhookId: 'W' }) as string;
    expect(body.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    expect(JSON.parse(body).webhook_id).toBe('W');
    expect(buildVerifyRequestBody({ headers, rawBody: '[1]', webhookId: 'W' })).toEqual({ error: 'invalid_body' });
    expect(buildVerifyRequestBody({ headers, rawBody: '{"a":1}, "webhook_id":"evil"', webhookId: 'W' })).toEqual({ error: 'invalid_body' });
  });

  it('simulated events are delivered but cannot be verified (documented PayPal behaviour)', async () => {
    const sim = await h.paypal.webhooks.simulateEvent({ eventType: 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED', webhookId: webhookId() });
    expect(sim.event_type).toBe('PAYMENT.PAYOUTS-ITEM.UNCLAIMED');
    await h.fake.idle();
    const d = deliveries[0]!;
    expect((await h.paypal.webhooks.verifyWebhookSignature({ headers: d.headers, rawBody: d.rawBody, webhookId: webhookId() })).verified).toBe(false);
  });
});

describe('parseWebhookEvent', () => {
  it('turns the claim story into typed events and folds to the right final states in any order', async () => {
    await runClaimStory();
    const events = deliveries.map((d) => parseWebhookEvent(d.rawBody));
    expect(events.map((e) => e.kind)).toEqual(['payout_batch', 'payout_item', 'payout_item', 'payout_batch', 'payout_item']);
    expect(events.map((e) => e.eventType)).toEqual([
      'PAYMENT.PAYOUTSBATCH.PROCESSING',
      'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
      'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
      'PAYMENT.PAYOUTSBATCH.SUCCESS',
      'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
    ]);
    const items = events.flatMap((e) => (e.kind === 'payout_item' ? [e] : []));
    expect(items[0]!.item).toMatchObject({ senderItemId: 'req_lan', amountCents: 15000, wallet: 'VENMO', status: 'SUCCESS' });

    // Deliver the item events in reverse order: state must still end at SUCCESS for both.
    const state = new Map<string, PayoutItemStatus>();
    for (const e of [...items].reverse()) {
      const id = e.item.senderItemId!;
      state.set(id, applyItemStatus(state.get(id) ?? 'PENDING', e.status).status);
    }
    expect(Object.fromEntries(state)).toEqual({ req_lan: 'SUCCESS', req_rosa: 'SUCCESS' });
  });

  it('parses donation events from orders + subscriptions', async () => {
    const order = await h.paypal.orders.createDonationOrder({ amountCents: 2500, description: 'Eastside ice storm fund', customId: 'don_42' });
    await h.control(`/__fake/orders/${order.id}/approve`, { fundingSource: 'venmo' });
    await h.paypal.orders.captureOrder(order.id);
    const tiers = await h.paypal.subscriptions.ensureDonationTiers({ product: { id: 'NEIGHBORLINE-DONATION', name: 'Neighborline monthly' } });
    const sub = await (await fetch(`${h.fake.url}/v1/billing/subscriptions`, { method: 'POST', headers: { authorization: `Bearer ${await h.paypal.client.getAccessToken()}`, 'content-type': 'application/json' }, body: JSON.stringify({ plan_id: tiers[2500], custom_id: 'donor_7' }) })).json() as { id: string };
    await h.control(`/__fake/subscriptions/${sub.id}/activate`);
    await h.fake.idle();
    const kinds = deliveries.map((d) => parseWebhookEvent(d.rawBody));
    expect(kinds.map((k) => k.kind)).toEqual(['order_approved', 'capture_completed', 'subscription_activated', 'sale_completed']);
    const cap = kinds[1]!;
    expect(cap.kind === 'capture_completed' && [cap.amountCents, cap.customId, cap.orderId]).toEqual([2500, 'don_42', order.id]);
    const sale = kinds[3]!;
    expect(sale.kind === 'sale_completed' && [sale.amountCents, sale.subscriptionId, sale.customId]).toEqual([2500, sub.id, 'donor_7']);
  });

  it('rejects malformed known events and passes unknown ones through', () => {
    expect(() => parseWebhookEvent('not json')).toThrow(WebhookParseError);
    expect(() => parseWebhookEvent({ id: 'WH-1', event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resource: { nope: true } })).toThrow(/unexpected resource shape/);
    expect(parseWebhookEvent({ id: 'WH-2', event_type: 'CUSTOMER.DISPUTE.CREATED', resource: {} }).kind).toBe('unknown');
  });
});

describe('listEvents (GET /v1/notifications/webhooks-events)', () => {
  it('builds second-precision start_time AND end_time (the sandbox refused milliseconds without end_time, 2026-10-28)', () => {
    const q = webhookEventsQuery({ startTime: new Date('2026-10-28T10:00:00.789Z') }, new Date('2026-10-28T11:22:33.456Z'));
    expect(q).toEqual({ start_time: '2026-10-28T10:00:00Z', end_time: '2026-10-28T11:22:33Z', page_size: 50 });
    expect(webhookEventsQuery({ startTime: '2026-10-28T10:00:00.1Z', endTime: '2026-10-28T10:05:00Z', pageSize: 100, eventType: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED' })).toMatchObject({ end_time: '2026-10-28T10:05:00Z', page_size: 100, event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED' });
    expect(() => webhookEventsQuery({ startTime: '2026-10-28T10:00:00Z', endTime: '2026-10-28T09:00:00Z' })).toThrow(RangeError);
    expect(() => webhookEventsQuery({ startTime: new Date(), pageSize: 301 })).toThrow(RangeError);
  });

  it('lists events from a fake that enforces the sandbox format', async () => {
    const since = new Date(Date.now() - 60_000);
    await runClaimStory(); // has a Venmo item: run it before turning on realism, which would refuse the batch
    h.fake.config.sandboxRealism = true;
    try {
      const events = await h.paypal.webhooks.listEvents({ startTime: since, endTime: new Date(Date.now() + 60_000), pageSize: 100 });
      expect(events.map((e) => e.eventType)).toContain('PAYMENT.PAYOUTS-ITEM.SUCCEEDED');
      expect(events[0]).toMatchObject({ id: expect.any(String), createTime: expect.any(String) });
      const call = h.calls.find((c) => c.url.includes('/v1/notifications/webhooks-events'))!;
      expect(new URL(call.url).searchParams.get('start_time')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(new URL(call.url).searchParams.get('end_time')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    } finally {
      h.fake.config.sandboxRealism = false;
    }
  });
});
