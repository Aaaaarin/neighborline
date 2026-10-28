import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv } from './config.js';
import { createFakePayPal, type FakePayPal } from './server.js';
import { getToken } from './test-helpers.js';

describe('CORS (FAKE_PAYPAL_CORS=1)', () => {
  let open: FakePayPal;
  let closed: FakePayPal;
  beforeAll(async () => {
    open = await createFakePayPal({ cors: true });
    closed = await createFakePayPal();
  });
  afterAll(async () => {
    await open.close();
    await closed.close();
  });

  it('is off by default and read from the env flag', () => {
    expect(closed.config.cors).toBe(false);
    expect(configFromEnv({ FAKE_PAYPAL_CORS: '1' }).cors).toBe(true);
    expect(configFromEnv({}).cors).toBeUndefined();
  });

  it('answers a preflight with 204 and echoes origin and requested headers', async () => {
    const res = await fetch(`${open.url}/v1/payments/payouts`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5555', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,paypal-request-id' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5555');
    expect(res.headers.get('access-control-allow-headers')).toBe('authorization,content-type,paypal-request-id');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('adds the headers to normal and error responses and exposes paypal-debug-id', async () => {
    const token = await getToken(open.url);
    const ok = await fetch(`${open.url}/v1/notifications/webhooks-events`, { headers: { authorization: `Bearer ${token}`, origin: 'http://x.test' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://x.test');
    expect(ok.headers.get('access-control-expose-headers')).toContain('paypal-debug-id');
    const err = await fetch(`${open.url}/v1/payments/payouts/NOPE`);
    expect(err.status).toBe(401);
    expect(err.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('without the flag, OPTIONS is not special and no CORS headers are sent', async () => {
    const res = await fetch(`${closed.url}/v1/payments/payouts`, { method: 'OPTIONS', headers: { origin: 'http://x.test' } });
    expect(res.status).toBe(405);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
