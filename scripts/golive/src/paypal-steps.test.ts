/**
 * preflight → sandbox-setup → sandbox-spike end to end against tools/fake-paypal (in process), the way they will run
 * against the real sandbox on key day: webhook subscriptions, plans, payouts, duplicate, negative values, Orders,
 * a captured + verified webhook delivery, Transaction Search, evidence, and a resumed second run.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakePayPal, type FakePayPal } from '@neighborline/fake-paypal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO } from './lib/context.js';
import { runGolive } from './lib/orchestrate.js';
import { preflight } from './steps/preflight.js';
import { sandboxSetup } from './steps/sandbox-setup.js';
import { sandboxSpike } from './steps/sandbox-spike.js';
import { fakePaypalEnv, fakeRunner, freePort, tmp } from './test-helpers.js';

let fake: FakePayPal;
beforeAll(async () => {
  // sandboxRealism: behave like the real sandbox did on 2026-10-28 (Venmo batches refused, webhook-events time format).
  fake = await createFakePayPal({ processingDelayMs: 30, sandboxRealism: true });
});
afterAll(async () => {
  await fake.close();
});

const steps = [preflight, sandboxSetup, sandboxSpike];

describe('PayPal steps against the fake', () => {
  it('set up, spike, write evidence; a second run resumes without paying twice', async () => {
    const fixtureDir = join(REPO, 'packages/paypal/src/fixtures/duplicate-sender-batch');
    const fixturesBefore = existsSync(fixtureDir) ? snapshotDir(fixtureDir) : '';
    const out = tmp();
    const capturePort = await freePort();
    const env = fakePaypalEnv(fake.url, {
      GOLIVE_PUBLIC_URL: 'http://127.0.0.1:9/app',
      GOLIVE_WEBHOOK_CAPTURE_URL: `http://127.0.0.1:${capturePort}/capture`,
      GOLIVE_WEBHOOK_CAPTURE_PORT: String(capturePort),
    });
    const { run } = fakeRunner();
    const report = await runGolive({ repo: REPO, out, steps, processEnv: env, run, quiet: true });
    const by = Object.fromEntries(report.results.map((r) => [r.step, r.result]));
    expect(report.stoppedAt).toBeUndefined();
    expect(by.preflight!.status).toMatch(/ok|warn/);
    expect(by['sandbox-setup']).toMatchObject({ status: 'ok' });
    expect(by['sandbox-spike']!, JSON.stringify(by['sandbox-spike'])).toMatchObject({ status: 'ok' });

    // sandbox-setup: one subscription per app (the fake scopes them by client_id, like PayPal).
    const gen = readFileSync(join(out, 'golive.env'), 'utf8');
    expect(gen).toMatch(/PAYPAL_WEBHOOK_ID=[A-Z0-9]{17}/);
    expect(gen).toMatch(/PAYPAL_PAYOUTS_WEBHOOK_ID=[A-Z0-9]{17}/);
    expect(/PAYPAL_WEBHOOK_ID=(\w+)/.exec(gen)![1]).not.toBe(/PAYPAL_PAYOUTS_WEBHOOK_ID=(\w+)/.exec(gen)![1]);
    expect(gen).toMatch(/PAYPAL_PLAN_ID_25=P-/);
    const subs = [...fake.state.registeredWebhooks.values()];
    expect(subs.map((s) => s.url)).toContain('http://127.0.0.1:9/app/api/webhooks/paypal');
    expect(subs.flatMap((s) => s.event_types.map((t) => t.name))).not.toContain('PAYMENT.PAYOUTS-ITEM.REVERSED');

    const spike = JSON.parse(readFileSync(join(out, 'sandbox-spike.json'), 'utf8'));
    expect(spike.target).toBe('fake');
    const items = spike.batches[0].items as Array<{ senderItemId: string; status: string; wallet: string }>;
    expect(Object.fromEntries(items.map((i) => [i.senderItemId.split('_a_')[1], i.status]))).toEqual({ paypal: 'SUCCESS', unregistered: 'RETURNED' });
    expect(spike.cancel).toMatchObject({ before: 'UNCLAIMED', after: 'RETURNED' });
    expect(spike.duplicate).toMatchObject({ ok: true, detectedAsDuplicate: true, linkMatchesOriginal: true, reused: { status: 400, name: 'USER_BUSINESS_ERROR', linkPaths: ['details[0].link[0].href'] } });
    expect(spike.duplicate.replay.batchId).toBe(spike.batches[0].batchId);
    const neg = Object.fromEntries((spike.negative as Array<{ code: string; status: number }>).map((n) => [n.code, n.status]));
    expect(neg).toMatchObject({ ERRPYO001: 422, ERRPYO005: 422, ERRPYO013: 400, POSPYO001: 201, ERRPYOB004: 200 });
    expect(spike.orders.approval).toMatchObject({ strategy: 'link', ok: true });
    expect(spike.orders.capture.captureStatus).toBe('COMPLETED');
    expect(spike.orders.recapture.alreadyCaptured).toBe(true);
    expect(spike.orders.declined.error.issue).toBe('INSTRUMENT_DECLINED');
    expect(spike.capture).toMatchObject({ verification: 'SUCCESS', tamperedVerification: 'FAILURE', cleanedUp: true, status: 'ok' });
    expect(spike.reconcile.status, JSON.stringify(spike.reconcile)).toBe('ok');
    expect(spike.reconcile.matched.length).toBeGreaterThanOrEqual(2); // batch A is PayPal-wallet only
    // Batch B (Venmo by handle, @handle and email) is refused as a whole, as the real sandbox did on 2026-10-28.
    expect(spike.batches[1].createError).toMatchObject({ status: 400, name: 'VALIDATION_ERROR' });
    expect(JSON.stringify(spike.batches[1].createError)).toContain('Recipient wallet not supported in sandbox.');
    expect(spike.events.length).toBeGreaterThan(0);

    const md = readFileSync(join(out, 'SANDBOX_EVIDENCE.md'), 'utf8');
    if (process.env.GOLIVE_PRINT_EVIDENCE) writeFileSync(process.env.GOLIVE_PRINT_EVIDENCE, md);
    expect(md).toContain('Not sandbox evidence');
    expect(md).toContain('**refused**: the sandbox rejects the whole batch when any item is Venmo');
    expect(md).toContain(spike.batches[0].batchId);
    expect(md).toContain('sb-la…@personal.example.com');
    expect(md).not.toContain('sb-lan47@');
    expect(md).not.toMatch(/EPayouts|EMain/);
    // A fake run never touches the repo's PayPal notes or fixtures.
    // (Compared before/after: a real sandbox run on the same day legitimately leaves its own fixture there.)
    expect(existsSync(fixtureDir) ? snapshotDir(fixtureDir) : '').toBe(fixturesBefore);

    // Second run: everything resumes; no new batch is created.
    const batchesBefore = fake.state.batches.size;
    const again = await runGolive({ repo: REPO, out, steps: [sandboxSpike], processEnv: env, run, quiet: true });
    expect(again.results.find((r) => r.step === 'sandbox-spike')!.result.status).toBe('ok');
    expect(fake.state.batches.size).toBe(batchesBefore);
    expect(JSON.parse(readFileSync(join(out, 'sandbox-spike.json'), 'utf8')).runId).toBe(spike.runId);
  }, 60_000);

  it('a first batch PayPal refuses stops the run with a next action', async () => {
    const out = tmp();
    // ERRPYO001 in the first item's note is the sandbox's SENDER_RESTRICTED; simulate by a fault on the create path.
    await fetch(`${fake.url}/__fake/faults`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pathPrefix: '/v1/payments/payouts', status: 422, count: 2, name: 'SENDER_RESTRICTED' }) });
    const report = await runGolive({ repo: REPO, out, steps: [sandboxSpike], processEnv: fakePaypalEnv(fake.url), run: fakeRunner().run, quiet: true });
    expect(report.stoppedAt).toBe('sandbox-spike');
    const r = report.results.find((x) => x.step === 'sandbox-spike')!.result;
    expect(r.summary).toContain('SENDER_RESTRICTED');
    expect(r.next).toMatch(/Payouts enabled/);
    expect(readFileSync(report.summaryFile, 'utf8')).toContain('Stopped at **sandbox-spike**');
  }, 30_000);

  it('without keys: preflight lists what is missing, PayPal steps skip, nothing fails', async () => {
    const report = await runGolive({ repo: REPO, out: tmp(), steps, processEnv: { PATH: process.env.PATH }, run: fakeRunner().run, quiet: true });
    expect(report.stoppedAt).toBeUndefined();
    expect(report.results.map((r) => r.result.status)).toEqual(['ok', 'skipped', 'skipped']);
  });

  it('refuses live PayPal', async () => {
    const report = await runGolive({ repo: REPO, out: tmp(), steps, processEnv: { PAYPAL_BASE_URL: 'https://api-m.paypal.com' }, run: fakeRunner().run, quiet: true });
    expect(report.stoppedAt).toBe('preflight');
    expect(report.results[0]!.result.summary).toMatch(/live PayPal/);
  });

  it('flags a bad key format and a failing OAuth before anything else runs', async () => {
    const strict = await createFakePayPal({ clientId: `AOnly${'z'.repeat(50)}`, clientSecret: `EOnly${'z'.repeat(50)}` });
    try {
      const report = await runGolive({ repo: REPO, out: tmp(), steps, processEnv: { ...fakePaypalEnv(strict.url), OPENAI_API_KEY: 'not-a-key' }, run: fakeRunner().run, quiet: true });
      expect(report.stoppedAt).toBe('preflight');
      const r = report.results[0]!.result;
      expect(r.next).toContain('OPENAI_API_KEY: expected sk-');
      expect(r.next).toContain('main app: OAuth failed');
    } finally {
      await strict.close();
    }
  });
});

describe('Transaction Search on a brand-new account (observed 2026-10-28)', () => {
  it('404 "Data for the given start date is not available." is pending (reporting lag), not failed', async () => {
    const { createPayPal } = await import('@neighborline/paypal');
    const { probeReconcile } = await import('./lib/spike/reconcile.js');
    const pp = createPayPal({ clientId: 'c', clientSecret: 's', baseUrl: fake.url });
    fake.config.reportingNotReady = true;
    try {
      const now = new Date();
      const batch = { label: 'A', senderBatchId: 'x', createdAt: now.toISOString(), plan: [], items: [{ senderItemId: 'x_a_paypal', payoutItemId: 'ITEM1', transactionId: 'TX1', status: 'SUCCESS', wallet: 'PAYPAL', recipientType: 'EMAIL', amountCents: 101 }] };
      const r = await probeReconcile(pp, [batch as never], now);
      expect(r.status).toBe('pending');
      expect(r.pendingLag).toEqual(['ITEM1']);
      expect(r.summary).toContain("PayPal's reporting isn't ready yet");
      expect(r.error).toMatchObject({ status: 404, name: 'INVALID_REQUEST' });
    } finally {
      fake.config.reportingNotReady = false;
    }
  });
});

/** File names, sizes and mtimes in a directory: equal before/after means nothing was written there. */
function snapshotDir(dir: string): string {
  return readdirSync(dir)
    .sort()
    .map((n) => {
      const st = statSync(join(dir, n));
      return `${n}:${st.size}:${st.mtimeMs}`;
    })
    .join('|');
}
