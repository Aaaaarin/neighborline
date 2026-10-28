/** Pure pieces: env loading and masking, the CLI, step selection, doc edits, the link checker. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkKeys, hostedParts, loadEnv, mask, parseDotenv, paypalTarget, redactSecrets } from './lib/env.js';
import { STAND_IN_ROW, devpostSandboxEdits, paypalDocEdit, readmeEdits, replaceRow, replaceToken } from './lib/docs.js';
import { anchorsOf, checkLinks, slugify } from './lib/links.js';
import { selectSteps } from './lib/orchestrate.js';
import { observedBlock, spliceObserved } from './lib/spike/observed.js';
import { planBatches } from './lib/spike/payouts.js';
import { batchLinkPaths } from './lib/spike/probes.js';
import { parseCli } from './main.js';
import { STEPS } from './steps/index.js';
import { tmp } from './test-helpers.js';

describe('env', () => {
  it('parses .env like scripts/dev.mjs and layers process > .env > golive.env, reporting conflicts', () => {
    expect(parseDotenv('A=1 # c\nB="x # y"\nexport C=3\nD=\n#E=5')).toEqual({ A: '1', B: 'x # y', C: '3' });
    const repo = tmp();
    const out = join(repo, 'golive-out');
    mkdirSync(out);
    writeFileSync(join(repo, '.env'), 'PAYPAL_WEBHOOK_ID=MINE\nX=dot\n');
    writeFileSync(join(out, 'golive.env'), 'PAYPAL_WEBHOOK_ID=GEN\nPAYPAL_PLAN_ID_10=P-1\n');
    const l = loadEnv(repo, out, { X: 'proc' });
    expect(l.env).toMatchObject({ PAYPAL_WEBHOOK_ID: 'MINE', PAYPAL_PLAN_ID_10: 'P-1', X: 'proc' });
    expect(l.conflicts).toEqual([{ key: 'PAYPAL_WEBHOOK_ID', generated: 'GEN', used: 'MINE' }]);
  });

  it('masks secrets and checks formats', () => {
    const secret = `E${'s'.repeat(70)}`;
    expect(mask(secret)).toBe('Esss…ss (71 chars)');
    expect(redactSecrets(`token ${secret} end`, { PAYPAL_CLIENT_SECRET: secret })).toBe('token Esss…ss (71 chars) end');
    const r = Object.fromEntries(checkKeys({ OPENAI_API_KEY: 'nope', RENDER_API_KEY: 'rnd_abcdefghijklmnopqrst', SANDBOX_PERSONAL_EMAIL: 'me@gmail.com' }).map((k) => [k.key, k]));
    expect(r.OPENAI_API_KEY!.error).toMatch(/sk-/);
    expect(r.RENDER_API_KEY!.error).toBeNull();
    expect(r.SANDBOX_PERSONAL_EMAIL!.warning).toMatch(/SANDBOX/);
    expect(r.OPENAI_API_KEY!.shown).not.toContain('nope');
  });

  it('never targets live PayPal; normalizes the hosted URL', () => {
    expect(paypalTarget({})).toBe('sandbox');
    expect(paypalTarget({ PAYPAL_BASE_URL: 'http://127.0.0.1:4010' })).toBe('fake');
    expect(() => paypalTarget({ PAYPAL_BASE_URL: 'https://api-m.paypal.com' })).toThrow(/live/);
    expect(hostedParts('neighborline.onrender.com')).toEqual({ host: 'neighborline.onrender.com', origin: 'https://neighborline.onrender.com' });
    expect(hostedParts('https://nl-x.onrender.com/')).toEqual({ host: 'nl-x.onrender.com', origin: 'https://nl-x.onrender.com' });
  });
});

describe('cli and steps', () => {
  it('parses flags', () => {
    expect(parseCli(['--only', 'sandbox-spike,finalize-docs', '--dry-run', '--force'])).toMatchObject({ only: ['sandbox-spike', 'finalize-docs'], dryRun: true, force: true });
    expect(parseCli(['--skip=video-vo'])).toMatchObject({ skip: ['video-vo'] });
    expect(() => parseCli(['--only'])).toThrow(/comma-separated/);
    expect(() => parseCli(['--bogus'])).toThrow(/unknown/);
  });
  it('runs in the documented order, preflight always first', () => {
    expect(STEPS.map((s) => s.name)).toEqual(['preflight', 'sandbox-setup', 'sandbox-spike', 'live-ai', 'deploy-render', 'video-vo', 'finalize-docs']);
    expect(selectSteps(STEPS, ['finalize-docs']).map((s) => s.name)).toEqual(['preflight', 'finalize-docs']);
    expect(selectSteps(STEPS, undefined, ['video-vo', 'live-ai']).map((s) => s.name)).not.toContain('video-vo');
    expect(() => selectSteps(STEPS, ['deploy'])).toThrow(/unknown step/);
  });
});

describe('spike planning', () => {
  it('derives every sender_batch_id from the run id; batch A is PayPal-only, Venmo is probed in batch B', () => {
    const [a, b] = planBatches({ SANDBOX_PERSONAL_EMAIL: 'sb-x@personal.example.com', SANDBOX_VENMO_HANDLE: '@lan-test' }, 'r1');
    expect(a!.input.senderBatchId).toBe('golive_r1_a');
    expect(a!.input.items.map((i) => `${i.wallet}:${i.recipientType}:${i.receiver}`)).toEqual(['PAYPAL:EMAIL:sb-x@personal.example.com', 'PAYPAL:EMAIL:neighborline-unclaimed-r1@example.com']);
    expect(b!.input.senderBatchId).toBe('golive_r1_b');
    expect(b!.input.items.map((i) => `${i.wallet}:${i.recipientType}:${i.receiver}`)).toEqual(['VENMO:USER_HANDLE:lan-test', 'VENMO:USER_HANDLE:@lan-test', 'VENMO:EMAIL:sb-x@personal.example.com']);
    expect(b!.input.items.every((i) => i.note && i.socialFeedPrivacy === 'PRIVATE')).toBe(true);
  });
  it('finds where the duplicate error keeps its batch link', () => {
    expect(batchLinkPaths({ details: [{ link: [{ href: 'https://api.sandbox.paypal.com/v1/payments/payouts/ABC' }] }], links: [{ href: 'https://x/v1/payments/payouts/DEF' }] })).toEqual(['details[0].link[0].href', 'links[0].href']);
  });
  it('splices the observed block into PAYPAL_NOTES after "To verify", replacing it on re-runs', () => {
    const notes = '# N\n## To verify in the real sandbox (Oct 21–24)\n1. x\n\n## Pages we could not fetch\n- y\n';
    const block = observedBlock({ runId: 'r', target: 'sandbox', base: 'b', startedAt: '2026-11-10T10:00:00Z', parts: {} });
    const once = spliceObserved(notes, block);
    expect(once.indexOf('golive:observed:start')).toBeGreaterThan(once.indexOf('1. x'));
    expect(once.indexOf('golive:observed:start')).toBeLessThan(once.indexOf('## Pages'));
    expect(spliceObserved(once, block)).toBe(once);
  });
});

describe('doc edits', () => {
  it('replaces tokens except where the docs talk about the token itself', () => {
    const src = 'Open https://{HOSTED_URL}/demo\n| `{HOSTED_URL}` | the host |\n`https://{HOSTED_URL}/x`\n- [ ] `grep -rn "{HOSTED_URL}" docs`';
    const r = replaceToken(src, 'HOSTED_URL', 'nl.onrender.com');
    expect(r.count).toBe(2);
    expect(r.text).toBe('Open https://nl.onrender.com/demo\n| `{HOSTED_URL}` | the host |\n`https://nl.onrender.com/x`\n- [ ] `grep -rn "{HOSTED_URL}" docs`');
    expect(replaceToken(r.text, 'HOSTED_URL', 'nl.onrender.com').count).toBe(0);
  });

  const readme = [
    '**Hosted:** not deployed yet (the Render Blueprint is ready in [`render.yaml`](render.yaml)). Until then, run it',
    'locally with no credentials:',
    '',
    '| | Status |',
    '|---|---|',
    '| Real PayPal sandbox | Supported by `PAYPAL_MODE=sandbox` but **not run yet** |',
    '| Venmo payouts in sandbox | **Unverified.** |',
    '| Speech, translation, read-back | Fixture mode replays prepared transcripts. |',
    '| Hosting | Not deployed yet. |',
  ].join('\n');
  const sandbox = { date: '2026-11-10', batchId: 'BATCH1', paypalSuccess: true, venmoStatuses: ['SUCCESS'], unclaimed: true, verifiedEventId: 'WH-1', duplicateOk: true, captureId: 'CAP1', reconciled: 4 };

  it('README: hosted line and the Sandbox reality rows, idempotently; nothing about the sandbox without a sandbox run', () => {
    const only = readmeEdits(readme, { host: 'nl.onrender.com' });
    expect(only.text).toContain('**Hosted:** <https://nl.onrender.com/demo>');
    expect(only.text).toContain('| Real PayPal sandbox | Supported by `PAYPAL_MODE=sandbox` but **not run yet** |');
    const all = readmeEdits(readme, { host: 'nl.onrender.com', sandbox, liveAi: { date: '2026-11-10', intakesOk: 3, intakes: 3, evalProviders: ['openai'] } });
    expect(all.edits.every((e) => e.applied)).toBe(true);
    expect(all.text).toContain('**Run on 2026-11-10**');
    expect(all.text).toContain('webhook `WH-1` verified');
    expect(all.text).toContain('| Venmo payouts in sandbox | Observed on 2026-11-10: SUCCESS');
    // What the real sandbox did on 2026-10-28: every Venmo batch refused, the POSPYO003 mock accepted.
    const refused = readmeEdits(readme, { sandbox: { ...sandbox, venmoStatuses: [], venmoRefused: true, venmoMockAccepted: true } }).text;
    expect(refused).toContain('| Venmo payouts in sandbox | **The real sandbox refuses Venmo** (2026-11-10)');
    expect(refused).toContain('"Recipient wallet not supported in sandbox."; PayPal\'s documented mock note `POSPYO003` is accepted (201 `PENDING`)');
    expect(refused).toContain('standing in for the Venmo handle, labelled');
    expect(all.text).toContain('3/3 voice notes');
    expect(readmeEdits(all.text, { host: 'nl.onrender.com', sandbox, liveAi: { date: '2026-11-10', intakesOk: 3, intakes: 3, evalProviders: [] } }).text).toBe(all.text);
    expect(replaceRow('| A | b |', 'Z', '| Z | c |').applied).toBe(false);
    // Hosted sandbox run with a stand-in → the /demo stand-in row says what happened; without one it stays.
    const hostedRun = { url: 'https://nl.onrender.com', scenario: 'lan', paypalMode: 'sandbox', paypalBatchId: 'HB9', itemStatus: 'SUCCESS', standIn: 'sb-de…@personal.example.com', webhookVerified: { eventType: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', eventId: 'WH-9', at: 'x' } };
    const withRow = `${all.text}\n| ${STAND_IN_ROW} | to be run |`;
    const si = readmeEdits(withRow, { sandbox, hosted: hostedRun });
    expect(si.text).toMatch(/\| Scripted `\/demo` payouts in sandbox \| \*\*Run on the hosted app\*\* \(2026-11-10\): Mrs\. Lan's payout, batch `HB9`, reached \*\*SUCCESS\*\*.*`WH-9`/);
    expect(readmeEdits(withRow, { sandbox, hosted: { ...hostedRun, standIn: undefined } }).text).toContain('| to be run |');
  });

  it('DEVPOST (sandbox) sentences, re-wrapped across lines, and PAYPAL.md', () => {
    const fields = 'x\n(sandbox) Every call is exercised end to end against tools/fake-paypal, our look-alike of PayPal\'s documented shapes; the run against PayPal\'s real sandbox is waiting on sandbox credentials, and the demo labels simulated PayPal ids "Sandbox: simulated".\n```';
    const f = devpostSandboxEdits('DEVPOST_FIELDS.md', fields, sandbox);
    expect(f.applied).toBe(true);
    expect(f.text).toContain("Verified against PayPal's sandbox on 2026-11-10: batch `BATCH1`, webhook `WH-1` verified by PayPal's postback API");
    expect(devpostSandboxEdits('DEVPOST_FIELDS.md', f.text, sandbox)).toEqual({ text: f.text, applied: true });
    expect(f.text).toContain("Rosa's claim is still simulated");
    // The hosted /demo paid a sandbox stand-in: say what really happened instead.
    const hosted = { url: 'https://nl.onrender.com', scenario: 'lan', paypalMode: 'sandbox', paypalBatchId: 'HB9', itemStatus: 'SUCCESS', standIn: 'sb-de…@personal.example.com' };
    const h = devpostSandboxEdits('DEVPOST_FIELDS.md', fields, sandbox, hosted);
    expect(h.text).toContain("Mrs. Lan's payout (batch `HB9`) settles in a PayPal sandbox account standing in for her Venmo");
    expect(h.text).not.toContain('still simulated');
    const long = "documented shapes; the run against PayPal's real\nsandbox is waiting on sandbox credentials *(sandbox)*. The demo's";
    expect(devpostSandboxEdits('DEVPOST.md', long, sandbox).text).toContain('recorded in [SANDBOX_EVIDENCE.md](../SANDBOX_EVIDENCE.md)');
    expect(devpostSandboxEdits('DEVPOST.md', 'reworded', sandbox).applied).toBe(false);
    const p = paypalDocEdit('## To verify in the real sandbox\n\n1. a\n', '2026-11-10');
    expect(p.text).toContain('**Answered by the sandbox run of 2026-11-10:**');
    expect(paypalDocEdit(p.text, '2026-11-11').text.match(/Answered/g)).toHaveLength(1);
  });
});

describe('links', () => {
  it('slugs like GitHub and finds broken files and anchors, ignoring code', () => {
    expect(slugify('What the AI does, and never does')).toBe('what-the-ai-does-and-never-does');
    expect(slugify('The MCP server: Payouts for agents (with two humans in the loop)')).toBe('the-mcp-server-payouts-for-agents-with-two-humans-in-the-loop');
    expect([...anchorsOf('# A\n## A\n```\n# not\n```\n')]).toEqual(['a', 'a-1']);
    const repo = tmp();
    mkdirSync(join(repo, 'docs'));
    writeFileSync(join(repo, 'docs/B.md'), '# Real heading\n');
    writeFileSync(join(repo, 'README.md'), '[ok](docs/B.md#real-heading) [bad](docs/B.md#nope) [gone](docs/C.md) [web](https://x.y) `[code](no.md)` [up](../../issues)\n');
    expect(checkLinks(repo, ['README.md', 'docs/B.md']).map((b) => `${b.target}:${b.reason}`)).toEqual(['docs/B.md#nope:no heading for #nope', 'docs/C.md:no such file']);
  });
});
