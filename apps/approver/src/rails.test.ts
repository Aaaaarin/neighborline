/**
 * Payout rails: PayPal account-level refusals → FAILED_RAIL (nothing sent), and the manual fallback that
 * records an organizer-attested hand-over with the same two re-verified signatures plus a receipt note.
 * The refusals go through the fake PayPal's documented negative-testing values (ERRPYO001
 * SENDER_RESTRICTED, ERRPYO003 AUTHORIZATION_ERROR in items[0].note), so the real error parsing is used.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { appendAudit, getBatch, getRequest, listAudit, listItemsForRequest, payoutBatches, requests, verifyAuditChain } from '@neighborline/db';
import { PayPalApiError, PayPalAuthError, PayPalTimeoutError, type PayoutsApi } from '@neighborline/paypal';
import { APPROVER_ROUTES, RAIL_FALLBACK_ACTION } from './protocol.js';
import { payoutCopy, type Group, type HelpRequest } from '@neighborline/core';
import type { BatchWithItems } from '@neighborline/db';
import { accountLevelReason, ManualRail, PayPalPayoutsRail, railBatchFor } from './rails.js';
import { approve, call, execute, executeBody, fileRequest, startFixture, type Fixture } from './test-helpers.js';

const venmo = (h: string) => ({ wallet: 'VENMO' as const, type: 'USER_HANDLE' as const, value: h });
const apiError = (status: number, name: string) => new PayPalApiError({ status, body: { name, message: name, debug_id: 'dbg1' }, method: 'POST', path: '/v1/payments/payouts' });

describe('accountLevelReason', () => {
  it('names the sponsor-account refusals, and nothing ambiguous or batch-specific', () => {
    expect(accountLevelReason(apiError(422, 'SENDER_RESTRICTED'))).toBe('SENDER_RESTRICTED');
    expect(accountLevelReason(apiError(422, 'SENDER_LOCKED'))).toBe('SENDER_LOCKED');
    expect(accountLevelReason(apiError(403, 'AUTHORIZATION_ERROR'))).toBe('AUTHORIZATION_ERROR');
    expect(accountLevelReason(apiError(403, 'REQUIRED_SCOPE_MISSING'))).toBe('REQUIRED_SCOPE_MISSING');
    expect(accountLevelReason(apiError(403, 'SOMETHING_NEW'))).toBe('HTTP 403 SOMETHING_NEW');
    expect(accountLevelReason(new PayPalAuthError({ status: 401, body: { error: 'invalid_client' }, method: 'POST', path: '/v1/oauth2/token' }))).toBe('OAuth 401 invalid_client');
    // Not account-level: ambiguous (may have landed → UNKNOWN), or about this batch / the balance.
    expect(accountLevelReason(apiError(500, 'INTERNAL_ERROR'))).toBeNull();
    expect(accountLevelReason(apiError(429, 'RATE_LIMIT_VALIDATION'))).toBeNull();
    expect(accountLevelReason(new PayPalTimeoutError('POST', '/v1/payments/payouts', 1000))).toBeNull();
    expect(accountLevelReason(apiError(422, 'INSUFFICIENT_FUNDS'))).toBeNull();
    expect(accountLevelReason(apiError(400, 'VALIDATION_ERROR'))).toBeNull();
    expect(accountLevelReason(new Error('boom'))).toBeNull();
  });

  it('the manual rail records and never moves money', async () => {
    const rail = new ManualRail();
    expect(rail.movesMoney).toBe(false);
    const batch = { senderBatchId: 'nl_0123456789abcdef01234567', emailSubject: '', note: '', purpose: 'NON_GOODS_OR_SERVICES' as const, items: [] };
    await expect(rail.send(batch)).rejects.toThrow(/attestation/);
    await expect(rail.send(batch, { attestation: { method: 'cash', receiptNote: 'short', recordedBy: 'org_dana' } })).rejects.toThrow(/receipt note/);
    const r = await rail.send(batch, { attestation: { method: 'check', receiptNote: '  Check #1042 handed to her at the door  ', recordedBy: 'org_dana' } });
    expect(r).toMatchObject({ rail: 'manual', reference: 'MANUAL-0123456789AB', attestation: { receiptNote: 'Check #1042 handed to her at the door' } });
  });
});

describe('railBatchFor: what the neighbor reads in PayPal / Venmo', () => {
  const group = { id: 'g1', name: 'Eastside Mutual Aid' } as Group;
  const req = (id: string, lang: HelpRequest['lang']) => ({ id, lang }) as HelpRequest;
  const item = (n: number, requestId: string, wallet: 'PAYPAL' | 'VENMO') => ({
    senderItemId: `nl_item_${n}`,
    requestId,
    amountCents: 15_000,
    receiver: wallet === 'VENMO' ? `@neighbor-${n}` : `n${n}@example.com`,
    recipientType: wallet === 'VENMO' ? 'USER_HANDLE' : 'EMAIL',
    wallet,
  });
  const bw = (items: ReturnType<typeof item>[]) => ({ batch: { senderBatchId: 'nl_batch_1' }, items }) as unknown as BatchWithItems;

  it('each item note is in its neighbor\u2019s language; the subject too when the batch shares one language', () => {
    const b = railBatchFor(group, [req('r1', 'vi')], bw([item(1, 'r1', 'VENMO')]));
    expect(b.items[0]!.note).toBe(payoutCopy('vi', group.name).note);
    expect(b.emailSubject).toBe(payoutCopy('vi', group.name).emailSubject);
    expect(b.note).toBe(payoutCopy('en', group.name).note);
  });

  it('a batch that mixes languages: notes per neighbor, English subject', () => {
    const b = railBatchFor(group, [req('r1', 'zh'), req('r2', 'es')], bw([item(1, 'r1', 'VENMO'), item(2, 'r2', 'PAYPAL')]));
    expect(b.items.map((i) => i.note)).toEqual([payoutCopy('zh', group.name).note, payoutCopy('es', group.name).note]);
    expect(b.emailSubject).toBe(payoutCopy('en', group.name).emailSubject);
  });

  it('the PayPal rail sends each item its own note (Venmo requires one)', async () => {
    let sent: Parameters<PayoutsApi['createBatch']>[0] | undefined;
    const api = {
      createBatch: async (input: Parameters<PayoutsApi['createBatch']>[0]) => {
        sent = input;
        return { batchId: 'PB1', status: 'PENDING' };
      },
      getBatch: async () => ({ items: [] }),
    } as unknown as PayoutsApi;
    await new PayPalPayoutsRail(api).send(railBatchFor(group, [req('r1', 'ru')], bw([item(1, 'r1', 'VENMO')])));
    expect(sent!.items[0]!.note).toBe(payoutCopy('ru', group.name).note);
    expect(sent!.emailSubject).toBe(payoutCopy('ru', group.name).emailSubject);
  });
});

describe('PayPal refuses at the account level → FAILED_RAIL → manual fallback', () => {
  let f: Fixture;
  /** The ERRPYO negative-testing value the next PayPal create call carries (null = a normal payout). */
  let refuseWith: string | null = null;
  let timeoutNext = false;
  beforeAll(async () => {
    f = await startFixture({
      wrapPayouts: (p: PayoutsApi) => {
        const create = p.createBatch.bind(p);
        p.createBatch = async (input) => {
          if (timeoutNext) {
            timeoutNext = false;
            throw new PayPalTimeoutError('POST', '/v1/payments/payouts', 1);
          }
          return create(refuseWith ? { ...input, items: input.items.map((i, n) => (n === 0 ? { ...i, note: refuseWith! } : i)) } : input);
        };
        return p;
      },
    });
  });
  afterAll(async () => {
    await f?.close();
  });

  const setFallback = (on: boolean) =>
    appendAudit(f.db, { actor: 'org_dana', action: RAIL_FALLBACK_ACTION, entityType: 'group', entityId: f.groupId, data: { manualFallback: on } });
  const record = (batchId: string, body: unknown) => call(f.approver.url, APPROVER_ROUTES.recordManual(batchId), body);
  const paypalBatches = () => f.fake.state.batches.size;

  async function refused(handle: string, code = 'ERRPYO001') {
    const id = await fileRequest(f.db, f.groupId, { dest: venmo(handle), requestedCents: 6_000 });
    const approvalId = await approve(f.db, [id], ['org_dana', 'org_marcus']);
    refuseWith = code;
    const before = paypalBatches();
    const res = await execute(f, await executeBody(f.db, approvalId));
    refuseWith = null;
    expect(paypalBatches()).toBe(before); // nothing was created at PayPal
    return { id, approvalId, res };
  }

  it('SENDER_RESTRICTED: 503 rail_unavailable, batch FAILED_RAIL, audit row, nothing sent', async () => {
    const { id, res } = await refused('@restricted-1');
    expect(res.status).toBe(503);
    expect(res.json).toMatchObject({ code: 'rail_unavailable', railReason: 'SENDER_RESTRICTED' });
    expect(String(res.json.error)).toMatch(/Nothing was sent/);
    const bw = (await getBatch(f.db, String(res.json.batchId)))!;
    expect(bw.batch.status).toBe('FAILED_RAIL');
    expect(bw.batch.paypalBatchId).toBeUndefined();
    expect((await listItemsForRequest(f.db, id))[0]!.status).toBe('PENDING');
    const row = (await listAudit(f.db)).find((e) => e.action === 'approver.rail_unavailable' && e.entityId === bw.batch.id)!;
    expect(row.data).toMatchObject({ reason: 'SENDER_RESTRICTED', rail: 'paypal_payouts', manualFallback: false });
  });

  it('AUTHORIZATION_ERROR (403) is account-level too', async () => {
    const { res } = await refused('@restricted-2', 'ERRPYO003');
    expect(res.status).toBe(503);
    expect(res.json.railReason).toBe('AUTHORIZATION_ERROR');
  });

  it('manual recording needs the group setting, an organizer and a receipt note; then records once and moves no money', async () => {
    const { id, approvalId, res } = await refused('@restricted-3');
    const batchId = String(res.json.batchId);
    const ok = { organizerId: 'org_marcus', method: 'cash', receiptNote: 'Handed $60 cash to her at the warming center, 3:10 pm' };

    // Setting off (the default): refused.
    let r = await record(batchId, ok);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('manual_not_allowed');

    await setFallback(true);
    expect((await record(batchId, { ...ok, receiptNote: 'cash' })).status).toBe(400); // note too short (schema)
    expect((await record(batchId, { ...ok, organizerId: 'org_mallory' })).status).toBe(403);

    const before = paypalBatches();
    r = await record(batchId, ok);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: 'MANUAL', rail: 'manual', method: 'cash', recordedBy: 'org_marcus', totalCents: 6_000, recordedNow: true, movedMoney: false });
    expect(String(r.json.reference)).toMatch(/^MANUAL-[0-9A-F]{12}$/);
    expect(paypalBatches()).toBe(before);
    expect((await getBatch(f.db, batchId))!.batch.status).toBe('MANUAL');
    expect((await listItemsForRequest(f.db, id))[0]!.status).toBe('SUCCESS');
    expect((await getRequest(f.db, id))!.status).toBe('paid');
    const audit = (await listAudit(f.db)).find((e) => e.action === 'approver.manual_recorded' && e.entityId === batchId)!;
    expect(audit.data).toMatchObject({ movedMoney: false, method: 'cash', recordedBy: 'org_marcus', approvalId });
    expect(audit.data.approvers).toEqual([
      { organizerId: 'org_dana', signature: 'demo_key' },
      { organizerId: 'org_marcus', signature: 'demo_key' },
    ]);

    // Idempotent; and a later execute never sends it to PayPal.
    const again = await record(batchId, { ...ok, method: 'check' });
    expect(again.json).toMatchObject({ recordedNow: false, reference: r.json.reference, method: 'cash' });
    const exec = await execute(f, await executeBody(f.db, approvalId));
    expect(exec.status).toBe(200);
    expect(exec.json).toMatchObject({ rail: 'manual', sentNow: false, paypalBatchId: '' });
    expect(paypalBatches()).toBe(before);
    expect((await verifyAuditChain(f.db)).ok).toBe(true);
  });

  it('re-verifies the approval like a PayPal payout: requests changed after signing → refused', async () => {
    await setFallback(true);
    const { id, res } = await refused('@restricted-4');
    await f.db.update(requests).set({ payoutDestination: venmo('@someone-else-44') }).where(eq(requests.id, id));
    const r = await record(String(res.json.batchId), { organizerId: 'org_dana', method: 'check', receiptNote: 'Sponsor check #2001 mailed to her' });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('tampered');
    expect((await getBatch(f.db, String(res.json.batchId)))!.batch.status).toBe('FAILED_RAIL');
  });

  it('once PayPal clears the account, re-executing sends the same batch (same sender_batch_id)', async () => {
    const { approvalId, res } = await refused('@restricted-5');
    const before = paypalBatches();
    const retry = await execute(f, await executeBody(f.db, approvalId));
    expect(retry.status).toBe(200);
    expect(retry.json).toMatchObject({ rail: 'paypal_payouts', sentNow: true, batchId: res.json.batchId });
    expect(paypalBatches()).toBe(before + 1);
    // …and it can no longer be recorded by hand.
    const r = await record(String(res.json.batchId), { organizerId: 'org_dana', method: 'cash', receiptNote: 'Should never be allowed now' });
    expect(r.status).toBe(409);
  });

  it('never for an UNKNOWN batch (a timeout may have paid) or a batch PayPal accepted', async () => {
    await setFallback(true);
    const id = await fileRequest(f.db, f.groupId, { dest: venmo('@timeout-6'), requestedCents: 5_000 });
    const approvalId = await approve(f.db, [id], ['org_dana', 'org_marcus']);
    timeoutNext = true;
    const res = await execute(f, await executeBody(f.db, approvalId));
    expect(res.json.code).toBe('paypal_unknown');
    const [b] = await f.db.select().from(payoutBatches).where(eq(payoutBatches.approvalId, approvalId));
    expect(b!.status).toBe('UNKNOWN');
    const r = await record(b!.id, { organizerId: 'org_dana', method: 'cash', receiptNote: 'Trying to double-pay by hand' });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('manual_not_allowed');
  });
});
