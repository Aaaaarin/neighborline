/**
 * Every recorded "sender_batch_id already used" body (src/fixtures/duplicate-sender-batch/*.json) must be recognised
 * by the client and resolved to its original batch. `pnpm golive` (sandbox-spike) adds the body the real sandbox
 * returned; if PayPal's shape differs from what we assumed, this test is the one that goes red.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PayPalApiError } from './errors.js';
import { findExistingBatchId, isDuplicateSenderBatchError } from './payouts.js';

const dir = fileURLToPath(new URL('./fixtures/duplicate-sender-batch/', import.meta.url));
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, ...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as { source: string; status: number; body: unknown; expectBatchId: string | null }) }));

describe('duplicate sender_batch_id fixtures', () => {
  it('has at least the community-observed shape', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });
  for (const fx of fixtures) {
    it(`${fx.file}: detected, and resolved to ${fx.expectBatchId ?? 'no link (DuplicateBatchError)'}`, () => {
      const err = new PayPalApiError({ status: fx.status, body: fx.body, method: 'POST', path: '/v1/payments/payouts' });
      expect(isDuplicateSenderBatchError(err)).toBe(true);
      expect(findExistingBatchId(fx.body) ?? null).toBe(fx.expectBatchId);
    });
  }
});
