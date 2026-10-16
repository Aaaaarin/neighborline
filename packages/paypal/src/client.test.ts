import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiCalls, startFake, type FakeHarness } from '../test/fake.js';
import { PayPalClient } from './client.js';
import { PayPalApiError, PayPalAuthError, PayPalInputError, PayPalNetworkError, PayPalTimeoutError, isAmbiguousPayPalError } from './errors.js';
import { backoffDelayMs, DEFAULT_RETRY, isRetryableStatus, isSafeToReplay, retryAfterMs } from './retry.js';

let h: FakeHarness;
beforeAll(async () => {
  h = await startFake();
});
afterEach(() => {
  h.fake.reset();
  h.calls.length = 0;
});
afterAll(() => h.close());

describe('isAmbiguousPayPalError', () => {
  const api = (status: number) => new PayPalApiError({ status, body: { name: 'X' }, method: 'POST', path: '/v1/payments/payouts' });
  it('treats timeouts, network errors and 5xx as "may have landed"', () => {
    expect(isAmbiguousPayPalError(new PayPalTimeoutError('POST', '/v1/payments/payouts', 30_000))).toBe(true);
    expect(isAmbiguousPayPalError(new PayPalNetworkError('POST', '/v1/payments/payouts', new Error('socket hang up')))).toBe(true);
    expect(isAmbiguousPayPalError(api(503))).toBe(true);
    expect(isAmbiguousPayPalError(api(429))).toBe(true);
    expect(isAmbiguousPayPalError(new Error('unexpected'))).toBe(true);
  });
  it('treats definite rejections as failures', () => {
    expect(isAmbiguousPayPalError(api(422))).toBe(false);
    expect(isAmbiguousPayPalError(api(400))).toBe(false);
    expect(isAmbiguousPayPalError(new PayPalInputError('bad note'))).toBe(false);
  });
});

describe('retry policy (pure)', () => {
  it('retries only 429 and 5xx', () => {
    expect([429, 500, 502, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 409, 422].some(isRetryableStatus)).toBe(false);
  });
  it('replays ambiguous network failures only when PayPal can dedupe them', () => {
    expect(isSafeToReplay('GET', false)).toBe(true);
    expect(isSafeToReplay('POST', false)).toBe(false);
    expect(isSafeToReplay('POST', true)).toBe(true);
  });
  it('uses full-jitter exponential backoff within the cap', () => {
    expect(backoffDelayMs(0, DEFAULT_RETRY, () => 0.999)).toBeLessThan(300);
    expect(backoffDelayMs(3, DEFAULT_RETRY, () => 0.999)).toBe(2397);
    expect(backoffDelayMs(20, DEFAULT_RETRY, () => 0.999)).toBeLessThanOrEqual(8000);
    expect(backoffDelayMs(5, DEFAULT_RETRY, () => 0)).toBe(0);
  });
  it('parses Retry-After seconds and dates', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 7_000)).toBe(3000);
    expect(retryAfterMs('garbage')).toBeUndefined();
  });
});

describe('PayPalClient against fake-paypal', () => {
  it('caches the access token across requests', async () => {
    const spy = vi.fn<typeof fetch>((input, init) => fetch(input, init));
    const client = new PayPalClient({ clientId: 'a', clientSecret: 'b', baseUrl: h.fake.url, fetch: spy });
    await client.request({ path: '/v1/payments/payouts/ERRPYOB001' });
    await client.request({ path: '/v1/payments/payouts/ERRPYOB002' });
    expect(spy.mock.calls.filter(([u]) => String(u).endsWith('/v1/oauth2/token'))).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('refreshes the token early (before expiry) and only once under concurrency', async () => {
    let now = 1_000_000;
    h.fake.config.tokenTtlSec = 600;
    const client = new PayPalClient({ clientId: 'a', clientSecret: 'b', baseUrl: h.fake.url, now: () => now, tokenRefreshSkewMs: 120_000 });
    const t1 = await client.getAccessToken();
    now += 479_000; // 121s before expiry: still fresh
    expect(await client.getAccessToken()).toBe(t1);
    now += 2_000; // inside the 120s skew window → refresh
    const [t2, t3] = await Promise.all([client.getAccessToken(), client.getAccessToken()]);
    expect(t2).not.toBe(t1);
    expect(t3).toBe(t2);
    h.fake.config.tokenTtlSec = 32_400;
  });

  it('on 401 drops the cached token, refreshes once and succeeds', async () => {
    await h.paypal.payouts.getBatch('ERRPYOB001');
    await h.control('/__fake/tokens/expire');
    h.calls.length = 0;
    const b = await h.paypal.payouts.getBatch('ERRPYOB001');
    expect(b.status).toBe('SUCCESS');
    expect(apiCalls(h, '/v1/oauth2/token')).toHaveLength(1);
  });

  it('retries 5xx with the SAME PayPal-Request-Id and then succeeds', async () => {
    await h.control('/__fake/faults', { pathPrefix: '/v1/payments/payouts', status: 503, count: 2 });
    const res = await h.paypal.payouts.createBatch({ senderBatchId: 'nl_retry', items: [{ senderItemId: 'i1', amountCents: 500, receiver: 'a@example.com', recipientType: 'EMAIL' }] });
    expect(res.status).toBe('PENDING');
    const posts = apiCalls(h, '/v1/payments/payouts').filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((p) => p.headers['paypal-request-id']))).toEqual(new Set(['nl_retry']));
  });

  it('honors Retry-After on 429', async () => {
    const sleeps: number[] = [];
    const client = new PayPalClient({ clientId: 'a', clientSecret: 'b', baseUrl: h.fake.url, sleep: async (ms) => void sleeps.push(ms) });
    await h.control('/__fake/faults', { pathPrefix: '/v1/payments/payouts/', status: 429, count: 1, retryAfterSec: 2 });
    await client.request({ path: '/v1/payments/payouts/ERRPYOB001' });
    expect(sleeps).toEqual([2000]);
  });

  it('gives up after maxRetries and surfaces a typed error', async () => {
    await h.control('/__fake/faults', { pathPrefix: '/v1/payments/payouts/', status: 500, count: 10 });
    const err = await h.paypal.payouts.getBatch('ERRPYOB001').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect((err as PayPalApiError).status).toBe(500);
    expect(apiCalls(h, '/v1/payments/payouts/')).toHaveLength(1 + 3);
  });

  it('never retries 4xx and exposes name, debug_id, details', async () => {
    const err = (await h.paypal.payouts.getItem('NOPE').catch((e: unknown) => e)) as PayPalApiError;
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err.status).toBe(404);
    expect(err.name).toBe('INVALID_RESOURCE_ID');
    expect(err.debugId).toMatch(/^[0-9a-f]{13}$/);
    expect(apiCalls(h, '/payouts-item/')).toHaveLength(1);
  });

  it('passes PayPal-Mock-Response through', async () => {
    const order = await h.paypal.orders.createDonationOrder({ amountCents: 2500, description: 'Donation' });
    const err = (await h.paypal.orders.captureOrder(order.id, { mockResponse: { mock_application_codes: 'INSTRUMENT_DECLINED' } }).catch((e: unknown) => e)) as PayPalApiError;
    expect(err.status).toBe(422);
    expect(err.issue).toBe('INSTRUMENT_DECLINED');
    expect(h.calls.at(-1)!.headers['paypal-mock-response']).toBe('{"mock_application_codes":"INSTRUMENT_DECLINED"}');
  });

  it('times out with PayPalTimeoutError', async () => {
    const hanging: typeof fetch = (input, init) =>
      String(input).endsWith('/token')
        ? fetch(input, init)
        : new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const client = new PayPalClient({ clientId: 'a', clientSecret: 'b', baseUrl: h.fake.url, fetch: hanging, timeoutMs: 30, retry: { maxRetries: 0 } });
    await expect(client.request({ path: '/v1/payments/payouts/X' })).rejects.toBeInstanceOf(PayPalTimeoutError);
  });

  it('raises PayPalAuthError for bad credentials', async () => {
    h.fake.config.clientId = 'right';
    h.fake.config.clientSecret = 'right';
    try {
      const client = new PayPalClient({ clientId: 'wrong', clientSecret: 'wrong', baseUrl: h.fake.url });
      const err = (await client.getAccessToken().catch((e: unknown) => e)) as PayPalAuthError;
      expect(err).toBeInstanceOf(PayPalAuthError);
      expect(err.name).toBe('invalid_client');
    } finally {
      delete h.fake.config.clientId;
      delete h.fake.config.clientSecret;
    }
  });
});
