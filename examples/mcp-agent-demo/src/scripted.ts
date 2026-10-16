/**
 * `--scripted`: a deterministic agent (no LLM, no keys) that walks the four beats. Every tool call is real: it goes
 * over stdio to `neighborline-payouts-mcp`, which talks to (fake) PayPal.
 */
import { DemoApprovalService } from './approval-service.js';
import { describeBatch, lanBatch, toBatchInput, USER_REQUEST, usd, type McpBatchArgs } from './batch.js';
import type { Stack } from './stack.js';
import type { Transcript } from './transcript.js';

export interface ScriptedOptions {
  senderBatchId: string;
  /** Also show the agent editing the approved amount, and being refused. */
  tamper?: boolean;
  /** Give up polling for SUCCESS after this long. */
  pollTimeoutMs?: number;
}

export interface ScriptedOutcome {
  refusedWithoutToken: string;
  refusedTampered?: string;
  batchId: string;
  finalStatus: string;
  itemStatus: string;
  reconcileOk: boolean;
  approvers: string[];
}

const firstLine = (s: string) => s.split('\n')[0] ?? s;

export async function runScripted(stack: Stack, approvals: DemoApprovalService, t: Transcript, opts: ScriptedOptions): Promise<ScriptedOutcome> {
  const batch: McpBatchArgs = lanBatch(opts.senderBatchId);
  const what = describeBatch(batch);

  // 1. No token: refused, with a reason the agent can relay.
  await t.emit({ kind: 'step', n: 1, title: 'The agent tries to pay on its own' });
  await t.emit({ kind: 'user', text: USER_REQUEST });
  await t.emit({ kind: 'call', tool: 'create_payout_batch', summary: `${what} · no approval_token`, args: batch });
  const refused = await stack.call('create_payout_batch', { ...batch });
  if (!refused.isError) throw new Error('expected the server to refuse a payout without an approval token');
  await t.emit({ kind: 'result', tool: 'create_payout_batch', ok: false, summary: firstLine(refused.text), text: refused.text });
  await t.emit({ kind: 'agent', text: "I can't send money on my own. Asking two organizers to approve this exact payout." });

  // 2. Two organizers approve the exact batch; only then does the approval service mint a token.
  await t.emit({ kind: 'step', n: 2, title: 'Two organizers sign' });
  const req = approvals.request(toBatchInput(batch));
  const first = approvals.approve(req.approvalId, 'org_ana');
  await t.emit({ kind: 'human', who: 'Ana (organizer)', text: `approved ${what} · ${first.approvals} of ${first.needed}` });
  const second = approvals.approve(req.approvalId, 'org_ben');
  await t.emit({ kind: 'human', who: 'Ben (organizer)', text: `approved ${what} · ${second.approvals} of ${second.needed}` });
  const token = second.token;
  if (!token) throw new Error('approval service did not mint a token after two approvals');
  const payload = DemoApprovalService.describe(token)!;
  const mins = Math.round((payload.exp - payload.iat) / 60);
  await t.emit({ kind: 'token', token, summary: `HMAC-signed for this batch only (digest ${payload.digest.slice(0, 10)}…) · ${payload.approvers.join(' + ')} · expires in ${mins} min` });

  let refusedTampered: string | undefined;
  if (opts.tamper) {
    await t.emit({ kind: 'step', n: 3, title: 'The agent edits the amount' });
    const edited = { ...batch, items: [{ ...batch.items[0]!, amount_cents: batch.items[0]!.amount_cents * 10 }] };
    await t.emit({ kind: 'call', tool: 'create_payout_batch', summary: `${describeBatch(edited)} · approval_token`, args: { ...edited, approval_token: token } });
    const r = await stack.call('create_payout_batch', { ...edited, approval_token: token });
    if (!r.isError) throw new Error('expected the server to refuse an edited batch');
    refusedTampered = r.text;
    await t.emit({ kind: 'result', tool: 'create_payout_batch', ok: false, summary: firstLine(r.text), text: r.text });
  }

  // 3. Same batch + token: paid.
  await t.emit({ kind: 'step', n: opts.tamper ? 4 : 3, title: 'The agent retries with the token' });
  await t.emit({ kind: 'call', tool: 'create_payout_batch', summary: `${what} · approval_token ✓`, args: { ...batch, approval_token: token } });
  const created = await stack.call('create_payout_batch', { ...batch, approval_token: token });
  if (created.isError) throw new Error(`payout refused unexpectedly: ${created.text}`);
  const batchId: string = created.data.batchId;
  await t.emit({ kind: 'result', tool: 'create_payout_batch', ok: true, summary: `batch ${batchId} · ${created.data.status} · approval ${created.data.approvalId}`, text: created.text });

  await t.emit({ kind: 'call', tool: 'get_payout_batch', summary: batchId, args: { payout_batch_id: batchId } });
  const started = Date.now();
  let status = await stack.call('get_payout_batch', { payout_batch_id: batchId });
  const settled = (r: typeof status) => !r.isError && r.data?.items?.every((i: { status: string }) => i.status !== 'PENDING') && r.data.status !== 'PENDING' && r.data.status !== 'PROCESSING';
  while (!settled(status) && Date.now() - started < (opts.pollTimeoutMs ?? 20_000)) {
    await new Promise((r) => setTimeout(r, 250));
    status = await stack.call('get_payout_batch', { payout_batch_id: batchId });
  }
  if (status.isError) throw new Error(`get_payout_batch failed: ${status.text}`);
  const item = status.data.items[0];
  await t.emit({
    kind: 'result',
    tool: 'get_payout_batch',
    ok: item.status === 'SUCCESS',
    summary: `batch ${status.data.status} · ${item.receiver} ${usd(item.amountCents)} ${item.wallet}: ${item.status}${item.transactionId ? ` · txn ${item.transactionId}` : ''}`,
    text: status.text,
  });

  // 4. Reconcile our ledger (here: the one item) against PayPal Transaction Search.
  await t.emit({ kind: 'step', n: opts.tamper ? 5 : 4, title: 'Reconcile against PayPal' });
  const now = Date.now();
  const recArgs = {
    start_date: new Date(now - 3_600_000).toISOString(),
    end_date: new Date(now + 60_000).toISOString(),
    local_items: status.data.items.map((i: { senderItemId: string; transactionId?: string; amountCents: number; status: string }) => ({
      id: i.senderItemId,
      ...(i.transactionId ? { transaction_id: i.transactionId } : {}),
      amount_cents: i.amountCents,
      status: i.status,
    })),
  };
  await t.emit({ kind: 'call', tool: 'reconcile_payouts', summary: `${recArgs.local_items.length} ledger item vs Transaction Search`, args: recArgs });
  const rec = await stack.call('reconcile_payouts', recArgs);
  if (rec.isError) throw new Error(`reconcile_payouts failed: ${rec.text}`);
  const r = rec.data;
  await t.emit({
    kind: 'result',
    tool: 'reconcile_payouts',
    ok: r.ok,
    summary: `${r.ok ? 'ok' : 'NOT ok'} · ${r.matched.length} matched · ${r.amountMismatch.length} mismatched · ${r.missingAtPayPal.length} missing · ${r.pendingLag.length} within PayPal's reporting lag`,
    text: rec.text,
  });

  await t.emit({ kind: 'done', text: `${what} paid with two humans' signatures. ${opts.tamper ? '2 refusals' : '1 refusal'}, 1 payout, reconciled.` });
  return {
    refusedWithoutToken: refused.text,
    ...(refusedTampered ? { refusedTampered } : {}),
    batchId,
    finalStatus: status.data.status,
    itemStatus: item.status,
    reconcileOk: r.ok,
    approvers: payload.approvers,
  };
}
