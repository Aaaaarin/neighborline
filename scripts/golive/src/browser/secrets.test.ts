import { describe, expect, it } from 'vitest';
import { resolveBase } from './spike-browser.js';
import { findSecrets, REDACTED, scrubSecrets } from './secrets.js';

const ID = `A${'b'.repeat(79)}`;
const SEC = `E${'c'.repeat(79)}`;

describe('secrets', () => {
  it('finds secret keys, token shapes and known values, by path', () => {
    const found = findSecrets(
      { a: { authorization: 'x' }, b: ['ok', `Bearer A21AAabcdefghijklmnopqrstuvwxyz0123`], c: { access_token: 't' }, d: `id ${ID}`, e: 'my-own-secret-value', f: 'Basic dGVzdDp0ZXN0dGVzdHRlc3Q=' },
      ['my-own-secret-value'],
    );
    expect(found.join('\n')).toContain('a.authorization');
    expect(found.join('\n')).toContain('b[1]: Bearer token');
    expect(found.join('\n')).toContain('b[1]: PayPal access token');
    expect(found.join('\n')).toContain('c.access_token');
    expect(found.join('\n')).toContain('d: PayPal client id/secret');
    expect(found.join('\n')).toContain('e: a credential value');
    expect(found.join('\n')).toContain('f: Basic credentials');
    // Nothing in a real spike result trips it: approve links carry an order token, ids are short.
    expect(findSecrets({ approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T', batchId: 'Q8KVJG9TZTNN4', message: 'Authentication failed: missing Authorization header.' })).toEqual([]);
  });

  it('scrubs to something findSecrets accepts, without touching ordinary data', () => {
    const dirty = { headers: { Authorization: `Bearer ${SEC}` }, note: `client ${ID} / ${SEC}`, nested: [{ token_type: 'Bearer', sec: SEC, keep: 42 }], err: 'token A21AAzzzzzzzzzzzzzzzzzzzzzzzzz expired', raw: 'custom-known-value-123' };
    const clean = scrubSecrets(dirty, ['custom-known-value-123']);
    expect(findSecrets(clean, ['custom-known-value-123'])).toEqual([]);
    expect(clean).toEqual({ note: `client ${REDACTED} / ${REDACTED}`, nested: [{ token_type: 'Bearer', keep: 42 }], err: `token ${REDACTED} expired`, raw: REDACTED, headers: {} });
    expect(dirty.nested[0]!.sec).toBe(SEC); // a copy, not in place
  });
});

describe('resolveBase', () => {
  it('defaults to the sandbox, allows localhost for tests, refuses everything else', () => {
    expect(resolveBase()).toEqual({ base: 'https://api-m.sandbox.paypal.com', target: 'sandbox' });
    expect(resolveBase('https://api-m.sandbox.paypal.com/')).toEqual({ base: 'https://api-m.sandbox.paypal.com', target: 'sandbox' });
    expect(resolveBase('http://127.0.0.1:4010')).toEqual({ base: 'http://127.0.0.1:4010', target: 'fake' });
    expect(() => resolveBase('https://api-m.paypal.com')).toThrow(/refused/);
    expect(() => resolveBase('https://evil.example.com')).toThrow(/refused/);
  });
});
