/**
 * What the real PayPal sandbox did on 2026-10-28 (packages/paypal/PAYPAL_NOTES.md, "Observed in the sandbox"):
 *   - any Venmo item fails the whole batch → in PAYPAL_MODE=sandbox the approver refuses Venmo up front;
 *   - cancel of an UNCLAIMED item answered 500 twice → ambiguous, "try again", never a hard failure;
 *   - a second cancel answers ITEM_ALREADY_CANCELLED → the outcome we wanted.
 * Plus the shared sandbox stand-in account (SANDBOX_DEMO_RECEIVER_EMAIL) is not capped against itself.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { getRequest, listAudit, listItemsForRequest, updateRequest, upsertItemFromEvent } from '@neighborline/db';
import { PayPalApiError, type PayoutsApi } from '@neighborline/paypal';
import { readConfig } from './config.js';
import { APPROVER_ROUTES, CANCEL_RETRY_MESSAGE, SANDBOX_VENMO_REFUSAL } from './protocol.js';
import { isStandInDestination, recheckPolicy } from './recheck.js';
import { approve, call, execute, executeBody, fileRequest, startFixture, type Fixture } from './test-helpers.js';

const open: Fixture[] = [];
const fixture = async (o: Parameters<typeof startFixture>[0]) => {
  const f = await startFixture(o);
  open.push(f);
  return f;
};
afterAll(async () => {
  for (const f of open) await f.close();
});

const VENMO = { wallet: 'VENMO', type: 'USER_HANDLE', value: '@lan-test' } as const;
const RECEIVER = 'sb-demo-receiver@personal.example.com';

describe('PAYPAL_MODE=sandbox: Venmo', () => {
  it('refuses a batch with a Venmo item before calling PayPal (typed wallet_unsupported, no batch row)', async () => {
    // DEMO_MODE on only so the test's labelled demo keys sign; the refusal does not depend on it.
    const f = await fixture({ paypalMode: 'sandbox', sandboxRealism: true });
    const id = await fileRequest(f.db, f.groupId, { dest: VENMO, requestedCents: 5_000 });
    const res = await execute(f, await executeBody(f.db, await approve(f.db, [id], ['org_dana', 'org_marcus'])));
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ code: 'wallet_unsupported', error: SANDBOX_VENMO_REFUSAL });
    expect(f.fake.state.batches.size).toBe(0); // PayPal was never called
    expect(await listItemsForRequest(f.db, id)).toEqual([]);
    const audit = await listAudit(f.db, { limit: 5000 });
    expect(audit.filter((a) => a.action === 'approver.execute_refused').at(-1)!.data).toMatchObject({ code: 'wallet_unsupported' });
  });

  it('a PayPal-wallet request in sandbox is sent as usual; the same Venmo request in fake mode too', async () => {
    const sb = await fixture({ paypalMode: 'sandbox', sandboxRealism: true });
    const pp = await fileRequest(sb.db, sb.groupId, { dest: { wallet: 'PAYPAL', type: 'EMAIL', value: 'neighbor@example.com' }, requestedCents: 5_000 });
    expect((await execute(sb, await executeBody(sb.db, await approve(sb.db, [pp], ['org_dana', 'org_marcus'])))).status).toBe(200);
    const fk = await fixture({});
    const v = await fileRequest(fk.db, fk.groupId, { dest: VENMO, requestedCents: 5_000 });
    expect((await execute(fk, await executeBody(fk.db, await approve(fk.db, [v], ['org_dana', 'org_marcus'])))).status).toBe(200);
  });

  it('without the guard, the fake (sandboxRealism) refuses the whole batch like the real sandbox did', async () => {
    const f = await fixture({ sandboxRealism: true }); // approver in fake mode: no up-front refusal
    const id = await fileRequest(f.db, f.groupId, { dest: VENMO, requestedCents: 5_000 });
    const res = await execute(f, await executeBody(f.db, await approve(f.db, [id], ['org_dana', 'org_marcus'])));
    expect(res.status).toBe(502);
    expect(String(res.json.error)).toContain('VALIDATION_ERROR');
  });

  it('config: the stand-in account is honoured only with PAYPAL_MODE=sandbox and DEMO_MODE on', () => {
    const base = { NEIGHBORLINE_APPROVER_SECRET: 'x'.repeat(40), PAYPAL_PAYOUTS_CLIENT_ID: 'id', PAYPAL_PAYOUTS_CLIENT_SECRET: 's', SANDBOX_DEMO_RECEIVER_EMAIL: RECEIVER };
    expect(readConfig({ ...base, PAYPAL_MODE: 'sandbox', DEMO_MODE: 'true' }).standInReceiver).toBe(RECEIVER);
    expect(readConfig({ ...base, PAYPAL_MODE: 'sandbox', DEMO_MODE: 'false' }).standInReceiver).toBeUndefined();
    expect(readConfig({ ...base, PAYPAL_MODE: 'fake' }).standInReceiver).toBeUndefined();
    expect(readConfig({ ...base, PAYPAL_MODE: 'sandbox', DEMO_MODE: 'true', SANDBOX_DEMO_RECEIVER_EMAIL: 'nope' }).standInReceiver).toBeUndefined();
  });
});

describe('the shared sandbox stand-in account', () => {
  it('earlier payouts to it do not count toward another request’s household cap (demo mode only)', async () => {
    const f = await fixture({ paypalMode: 'sandbox', standInReceiver: RECEIVER });
    const dest = { wallet: 'PAYPAL', type: 'EMAIL', value: RECEIVER } as const;
    // Two neighbors' Venmo requests already went to the stand-in: $150 + $150 = the $300 utility household cap.
    let paid = '';
    for (const _ of [0, 1]) {
      paid = await fileRequest(f.db, f.groupId, { dest, requestedCents: 15_000 });
      expect((await execute(f, await executeBody(f.db, await approve(f.db, [paid], ['org_dana', 'org_marcus'])))).status).toBe(200);
    }
    // A third neighbor, filed by the web app with the same exclusion, at the full $150.
    const third = await fileRequest(f.db, f.groupId, { dest, requestedCents: 15_000 });
    const computed = (await getRequest(f.db, paid))!.computed!;
    await updateRequest(f.db, third, { computed, railFlags: [] }, { actor: 'test' });
    const r = (await getRequest(f.db, third))!;
    const group = { id: f.groupId } as Parameters<typeof recheckPolicy>[1]['group'];
    const common = { group, policyVersionId: r.policyVersionId!, requests: [r], demoMode: true };
    expect((await recheckPolicy(f.db, { ...common, standInReceiver: RECEIVER })).ok).toBe(true);
    expect((await recheckPolicy(f.db, common)).ok).toBe(false); // without the exclusion the cap is used up
    expect((await recheckPolicy(f.db, { ...common, demoMode: false, standInReceiver: RECEIVER })).ok).toBe(false); // never outside demo mode
    expect(isStandInDestination({ wallet: 'PAYPAL', value: ' SB-Demo-Receiver@personal.example.com' }, RECEIVER)).toBe(true);
    expect(isStandInDestination({ wallet: 'VENMO', value: RECEIVER }, RECEIVER)).toBe(false);
  });
});

describe('cancel an UNCLAIMED item', () => {
  const unclaimedItem = async (f: Fixture, email: string) => {
    const id = await fileRequest(f.db, f.groupId, { dest: { wallet: 'PAYPAL', type: 'EMAIL', value: email }, requestedCents: 4_500 });
    const res = await execute(f, await executeBody(f.db, await approve(f.db, [id], ['org_dana', 'org_marcus'])));
    const batchId = String(res.json.batchId);
    let items: Array<{ payoutItemId: string; status: string; senderItemId: string }> = [];
    for (let i = 0; i < 60 && items[0]?.status !== 'UNCLAIMED'; i++) {
      items = (await call(f.approver.url, APPROVER_ROUTES.poll(batchId), {})).json.items as typeof items;
      await new Promise((r) => setTimeout(r, 50));
    }
    await upsertItemFromEvent(f.db, { senderItemId: items[0]!.senderItemId, paypalItemId: items[0]!.payoutItemId, status: 'UNCLAIMED', actor: 'test' });
    return { batchId, local: (await listItemsForRequest(f.db, id))[0]! };
  };

  it('PayPal 500 (observed twice in the sandbox) → 503 paypal_unknown "try again", then a retry succeeds', async () => {
    let failures = 2;
    const f = await fixture({
      unclaimed: ['sandbox-cancel@example.com'],
      wrapPayouts: (p) =>
        Object.assign(Object.create(p) as PayoutsApi, {
          cancelUnclaimedItem: (id: string) => {
            if (failures-- > 0) throw new PayPalApiError({ status: 500, body: { name: 'INTERNAL_SERVICE_ERROR', message: 'Internal service error' }, method: 'POST', path: `/v1/payments/payouts-item/${id}/cancel` });
            return p.cancelUnclaimedItem(id);
          },
        }),
    });
    const { batchId, local } = await unclaimedItem(f, 'sandbox-cancel@example.com');
    for (const _ of [0, 1]) {
      const res = await call(f.approver.url, APPROVER_ROUTES.cancelUnclaimed(local.id), { organizerId: 'org_dana', batchId });
      expect(res.status).toBe(503);
      expect(res.json).toMatchObject({ code: 'paypal_unknown', error: CANCEL_RETRY_MESSAGE });
    }
    const ok = await call(f.approver.url, APPROVER_ROUTES.cancelUnclaimed(local.id), { organizerId: 'org_dana', batchId });
    expect([ok.status, ok.json.status]).toEqual([200, 'CANCELED']);
  });

  it('a retry after a cancel that did land (ITEM_ALREADY_CANCELLED) is a success, not an error', async () => {
    const f = await fixture({ unclaimed: ['twice@example.com'] });
    const { batchId, local } = await unclaimedItem(f, 'twice@example.com');
    const body = { organizerId: 'org_dana', batchId };
    expect((await call(f.approver.url, APPROVER_ROUTES.cancelUnclaimed(local.id), body)).status).toBe(200);
    const again = await call(f.approver.url, APPROVER_ROUTES.cancelUnclaimed(local.id), body); // our row is still UNCLAIMED until the webhook
    expect([again.status, again.json.status]).toEqual([200, 'CANCELED']);
  });
});
