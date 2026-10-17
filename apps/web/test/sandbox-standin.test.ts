/**
 * PAYPAL_MODE=sandbox /demo stand-ins (lib/server/engine/sandbox-standin.ts), against tools/fake-paypal driven in
 * sandbox mode (PAYPAL_BASE_URL → the fake; the engine has no claim control, exactly as with the real sandbox).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAudit, listItemsForRequest, type Db } from '@neighborline/db';
import { SCENARIOS } from '../lib/server/fixtures/scenarios';
import { UNCLAIMED_STANDIN, sandboxDemoReceiver, standInFor, standInNoteFromDestination } from '../lib/server/engine/sandbox-standin';
import { demoDisclosure, SANDBOX_STAND_IN } from '../lib/server/security/demo-disclosure';
import { redactRequestView } from '../lib/server/security/redact';
import { startHarness, waitFor, type Harness } from './harness';

const RECEIVER = 'sb-demo-receiver@personal.example.com';

describe('sandboxDemoReceiver / standInFor (pure)', () => {
  it('is on only with PAYPAL_MODE=sandbox, DEMO_MODE on and a plausible email', () => {
    const env = { PAYPAL_MODE: 'sandbox', DEMO_MODE: 'true', SANDBOX_DEMO_RECEIVER_EMAIL: RECEIVER };
    expect(sandboxDemoReceiver(env, 'sandbox')).toBe(RECEIVER);
    expect(sandboxDemoReceiver({ ...env, PAYPAL_MODE: 'fake' }, 'fake')).toBeNull(); // fake mode unchanged
    expect(sandboxDemoReceiver({ ...env, DEMO_MODE: 'false' }, 'sandbox')).toBeNull(); // the approver would count demo history
    expect(sandboxDemoReceiver({ PAYPAL_MODE: 'sandbox', SANDBOX_DEMO_RECEIVER_EMAIL: RECEIVER }, 'sandbox')).toBeNull(); // DEMO_MODE fails closed
    expect(sandboxDemoReceiver({ ...env, SANDBOX_DEMO_RECEIVER_EMAIL: 'not-an-email' }, 'sandbox')).toBeNull();
    expect(sandboxDemoReceiver({ ...env, SANDBOX_DEMO_RECEIVER_EMAIL: '' }, 'sandbox')).toBeNull();
  });

  it('Lan, Jean and Walter → the sandbox account (PayPal wallet, by email); Rosa → a fresh unregistered address; the impersonator → none', () => {
    const lan = standInFor({ scenario: 'lan', name: 'Lan', scripted: SCENARIOS.lan.payout, receiver: RECEIVER })!;
    expect(lan).toMatchObject({ kind: 'receiver', destination: { wallet: 'PAYPAL', type: 'EMAIL', value: RECEIVER, nameOnFile: 'Nguyen Thi Lan' }, scripted: { wallet: 'VENMO', value: '@lan-nguyen54' } });
    expect(lan.note).toBe('Sandbox: paid to a PayPal sandbox account standing in for Lan’s Venmo.');
    expect(standInFor({ scenario: 'walter', name: 'Walter', scripted: SCENARIOS.walter.payout, receiver: RECEIVER })!.note).toContain('standing in for Walter’s PayPal email');
    const a = standInFor({ scenario: 'rosa', name: 'Rosa', scripted: SCENARIOS.rosa.payout, receiver: RECEIVER })!;
    const b = standInFor({ scenario: 'rosa', name: 'Rosa', scripted: SCENARIOS.rosa.payout, receiver: RECEIVER })!;
    expect(a.kind).toBe('unclaimed');
    expect(a.destination.value).toMatch(UNCLAIMED_STANDIN);
    expect(a.destination.value).not.toBe(b.destination.value);
    expect(a.note).toContain('really goes UNCLAIMED');
    expect(standInFor({ scenario: 'blocked', name: 'Unknown', scripted: SCENARIOS.blocked.payout, receiver: RECEIVER })).toBeNull();
  });

  it('recognises a stand-in after a restart, for demo runs only', () => {
    expect(standInNoteFromDestination('req_demo_abc', { wallet: 'PAYPAL', type: 'EMAIL', value: RECEIVER }, RECEIVER)).toMatch(/^Sandbox: paid to/);
    expect(standInNoteFromDestination('req_demo_abc', { wallet: 'PAYPAL', type: 'EMAIL', value: 'neighborline-unclaimed-rosa-0123abcd@example.com' }, null)).toMatch(/UNCLAIMED/);
    expect(standInNoteFromDestination('req_real', { wallet: 'PAYPAL', type: 'EMAIL', value: RECEIVER }, RECEIVER)).toBeNull();
  });

  it('/trust says so only when stand-ins are on', () => {
    expect(demoDisclosure({ PAYPAL_MODE: 'sandbox', DEMO_MODE: 'true' }, 'sandbox').relaxed).not.toContain(SANDBOX_STAND_IN);
    const on = demoDisclosure({ PAYPAL_MODE: 'sandbox', DEMO_MODE: 'true', SANDBOX_DEMO_RECEIVER_EMAIL: RECEIVER }, 'sandbox');
    expect(on.relaxed).toContain(SANDBOX_STAND_IN);
    expect(on.text).toContain('Rail checks run on the scripted address first');
    expect(demoDisclosure({ DEMO_MODE: 'true', SANDBOX_DEMO_RECEIVER_EMAIL: RECEIVER }, 'fake').relaxed).not.toContain(SANDBOX_STAND_IN);
  });
});

let h: Harness;
const db = async () => (await (h.engine as unknown as { state: Promise<{ ctx: { db: Db } }> }).state).ctx.db;
const sentTo = (receiver: string) => [...h.fake.state.items.values()].filter((i) => i.payout_item.receiver === receiver);

describe('engine in PAYPAL_MODE=sandbox with SANDBOX_DEMO_RECEIVER_EMAIL', () => {
  beforeAll(async () => {
    h = await startHarness({ sandbox: { env: { SANDBOX_DEMO_RECEIVER_EMAIL: RECEIVER } } });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('Lan: rail checks on her Venmo handle, then the payout settles in the sandbox account, and every screen says so', async () => {
    expect(h.engine.modes.paypalMode).toBe('sandbox');
    const run = await h.engine.playScenario({ scenario: 'lan', mode: 'auto', speed: 20 });
    const t = await waitFor(async () => {
      const x = await h.engine.getThread(run.requestId);
      return x?.itemStatus === 'SUCCESS' && x.messages.some((m) => m.kind === 'paid') ? x : null;
    }, 20_000, 'Lan SUCCESS');
    // She was read back her own Venmo; the stand-in is filed only after the rail checks on it.
    expect(t.messages.find((m) => m.kind === 'readback')!.textEn).toContain('@lan-nguyen54');
    expect(t.sandboxNote).toBe('Sandbox: paid to a PayPal sandbox account standing in for Lan’s Venmo.');
    const v = (await h.engine.getRequest(run.requestId))!;
    expect(v.request.payoutDestination).toMatchObject({ wallet: 'PAYPAL', type: 'EMAIL', value: RECEIVER });
    expect(v.request.computed?.amountCents).toBe(15_000);
    expect(v.request.railFlags).toEqual([]);
    expect(v.sandboxStandIn).toEqual({ note: t.sandboxNote, scripted: { wallet: 'VENMO', value: '@lan-nguyen54' } });
    expect(v.payout!.item).toMatchObject({ wallet: 'PAYPAL', receiver: RECEIVER, status: 'SUCCESS' });
    expect(sentTo(RECEIVER).at(-1)!.payout_item).toMatchObject({ recipient_wallet: 'PAYPAL', recipient_type: 'EMAIL', amount: { value: '150.00' } });
    expect(sentTo('@lan-nguyen54')).toEqual([]);
    const audit = (await listAudit(await db(), { limit: 500 })).find((a) => a.action === 'demo.sandbox_stand_in' && a.entityId === run.requestId)!;
    expect(audit.data).toMatchObject({ kind: 'receiver', scripted: { wallet: 'VENMO' }, paidTo: { wallet: 'PAYPAL' } });
    // Anonymous readers: the note stays, the handles are masked.
    const red = redactRequestView(v);
    expect(red.sandboxStandIn!.note).toBe(t.sandboxNote);
    expect(red.sandboxStandIn!.scripted!.value).not.toContain('nguyen54');
  });

  it('Jean and Walter right after: the shared sandbox account never trips caps or duplicate-destination checks (demo-exempt)', async () => {
    for (const [scenario, cents] of [['jean', 6_000], ['walter', 6_000]] as const) {
      const run = await h.engine.playScenario({ scenario, mode: 'auto', speed: 20 });
      await waitFor(async () => (await h.engine.getThread(run.requestId))?.itemStatus === 'SUCCESS', 20_000, `${scenario} SUCCESS`);
      const v = (await h.engine.getRequest(run.requestId))!;
      expect(v.request.railFlags).toEqual([]);
      expect(v.request.computed?.amountCents).toBe(cents);
      expect(v.payout!.item.receiver).toBe(RECEIVER);
      expect(v.sandboxStandIn!.note).toContain(scenario === 'jean' ? 'Jean’s Venmo' : 'Walter’s PayPal email');
    }
    expect(sentTo(RECEIVER).length).toBeGreaterThanOrEqual(3);
  });

  it('Rosa: a fresh unregistered address per run really goes UNCLAIMED, nobody fakes her claim, and the visitor can cancel it', async () => {
    const tag = '0123456789ab';
    const run = await h.engine.playScenario({ scenario: 'rosa', mode: 'auto', speed: 20, visitorTag: tag });
    await waitFor(async () => {
      const x = await h.engine.getThread(run.requestId);
      return x?.itemStatus === 'UNCLAIMED' && x.messages.some((m) => m.kind === 'claim_help') ? x : null;
    }, 20_000, 'Rosa UNCLAIMED');
    await new Promise((r) => setTimeout(r, 1_000)); // well past the fake-mode claim beat (12 s × 0.02)
    const v = (await h.engine.getRequest(run.requestId))!;
    expect(v.payout!.item.status).toBe('UNCLAIMED');
    expect(v.payout!.item.receiver).toMatch(UNCLAIMED_STANDIN);
    expect(v.sandboxStandIn!.note).toContain('really goes UNCLAIMED');
    const again = await h.engine.playScenario({ scenario: 'rosa', mode: 'auto', speed: 20 });
    await waitFor(async () => (await h.engine.getThread(again.requestId))?.itemStatus === 'UNCLAIMED', 20_000, 'second Rosa UNCLAIMED');
    expect((await h.engine.getRequest(again.requestId))!.payout!.item.receiver).not.toBe(v.payout!.item.receiver);
    // The stage's "Cancel unclaimed payout": the visitor who played it, through the approver.
    await h.engine.cancelPayoutItem({ batchId: v.payout!.batch.id, itemId: v.payout!.item.id, actor: { visitorTag: tag } });
    await waitFor(async () => (await h.engine.getRequest(run.requestId))!.payout!.item.status === 'CANCELED', 5_000, 'CANCELED');
    expect((await listItemsForRequest(await db(), run.requestId)).map((i) => i.status)).toEqual(['CANCELED']);
  });

  it('the impersonator is still blocked on its scripted lookalike handle; nothing is swapped or paid', async () => {
    const run = await h.engine.playScenario({ scenario: 'blocked', mode: 'auto', speed: 20 });
    await waitFor(() => h.events(run.requestId).find((e) => e.type === 'request.flagged'), 10_000, 'flagged');
    const v = (await h.engine.getRequest(run.requestId))!;
    expect(v.request.payoutDestination?.value).toBe(SCENARIOS.blocked.payout.value);
    expect(v.sandboxStandIn).toBeUndefined();
    expect(await listItemsForRequest(await db(), run.requestId)).toEqual([]);
  });

  it('a /call request (not a scripted run) is never swapped', async () => {
    const { requestId } = await h.engine.startIntake({ groupSlug: 'eastside', channel: 'web_voice' });
    await h.engine.submitAudio(requestId, { sampleId: 'jean' });
    await h.engine.confirmIntake(requestId, { confirmed: true });
    const v = (await h.engine.getRequest(requestId))!;
    expect(v.request.payoutDestination?.value).toBe('@jean-baptiste-h');
    expect(v.sandboxStandIn).toBeUndefined();
  });
});
