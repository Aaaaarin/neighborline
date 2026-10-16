import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startFake, type FakeHarness } from '../../test/fake.js';
import { createHmacApprovalVerifier, signApprovalToken, type ApprovalVerifier } from '../approval.js';
import { createPayoutsMcpServer, type AuditEntry } from './server.js';

const SECRET = 'test-approval-secret-at-least-32-chars!!';
let h: FakeHarness;
beforeAll(async () => {
  h = await startFake();
});
afterEach(() => h.fake.reset());
afterAll(() => h.close());

async function connect(approvalVerifier?: ApprovalVerifier) {
  const audit: AuditEntry[] = [];
  const server = createPayoutsMcpServer({ paypal: h.paypal, ...(approvalVerifier ? { approvalVerifier } : {}), onAudit: (e) => audit.push(e) });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }>; structuredContent?: any };
    return { isError: Boolean(r.isError), text: r.content[0]?.text ?? '', data: r.structuredContent };
  };
  return { client, call, audit };
}

const batchArgs = {
  sender_batch_id: 'nl_mcp_1',
  items: [
    { sender_item_id: 'req_lan', amount_cents: 15000, receiver: '@lan-nguyen', recipient_type: 'USER_HANDLE', wallet: 'VENMO', note: 'Đã gửi $150' },
    { sender_item_id: 'req_rosa', amount_cents: 12000, receiver: 'rosa@example.com', recipient_type: 'EMAIL', purpose: 'NON_GOODS_OR_SERVICES' },
  ],
};
const asBatch = (a = batchArgs) => ({
  senderBatchId: a.sender_batch_id,
  items: a.items.map((i) => ({ senderItemId: i.sender_item_id, amountCents: i.amount_cents, receiver: i.receiver, recipientType: i.recipient_type as 'EMAIL' | 'USER_HANDLE', wallet: (i.wallet ?? 'PAYPAL') as 'PAYPAL' | 'VENMO' })),
});
const token = (approvers = ['org_ana', 'org_ben'], batch = asBatch(), ttlSec = 600) => signApprovalToken(SECRET, { approvalId: 'appr_1', batch, approvers, ttlSec });

describe('neighborline-payouts MCP server', () => {
  it('exposes the payouts tools with input schemas', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['cancel_unclaimed_payout_item', 'create_payout_batch', 'get_payout_batch', 'get_payout_item', 'reconcile_payouts', 'search_transactions']);
    const create = tools.find((t) => t.name === 'create_payout_batch')!;
    expect(create.inputSchema.required).toContain('approval_token');
    expect(create.annotations?.destructiveHint).toBe(true);
  });

  it('refuses to move money by default, even with a "token"', async () => {
    const { call, audit } = await connect();
    const r = await call('create_payout_batch', { ...batchArgs, approval_token: token() });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Refused/);
    expect(h.fake.state.batches.size).toBe(0);
    expect(audit.at(-1)).toMatchObject({ tool: 'create_payout_batch', outcome: 'refused' });
  });

  it('executes exactly the batch two humans approved', async () => {
    const { call, audit } = await connect(createHmacApprovalVerifier(SECRET));
    const r = await call('create_payout_batch', { ...batchArgs, approval_token: token() });
    expect(r.isError).toBe(false);
    expect(r.data).toMatchObject({ status: 'PENDING', duplicate: false, approvalId: 'appr_1' });
    expect(audit.at(-1)).toMatchObject({ outcome: 'ok', approvalId: 'appr_1', senderBatchId: 'nl_mcp_1' });
    const again = await call('create_payout_batch', { ...batchArgs, approval_token: token() });
    expect(again.data.batchId).toBe(r.data.batchId);
    expect(h.fake.state.batches.size).toBe(1);
  });

  it.each([
    ['an agent-edited amount', () => ({ ...batchArgs, items: [{ ...batchArgs.items[0]!, amount_cents: 99_900 }, batchArgs.items[1]!], approval_token: token() }), /differ from what was approved/],
    ['a swapped receiver', () => ({ ...batchArgs, items: [{ ...batchArgs.items[0]!, receiver: '@eastside-mutuaiaid' }, batchArgs.items[1]!], approval_token: token() }), /differ/],
    ['a single approver', () => ({ ...batchArgs, approval_token: token(['org_ana', 'ORG_ANA ']) }), /2 distinct human approvers/],
    ['an expired token', () => ({ ...batchArgs, approval_token: token(undefined, undefined, -1) }), /expired/],
    ['a forged signature', () => ({ ...batchArgs, approval_token: token().slice(0, -4) + 'AAAA' }), /signature invalid/],
  ])('refuses %s', async (_n, args, msg) => {
    const { call } = await connect(createHmacApprovalVerifier(SECRET));
    const r = await call('create_payout_batch', args());
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(msg);
    expect(h.fake.state.batches.size).toBe(0);
  });

  it('read tools work and PayPal errors come back as tool errors with debug_id', async () => {
    const { call } = await connect(createHmacApprovalVerifier(SECRET));
    const created = await call('create_payout_batch', { ...batchArgs, approval_token: token() });
    await h.control(`/__fake/batches/${created.data.batchId}/process`);
    const batch = await call('get_payout_batch', { payout_batch_id: created.data.batchId });
    expect(batch.data.items.map((i: any) => i.status)).toEqual(['SUCCESS', 'SUCCESS']);
    expect(batch.data.items[0]).not.toHaveProperty('raw');
    const item = await call('get_payout_item', { payout_item_id: batch.data.items[1].payoutItemId });
    expect(item.data.amountCents).toBe(12000);
    const cancel = await call('cancel_unclaimed_payout_item', { payout_item_id: batch.data.items[1].payoutItemId, reason: 'wrong email' });
    expect(cancel.isError).toBe(true);
    expect(cancel.text).toMatch(/ITEM_INCORRECT_STATUS.*debug_id/);
    const now = Date.now();
    const rec = await call('reconcile_payouts', {
      start_date: new Date(now - 86_400_000).toISOString(),
      end_date: new Date(now + 60_000).toISOString(),
      local_items: batch.data.items.map((i: any) => ({ id: i.senderItemId, transaction_id: i.transactionId, amount_cents: i.amountCents, status: i.status })),
    });
    expect(rec.data).toMatchObject({ ok: true, matched: [{ id: 'req_lan' }, { id: 'req_rosa' }] });
  });
});
