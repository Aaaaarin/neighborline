/**
 * The browser spike end to end: bundle dist-browser/spike.js, load it into Playwright Chromium on a page of another
 * origin, give it credentials through sessionStorage only, run NLSpike against tools/fake-paypal (FAKE_PAYPAL_CORS),
 * approve the order by hand (a GET of the approve link), capture, reconcile again, then ingest the JSON and check the
 * evidence. Also: the sandbox branch of the ingest (fixture + PAYPAL_NOTES.md) in a temp repo, and its refusals.
 * Skips the Chromium part when Playwright (apps/web) or its browser is not installed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createFakePayPal, type FakePayPal } from '@neighborline/fake-paypal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO } from '../lib/context.js';
import type { SpikeData } from '../lib/evidence.js';
import { tmp } from '../test-helpers.js';
import { buildBrowserBundle, MAX_BYTES } from './build.js';
import { ingestSpike, parseIngestArgs, parseSpikeJson } from './ingest.js';
import { findSecrets } from './secrets.js';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

type Chromium = { launch(o?: object): Promise<{ newPage(): Promise<any>; close(): Promise<void> }> };
async function loadChromium(): Promise<Chromium | null> {
  const req = createRequire(join(REPO, 'apps/web/package.json'));
  for (const name of ['playwright', '@playwright/test']) {
    try {
      const mod = await import(req.resolve(name));
      const chromium = (mod.chromium ?? mod.default?.chromium) as Chromium | undefined;
      if (chromium) return chromium;
    } catch {
      /* next */
    }
  }
  return null;
}

const CREDS = { main: { id: `AMain${'a'.repeat(75)}`, sec: `EMain${'b'.repeat(75)}` }, payouts: { id: `APay${'c'.repeat(76)}`, sec: `EPay${'d'.repeat(76)}` } };
const SECRETS = [CREDS.main.id, CREDS.main.sec, CREDS.payouts.id, CREDS.payouts.sec];

let fake: FakePayPal;
let page: Server;
let pageUrl: string;
let bundle: string;
let bundleBytes: number;
let browser: Awaited<ReturnType<Chromium['launch']>> | null = null;

beforeAll(async () => {
  fake = await createFakePayPal({ cors: true, processingDelayMs: 200 });
  page = createServer((_req, res) => void res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>developer.paypal.com stand-in</title><p>tab'));
  await new Promise<void>((r) => page.listen(0, '127.0.0.1', () => r()));
  pageUrl = `http://localhost:${(page.address() as { port: number }).port}/`;
  const out = join(tmp('golive-bundle-'), 'spike.js');
  ({ file: bundle, bytes: bundleBytes } = await buildBrowserBundle({ outfile: out }));
  const chromium = await loadChromium();
  browser = chromium ? await chromium.launch().catch(() => null) : null;
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await fake.close();
  await new Promise<void>((r) => page.close(() => r()));
});

describe('browser spike bundle', () => {
  it('builds to one IIFE under the size limit with no node builtins left', () => {
    expect(bundleBytes).toBeLessThan(MAX_BYTES);
    const js = readFileSync(bundle, 'utf8');
    expect(js).not.toMatch(/\brequire\(["']node:/);
    expect(js).toContain('NLSpike');
  });

  it('runs in Chromium against the fake, scrubs secrets, captures after a manual approval, and ingests into evidence', async (t) => {
    if (!browser) return t.skip();
    const p = await browser.newPage();
    const console: string[] = [];
    p.on('console', (m: { text(): string }) => console.push(m.text()));
    await p.goto(pageUrl);
    await p.evaluate((c: typeof CREDS) => {
      sessionStorage.setItem('nl_main', JSON.stringify(c.main));
      sessionStorage.setItem('nl_payouts', JSON.stringify(c.payouts));
    }, CREDS);
    // The lead pastes the bundle text through a JavaScript tool; addScriptTag with its content is the same thing.
    await p.addScriptTag({ content: readFileSync(bundle, 'utf8') });

    await expect(p.evaluate(() => (window as any).NLSpike.run({ personalEmail: 'sb-lan47@personal.example.com', base: 'https://api-m.paypal.com' }))).rejects.toThrow(/refused/);

    const d = (await p.evaluate((base: string) => (window as any).NLSpike.run({ personalEmail: 'sb-lan47@personal.example.com', venmoHandle: '@lan-nguyen54', base, pollSeconds: 15, pollIntervalMs: 100 }), fake.url)) as SpikeData;
    expect(d.target).toBe('fake');
    expect(d.runId).toMatch(/^\d{8}t\d{6}$/);
    expect(Object.keys(d.parts)).toEqual(['payouts', 'phone', 'poll', 'cancel-unclaimed', 'duplicate', 'negative', 'orders', 'webhook-events', 'reconcile']);
    const items = d.batches!.flatMap((b) => b.items ?? []);
    expect(Object.fromEntries(items.filter((i) => i.senderItemId?.includes('_a_')).map((i) => [i.senderItemId!.split('_a_')[1], i.status]))).toEqual({ paypal: 'SUCCESS', venmo_handle: 'SUCCESS', venmo_email: 'SUCCESS', unregistered: 'RETURNED' });
    expect(d.duplicate!.ok).toBe(true);
    expect(d.negative!.length).toBe(25);
    expect(d.orders!.approval).toMatchObject({ strategy: 'manual', ok: false });
    expect(d.parts.orders!.status).toBe('warn');
    expect(d.orders!.approveUrl).toContain('/checkoutnow?token=');
    expect(d.orders!.declined!.error!.issue).toBe('INSTRUMENT_DECLINED');
    expect(d.reconcile!.matched.length).toBeGreaterThan(0);

    // A human approves at the approve URL; then NLSpike.capture(d) finishes the order.
    expect((await fetch(d.orders!.approveUrl!, { redirect: 'manual' })).status).toBeLessThan(400);
    const d2 = (await p.evaluate((x: SpikeData) => (window as any).NLSpike.capture(x), d)) as SpikeData;
    expect(d2.orders!.capture!.captureId).toBeTruthy();
    expect(d2.orders!.recapture!.alreadyCaptured).toBe(true);
    expect(d2.parts.orders).toMatchObject({ status: 'ok' });
    const d3 = (await p.evaluate((x: SpikeData) => (window as any).NLSpike.reconcileAgain(x), d2)) as SpikeData;
    expect(d3.reconcile!.checkedAt >= d2.reconcile!.checkedAt).toBe(true);
    // Fire-and-poll mode and the chunked JSON getter exist for tools that time out or truncate.
    const json = (await p.evaluate(() => (window as any).NLSpike.json())) as string;
    expect(JSON.parse(json).runId).toBe(d.runId);
    expect(await p.evaluate(() => (window as any).NLSpike.json(0, 1000).of)).toBeGreaterThan(1);

    // No credential or token anywhere: result, console, or what the tab keeps.
    const everything = JSON.stringify([d, d2, d3]) + console.join('\n') + String(await p.evaluate(() => sessionStorage.getItem('nl_spike_last')));
    for (const s of SECRETS) expect(everything).not.toContain(s);
    expect(findSecrets([d, d2, d3])).toEqual([]);
    expect(everything).not.toMatch(/Bearer\s+\S{8,}|access_token/);

    // Ingest exactly what came back.
    const out = tmp('golive-ingest-');
    const r = ingestSpike(JSON.stringify(JSON.stringify(d3)), { repo: tmp('golive-repo-'), out });
    expect(r.result.status).toBe('ok');
    const md = readFileSync(join(out, 'SANDBOX_EVIDENCE.md'), 'utf8');
    expect(md).toContain('**Not sandbox evidence.**');
    expect(md).toContain(d3.batches![0]!.batchId!);
    expect(md).toContain('Buyer approval (manual): approved');
    expect(md).toContain(d3.orders!.capture!.captureId!);
    const state = JSON.parse(readFileSync(join(out, 'state.json'), 'utf8'));
    expect(state.steps['sandbox-spike'].status).toBe('ok');
    expect(state.parts['sandbox-spike'].runId).toBe(d.runId);
    expect(JSON.parse(readFileSync(join(out, 'sandbox-spike.json'), 'utf8')).orders.capture.captureId).toBe(d3.orders!.capture!.captureId);
    await p.close();
  }, 120_000);
});

describe('golive:ingest', () => {
  const base: SpikeData = {
    runId: '20261028t041944',
    target: 'sandbox',
    base: 'https://api-m.sandbox.paypal.com',
    startedAt: '2026-10-28T04:19:44.000Z',
    parts: { payouts: { status: 'ok', at: '2026-10-28T04:19:50.000Z' }, reconcile: { status: 'pending', at: '2026-10-28T04:21:00.000Z', note: '3 item(s) inside the lag' } },
    batches: [{ label: 'A', senderBatchId: 'golive_20261028t041944_a', batchId: 'Q8KVJG9TZTNN4', createdAt: '2026-10-28T04:19:46Z', plan: [{ key: 'paypal', label: 'PayPal wallet', expect: 'SUCCESS' }], items: [{ senderItemId: 'golive_20261028t041944_a_paypal', payoutItemId: 'ITEM1', transactionId: '1AB', status: 'SUCCESS', wallet: 'PAYPAL', recipientType: 'EMAIL', receiver: 'sb-lan47@personal.example.com', amountCents: 101, feeCents: 0, timeProcessed: '2026-10-28T04:19:50Z', errorName: undefined, errorMessage: undefined, purposeEcho: 'DONATIONS' }] }],
    duplicate: { reused: { status: 400, name: 'USER_BUSINESS_ERROR', linkPaths: ['links[0].href'], body: { name: 'USER_BUSINESS_ERROR', message: 'Batch with given sender_batch_id already exists', links: [{ href: 'https://api.sandbox.paypal.com/v1/payments/payouts/Q8KVJG9TZTNN4' }] } }, detectedAsDuplicate: true, linkedBatchId: 'Q8KVJG9TZTNN4', linkMatchesOriginal: true, client: { duplicate: true, batchId: 'Q8KVJG9TZTNN4' }, replay: { status: 201, batchId: 'Q8KVJG9TZTNN4' }, ok: true },
  };

  it('a sandbox run writes evidence, the duplicate fixture and PAYPAL_NOTES.md, and keeps hosted evidence', () => {
    const repo = tmp('golive-repo-');
    mkdirSync(join(repo, 'packages/paypal'), { recursive: true });
    writeFileSync(join(repo, 'packages/paypal/PAYPAL_NOTES.md'), '# Notes\n\n## To verify in the real sandbox\n\n1. duplicate?\n\n## Later\n');
    const out = tmp('golive-out-');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'state.json'), JSON.stringify({ steps: {}, parts: { 'sandbox-spike': { runId: '20261027t000000', target: 'sandbox', hosted: { url: 'https://x.onrender.com', scenario: 'lan' } } } }));
    const r = ingestSpike(JSON.stringify(base), { repo, out, now: () => new Date('2026-10-28T05:00:00Z') });
    expect(r.result.status).toBe('pending');
    expect(r.result.next).toContain('NLSpike.reconcileAgain');
    expect(r.outputs).toEqual(['sandbox-spike.json', 'SANDBOX_EVIDENCE.md', 'packages/paypal/src/fixtures/duplicate-sender-batch/sandbox-2026-10-28.json', 'packages/paypal/PAYPAL_NOTES.md'].map((f, i) => (i < 2 ? join(out, f) : f)));
    expect(readdirSync(join(repo, 'packages/paypal/src/fixtures/duplicate-sender-batch'))).toEqual(['sandbox-2026-10-28.json']);
    expect(JSON.parse(readFileSync(join(repo, 'packages/paypal/src/fixtures/duplicate-sender-batch/sandbox-2026-10-28.json'), 'utf8')).expectBatchId).toBe('Q8KVJG9TZTNN4');
    expect(readFileSync(join(repo, 'packages/paypal/PAYPAL_NOTES.md'), 'utf8')).toMatch(/1\. duplicate\?\n\n<!-- golive:observed:start -->[\s\S]*run `20261028t041944`[\s\S]*<!-- golive:observed:end -->\n\n## Later/);
    const md = readFileSync(join(out, 'SANDBOX_EVIDENCE.md'), 'utf8');
    expect(md).not.toContain('Not sandbox evidence');
    expect(md).toContain('`Q8KVJG9TZTNN4`');
    const state = JSON.parse(readFileSync(join(out, 'state.json'), 'utf8'));
    expect(state.parts['sandbox-spike']).toMatchObject({ runId: base.runId, target: 'sandbox', hosted: { scenario: 'lan' } });
    expect(state.steps['sandbox-spike']).toMatchObject({ status: 'pending', at: '2026-10-28T05:00:00.000Z' });
  });

  it('refuses secrets, malformed data, live PayPal and a target that does not match the base', () => {
    expect(() => parseSpikeJson(JSON.stringify({ ...base, orders: { approval: { strategy: 'manual', ok: false, note: '' }, authorization: 'Bearer abcdefghijkl' } }))).toThrow(/credential or token at orders.authorization/);
    expect(() => parseSpikeJson(JSON.stringify({ ...base, apps: { main: `E${'x'.repeat(79)}` } }))).toThrow(/apps.main: PayPal client id\/secret/);
    try {
      parseSpikeJson(JSON.stringify({ ...base, apps: { main: `E${'x'.repeat(79)}` } }));
    } catch (err) {
      expect((err as Error).message).not.toContain('x'.repeat(20)); // the reason names the path, never the value
    }
    expect(() => parseSpikeJson('{"runId":"nope"}')).toThrow(/not sandbox-spike data/);
    expect(() => parseSpikeJson('not json')).toThrow(/not JSON/);
    expect(() => parseSpikeJson(JSON.stringify({ ...base, extra: 1 }))).toThrow(/Unrecognized key/);
    expect(() => parseSpikeJson(JSON.stringify({ ...base, base: 'https://api-m.paypal.com' }))).toThrow(/live PayPal/);
    expect(() => parseSpikeJson(JSON.stringify({ ...base, base: 'http://127.0.0.1:4010' }))).toThrow(/does not match/);
    expect(() => parseSpikeJson(JSON.stringify({ ...base, target: 'fake' }))).toThrow(/does not match/);
  });

  it('resolves the file against the directory pnpm was started from', () => {
    expect(parseIngestArgs(['spike.json'], '/home/me')).toEqual({ file: '/home/me/spike.json', out: join(REPO, 'golive-out') });
    expect(parseIngestArgs(['--', '/tmp/a.json', '--out', 'o'], '/w')).toEqual({ file: '/tmp/a.json', out: '/w/o' });
    expect(() => parseIngestArgs([], '/w')).toThrow(/usage/);
    expect(() => parseIngestArgs(['a', 'b'], '/w')).toThrow(/one file/);
  });
});
