import { describe, expect, it } from 'vitest';
import { ConfigError, readConfig } from './config.js';
import { NonceCache, verifyApproverRequest, signApproverRequest } from './protocol.js';

const secret = 's'.repeat(40);

describe('approver config: Payouts credentials live here, and only here', () => {
  it('refuses to start without a strong shared secret', () => {
    expect(() => readConfig({ NEIGHBORLINE_APPROVER_SECRET: 'short' })).toThrow(ConfigError);
  });

  it('fake mode needs no credentials', () => {
    const c = readConfig({ NEIGHBORLINE_APPROVER_SECRET: secret });
    expect(c.paypal).toMatchObject({ mode: 'fake', credentials: 'fake' });
  });

  it('sandbox requires a dedicated Payouts app', () => {
    expect(() => readConfig({ NEIGHBORLINE_APPROVER_SECRET: secret, PAYPAL_MODE: 'sandbox', PAYPAL_CLIENT_ID: 'main', PAYPAL_CLIENT_SECRET: 'main' })).toThrow(/PAYPAL_PAYOUTS_CLIENT_ID/);
    const c = readConfig({ NEIGHBORLINE_APPROVER_SECRET: secret, PAYPAL_MODE: 'sandbox', PAYPAL_PAYOUTS_CLIENT_ID: 'p', PAYPAL_PAYOUTS_CLIENT_SECRET: 'ps' });
    expect(c.paypal).toMatchObject({ mode: 'sandbox', credentials: 'dedicated', clientId: 'p', baseUrl: 'https://api-m.sandbox.paypal.com' });
  });

  it('falls back to the main app only when explicitly allowed, with a loud warning', () => {
    const c = readConfig({ NEIGHBORLINE_APPROVER_SECRET: secret, PAYPAL_MODE: 'sandbox', APPROVER_ALLOW_SHARED_CREDENTIALS: 'true', PAYPAL_CLIENT_ID: 'main', PAYPAL_CLIENT_SECRET: 'm' });
    expect(c.paypal.credentials).toBe('shared-fallback');
    expect(c.warnings.join(' ')).toMatch(/NOT true at the PayPal level/);
  });
});

describe('request signing', () => {
  it('verifies a signature and rejects a tampered body', () => {
    const h = signApproverRequest(secret, 'POST', '/v1/execute', '{"a":1}');
    expect(verifyApproverRequest({ secret, method: 'POST', path: '/v1/execute', rawBody: '{"a":1}', headers: h }).ok).toBe(true);
    expect(verifyApproverRequest({ secret, method: 'POST', path: '/v1/execute', rawBody: '{"a":2}', headers: h })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyApproverRequest({ secret, method: 'POST', path: '/v1/poll/x', rawBody: '{"a":1}', headers: h })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('nonce cache accepts once, forgets after the TTL, and fails closed when full', () => {
    const c = new NonceCache(1000, 2);
    expect(c.accept('a', 0)).toBe(true);
    expect(c.accept('a', 10)).toBe(false);
    expect(c.accept('b', 10)).toBe(true);
    expect(c.accept('c', 20)).toBe(false); // full, nothing expired yet
    expect(c.accept('c', 2000)).toBe(true); // a and b expired and were pruned
  });
});
