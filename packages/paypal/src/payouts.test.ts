import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { apiCalls, startFake, type FakeHarness } from '../test/fake.js';
import { DuplicateBatchError, PayPalApiError, PayPalInputError } from './errors.js';
import { buildPayoutRequest, findExistingBatchId, isDuplicateSenderBatchError, type CreateBatchInput, type PayoutItemInput } from './payouts.js';

const paypalItem = (receiver: string, cents = 15000, id = receiver): PayoutItemInput => ({ senderItemId: id.slice(0, 63), amountCents: cents, receiver, recipientType: 'EMAIL', note: 'Neighborline mutual aid', purpose: 'NON_GOODS_OR_SERVICES' });
const venmoItem = (handle: string, cents = 15000): PayoutItemInput => ({ senderItemId: handle, amountCents: cents, receiver: handle, recipientType: 'USER_HANDLE', wallet: 'VENMO', note: 'Đã gửi tiền hỗ trợ' });

describe('buildPayoutRequest (pure)', () => {
  it('maps cents to PayPal strings and sets Venmo wallet + PRIVATE feed', () => {
    const req = buildPayoutRequest({ senderBatchId: 'nl_1', emailSubject: 'You have a payout', items: [paypalItem('a@example.com', 15000), venmoItem('@lan', 4205)] });
    expect(req.sender_batch_header).toEqual({ sender_batch_id: 'nl_1', email_subject: 'You have a payout' });
    expect(req.items[0]).toMatchObject({ amount: { value: '150.00', currency: 'USD' }, recipient_wallet: 'PAYPAL', purpose: 'NON_GOODS_OR_SERVICES' });
    expect(req.items[0]).not.toHaveProperty('application_context');
    expect(req.items[1]).toMatchObject({ amount: { value: '42.05', currency: 'USD' }, recipient_type: 'USER_HANDLE', recipient_wallet: 'VENMO', application_context: { social_feed_privacy: 'PRIVATE' } });
  });

  it.each<[string, Partial<CreateBatchInput>, RegExp]>([
    ['Venmo without note', { items: [{ ...venmoItem('@x'), note: '  ' }] }, /Venmo payouts require a note/],
    ['USER_HANDLE on PayPal wallet', { items: [{ ...paypalItem('x'), recipientType: 'USER_HANDLE' }] }, /requires wallet VENMO/],
    ['mixed currencies', { items: [paypalItem('a'), { ...paypalItem('b'), currency: 'EUR' }] }, /one currency/],
    ['duplicate senderItemId', { items: [paypalItem('a', 100, 'same'), paypalItem('b', 100, 'same')] }, /duplicate senderItemId/],
    ['float amount', { items: [{ ...paypalItem('a'), amountCents: 10.5 }] }, /positive integer/],
    ['empty batch', { items: [] }, /1–15000 items/],
    ['long non-ASCII note', { items: [{ ...paypalItem('a'), note: 'đ'.repeat(1001) }] }, /exceeds 1000/],
  ])('rejects %s before calling PayPal', (_name, patch, msg) => {
    expect(() => buildPayoutRequest({ senderBatchId: 'nl_x', items: [], ...patch } as CreateBatchInput)).toThrow(msg);
    expect(() => buildPayoutRequest({ senderBatchId: 'nl_x', items: [], ...patch } as CreateBatchInput)).toThrow(PayPalInputError);
  });
});

describe('duplicate sender_batch_id detection (pure)', () => {
  const observed = {
    name: 'USER_BUSINESS_ERROR',
    message: 'User business error.',
    debug_id: 'abc',
    details: [{ field: 'SENDER_BATCH_ID', location: 'body', issue: 'Batch with given sender_batch_id already exists', link: [{ href: 'https://api-m.sandbox.paypal.com/v1/payments/payouts/TDKVFBJK7XYZ', rel: 'self', method: 'GET' }] }],
  };
  const err = (body: unknown, status = 400) => new PayPalApiError({ status, body, method: 'POST', path: '/v1/payments/payouts' });

  it('recognises the observed sandbox shape and extracts the original batch id', () => {
    expect(isDuplicateSenderBatchError(err(observed))).toBe(true);
    expect(findExistingBatchId(observed)).toBe('TDKVFBJK7XYZ');
  });
  it('also finds links under details[].links or top-level links', () => {
    expect(findExistingBatchId({ links: [{ href: 'https://x/v1/payments/payouts/ABC123?page=1', rel: 'self' }] })).toBe('ABC123');
  });
  it('does not treat other business errors as duplicates', () => {
    expect(isDuplicateSenderBatchError(err({ name: 'INSUFFICIENT_FUNDS', message: 'x', details: [] }, 422))).toBe(false);
    expect(isDuplicateSenderBatchError(err(observed, 500))).toBe(false);
  });
});

describe('PayoutsApi against fake-paypal', () => {
  let h: FakeHarness;
  beforeAll(async () => {
    h = await startFake();
  });
  afterEach(() => {
    h.fake.reset();
    h.calls.length = 0;
  });
  afterAll(() => h.close());

  const batch = (senderBatchId: string, items: PayoutItemInput[]): CreateBatchInput => ({ senderBatchId, emailSubject: 'Neighborline sent you money', items });

  it('creates a mixed PayPal + Venmo batch; PayPal-Request-Id defaults to sender_batch_id', async () => {
    const res = await h.paypal.payouts.createBatch(batch('nl_mixed', [paypalItem('lan@example.com'), venmoItem('@rosa')]));
    expect(res).toMatchObject({ status: 'PENDING', duplicate: false, senderBatchId: 'nl_mixed' });
    expect(res.batchId).toMatch(/^[A-Z0-9]{13}$/);
    expect(apiCalls(h, '/v1/payments/payouts')[0]!.headers['paypal-request-id']).toBe('nl_mixed');
  });

  it('double submit (same request id) returns the same batch, not a second payout', async () => {
    const a = await h.paypal.payouts.createBatch(batch('nl_double', [paypalItem('a@example.com')]));
    const b = await h.paypal.payouts.createBatch(batch('nl_double', [paypalItem('a@example.com')]));
    expect(b.batchId).toBe(a.batchId);
    expect(h.fake.state.batches.size).toBe(1);
  });

  it('reused sender_batch_id under a different request id resolves to the original batch (duplicate: true)', async () => {
    const a = await h.paypal.payouts.createBatch(batch('nl_dup', [paypalItem('a@example.com')]));
    const b = await h.paypal.payouts.createBatch({ ...batch('nl_dup', [paypalItem('a@example.com')]), requestId: 'other-process' });
    expect(b).toMatchObject({ batchId: a.batchId, duplicate: true });
    expect(h.fake.state.batches.size).toBe(1);
  });

  it('throws DuplicateBatchError when PayPal gives no link to the original', async () => {
    const body = { name: 'USER_BUSINESS_ERROR', message: 'User business error.', debug_id: 'd1', details: [{ field: 'SENDER_BATCH_ID', issue: 'Batch with given sender_batch_id already exists' }] };
    const fetchStub: typeof fetch = async (input) =>
      String(input).endsWith('/token')
        ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
        : new Response(JSON.stringify(body), { status: 400 });
    const { createPayPal } = await import('./paypal.js');
    const pp = createPayPal({ clientId: 'a', clientSecret: 'b', baseUrl: 'http://stub', fetch: fetchStub });
    const err = await pp.payouts.createBatch(batch('nl_nolink', [paypalItem('a@example.com')])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DuplicateBatchError);
    expect((err as DuplicateBatchError).senderBatchId).toBe('nl_nolink');
  });

  it('maps item outcomes after processing and paginates batch items', async () => {
    const created = await h.paypal.payouts.createBatch(
      batch('nl_outcomes', [paypalItem('ok@example.com'), paypalItem('maria.unclaimed@example.com'), venmoItem('@new-to-venmo-ana'), paypalItem('z@onhold.example'), paypalItem('q@blocked.example')]),
    );
    await h.control(`/__fake/batches/${created.batchId}/process`);
    const page1 = await h.paypal.payouts.getBatch(created.batchId, { pageSize: 2 });
    expect(page1).toMatchObject({ status: 'SUCCESS', totalItems: 5, totalPages: 3, hasNextPage: true, amountCents: 75000 });
    const all = await h.paypal.payouts.listAllItems(created.batchId, 2);
    expect(all.map((i) => [i.senderItemId, i.status, i.amountCents])).toEqual([
      ['ok@example.com', 'SUCCESS', 15000],
      ['maria.unclaimed@example.com', 'UNCLAIMED', 15000],
      ['@new-to-venmo-ana', 'UNCLAIMED', 15000],
      ['z@onhold.example', 'ONHOLD', 15000],
      ['q@blocked.example', 'BLOCKED', 15000],
    ]);
    expect(all[1]!.errorName).toBe('RECEIVER_UNREGISTERED');
    expect(all[2]!.wallet).toBe('VENMO');
    expect(all[0]!.transactionId).toMatch(/^[0-9A-Z]{17}$/);
  });

  it('cancels an UNCLAIMED item (→ RETURNED) and refuses to cancel a paid one', async () => {
    const created = await h.paypal.payouts.createBatch(batch('nl_cancel', [paypalItem('x.unclaimed@example.com'), paypalItem('ok@example.com')]));
    await h.control(`/__fake/batches/${created.batchId}/process`);
    const [unclaimed, paid] = await h.paypal.payouts.listAllItems(created.batchId);
    expect((await h.paypal.payouts.cancelUnclaimedItem(unclaimed!.payoutItemId)).status).toBe('RETURNED');
    const err = (await h.paypal.payouts.cancelUnclaimedItem(paid!.payoutItemId).catch((e: unknown) => e)) as PayPalApiError;
    expect(err.name).toBe('ITEM_INCORRECT_STATUS');
    expect((await h.paypal.payouts.getItem(paid!.payoutItemId)).status).toBe('SUCCESS');
  });
});
