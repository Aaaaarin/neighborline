/** Start tools/fake-paypal in-process on a random port and point a client at it. */
import { createFakePayPal, type FakePayPal, type FakePayPalOptions } from '@neighborline/fake-paypal';
import { createPayPal, type PayPal } from '../src/paypal.js';
import type { PayPalClientOptions } from '../src/client.js';

export interface FakeHarness {
  fake: FakePayPal;
  paypal: PayPal;
  /** Every outgoing request: method, url, headers (for asserting idempotency keys etc.). */
  calls: Array<{ method: string; url: string; headers: Record<string, string> }>;
  control(path: string, body?: unknown): Promise<any>;
  close(): Promise<void>;
}

export async function startFake(fakeOpts: FakePayPalOptions = {}, clientOpts: Partial<PayPalClientOptions> = {}): Promise<FakeHarness> {
  const fake = await createFakePayPal({ autoProcess: false, ...fakeOpts });
  const calls: FakeHarness['calls'] = [];
  const spyFetch: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    calls.push({ method: init?.method ?? 'GET', url: String(input), headers });
    return fetch(input, init);
  };
  const paypal = createPayPal({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    baseUrl: fake.url,
    fetch: spyFetch,
    retry: { baseDelayMs: 1, maxDelayMs: 5 },
    ...clientOpts,
  });
  return {
    fake,
    paypal,
    calls,
    async control(path, body) {
      const res = await fetch(`${fake.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
      return res.json();
    },
    close: () => fake.close(),
  };
}

export const apiCalls = (h: FakeHarness, pathPart: string) => h.calls.filter((c) => c.url.includes(pathPart));
