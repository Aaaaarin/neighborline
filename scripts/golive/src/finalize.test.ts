/**
 * finalize-docs on a shadow copy of the repo (every tracked Markdown file with its content, every other tracked file
 * as an empty placeholder so links resolve), and the whole pipeline's --dry-run with zero keys and no network.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, StateStore } from './lib/context.js';
import type { SpikeData } from './lib/evidence.js';
import { runGolive } from './lib/orchestrate.js';
import { STEPS } from './steps/index.js';
import { finalizeDocs } from './steps/finalize-docs.js';
import { fakeRunner, tmp } from './test-helpers.js';

function shadowRepo(): string {
  const dir = tmp('golive-shadow-');
  for (const f of execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), f.endsWith('.md') && existsSync(join(REPO, f)) ? readFileSync(join(REPO, f)) : '');
  }
  return dir;
}

const spike = (target: 'sandbox' | 'fake'): SpikeData => ({
  runId: '20261110t100000',
  target,
  base: target === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'http://127.0.0.1:4010',
  startedAt: '2026-11-10T10:00:00.000Z',
  parts: { payouts: { status: 'ok', at: '2026-11-10T10:00:01Z' } },
  batches: [
    {
      label: 'A',
      senderBatchId: 'golive_20261110t100000_a',
      batchId: 'SBATCH0000001',
      batchStatus: 'SUCCESS',
      createdAt: '2026-11-10T10:00:01Z',
      plan: [{ key: 'paypal', label: 'PayPal wallet', expect: 'SUCCESS' }],
      items: [{ senderItemId: 'golive_20261110t100000_a_paypal', payoutItemId: 'ITEM1', transactionId: 'TXN1', status: 'SUCCESS', wallet: 'PAYPAL', recipientType: 'EMAIL', receiver: 'sb-abc@personal.example.com', amountCents: 101, feeCents: 0, timeProcessed: '2026-11-10T10:00:05Z', errorName: undefined, errorMessage: undefined, purposeEcho: 'DONATIONS' }],
    },
  ],
  capture: { url: 'https://t.example/capture', webhookId: 'WHSUB', received: 1, event: { id: 'WH-REAL-9', type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', at: '2026-11-10T10:00:06Z' }, verification: 'SUCCESS', tamperedVerification: 'FAILURE', cleanedUp: true, status: 'ok' },
});

function seed(out: string, target: 'sandbox' | 'fake') {
  const st = new StateStore(join(out, 'state.json'));
  st.patch('sandbox-spike', spike(target) as unknown as Record<string, unknown>);
  st.patch('deploy-render', { url: 'https://nl-test.onrender.com', hosted: { url: 'https://nl-test.onrender.com', scenario: 'lan', paypalMode: 'sandbox', paypalBatchId: 'HB1', itemStatus: 'SUCCESS' } });
}

const ok200 = (async (u: string | URL | Request) => (String(u) === 'https://nl-test.onrender.com/demo' ? new Response('<html>', { status: 200 }) : new Response('no', { status: 599 }))) as typeof fetch;

describe('finalize-docs', () => {
  it('fills tokens and publishes real sandbox evidence; a second run changes nothing', async () => {
    const repo = shadowRepo();
    const out = tmp();
    seed(out, 'sandbox');
    const env = { HOSTED_URL: 'nl-test.onrender.com', VIDEO_ID: 'abcdefghijk', JUDGE_SANDBOX_BUYER_EMAIL: 'sb-judge@personal.example.com', JUDGE_SANDBOX_BUYER_PASSWORD: 'judge-pass-1' };
    const report = await runGolive({ repo, out, steps: [finalizeDocs], processEnv: env, run: fakeRunner().run, fetch: ok200, quiet: true });
    const r = report.results.find((x) => x.step === 'finalize-docs')!.result;
    expect(r.status, JSON.stringify(r)).not.toBe('failed');
    const readme = readFileSync(join(repo, 'README.md'), 'utf8');
    expect(readme).toContain('**Hosted:** <https://nl-test.onrender.com/demo>');
    expect(readme).toMatch(/\| Real PayPal sandbox \| \*\*Run on 2026-11-10\*\*.*SBATCH0000001.*WH-REAL-9/);
    const fields = readFileSync(join(repo, 'docs/submission/DEVPOST_FIELDS.md'), 'utf8');
    expect(fields).toContain('https://nl-test.onrender.com/demo');
    expect(fields).toContain('https://youtu.be/abcdefghijk');
    expect(fields).toContain('sb-judge@personal.example.com / judge-pass-1');
    expect(fields).toContain('| `{HOSTED_URL}` |'); // the token table itself stays
    expect(readFileSync(join(repo, 'docs/SANDBOX_EVIDENCE.md'), 'utf8')).toContain('SBATCH0000001');
    expect(readFileSync(join(repo, 'docs/PAYPAL.md'), 'utf8')).toContain('Answered by the sandbox run of 2026-11-10');
    // Any wording finalize-docs could not find is named in the next action (never silently skipped).
    const fin = JSON.parse(readFileSync(join(out, 'finalize-docs.json'), 'utf8')) as { report: Array<{ file: string; rule: string; applied: boolean }>; broken: unknown[] };
    for (const e of fin.report.filter((x) => !x.applied)) expect(r.next).toContain(e.rule);
    expect(fin.broken).toEqual([]);

    const again = await runGolive({ repo, out, steps: [finalizeDocs], processEnv: env, run: fakeRunner().run, fetch: ok200, quiet: true });
    expect(again.results[0]!.result.summary).toMatch(/^0 file\(s\) updated/);
  }, 60_000);

  it('a fake-PayPal run is never published as sandbox evidence', async () => {
    const repo = shadowRepo();
    const out = tmp();
    seed(out, 'fake');
    const before = readFileSync(join(repo, 'README.md'), 'utf8');
    await runGolive({ repo, out, steps: [finalizeDocs], processEnv: {}, run: fakeRunner().run, fetch: ok200, quiet: true });
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe(before);
    expect(existsSync(join(repo, 'docs/SANDBOX_EVIDENCE.md'))).toBe(false);
  }, 60_000);
});

describe('pnpm golive --dry-run', () => {
  const noNetwork = (async (u: string | URL | Request) => {
    throw new Error(`dry run made a network call to ${String(u)}`);
  }) as typeof fetch;

  it('works with zero keys: nothing fails, nothing is called, nothing in the repo changes', async () => {
    const out = tmp();
    const { run, calls } = fakeRunner();
    const report = await runGolive({ repo: REPO, out, steps: STEPS, processEnv: { PATH: process.env.PATH }, dryRun: true, run, fetch: noNetwork, quiet: true });
    expect(report.stoppedAt).toBeUndefined();
    expect(report.results.map((r) => r.result.status)).toEqual(['ok', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'ok']);
    expect(calls.map((c) => c.cmd)).toEqual(['ffmpeg']);
    expect(existsSync(join(out, 'SUMMARY.dry-run.md'))).toBe(true);
    expect(existsSync(join(out, 'golive.env'))).toBe(false);
  });

  it('with every key set it still makes no call and prints each step\'s plan', async () => {
    const out = tmp();
    const { run, calls } = fakeRunner();
    const env = {
      PAYPAL_CLIENT_ID: `A${'m'.repeat(60)}`, PAYPAL_CLIENT_SECRET: `E${'m'.repeat(60)}`, PAYPAL_PAYOUTS_CLIENT_ID: `A${'p'.repeat(60)}`, PAYPAL_PAYOUTS_CLIENT_SECRET: `E${'p'.repeat(60)}`,
      OPENAI_API_KEY: `sk-${'o'.repeat(30)}`, RENDER_API_KEY: 'rnd_abcdefghijklmnopqrstu', SANDBOX_PERSONAL_EMAIL: 'sb-p@personal.example.com', HOSTED_URL: 'nl.onrender.com',
    };
    const report = await runGolive({ repo: REPO, out, steps: STEPS, processEnv: env, dryRun: true, run, fetch: noNetwork, quiet: true });
    expect(report.results.map((r) => `${r.step}:${r.result.status}`)).toEqual(['preflight:ok', 'sandbox-setup:ok', 'sandbox-spike:ok', 'live-ai:ok', 'deploy-render:ok', 'video-vo:ok', 'finalize-docs:ok']);
    expect(calls.map((c) => c.cmd)).toEqual(['ffmpeg']);
    const log = readFileSync(join(out, 'golive.log'), 'utf8');
    expect(log).toContain('would create golive_');
    expect(log).toContain('would register webhooks for https://nl.onrender.com/api/webhooks/paypal');
    expect(log).toContain('--mode live --provider openai');
    expect(log).not.toContain(env.PAYPAL_PAYOUTS_CLIENT_SECRET);
  });
});
