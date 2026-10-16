import { describe, expect, it } from 'vitest';
import { batchDigest, createHmacApprovalVerifier, denyAllApprovals, readApprovalToken, signApprovalToken } from './approval.js';
import type { CreateBatchInput } from './payouts.js';

const SECRET = 'approval-secret-that-is-at-least-32-chars';
const batch: CreateBatchInput = {
  senderBatchId: 'nl_test_1',
  items: [
    { senderItemId: 'req_lan', amountCents: 15000, receiver: '@lan-nguyen', recipientType: 'USER_HANDLE', wallet: 'VENMO', note: 'from your neighbors' },
    { senderItemId: 'req_rosa', amountCents: 12000, receiver: 'rosa@example.com', recipientType: 'EMAIL' },
  ],
};
const check = (token: string, b: CreateBatchInput = batch, now?: () => number) =>
  createHmacApprovalVerifier(SECRET, now ? { now } : {})({ approvalToken: token, batch: b, digest: batchDigest(b) });

describe('batchDigest', () => {
  it('ignores item order, receiver case and surrounding whitespace, and defaults currency and wallet', () => {
    const reordered = { ...batch, items: [{ ...batch.items[1]!, receiver: ' ROSA@example.com ', currency: 'usd', wallet: 'PAYPAL' as const }, batch.items[0]!] };
    expect(batchDigest(reordered)).toBe(batchDigest(batch));
  });

  it('changes when any money-relevant field changes, but not for the note', () => {
    const d = batchDigest(batch);
    const edit = (patch: Partial<CreateBatchInput['items'][number]>) => batchDigest({ ...batch, items: [{ ...batch.items[0]!, ...patch }, batch.items[1]!] });
    expect(edit({ amountCents: 15001 })).not.toBe(d);
    expect(edit({ receiver: '@lan-nguyem' })).not.toBe(d);
    expect(edit({ wallet: 'PAYPAL' })).not.toBe(d);
    expect(edit({ currency: 'CAD' })).not.toBe(d);
    expect(edit({ recipientType: 'EMAIL' })).not.toBe(d);
    expect(batchDigest({ ...batch, senderBatchId: 'nl_test_2' })).not.toBe(d);
    expect(edit({ note: 'different words' })).toBe(d);
  });
});

describe('approval tokens', () => {
  it('round-trips: two distinct approvers, bound to the batch, readable without the secret', () => {
    const token = signApprovalToken(SECRET, { approvalId: 'appr_1', batch, approvers: ['org_ana', 'org_ben'], ttlSec: 60, now: 1_800_000_000_000 });
    expect(token).toMatch(/^nlap1\.[\w-]+\.[\w-]+$/);
    expect(readApprovalToken(token)).toEqual({ v: 1, approvalId: 'appr_1', senderBatchId: 'nl_test_1', digest: batchDigest(batch), approvers: ['org_ana', 'org_ben'], iat: 1_800_000_000, exp: 1_800_000_060 });
    expect(check(token, batch, () => 1_800_000_030_000)).toEqual({ ok: true, approvalId: 'appr_1', approvers: ['org_ana', 'org_ben'] });
    expect(check(token, batch, () => 1_800_000_061_000)).toEqual({ ok: false, reason: 'approval token expired' });
  });

  it('refuses tampering, a different batch, one approver twice, and a wrong secret', () => {
    const token = signApprovalToken(SECRET, { approvalId: 'appr_1', batch, approvers: ['org_ana', 'org_ben'] });
    const [p, payload, sig] = token.split('.') as [string, string, string];
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;
    forged.exp = 9_999_999_999;
    expect(check(`${p}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`)).toEqual({ ok: false, reason: 'approval token signature invalid' });
    expect(check(token, { ...batch, senderBatchId: 'nl_other' })).toMatchObject({ reason: 'approval token is for a different sender_batch_id' });
    expect(check(token, { ...batch, items: [batch.items[0]!] })).toMatchObject({ reason: 'batch contents differ from what was approved' });
    const once = signApprovalToken(SECRET, { approvalId: 'a', batch, approvers: ['org_ana', ' ORG_ANA'] });
    expect(check(once)).toEqual({ ok: false, reason: 'needs 2 distinct human approvers, token has 1' });
    const other = signApprovalToken('another-secret-that-is-at-least-32-chars', { approvalId: 'a', batch, approvers: ['x', 'y'] });
    expect(check(other)).toMatchObject({ reason: 'approval token signature invalid' });
    expect(check('not-a-token')).toEqual({ ok: false, reason: 'malformed approval token' });
    expect(readApprovalToken('not-a-token')).toBeNull();
    expect(readApprovalToken('nlap1.%%%.x')).toBeNull();
  });

  it('rejects short secrets and denies everything by default', () => {
    expect(() => createHmacApprovalVerifier('short')).toThrow(/at least 32/);
    expect(() => signApprovalToken('short', { approvalId: 'a', batch, approvers: ['x', 'y'] })).toThrow(/at least 32/);
    expect(denyAllApprovals({ approvalToken: 'x', batch, digest: batchDigest(batch) })).toMatchObject({ ok: false });
  });

  it('honours minApprovers', () => {
    const token = signApprovalToken(SECRET, { approvalId: 'a', batch, approvers: ['org_ana', 'org_ben'] });
    const verify = createHmacApprovalVerifier(SECRET, { minApprovers: 3 });
    expect(verify({ approvalToken: token, batch, digest: batchDigest(batch) })).toEqual({ ok: false, reason: 'needs 3 distinct human approvers, token has 2' });
  });
});
