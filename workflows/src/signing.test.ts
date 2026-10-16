import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signedHeaders, verifyInternalRequest } from './signing.js';

const secret = 'x'.repeat(48);
const now = Date.parse('2026-11-20T10:00:00Z');
const body = JSON.stringify({ minNewPayouts: 5, force: false, reason: 'schedule' });

test('round trip verifies (plain object and Fetch Headers)', () => {
  const h = signedHeaders(secret, 'POST', '/api/internal/report-refresh', body, now);
  assert.deepEqual(verifyInternalRequest({ secret, method: 'POST', path: '/api/internal/report-refresh', rawBody: body, headers: h, nowMs: now }), { ok: true });
  assert.deepEqual(
    verifyInternalRequest({ secret, method: 'post', path: '/api/internal/report-refresh', rawBody: body, headers: new Headers(h), nowMs: now + 60_000 }),
    { ok: true },
  );
});

test('rejects tampering, re-targeting, staleness, wrong secret, missing headers', () => {
  const h = signedHeaders(secret, 'POST', '/api/internal/report-refresh', body, now);
  const v = (o: Partial<Parameters<typeof verifyInternalRequest>[0]>) =>
    verifyInternalRequest({ secret, method: 'POST', path: '/api/internal/report-refresh', rawBody: body, headers: h, nowMs: now, ...o });
  assert.equal(v({ rawBody: body.replace('5', '6') }).ok, false);
  assert.deepEqual(v({ path: '/api/internal/reconcile' }), { ok: false, reason: 'bad_signature' });
  assert.deepEqual(v({ nowMs: now + 301_000 }), { ok: false, reason: 'stale' });
  assert.deepEqual(v({ secret: 'y'.repeat(48) }), { ok: false, reason: 'bad_signature' });
  assert.deepEqual(v({ secret: 'short' }), { ok: false, reason: 'no_secret' });
  assert.deepEqual(v({ headers: { [TIMESTAMP_HEADER]: h[TIMESTAMP_HEADER] } }), { ok: false, reason: 'missing' });
  assert.ok(h[SIGNATURE_HEADER]!.startsWith('v1='));
});
