import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DemoApprovalService } from './approval-service.js';
import { lanBatch, toBatchInput } from './batch.js';
import { runScripted } from './scripted.js';
import { startStack, type Stack } from './stack.js';
import { formatEvent, Transcript } from './transcript.js';

const secret = randomBytes(32).toString('base64url');
let stack: Stack;
beforeAll(async () => {
  // The real thing: the MCP server as a stdio subprocess, talking to an in-process fake PayPal.
  stack = await startStack({ approvalSecret: secret, processingDelayMs: 200 });
}, 30_000);
afterAll(() => stack?.close());

const quiet = () => new Transcript({ cps: 0, pauseMs: 0, color: false, verbose: false, write: () => {} });

describe('scripted MCP agent demo', () => {
  it('refuses without a token, pays with two signatures, reaches SUCCESS and reconciles', async () => {
    const t = quiet();
    const out = await runScripted(stack, new DemoApprovalService(secret), t, { senderBatchId: 'nl_demo_test_1' });
    expect(out.refusedWithoutToken).toMatch(/^Refused: no approval_token/);
    expect(out).toMatchObject({ finalStatus: 'SUCCESS', itemStatus: 'SUCCESS', reconcileOk: true, approvers: ['org_dana', 'org_marcus'] });
    expect(stack.fake!.state.batches.size).toBe(1);
    // Same cast and handle as the main story (/demo, the video): Dana and Marcus approve Mrs. Lan's @lan-nguyen54.
    const humans = t.events.flatMap((e) => (e.kind === 'human' ? [e.who] : []));
    expect(humans).toEqual(['Dana (organizer)', 'Marcus (organizer)']);
    expect(lanBatch('x').items.map((i) => i.receiver)).toEqual(['@lan-nguyen54']);
    expect(t.events.some((e) => e.kind === 'user' && e.text.includes('@lan-nguyen54'))).toBe(true);
    const kinds = t.events.map((e) => (e.kind === 'call' || e.kind === 'result' ? `${e.kind}:${e.tool}` : e.kind));
    expect(kinds).toEqual([
      'step', 'user', 'call:create_payout_batch', 'result:create_payout_batch', 'agent',
      'step', 'human', 'human', 'token',
      'step', 'call:create_payout_batch', 'result:create_payout_batch', 'call:get_payout_batch', 'result:get_payout_batch',
      'step', 'call:reconcile_payouts', 'result:reconcile_payouts', 'done',
    ]);
    // The server audited the refusal and the payout (stderr of the subprocess).
    await new Promise((r) => setTimeout(r, 100));
    const audits = stack.serverLog.filter((l) => l.startsWith('[audit]')).map((l) => JSON.parse(l.slice(8)) as { tool: string; outcome: string });
    expect(audits.filter((a) => a.tool === 'create_payout_batch').map((a) => a.outcome)).toEqual(['refused', 'ok']);
  }, 30_000);

  it('--tamper: an agent-edited amount is refused even with a valid token', async () => {
    const out = await runScripted(stack, new DemoApprovalService(secret), quiet(), { senderBatchId: 'nl_demo_test_2', tamper: true });
    expect(out.refusedTampered).toMatch(/batch contents differ from what was approved/);
    expect(out.itemStatus).toBe('SUCCESS');
  }, 30_000);

  it('formats a plain transcript without ANSI codes', () => {
    const lines = formatEvent({ kind: 'result', tool: 'x', ok: false, summary: 'Refused: nope', text: '' }, false);
    expect(lines).toEqual(['mcp    ✗ Refused: nope']);
  });
});

describe('DemoApprovalService', () => {
  it('needs two different organizers before it mints a token', () => {
    const svc = new DemoApprovalService(secret);
    const req = svc.request(toBatchInput(lanBatch('nl_x')));
    expect(svc.approve(req.approvalId, 'org_dana')).toMatchObject({ token: null, approvals: 1 });
    expect(svc.approve(req.approvalId, ' ORG_DANA ')).toMatchObject({ token: null, approvals: 1 });
    const done = svc.approve(req.approvalId, 'org_marcus');
    expect(DemoApprovalService.describe(done.token!)).toMatchObject({ approvalId: req.approvalId, senderBatchId: 'nl_x', approvers: ['org_dana', 'org_marcus'] });
  });
});
