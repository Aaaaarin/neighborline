import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { approvalHash, approvalPayload, canonicalJson, senderBatchIdFor, sha256Hex } from '@neighborline/core';
import {
  addOrganizerCredential,
  approvals,
  contentFromRequests,
  createOrGetApproval,
  getRequest,
  listAudit,
  listItemsForRequest,
  recordApprovalAssertion,
  requests,
  upsertItemFromEvent,
  verifyAuditChain,
} from '@neighborline/db';
import { challengeForApprovalHash, createSoftwareAuthenticator } from '@neighborline/passkeys';
import { APPROVER_ROUTES, signApproverRequest } from './protocol.js';
import { PayPalApiError, PayPalClient, PayPalTimeoutError, PayoutsApi, WebhooksApi } from '@neighborline/paypal';
import { getBatch, payoutBatches } from '@neighborline/db';
import { silentLogger } from './log.js';
import { startApproverServer } from './server.js';
import { SECRET, approve, call, execute, executeBody, fileRequest, signAs, startFixture, type Fixture } from './test-helpers.js';

let f: Fixture;
beforeAll(async () => {
  f = await startFixture();
});
afterAll(async () => {
  await f?.close();
});

const venmo = (h: string) => ({ wallet: 'VENMO' as const, type: 'USER_HANDLE' as const, value: h });
const batchesAtPayPal = () => f.fake.state.batches.size;

describe('approver /v1/execute', () => {
  it('pays a complete two-person approval once, with ids derived from the approval hash', async () => {
    const id = await fileRequest(f.db, f.groupId, { dest: venmo('@kim-park-11'), requestedCents: 12_000 });
    const approvalId = await approve(f.db, [id], ['org_dana', 'org_marcus']);
    const before = batchesAtPayPal();
    const r = await execute(f, await executeBody(f.db, approvalId));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ approvalId, sentNow: true, totalCents: 12_000, itemCount: 1 });
    expect(r.json.senderBatchId).toBe(senderBatchIdFor({ id: approvalId, hash: String(r.json.hash) }));
    expect(r.json.paypalBatchId).toBeTruthy();
    expect(batchesAtPayPal()).toBe(before + 1);
    const sent = [...f.fake.state.items.values()].find((i) => i.payout_item.receiver === '@kim-park-11')!;
    expect(sent.payout_item).toMatchObject({ amount: { value: '120.00', currency: 'USD' }, purpose: 'NON_GOODS_OR_SERVICES', recipient_wallet: 'VENMO' });
    expect((await getRequest(f.db, id))!.status).toBe('paying');
    const audit = await listAudit(f.db);
    const done = audit.find((e) => e.action === 'approver.executed' && e.data.approvalId === approvalId)!;
    expect(done.actor).toBe('approver');
    expect(done.data.approvers).toEqual([
      { organizerId: 'org_dana', signature: 'demo_key' },
      { organizerId: 'org_marcus', signature: 'demo_key' },
    ]);
    expect((await verifyAuditChain(f.db)).ok).toBe(true);
  });

  it('re-executing (fresh nonce) returns the same batch and never calls PayPal twice', async () => {
    const id = await fileRequest(f.db, f.groupId, { dest: venmo('@sam-okafor-2'), requestedCents: 5_000 });
    const approvalId = await approve(f.db, [id], ['org_dana', 'org_marcus']);
    const body = await executeBody(f.db, approvalId);
    const before = batchesAtPayPal();
    const [a, b] = await Promise.all([execute(f, body), execute(f, body)]);
    const c = await execute(f, body);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(new Set([a.json.batchId, b.json.batchId, c.json.batchId]).size).toBe(1);
    expect(c.json.sentNow).toBe(false);
    expect(batchesAtPayPal()).toBe(before + 1);
    expect(await listItemsForRequest(f.db, id)).toHaveLength(1);
  });

  it('rejects a replayed request (same signed headers) before doing any work', async () => {
    const id = await fileRequest(f.db, f.groupId, { dest: venmo('@lee-moss-3'), requestedCents: 4_000 });
    const approvalId = await approve(f.db, [id], ['org_dana', 'org_marcus']);
    const body = await executeBody(f.db, approvalId);
    const first = await execute(f, body);
    expect(first.status).toBe(200);
    const replay = await execute(f, body, { headers: first.headers });
    expect(replay.status).toBe(409);
    expect(replay.json.code).toBe('replayed');
  });

  it('rejects bad, missing and stale signatures', async () => {
    const id = await fileRequest(f.db, f.groupId, { dest: venmo('@ray-dunn-4'), requestedCents: 4_000 });
    const body = await executeBody(f.db, await approve(f.db, [id], ['org_dana', 'org_marcus']));
    expect((await execute(f, body, { secret: 'x'.repeat(40) })).status).toBe(401);
    expect((await execute(f, body, { headers: {} })).status).toBe(401);
    const stale = await execute(f, body, { nowMs: Date.now() - 10 * 60_000 });
    expect(stale.status).toBe(401);
    expect(String(stale.json.error)).toContain('stale');
    expect(await listItemsForRequest(f.db, id)).toHaveLength(0);
  });

  it('rejects a tampered amount in the request (with or without a recomputed hash)', async () => {
    const id = await fileRequest(f.db, f.groupId, { dest: venmo('@ivy-chen-5'), requestedCents: 6_000 });
    const approvalId = await approve(f.db, [id], ['org_dana', 'org_marcus']);
    const body = await executeBody(f.db, approvalId);
    const bumped = { ...body.payload, items: body.payload.items.map((i) => ({ ...i, amountCents: 50_000 })), totalCents: 50_000 };

    const sameHash = await execute(f, { ...body, payload: bumped });
    expect(sameHash.status).toBe(400);
    expect(sameHash.json.code).toBe('hash_mismatch');

    const rehashed = await execute(f, { ...body, payload: bumped, hash: sha256Hex(canonicalJson(bumped)) });
    expect(rehashed.status).toBe(409);
    expect(rehashed.json.code).toBe('tampered');

    expect(await listItemsForRequest(f.db, id)).toHaveLength(0);
    const refused = (await listAudit(f.db)).filter((e) => e.action === 'approver.execute_refused' && e.entityId === approvalId);
    expect(refused.map((e) => e.data.code)).toEqual(['hash_mismatch', 'tampered']);
  });

  it('rejects an approval with a single approver, even if the record was forced to "complete"', async () => {
    const id = await fileRequest(f.db, f.groupId, { dest: venmo('@noa-weiss-6'), requestedCents: 3_000 });
    const approvalId = await approve(f.db, [id], ['org_dana']);
    const pending = await execute(f, await executeBody(f.db, approvalId));
    expect(pending.status).toBe(409);
    expect(pending.json.code).toBe('not_complete');

    // A compromised web process with database access flips the status without a second signature.
    await f.db.update(approvals).set({ status: 'complete' }).where(eq(approvals.id, approvalId));
    const forced = await execute(f, await executeBody(f.db, approvalId));
    expect(forced.status).toBe(403);
    expect(forced.json.code).toBe('too_few_approvers');

    // …or claims a second approver the record does not have.
    const body = await executeBody(f.db, approvalId);
    const claimed = await execute(f, { ...body, approvers: [...body.approvers, { organizerId: 'org_marcus', at: new Date().toISOString(), deviceLabel: 'x', assertion: null }] });
    expect(claimed.status).toBe(403);
    expect(await listItemsForRequest(f.db, id)).toHaveLength(0);
  });

  it('re-runs the policy itself: an inflated amount written straight into the database is refused', async () => {
    const id = await fileRequest(f.db, f.groupId, { dest: venmo('@oz-batra-7'), requestedCents: 9_000 });
    // Compromised web: rewrites the computed amount, then collects two (real) signatures over it.
    const r = (await getRequest(f.db, id))!;
    await f.db.update(requests).set({ computed: { ...r.computed!, amountCents: 500_000 }, amountCents: 500_000 }).where(eq(requests.id, id));
    const approvalId = await approve(f.db, [id], ['org_dana', 'org_marcus']);
    const res = await execute(f, await executeBody(f.db, approvalId));
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('policy_violation');
    expect(String(res.json.error)).toMatch(/allows at most \$/);
    expect(await listItemsForRequest(f.db, id)).toHaveLength(0);
  });

  it('refuses when the requests changed after the approval was signed', async () => {
    const id = await fileRequest(f.db, f.groupId, { dest: venmo('@pia-lund-8'), requestedCents: 7_000 });
    const approvalId = await approve(f.db, [id], ['org_dana', 'org_marcus']);
    const body = await executeBody(f.db, approvalId);
    await f.db.update(requests).set({ payoutDestination: venmo('@someone-else-9') }).where(eq(requests.id, id));
    const res = await execute(f, body);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('tampered');
  });

  it('refuses a blocked destination (lookalike of the group handle) even with two signatures', async () => {
    const id = await fileRequest(f.db, f.groupId, { dest: venmo('@zed-ford-10'), requestedCents: 5_000 });
    const approvalId = await approve(f.db, [id], ['org_dana', 'org_marcus']);
    const body = await executeBody(f.db, approvalId);
    // Destination swapped to an impersonator AND a matching approval re-created and signed by a compromised web.
    await f.db.update(requests).set({ status: 'awaiting_approval', payoutDestination: venmo('@eastside-mutuaiaid') }).where(eq(requests.id, id));
    await f.db.update(approvals).set({ status: 'void' }).where(eq(approvals.id, approvalId));
    const again = await approve(f.db, [id], ['org_dana', 'org_marcus']);
    const res = await execute(f, await executeBody(f.db, again));
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('policy_violation');
    expect(String(res.json.error)).toContain('LOOKALIKE_HANDLE');
    expect(body.approvalId).not.toBe(again);
  });
});

describe('approver passkey checks', () => {
  let g: Fixture;
  beforeAll(async () => {
    g = await startFixture({ requirePasskeys: true, demoMode: true });
  });
  afterAll(async () => {
    await g?.close();
  });

  async function sign(db: Fixture['db'], organizerId: string, hash: string, origin = 'http://localhost:3000') {
    const auth = createSoftwareAuthenticator();
    await addOrganizerCredential(db, { id: auth.credentialId, organizerId, publicKey: auth.publicKey, deviceLabel: `${organizerId} (demo key)`, kind: 'demo_key' });
    const parts = auth.sign({ challenge: challengeForApprovalHash(hash), origin, rpId: 'localhost' });
    await recordApprovalAssertion(db, {
      organizerId,
      assertion: { v: 1, kind: 'demo_key', ...parts, rpId: 'localhost', origin, approvalHash: hash, deviceLabel: `${organizerId} (demo key)`, verifiedAt: new Date().toISOString() },
    });
    return auth;
  }

  it('always requires a verified signature from every approver (there is no unsigned mode)', async () => {
    const id = await fileRequest(g.db, g.groupId, { dest: venmo('@uma-diaz-12'), requestedCents: 5_000 });
    const approvalId = await approve(g.db, [id], ['org_dana', 'org_marcus'], { unsigned: true });
    const res = await execute(g, await executeBody(g.db, approvalId));
    expect(res.status).toBe(403);
    expect(res.json.code).toBe('assertion_invalid');
  });

  it('pays when both approvers signed the exact approval hash; a signature over another hash fails', async () => {
    const id = await fileRequest(g.db, g.groupId, { dest: venmo('@vic-hale-13'), requestedCents: 5_000 });
    const { approval } = await createOrGetApproval(g.db, { requestIds: [id] });
    await sign(g.db, 'org_dana', approval.hash);
    // Marcus's key signs a DIFFERENT hash but the row claims this one.
    const other = approvalHash({ policyVersionId: approval.policyVersionId, items: [{ requestId: id, amountCents: 1, destination: venmo('@x-y-z') }] });
    const auth = createSoftwareAuthenticator();
    await addOrganizerCredential(g.db, { id: auth.credentialId, organizerId: 'org_marcus', publicKey: auth.publicKey, deviceLabel: 'marcus (demo key)', kind: 'demo_key' });
    const parts = auth.sign({ challenge: challengeForApprovalHash(other), origin: 'http://localhost:3000', rpId: 'localhost' });
    await recordApprovalAssertion(g.db, {
      organizerId: 'org_marcus',
      assertion: { v: 1, kind: 'demo_key', ...parts, rpId: 'localhost', origin: 'http://localhost:3000', approvalHash: approval.hash, deviceLabel: 'marcus (demo key)', verifiedAt: new Date().toISOString() },
    });
    const approvalId = await approve(g.db, [id], ['org_dana', 'org_marcus']);
    const bad = await execute(g, await executeBody(g.db, approvalId));
    expect(bad.status).toBe(403);
    expect(String(bad.json.error)).toContain('org_marcus');

    const id2 = await fileRequest(g.db, g.groupId, { dest: venmo('@wes-ng-14'), requestedCents: 5_000 });
    const a2 = (await createOrGetApproval(g.db, { requestIds: [id2] })).approval;
    await sign(g.db, 'org_dana', a2.hash);
    await sign(g.db, 'org_marcus', a2.hash);
    const ok = await execute(g, await executeBody(g.db, await approve(g.db, [id2], ['org_dana', 'org_marcus'])));
    expect(ok.status).toBe(200);
    expect(ok.json.approvers).toEqual([
      { organizerId: 'org_dana', signature: 'demo_key' },
      { organizerId: 'org_marcus', signature: 'demo_key' },
    ]);
  });
});

describe('approver poll, cancel-unclaimed, health', () => {
  it('enforces today\'s budget itself, even when the web filed an amount without counting today\'s spend', async () => {
    // fileRequest() passes todaySpentCents: 0, like a buggy or compromised web app would.
    const ids = [];
    for (let i = 0; i < 12; i++) ids.push(await fileRequest(f.db, f.groupId, { dest: venmo(`@budget-test-${i}`), requestedCents: 15_000 }));
    const results = [];
    for (const id of ids) results.push(await execute(f, await executeBody(f.db, await approve(f.db, [id], ['org_dana', 'org_marcus']))));
    const refused = results.filter((r) => r.status === 409);
    expect(refused.length).toBeGreaterThan(0);
    expect(String(refused[0]!.json.error)).toContain('BUDGET_EXCEEDED');
  });

  it('polls PayPal for one of our batches and cancels an UNCLAIMED item (organizer only)', async () => {
    const h = await startFixture({ unclaimed: ['nobody-yet@example.com'] });
    const f = h;
    const id = await fileRequest(f.db, f.groupId, { dest: { wallet: 'PAYPAL', type: 'EMAIL', value: 'nobody-yet@example.com' }, requestedCents: 4_500 });
    const res = await execute(f, await executeBody(f.db, await approve(f.db, [id], ['org_dana', 'org_marcus'])));
    expect(res.status).toBe(200);
    const batchId = String(res.json.batchId);
    let polled: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      polled = (await call(f.approver.url, APPROVER_ROUTES.poll(batchId), {})).json;
      if ((polled.items as Array<{ status: string }>)[0]?.status === 'UNCLAIMED') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const item = (polled.items as Array<{ payoutItemId: string; status: string; senderItemId: string }>)[0]!;
    expect(item.status).toBe('UNCLAIMED');
    await upsertItemFromEvent(f.db, { senderItemId: item.senderItemId, paypalItemId: item.payoutItemId, status: 'UNCLAIMED', actor: 'test' });
    const [local] = await listItemsForRequest(f.db, id);

    const stranger = await call(f.approver.url, APPROVER_ROUTES.cancelUnclaimed(local!.id), { organizerId: 'org_mallory' });
    expect(stranger.status).toBe(403);
    // Nobody named, or a demo visitor on a real (non-demo) payout: refused by the approver itself.
    expect((await call(f.approver.url, APPROVER_ROUTES.cancelUnclaimed(local!.id), { batchId })).status).toBe(403);
    expect((await call(f.approver.url, APPROVER_ROUTES.cancelUnclaimed(local!.id), { demoVisitorTag: 'abcdefabcdef', batchId })).status).toBe(403);
    const ok = await call(f.approver.url, APPROVER_ROUTES.cancelUnclaimed(local!.id), { organizerId: 'org_dana', batchId });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ itemId: local!.id, status: 'CANCELED', paypalItemId: item.payoutItemId });
    await h.close();
  });

  it('a demo visitor may cancel only the UNCLAIMED payout of their own demo run, and only in DEMO_MODE', async () => {
    const unclaimedFor = async (h: Fixture, id: string, email: string) => {
      await fileRequest(h.db, h.groupId, { id, dest: { wallet: 'PAYPAL', type: 'EMAIL', value: email }, requestedCents: 4_500 });
      const res = await execute(h, await executeBody(h.db, await approve(h.db, [id], ['org_dana', 'org_marcus'])));
      expect(res.status).toBe(200);
      const batchId = String(res.json.batchId);
      for (let i = 0; i < 40; i++) {
        const items = (await call(h.approver.url, APPROVER_ROUTES.poll(batchId), {})).json.items as Array<{ payoutItemId: string; status: string; senderItemId: string }>;
        if (items[0]?.status === 'UNCLAIMED') {
          await upsertItemFromEvent(h.db, { senderItemId: items[0].senderItemId, paypalItemId: items[0].payoutItemId, status: 'UNCLAIMED', actor: 'test' });
          return { batchId, itemId: (await listItemsForRequest(h.db, id))[0]!.id };
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('never UNCLAIMED');
    };
    const on = await startFixture({ demoMode: true, unclaimed: ['demo-own@example.com', 'demo-own2@example.com'] });
    try {
      const { batchId, itemId } = await unclaimedFor(on, 'req_demo_abcdefabcdef_0a1', 'demo-own@example.com');
      expect((await call(on.approver.url, APPROVER_ROUTES.cancelUnclaimed(itemId), { demoVisitorTag: 'ffffffffffff', batchId })).status).toBe(403);
      const ok = await call(on.approver.url, APPROVER_ROUTES.cancelUnclaimed(itemId), { demoVisitorTag: 'abcdefabcdef', batchId });
      expect(ok.status).toBe(200);
      expect(ok.json).toMatchObject({ itemId, status: 'CANCELED' });
      // The same item, asked of an approver running with DEMO_MODE off: refused even with the right tag.
      const strict = await startApproverServer({
        db: () => on.db,
        payouts: new PayoutsApi(new PayPalClient({ clientId: 'fake-client-id', clientSecret: 'fake-client-secret', baseUrl: on.fake.url })),
        webhooks: new WebhooksApi(new PayPalClient({ clientId: 'fake-client-id', clientSecret: 'fake-client-secret', baseUrl: on.fake.url })),
        config: { requirePasskeys: true, demoMode: false, webhookId: on.fake.config.webhookId },
        env: { DEMO_MODE: 'false' },
        log: silentLogger,
        secret: SECRET,
        health: { paypalMode: 'fake', credentials: 'fake', requirePasskeys: true, demoMode: false },
      });
      try {
        const second = await unclaimedFor(on, 'req_demo_abcdefabcdef_0b2', 'demo-own2@example.com');
        expect((await call(strict.url, APPROVER_ROUTES.cancelUnclaimed(second.itemId), { demoVisitorTag: 'abcdefabcdef', batchId: second.batchId })).status).toBe(403);
      } finally {
        await strict.close();
      }
    } finally {
      await on.close();
    }
  });

  it('serves an unauthenticated health check without secrets', async () => {
    const h = (await (await fetch(`${f.approver.url}/v1/health`)).json()) as Record<string, unknown>;
    expect(h).toMatchObject({ ok: true, service: 'neighborline-approver', credentials: 'fake' });
    expect(JSON.stringify(h)).not.toContain(SECRET);
  });

  it('signs with the documented base string', () => {
    const h = signApproverRequest(SECRET, 'post', '/v1/execute', '{}', { nowMs: 1_700_000_000_000, nonce: '0'.repeat(32) });
    expect(h['x-nl-approver-timestamp']).toBe('1700000000');
    expect(h['x-nl-approver-signature']).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it('approvalPayload in the request must be canonical', async () => {
    const id = await fileRequest(f.db, f.groupId, { dest: venmo('@yan-otto-15'), requestedCents: 2_000 });
    const body = await executeBody(f.db, await approve(f.db, [id], ['org_dana', 'org_marcus']));
    const reqs = [(await getRequest(f.db, id))!];
    expect(canonicalJson(body.payload)).toBe(canonicalJson(approvalPayload(contentFromRequests(reqs))));
    const res = await execute(f, { ...body, payload: { ...body.payload, totalCents: body.payload.totalCents + 1 } });
    expect(res.json.code).toBe('hash_mismatch');
  });
});

describe('ambiguous PayPal failures (QA P2-8)', () => {
  /** createBatch that lands at PayPal and then "times out" (the response is lost), `times` times. */
  const lostResponse = (times: number) => (p: PayoutsApi): PayoutsApi => {
    let left = times;
    const real = p.createBatch.bind(p);
    p.createBatch = async (input) => {
      const res = await real(input);
      if (left-- > 0) throw new PayPalTimeoutError('POST', '/v1/payments/payouts', 30_000);
      return res;
    };
    return p;
  };

  it('a timeout after PayPal accepted the batch is UNKNOWN, not FAILED; re-executing resolves to the same batch', async () => {
    const h = await startFixture({ wrapPayouts: lostResponse(1) });
    try {
      const id = await fileRequest(h.db, h.groupId, { dest: venmo('@lost-reply-1'), requestedCents: 5_000 });
      const approvalId = await approve(h.db, [id], ['org_dana', 'org_marcus']);
      const first = await execute(h, await executeBody(h.db, approvalId));
      expect(first.status).toBe(504);
      expect(first.json.code).toBe('paypal_unknown');
      const [row] = await h.db.select().from(payoutBatches).where(eq(payoutBatches.approvalId, approvalId));
      expect(row!.status).toBe('UNKNOWN');
      expect(h.fake.state.batches.size).toBe(1); // it did land
      const again = await execute(h, await executeBody(h.db, approvalId));
      expect(again.status).toBe(200);
      expect(again.json.senderBatchId).toBe(row!.senderBatchId);
      expect(h.fake.state.batches.size).toBe(1); // resolved by the same sender_batch_id, never paid twice
      expect((await getBatch(h.db, row!.id))!.batch.paypalBatchId).toBe(again.json.paypalBatchId);
      const audit = await listAudit(h.db);
      expect(audit.some((e) => e.action === 'approver.paypal_unknown')).toBe(true);
    } finally {
      await h.close();
    }
  });

  it('a definite rejection is FAILED', async () => {
    const h = await startFixture({
      wrapPayouts: (p) => {
        p.createBatch = async () => {
          throw new PayPalApiError({ status: 422, body: { name: 'UNPROCESSABLE_ENTITY', message: 'nope' }, method: 'POST', path: '/v1/payments/payouts' });
        };
        return p;
      },
    });
    try {
      const id = await fileRequest(h.db, h.groupId, { dest: venmo('@rejected-1'), requestedCents: 5_000 });
      const approvalId = await approve(h.db, [id], ['org_dana', 'org_marcus']);
      const r = await execute(h, await executeBody(h.db, approvalId));
      expect(r.json.code).toBe('paypal_error');
      const [row] = await h.db.select().from(payoutBatches).where(eq(payoutBatches.approvalId, approvalId));
      expect(row!.status).toBe('FAILED');
    } finally {
      await h.close();
    }
  });

  it('re-checks policy before a re-send: a batch left UNKNOWN is not re-sent after the policy changed', async () => {
    const h = await startFixture({ wrapPayouts: (p) => {
      p.createBatch = async () => {
        throw new PayPalTimeoutError('POST', '/v1/payments/payouts', 30_000);
      };
      return p;
    } });
    try {
      const id = await fileRequest(h.db, h.groupId, { dest: venmo('@recheck-1'), requestedCents: 5_000 });
      const approvalId = await approve(h.db, [id], ['org_dana', 'org_marcus']);
      expect((await execute(h, await executeBody(h.db, approvalId))).json.code).toBe('paypal_unknown');
      // between attempts the destination became one of the group's own handles (rail block)
      await h.db.execute(sql`update groups set official_handles = official_handles || ${JSON.stringify([{ wallet: 'VENMO', type: 'USER_HANDLE', value: '@recheck-1' }])}::jsonb`);
      const r = await execute(h, await executeBody(h.db, approvalId));
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('policy_violation');
    } finally {
      await h.close();
    }
  });
});

describe('demo-visitor passkeys and nonce-bound signatures', () => {
  it('a visitor-bound credential signs only that visitor’s own demo runs, and only in DEMO_MODE', async () => {
    const h = await startFixture({ demoMode: true });
    try {
      const own = await fileRequest(h.db, h.groupId, { id: 'req_demo_abc123_run1', dest: venmo('@visitor-own-1'), requestedCents: 5_000 });
      const { approval } = await createOrGetApproval(h.db, { requestIds: [own] });
      await signAs(h.db, 'org_dana', approval.hash);
      await signAs(h.db, 'org_marcus', approval.hash, { boundTo: 'demo-visitor:abc123' });
      const ok = await execute(h, await executeBody(h.db, await approve(h.db, [own], ['org_dana', 'org_marcus'], { unsigned: true })));
      expect(ok.status).toBe(200);

      const other = await fileRequest(h.db, h.groupId, { id: 'req_demo_ffff99_run1', dest: venmo('@visitor-other-1'), requestedCents: 5_000 });
      const a2 = (await createOrGetApproval(h.db, { requestIds: [other] })).approval;
      await signAs(h.db, 'org_dana', a2.hash);
      await signAs(h.db, 'org_marcus', a2.hash, { boundTo: 'demo-visitor:abc123' });
      const bad = await execute(h, await executeBody(h.db, await approve(h.db, [other], ['org_dana', 'org_marcus'], { unsigned: true })));
      expect(bad.status).toBe(403);
      expect(String(bad.json.error)).toContain('own demo runs');

      const real = await fileRequest(h.db, h.groupId, { dest: venmo('@real-request-1'), requestedCents: 5_000 });
      const a3 = (await createOrGetApproval(h.db, { requestIds: [real] })).approval;
      await signAs(h.db, 'org_dana', a3.hash);
      await signAs(h.db, 'org_marcus', a3.hash, { boundTo: 'demo-visitor:abc123' });
      expect((await execute(h, await executeBody(h.db, await approve(h.db, [real], ['org_dana', 'org_marcus'], { unsigned: true })))).status).toBe(403);
    } finally {
      await h.close();
    }
  });

  it('demo keys and visitor passkeys do not count when DEMO_MODE is off', async () => {
    const h = await startFixture({ demoMode: false });
    try {
      const id = await fileRequest(h.db, h.groupId, { dest: venmo('@no-demo-1'), requestedCents: 5_000 });
      const r = await execute(h, await executeBody(h.db, await approve(h.db, [id], ['org_dana', 'org_marcus'])));
      expect(r.status).toBe(403);
      expect(String(r.json.error)).toContain('DEMO_MODE');
    } finally {
      await h.close();
    }
  });

  it('re-verifies a nonce-bound assertion with the nonce stored next to it; a wrong nonce fails', async () => {
    const h = await startFixture();
    try {
      const id = await fileRequest(h.db, h.groupId, { dest: venmo('@nonce-1'), requestedCents: 5_000 });
      const { approval } = await createOrGetApproval(h.db, { requestIds: [id] });
      await signAs(h.db, 'org_dana', approval.hash);
      await signAs(h.db, 'org_marcus', approval.hash);
      const res = await execute(h, await executeBody(h.db, await approve(h.db, [id], ['org_dana', 'org_marcus'], { unsigned: true })));
      expect(res.status).toBe(200);
      // Marcus's next assertion was made over one nonce but the row claims another (tampered)
      const id2 = await fileRequest(h.db, h.groupId, { dest: venmo('@nonce-2'), requestedCents: 5_000 });
      const a2 = (await createOrGetApproval(h.db, { requestIds: [id2] })).approval;
      await signAs(h.db, 'org_dana', a2.hash);
      await signAs(h.db, 'org_marcus', a2.hash);
      await h.db.execute(sql`update approval_assertions set server_nonce = ${'A'.repeat(43)} where approval_hash = ${a2.hash} and organizer_id = 'org_marcus'`);
      const bad = await execute(h, await executeBody(h.db, await approve(h.db, [id2], ['org_dana', 'org_marcus'], { unsigned: true })));
      expect(bad.status).toBe(403);
      expect(String(bad.json.error)).toContain('org_marcus');
    } finally {
      await h.close();
    }
  });
});
