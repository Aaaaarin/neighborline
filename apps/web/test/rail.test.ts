/**
 * Payout rails through the real engine + the approver process + the fake PayPal (JUDGE-PANEL-2 #10):
 * a sponsor account PayPal restricts → FAILED_RAIL, nothing sent, an organizer alert offering the manual
 * path → a signed-in organizer turns on manual recording and records a cash hand-over → the request is
 * paid, the ledger labels it "by hand" (no PayPal transaction, not reconciled), the totals still agree.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addOrganizerCredential, getBatch, listAudit, listItemsForRequest } from '@neighborline/db';
import { createSoftwareAuthenticator } from '@neighborline/passkeys';
import { RAIL_FALLBACK_ACTION as PROTOCOL_ACTION } from '@neighborline/approver/protocol';
import { RAIL_FALLBACK_ACTION } from '../lib/server/engine/rail';
import type { OrganizerSession } from '../lib/types';
import { startHarness, type Harness } from './harness';

let h: Harness;
let marcus: OrganizerSession;
beforeAll(async () => {
  h = await startHarness();
  const a = createSoftwareAuthenticator({ userVerified: true });
  await addOrganizerCredential(await db(), { id: a.credentialId, organizerId: 'org_marcus', publicKey: a.publicKey, deviceLabel: 'Marcus’s phone', kind: 'passkey' });
  marcus = { organizerId: 'org_marcus', name: 'Marcus', credentialId: a.credentialId, deviceLabel: 'Marcus’s phone', kind: 'passkey' } as OrganizerSession;
});
afterAll(async () => {
  await h?.close();
});
const db = async () => (await (h.engine as unknown as { state: Promise<{ ctx: { db: never } }> }).state).ctx.db;

/** The next PayPal create-batch call is refused the way a restricted sponsor account is. */
const restrictSponsor = (name = 'SENDER_RESTRICTED', status = 422) =>
  fetch(`${h.fake.url}/__fake/faults`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pathPrefix: '/v1/payments/payouts', status, count: 1, name }) });

describe('PayPal unavailable → FAILED_RAIL → manual recording', () => {
  it('the web app writes the setting under the action the approver reads', () => {
    expect(RAIL_FALLBACK_ACTION).toBe(PROTOCOL_ACTION);
  });

  let batchId = '';

  it('a restricted sponsor account: the second approval gets a 503, nothing is sent, organizers are alerted', async () => {
    const before = h.fake.state.batches.size;
    await restrictSponsor();
    // Priya already signed Minh's request (seed); Dana's tap completes it and the approver tries PayPal.
    await expect(h.engine.approve({ requestIds: ['req_seed_q_minh'], organizerId: 'org_dana', signer: { kind: 'demo_key' } })).rejects.toMatchObject({ status: 503, code: 'rail_unavailable' });
    expect(h.fake.state.batches.size).toBe(before);
    const item = (await listItemsForRequest(await db(), 'req_seed_q_minh'))[0]!;
    batchId = item.batchId;
    expect((await getBatch(await db(), batchId))!.batch.status).toBe('FAILED_RAIL');

    const g = await h.engine.getGroup();
    expect(g.rail).toMatchObject({ primary: 'paypal_payouts', manualFallback: false });
    const alert = g.alerts!.find((a) => a.kind === 'rail_unavailable')!;
    expect(alert).toMatchObject({ batchId, itemIds: [item.id] });
    expect(alert.summary).toMatch(/SENDER_RESTRICTED.*Nothing was sent.*turn on manual recording/);
    expect(alert.resolved).toBeUndefined();

    // The ledger says "not sent", not "sending"; the money is still owed and still in the fund.
    const ledger = await h.engine.getLedger();
    expect(ledger.rows.find((r) => r.itemId === item.id)).toMatchObject({ rail: 'refused', status: 'PENDING' });
    expect(ledger.fund.notSentCents).toBe(8_000);
    expect(ledger.fund.sendingCents).toBe(0);
  });

  it('only a signed-in organizer changes the setting or records; the setting is off by default', async () => {
    await expect(h.engine.setManualFallback({ enabled: true, session: null })).rejects.toMatchObject({ status: 401 });
    await expect(h.engine.recordManualPayout({ batchId, method: 'cash', receiptNote: 'Handed over in person', session: null })).rejects.toMatchObject({ status: 401 });
    await expect(h.engine.recordManualPayout({ batchId, method: 'cash', receiptNote: 'Handed over in person', session: marcus })).rejects.toMatchObject({ code: 'manual_not_allowed' });
  });

  it('with manual recording on, Marcus records a cash hand-over: paid, labelled by hand, no PayPal call, audited', async () => {
    const before = h.fake.state.batches.size;
    expect(await h.engine.setManualFallback({ enabled: true, session: marcus })).toMatchObject({ manualFallback: true, updatedBy: 'org_marcus' });
    const r = await h.engine.recordManualPayout({ batchId, method: 'cash', receiptNote: '$80 cash to Minh at the Montavilla warming center, 4:10 pm', session: marcus });
    expect(r).toMatchObject({ batchId, method: 'cash', recordedBy: 'org_marcus', totalCents: 8_000, recordedNow: true, movedMoney: false });
    expect(h.fake.state.batches.size).toBe(before);

    const v = (await h.engine.getRequest('req_seed_q_minh'))!;
    expect(v.request.status).toBe('paid');
    expect(v.payout!.batch.status).toBe('MANUAL');

    const ledger = await h.engine.getLedger();
    const row = ledger.rows.find((x) => x.batchId === batchId)!;
    expect(row).toMatchObject({ status: 'SUCCESS', rail: 'manual', reconcile: 'manual', manual: { method: 'cash', reference: r.reference, recordedBy: 'org_marcus' } });
    expect(row.transactionId).toBeUndefined();
    expect(ledger.fund.notSentCents).toBe(0);
    const report = await h.engine.getReport();
    expect(report.totals.paidCents).toBe(ledger.fund.landedCents);

    const g = await h.engine.getGroup();
    expect(g.alerts!.find((a) => a.kind === 'rail_unavailable')!.resolved).toMatchObject({ how: 'manual', manual: { method: 'cash', reference: r.reference } });

    const audit = await listAudit(await db());
    expect(audit.find((e) => e.action === 'approver.manual_recorded' && e.entityId === batchId)!.data).toMatchObject({ movedMoney: false, recordedBy: 'org_marcus', method: 'cash' });
    expect(audit.filter((e) => e.action === 'group.rail_fallback').at(-1)).toMatchObject({ actor: 'org_marcus', data: { manualFallback: true } });

    // Reconcile never asks PayPal about it; a second record is a no-op.
    const rec = await h.engine.reconcile();
    expect(rec.mismatched).toBe(0);
    expect((await h.engine.recordManualPayout({ batchId, method: 'check', receiptNote: 'Trying to record it twice', session: marcus })).recordedNow).toBe(false);
  });

  it('an ordinary PayPal rejection is not a rail outage (no FAILED_RAIL, no manual path)', async () => {
    const run = await h.engine.playScenario({ scenario: 'jean', mode: 'manual', speed: 20 });
    const { waitFor } = await import('./harness');
    await waitFor(async () => (await h.engine.getRequest(run.requestId))?.request.status === 'awaiting_approval', 15_000, 'awaiting');
    await h.engine.approve({ requestIds: [run.requestId], organizerId: 'org_dana', signer: { kind: 'demo_key' } });
    await restrictSponsor('VALIDATION_ERROR', 400);
    await expect(h.engine.approve({ requestIds: [run.requestId], organizerId: 'org_marcus', signer: { kind: 'demo_key' } })).rejects.toMatchObject({ code: 'paypal_error' });
    const item = (await listItemsForRequest(await db(), run.requestId))[0]!;
    expect((await getBatch(await db(), item.batchId))!.batch.status).toBe('FAILED');
    await expect(h.engine.recordManualPayout({ batchId: item.batchId, method: 'cash', receiptNote: 'Not allowed for this one', session: marcus })).rejects.toMatchObject({ code: 'manual_not_allowed' });
  });
});
