import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listItemsForRequest, listNotifications } from '@neighborline/db';
import { startHarness, waitFor, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

const types = (id: string) => h.events(id).map((e) => (e.type === 'payout.item_updated' ? `item:${e.status}` : e.type));
const db = async () => (await (h.engine as unknown as { state: Promise<{ ctx: { db: never } }> }).state).ctx.db;

async function paidThread(id: string, status = 'SUCCESS') {
  return waitFor(async () => {
    const t = await h.engine.getThread(id);
    return t?.itemStatus === status && t.messages.some((m) => m.kind === (status === 'SUCCESS' ? 'paid' : 'claim_help')) ? t : null;
  }, 20_000, `item ${status} for ${id}`);
}

describe('engine (in-memory PGlite + fake PayPal + fixture AI)', () => {
  it('seeds the demo group, two waiting requests and three organizers', async () => {
    const g = await h.engine.getGroup();
    expect(g.slug).toBe('eastside');
    expect(g.organizers.map((o) => o.id).sort()).toEqual(['org_dana', 'org_marcus', 'org_priya']);
    const queue = await h.engine.listRequests({ status: ['awaiting_approval'] });
    expect(queue.map((r) => r.requester.displayName).sort()).toEqual(['Ana', 'Minh']);
    const ana = queue.find((r) => r.requester.displayName === 'Ana')!;
    expect(ana.request.railFlags.map((f) => f.code)).toContain('DUP_DESTINATION_DIFF_NAME');
    expect(ana.request.railFlags.every((f) => f.severity === 'review')).toBe(true);
  });

  it('Lan: Vietnamese voice note → two approvals → Payouts → verified webhook SUCCESS → callback in Vietnamese', async () => {
    const run = await h.engine.playScenario({ scenario: 'lan', mode: 'auto', speed: 20 });
    expect(run.requestId).toMatch(/^req_demo_/);
    const t = await paidThread(run.requestId);
    const paid = [...t.messages].reverse().find((m) => m.kind === 'paid')!;
    expect(paid.lang).toBe('vi');
    expect(paid.text).toContain('Đã gửi $150 vào Venmo của bạn');
    expect(types(run.requestId)).toEqual([
      'request.created',
      'request.transcribed',
      'request.readback',
      'request.confirmed',
      'approval.added',
      'approval.added',
      'payout.batch_created',
      'item:PENDING',
      'webhook.verified',
      'item:SUCCESS',
      'notify.sent',
    ]);
    const v = (await h.engine.getRequest(run.requestId))!;
    expect(v.request.status).toBe('paid');
    expect(v.request.computed).toMatchObject({ amountCents: 15_000, ruleKey: 'utility_outage' });
    expect(v.approvals.map((a) => a.name)).toEqual(['Dana', 'Marcus']);
    expect(v.payout!.batch.senderBatchId).toMatch(/^nl_[0-9a-f]{24}$/);
    expect(v.payout!.item.transactionId).toBeTruthy();
    expect(v.aiTrace?.summary).toContain('IntakeExtraction');
    // What actually went over the wire to (fake) PayPal.
    const sent = [...h.fake.state.items.values()].find((i) => i.payout_item.receiver === '@lan-nguyen54')!;
    expect(sent.payout_item).toMatchObject({ recipient_wallet: 'VENMO', recipient_type: 'USER_HANDLE', purpose: 'NON_GOODS_OR_SERVICES', amount: { value: '150.00', currency: 'USD' } });
    expect(sent.payout_item.application_context?.social_feed_privacy).toBe('PRIVATE');
    expect(sent.payout_item.note).toBeTruthy();
    const notes = await listNotifications(await db(), run.requestId);
    expect(notes.find((n) => n.messageKey === 'paid')).toMatchObject({ lang: 'vi', status: 'sent' });
  });

  it('a second Lan rehearsal is not blocked by the first one (demo runs never count against her household)', async () => {
    const run = await h.engine.playScenario({ scenario: 'lan', mode: 'auto', speed: 20 });
    await paidThread(run.requestId);
    const v = (await h.engine.getRequest(run.requestId))!;
    expect(v.request.computed?.amountCents).toBe(15_000);
    expect(v.request.railFlags).toEqual([]);
  });

  it('Rosa: UNCLAIMED → claim help in Spanish → she claims → SUCCESS', async () => {
    const run = await h.engine.playScenario({ scenario: 'rosa', mode: 'auto', speed: 20 });
    const t = await paidThread(run.requestId);
    const kinds = t.messages.filter((m) => m.from === 'line').map((m) => m.kind);
    expect(kinds.indexOf('claim_help')).toBeLessThan(kinds.indexOf('paid'));
    expect(t.messages.find((m) => m.kind === 'claim_help')!.lang).toBe('es');
    expect(types(run.requestId).filter((x) => x.startsWith('item:'))).toEqual(['item:PENDING', 'item:UNCLAIMED', 'item:SUCCESS']);
    expect(types(run.requestId).filter((x) => x === 'webhook.verified')).toHaveLength(2);
    expect((await h.engine.getRequest(run.requestId))!.request.status).toBe('paid');
  });

  it('impersonator: lookalike handle is blocked at intake, approval refused, no batch created', async () => {
    const batchesBefore = h.fake.state.batches.size;
    const run = await h.engine.playScenario({ scenario: 'blocked', mode: 'auto', speed: 20 });
    const flagged = await waitFor(() => h.events(run.requestId).find((e) => e.type === 'request.flagged'), 10_000, 'flagged');
    if (flagged.type !== 'request.flagged') throw new Error('unexpected');
    expect(flagged.flags[0]).toMatchObject({ code: 'LOOKALIKE_HANDLE', severity: 'block' });
    expect(flagged.flags.map((f) => f.code)).toContain('PROMPT_INJECTION');
    await expect(h.engine.approve({ requestIds: [run.requestId], organizerId: 'org_dana', signer: { kind: 'demo_key' } })).rejects.toMatchObject({ status: 409 });
    expect(types(run.requestId)).not.toContain('request.readback'); // the lookalike destination is never read back
    expect(await listItemsForRequest(await db(), run.requestId)).toEqual([]);
    expect(h.fake.state.batches.size).toBe(batchesBefore);
    const t = (await h.engine.getThread(run.requestId))!;
    expect(t.messages.at(-1)!.kind).toBe('blocked');
  });

  it('double taps and concurrent approvals produce exactly one PayPal batch', async () => {
    const { requestId } = await h.engine.startIntake({ groupSlug: 'eastside', channel: 'web_voice' });
    const intake = await h.engine.submitAudio(requestId, { sampleId: 'jean' });
    expect(intake.extraction.payout).toMatchObject({ wallet: 'VENMO', value: '@jean-baptiste-h' });
    expect(intake.simulatedTranscript).toBe(true);
    await h.engine.confirmIntake(requestId, { confirmed: true });
    expect((await h.engine.getRequest(requestId))!.request.computed?.amountCents).toBe(6_000);
    const batchesBefore = h.fake.state.batches.size;
    const dana = await Promise.all([1, 2].map(() => h.engine.approve({ requestIds: [requestId], organizerId: 'org_dana', signer: { kind: 'demo_key' } })));
    expect(dana.map((d) => d.count)).toEqual([1, 1]);
    expect(dana.every((d) => !d.executed)).toBe(true);
    const marcus = await Promise.all([1, 2, 3].map(() => h.engine.approve({ requestIds: [requestId], organizerId: 'org_marcus', signer: { kind: 'demo_key' } })));
    expect(new Set(marcus.map((m) => m.batchId)).size).toBe(1);
    expect(marcus.every((m) => m.executed && m.senderBatchId?.startsWith('nl_'))).toBe(true);
    const again = await h.engine.approve({ requestIds: [requestId], organizerId: 'org_priya', signer: { kind: 'demo_key' } });
    expect(again.batchId).toBe(marcus[0]!.batchId);
    expect(h.fake.state.batches.size).toBe(batchesBefore + 1);
    expect(types(requestId).filter((x) => x === 'payout.batch_created')).toHaveLength(1);
    await paidThread(requestId);
  });

  it('a duplicate webhook delivery is ignored, and a late HELD after SUCCESS does not regress', async () => {
    const run = await h.engine.playScenario({ scenario: 'walter', mode: 'auto', speed: 20 });
    await paidThread(run.requestId);
    const item = (await h.engine.getRequest(run.requestId))!.payout!.item;
    const succeeded = h.deliveries.find((d) => d.rawBody.includes('PAYMENT.PAYOUTS-ITEM.SUCCEEDED') && d.rawBody.includes(item.paypalItemId!))!;
    const before = h.events(run.requestId).length;
    const replay = await h.engine.handlePaypalWebhook({ headers: succeeded.headers, rawBody: succeeded.rawBody });
    expect(replay.verified).toBe(true);
    expect(h.events(run.requestId).length).toBe(before);
    // Tampered body: signature no longer matches.
    const forged = await h.engine.handlePaypalWebhook({ headers: succeeded.headers, rawBody: succeeded.rawBody.replace('"SUCCESS"', '"RETURNED"') });
    expect(forged.verified).toBe(false);
    // Late, genuinely signed HELD event after SUCCESS.
    await fetch(`${h.fake.url}/__fake/items/${item.paypalItemId}/status`, { method: 'POST', body: JSON.stringify({ status: 'ONHOLD' }) });
    await waitFor(() => h.deliveries.some((d) => d.rawBody.includes('PAYMENT.PAYOUTS-ITEM.HELD') && d.rawBody.includes(item.paypalItemId!)), 5_000, 'HELD delivery');
    const v = (await h.engine.getRequest(run.requestId))!;
    expect(v.payout!.item.status).toBe('SUCCESS');
    expect(v.request.status).toBe('paid');
    expect(h.events(run.requestId).filter((e) => e.type === 'notify.sent')).toHaveLength(1);
  });

  it('manual mode waits for the visitor to approve as Marcus', async () => {
    const run = await h.engine.playScenario({ scenario: 'lan', mode: 'manual', speed: 20 });
    expect(run.manualOrganizerId).toBe('org_marcus');
    await waitFor(async () => (await h.engine.getRequest(run.requestId))?.approvals.length === 1, 10_000, 'Dana');
    await new Promise((r) => setTimeout(r, 300));
    expect((await h.engine.getRequest(run.requestId))!.request.status).toBe('awaiting_approval');
    await h.engine.approve({ requestIds: [run.requestId], organizerId: 'org_marcus', signer: { kind: 'demo_key' } });
    await paidThread(run.requestId);
  });

  it('an organizer can cancel an UNCLAIMED payout; the money returns and nothing regresses', async () => {
    const { requestId } = await h.engine.startIntake({ groupSlug: 'eastside', channel: 'web_voice' });
    await h.engine.submitAudio(requestId, { sampleId: 'rosa' }); // rosa.m.delgado@… has no PayPal account in the fake
    await h.engine.confirmIntake(requestId, { confirmed: true });
    await h.engine.approve({ requestIds: [requestId], organizerId: 'org_dana', signer: { kind: 'demo_key' } });
    await h.engine.approve({ requestIds: [requestId], organizerId: 'org_marcus', signer: { kind: 'demo_key' } });
    await paidThread(requestId, 'UNCLAIMED');
    const p = (await h.engine.getRequest(requestId))!.payout!;
    await expect(h.engine.cancelPayoutItem({ batchId: 'pb_wrong', itemId: p.item.id })).rejects.toMatchObject({ status: 404 });
    await h.engine.cancelPayoutItem({ batchId: p.batch.id, itemId: p.item.id });
    await waitFor(() => h.deliveries.some((d) => d.rawBody.includes('PAYMENT.PAYOUTS-ITEM.CANCELED') && d.rawBody.includes(p.item.paypalItemId!)), 5_000, 'CANCELED webhook');
    const v = (await h.engine.getRequest(requestId))!;
    expect(v.payout!.item.status).toBe('CANCELED');
    expect(v.request.status).toBe('cancelled');
    await expect(h.engine.cancelPayoutItem({ batchId: p.batch.id, itemId: p.item.id })).rejects.toMatchObject({ status: 409 });
  });

  it('donations go through Orders v2 on fake PayPal and show up in the report and ledger', async () => {
    const before = await h.engine.getReport();
    const order = await h.engine.createDonationOrder({ amountCents: 2_500, source: 'VENMO' });
    const cap = await h.engine.captureDonationOrder(order.orderId);
    expect(cap).toMatchObject({ status: 'COMPLETED', amountCents: 2_500, simulated: true });
    const again = await h.engine.captureDonationOrder(order.orderId); // double tap
    expect(again.captureId).toBe(cap.captureId);
    const after = await h.engine.getReport();
    expect(after.totals.donationsCents).toBe(before.totals.donationsCents + 2_500);
    expect(after.narrative.paragraphs.length).toBeGreaterThan(0);
    expect(after.narrative.figuresChecked).toBeGreaterThan(3);
    expect(after.narrative.allFiguresMatchLedger).toBe(true);
    expect(after.lines.some((l) => l.status === 'SUCCESS' && l.transactionId)).toBe(true);
  });

  it('reconciles live payouts against Transaction Search; seeded history is labelled, not faked', async () => {
    const r = await h.engine.reconcile();
    expect(r.matched).toBeGreaterThan(0);
    expect(r.mismatched).toBe(0);
    const ledger = await h.engine.getLedger();
    expect(ledger.rows.some((x) => x.reconcile === 'matched')).toBe(true);
    expect(ledger.rows.filter((x) => x.reconcile === 'seeded').length).toBeGreaterThanOrEqual(13);
    expect(ledger.lastReconciledAt).toBe(r.at);
  });

  it('trust view reports real modes', async () => {
    const t = await h.engine.getTrust();
    expect(t.modes).toEqual({ paypalMode: 'fake', aiMode: 'fixture', engine: 'real' });
    expect(t.sandboxReality.find((s) => s.label.startsWith('Least privilege'))?.status).toBe('real');
    expect(t.group.fiscalSponsor.checks.find((c) => c.key === 'purpose_donations')?.label).toContain('NON_GOODS_OR_SERVICES');
  });

  it('reset swaps in a fresh database while requests are in flight', async () => {
    const run = await h.engine.playScenario({ scenario: 'lan', mode: 'auto', speed: 1 });
    const [, , queue] = await Promise.all([h.engine.resetDemo(), h.engine.resetDemo(), h.engine.listRequests()]);
    expect(Array.isArray(queue)).toBe(true);
    expect(await h.engine.getRequest(run.requestId)).toBeNull();
    const fresh = await h.engine.listRequests({ status: ['awaiting_approval'] });
    expect(fresh).toHaveLength(2);
    expect(h.engine.replay(run.requestId)).toEqual([]);
  });
});
