import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvalHash, senderBatchIdFor, senderItemIdFor } from '@neighborline/core';
import type { DbHandle } from './client.js';
import { listAudit, verifyAuditChain } from './repo/audit.js';
import { addApproverTx, createOrGetApproval, getApproval, listApprovalsForRequest } from './repo/approvals.js';
import {
  createBatch,
  getBatch,
  getBatchBySenderBatchId,
  getTodaySpentCents,
  listItems,
  listItemsForRequest,
  setPaypalItemId,
  updateBatch,
  upsertItemFromEvent,
} from './repo/payouts.js';
import { createGroup, createOrganizer } from './repo/groups.js';
import { createRequest, getRequest, updateRequest } from './repo/requests.js';
import { GROUP_ID, freshDb, readyRequest, venmo, withGroup } from './test-db.js';

let h: DbHandle;
beforeAll(async () => {
  h = await freshDb();
  await withGroup(h);
});
afterAll(async () => h.close());

const sign = (approvalId: string, organizerId: string) =>
  addApproverTx(h.db, { approvalId, organizerId, deviceLabel: `${organizerId} phone` });

async function approvedBatch(amountCents = 10000) {
  const r = await readyRequest(h, { amountCents });
  const { approval } = await createOrGetApproval(h.db, { requestIds: [r.id] });
  await sign(approval.id, 'org_a');
  await sign(approval.id, 'org_b');
  const res = await createBatch(h.db, { approvalId: approval.id });
  return { request: r, approval, ...res };
}

describe('createOrGetApproval', () => {
  it('creates once and returns the same live approval for the same content', async () => {
    const r1 = await readyRequest(h, { amountCents: 15000 });
    const r2 = await readyRequest(h, { amountCents: 5000 });
    const a = await createOrGetApproval(h.db, { requestIds: [r2.id, r1.id, r1.id] });
    expect(a.created).toBe(true);
    expect(a.approval).toMatchObject({ requestIds: [r1.id, r2.id].sort(), totalCents: 20000, status: 'pending', approvers: [] });
    expect(a.approval.hash).toBe(approvalHash(a.content));
    const b = await createOrGetApproval(h.db, { requestIds: [r1.id, r2.id] });
    expect(b.created).toBe(false);
    expect(b.approval.id).toBe(a.approval.id);
    expect(await getApproval(h.db, a.approval.id)).toEqual(a.approval);
    expect((await listApprovalsForRequest(h.db, r1.id)).map((x) => x.id)).toEqual([a.approval.id]);
  });
  it('refuses requests that are not ready', async () => {
    await expect(createOrGetApproval(h.db, { requestIds: [] })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(createOrGetApproval(h.db, { requestIds: ['nope'] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const intake = await createRequest(h.db, { groupId: GROUP_ID, channel: 'sms', lang: 'en' });
    await expect(createOrGetApproval(h.db, { requestIds: [intake.id] })).rejects.toThrow(/is intake/);
    const blocked = await readyRequest(h, { railFlags: [{ code: 'LOOKALIKE_HANDLE', severity: 'block', detail: 'x' }] });
    await expect(createOrGetApproval(h.db, { requestIds: [blocked.id] })).rejects.toThrow(/blocking rail flag/);
    const review = await readyRequest(h, { railFlags: [{ code: 'VELOCITY', severity: 'review', detail: 'x' }] });
    await expect(createOrGetApproval(h.db, { requestIds: [review.id] })).resolves.toMatchObject({ created: true });
  });
  it('refuses mixing groups or policy versions', async () => {
    await createGroup(h.db, {
      id: 'grp_other', slug: 'other-group', name: 'Other', officialHandles: [],
      fiscalSponsor: { name: 's', paypalBusinessVerified: true, payoutsEnabled: true, charityConfirmed: true },
    });
    const mine = await readyRequest(h);
    const other = await createRequest(h.db, { groupId: 'grp_other', channel: 'sms', lang: 'en', payoutDestination: venmo('@zed-other') });
    await updateRequest(h.db, other.id, {
      status: 'awaiting_approval', policyVersionId: 'pol_t1',
      computed: { amountCents: 100, ruleKey: 'other', ruleCitation: 'x', policyVersion: 1 },
    });
    await expect(createOrGetApproval(h.db, { requestIds: [mine.id, other.id] })).rejects.toThrow(/different groups/);
    const v2 = await readyRequest(h);
    await updateRequest(h.db, v2.id, { policyVersionId: 'pol_t2' });
    await expect(createOrGetApproval(h.db, { requestIds: [mine.id, v2.id] })).rejects.toThrow(/policy versions/);
  });
});

describe('addApproverTx', () => {
  it('needs two distinct organizers; double taps are no-ops', async () => {
    const r = await readyRequest(h);
    const { approval } = await createOrGetApproval(h.db, { requestIds: [r.id] });
    expect(await sign(approval.id, 'org_a')).toMatchObject({ ok: true, changed: true, complete: false });
    expect(await sign(approval.id, 'org_a')).toMatchObject({ ok: true, changed: false, complete: false });
    expect((await getRequest(h.db, r.id))?.status).toBe('awaiting_approval');
    const done = await sign(approval.id, 'org_b');
    expect(done).toMatchObject({ ok: true, changed: true, complete: true });
    expect((await getApproval(h.db, approval.id))?.status).toBe('complete');
    expect((await getRequest(h.db, r.id))?.status).toBe('approved');
    expect((await getApproval(h.db, approval.id))?.approvers.map((a) => a.organizerId)).toEqual(['org_a', 'org_b']);
  });
  it('handles two organizers tapping at the same moment', async () => {
    const r = await readyRequest(h);
    const { approval } = await createOrGetApproval(h.db, { requestIds: [r.id] });
    const results = await Promise.all([sign(approval.id, 'org_a'), sign(approval.id, 'org_b'), sign(approval.id, 'org_a')]);
    expect(results.every((x) => x.ok)).toBe(true);
    const a = await getApproval(h.db, approval.id);
    expect(a?.approvers).toHaveLength(2);
    expect(a?.status).toBe('complete');
  });
  it('rejects non-organizers and unknown approvals', async () => {
    const r = await readyRequest(h);
    const { approval } = await createOrGetApproval(h.db, { requestIds: [r.id] });
    expect(await sign(approval.id, 'mallory')).toMatchObject({ ok: false, reason: 'NOT_AN_ORGANIZER' });
    await createOrganizer(h.db, { id: 'org_elsewhere', groupId: 'grp_other', name: 'Elsewhere', handles: [] });
    expect(await sign(approval.id, 'org_elsewhere')).toMatchObject({ ok: false, reason: 'NOT_AN_ORGANIZER' });
    await expect(sign('apr_missing', 'org_a')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('voids the approval if the amount changed after the first signature', async () => {
    const r = await readyRequest(h, { amountCents: 10000 });
    const { approval } = await createOrGetApproval(h.db, { requestIds: [r.id] });
    await sign(approval.id, 'org_a');
    await updateRequest(h.db, r.id, { computed: { amountCents: 25000, ruleKey: 'rent_gap', ruleCitation: 'x', policyVersion: 1 } });
    expect(await sign(approval.id, 'org_b')).toMatchObject({ ok: false, reason: 'CONTENT_CHANGED' });
    expect((await getApproval(h.db, approval.id))?.status).toBe('void');
    expect(await sign(approval.id, 'org_c')).toMatchObject({ ok: false, reason: 'VOID' });
    // a fresh approval for the new content can be created (void hashes don't block)
    const again = await createOrGetApproval(h.db, { requestIds: [r.id] });
    expect(again.created).toBe(true);
    expect(again.approval.totalCents).toBe(25000);
  });
  it('voids if the destination changed or the request left awaiting_approval', async () => {
    const r = await readyRequest(h);
    const { approval } = await createOrGetApproval(h.db, { requestIds: [r.id] });
    await updateRequest(h.db, r.id, { payoutDestination: venmo('@attacker-swap') });
    expect(await sign(approval.id, 'org_a')).toMatchObject({ ok: false, reason: 'CONTENT_CHANGED' });

    const r2 = await readyRequest(h);
    const a2 = await createOrGetApproval(h.db, { requestIds: [r2.id] });
    await updateRequest(h.db, r2.id, { status: 'declined' });
    expect(await sign(a2.approval.id, 'org_a')).toMatchObject({ ok: false, reason: 'CONTENT_CHANGED' });
  });
  it('respects a group requiring three approvals', async () => {
    const h3 = await freshDb();
    await withGroup(h3, { requiredApprovals: 3 });
    const r = await readyRequest(h3);
    const { approval } = await createOrGetApproval(h3.db, { requestIds: [r.id] });
    for (const o of ['org_a', 'org_b']) await addApproverTx(h3.db, { approvalId: approval.id, organizerId: o, deviceLabel: 'p' });
    await expect(createBatch(h3.db, { approvalId: approval.id })).rejects.toMatchObject({ code: 'NOT_EXECUTABLE' });
    const last = await addApproverTx(h3.db, { approvalId: approval.id, organizerId: 'org_c', deviceLabel: 'p' });
    expect(last).toMatchObject({ ok: true, complete: true });
    await h3.close();
  });
});

describe('createBatch', () => {
  it('creates one batch per approval with deterministic PayPal ids, idempotently', async () => {
    const { approval, batch, items, created, request } = await approvedBatch(12000);
    expect(created).toBe(true);
    const full = await getApproval(h.db, approval.id);
    expect(batch.senderBatchId).toBe(senderBatchIdFor(approval));
    expect(full?.status).toBe('executed');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      requestId: request.id, amountCents: 12000, wallet: 'VENMO', recipientType: 'USER_HANDLE', status: 'PENDING',
      senderItemId: senderItemIdFor(approval, request.id),
    });
    expect((await getRequest(h.db, request.id))?.status).toBe('paying');
    const again = await createBatch(h.db, { approvalId: approval.id });
    expect(again.created).toBe(false);
    expect(again.batch.id).toBe(batch.id);
    expect(await getBatchBySenderBatchId(h.db, batch.senderBatchId)).toEqual({ batch, items });
    expect(await getBatch(h.db, 'nope')).toBeNull();
    expect(await getBatchBySenderBatchId(h.db, 'nope')).toBeNull();
    // executed approvals accept no more signatures
    expect(await sign(approval.id, 'org_c')).toMatchObject({ ok: false, reason: 'ALREADY_EXECUTED' });
  });
  it('double-tapped execute in parallel still yields exactly one batch', async () => {
    const r = await readyRequest(h);
    const { approval } = await createOrGetApproval(h.db, { requestIds: [r.id] });
    await sign(approval.id, 'org_a');
    await sign(approval.id, 'org_b');
    const [x, y] = await Promise.all([createBatch(h.db, { approvalId: approval.id }), createBatch(h.db, { approvalId: approval.id })]);
    expect(x.batch.id).toBe(y.batch.id);
    expect([x.created, y.created].sort()).toEqual([false, true]);
  });
  it('refuses incomplete or missing approvals', async () => {
    const r = await readyRequest(h);
    const { approval } = await createOrGetApproval(h.db, { requestIds: [r.id] });
    await sign(approval.id, 'org_a');
    await expect(createBatch(h.db, { approvalId: approval.id })).rejects.toMatchObject({ code: 'NOT_EXECUTABLE' });
    await expect(createBatch(h.db, { approvalId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('updates PayPal batch ids and status', async () => {
    const { batch } = await approvedBatch();
    const b = await updateBatch(h.db, batch.id, { paypalBatchId: 'PPB-1', status: 'PENDING' });
    expect(b).toMatchObject({ paypalBatchId: 'PPB-1', status: 'PENDING' });
    await expect(updateBatch(h.db, 'nope', { status: 'SUCCESS' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('upsertItemFromEvent', () => {
  it('applies SUCCESS, sets transaction id, success time and request paid', async () => {
    const { items, request } = await approvedBatch();
    const item = items[0]!;
    await setPaypalItemId(h.db, item.senderItemId, 'PPI-OK');
    const at = new Date(Date.now() + 1000);
    const out = await upsertItemFromEvent(h.db, { paypalItemId: 'PPI-OK', status: 'SUCCESS', transactionId: 'TXN1', at });
    expect(out).toMatchObject({ changed: true, requestStatus: 'paid', item: { status: 'SUCCESS', transactionId: 'TXN1', paypalItemId: 'PPI-OK' } });
    expect((await getRequest(h.db, request.id))?.status).toBe('paid');
    // duplicate webhook
    expect(await upsertItemFromEvent(h.db, { paypalItemId: 'PPI-OK', status: 'SUCCESS' })).toMatchObject({ changed: false, ignored: 'duplicate' });
    // late PENDING/UNCLAIMED must not regress
    expect(await upsertItemFromEvent(h.db, { senderItemId: item.senderItemId, status: 'PENDING' })).toMatchObject({ changed: false, ignored: 'stale', item: { status: 'SUCCESS' } });
    expect(await upsertItemFromEvent(h.db, { senderItemId: item.senderItemId, status: 'UNCLAIMED' })).toMatchObject({ changed: false, requestStatus: 'paid' });
  });
  it('handles UNCLAIMED → claim help → SUCCESS (the Spanish beat)', async () => {
    const { items, request } = await approvedBatch();
    const s = items[0]!.senderItemId;
    const u = await upsertItemFromEvent(h.db, { senderItemId: s, paypalItemId: 'PPI-UNC', status: 'UNCLAIMED' });
    expect(u).toMatchObject({ changed: true, requestStatus: 'unclaimed', item: { status: 'UNCLAIMED', paypalItemId: 'PPI-UNC' } });
    const ok = await upsertItemFromEvent(h.db, { paypalItemId: 'PPI-UNC', status: 'SUCCESS', transactionId: 'TXN2' });
    expect(ok).toMatchObject({ changed: true, requestStatus: 'paid' });
    expect((await listItemsForRequest(h.db, request.id))[0]).toMatchObject({ status: 'SUCCESS', transactionId: 'TXN2' });
  });
  it('maps RETURNED and CANCELED to request statuses', async () => {
    const a = await approvedBatch();
    await upsertItemFromEvent(h.db, { senderItemId: a.items[0]!.senderItemId, status: 'UNCLAIMED' });
    expect(await upsertItemFromEvent(h.db, { senderItemId: a.items[0]!.senderItemId, status: 'RETURNED' })).toMatchObject({ requestStatus: 'returned' });
    const b = await approvedBatch();
    await upsertItemFromEvent(h.db, { senderItemId: b.items[0]!.senderItemId, status: 'UNCLAIMED' });
    expect(await upsertItemFromEvent(h.db, { senderItemId: b.items[0]!.senderItemId, status: 'CANCELED' })).toMatchObject({ requestStatus: 'cancelled' });
  });
  it('falls back from an unknown paypal item id to the sender item id', async () => {
    const { items } = await approvedBatch();
    const out = await upsertItemFromEvent(h.db, { senderItemId: items[0]!.senderItemId, paypalItemId: 'PPI-NEW', status: 'ONHOLD' });
    expect(out?.item).toMatchObject({ status: 'ONHOLD', paypalItemId: 'PPI-NEW' });
    expect(out?.requestStatus).toBe('paying');
  });
  it('returns null for unknown items and requires an id', async () => {
    expect(await upsertItemFromEvent(h.db, { paypalItemId: 'ghost', status: 'SUCCESS' })).toBeNull();
    await expect(upsertItemFromEvent(h.db, { status: 'SUCCESS' })).rejects.toMatchObject({ code: 'INVALID' });
  });
  it('lists items by status', async () => {
    const pending = await listItems(h.db, { status: ['PENDING'] });
    expect(pending.every((i) => i.status === 'PENDING')).toBe(true);
    expect((await listItems(h.db)).length).toBeGreaterThan(pending.length);
  });
  it('keeps the audit chain valid through the whole flow', async () => {
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
    const actions = new Set((await listAudit(h.db)).map((e) => e.action));
    for (const a of ['approval.created', 'approval.signed', 'approval.complete', 'approval.voided', 'payout.batch_created', 'payout.item_status']) {
      expect(actions).toContain(a);
    }
  });
});

describe('getTodaySpentCents', () => {
  it('sums today’s non-bounced items plus approved-but-unbatched requests in the group timezone', async () => {
    const h2 = await freshDb();
    await withGroup(h2);
    const now = new Date();
    expect(await getTodaySpentCents(h2.db, GROUP_ID, { now })).toBe(0);
    const mk = async (amountCents: number) => {
      const r = await readyRequest(h2, { amountCents });
      const { approval } = await createOrGetApproval(h2.db, { requestIds: [r.id] });
      for (const o of ['org_a', 'org_b']) await addApproverTx(h2.db, { approvalId: approval.id, organizerId: o, deviceLabel: 'p' });
      return approval;
    };
    const a1 = await mk(10000);
    expect(await getTodaySpentCents(h2.db, GROUP_ID, { now })).toBe(10000); // approved, not batched
    const b1 = await createBatch(h2.db, { approvalId: a1.id });
    expect(await getTodaySpentCents(h2.db, GROUP_ID, { now })).toBe(10000); // now counted as an item, not twice
    const a2 = await mk(5000);
    const b2 = await createBatch(h2.db, { approvalId: a2.id });
    await upsertItemFromEvent(h2.db, { senderItemId: b2.items[0]!.senderItemId, status: 'FAILED' });
    expect(await getTodaySpentCents(h2.db, GROUP_ID, { now })).toBe(10000); // failed money did not go out
    // tomorrow it resets
    expect(await getTodaySpentCents(h2.db, GROUP_ID, { now: new Date(now.getTime() + 2 * 86_400_000) })).toBe(0);
    expect(b1.items[0]!.status).toBe('PENDING');
    await expect(getTodaySpentCents(h2.db, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await h2.close();
  });
});
