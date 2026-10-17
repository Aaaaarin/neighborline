/**
 * `--llm`: a real model drives the same MCP tools in a plain tool-calling loop (Anthropic Messages API or OpenAI
 * Chat Completions). The model also gets one local tool, `request_human_approval`, which hands the batch to the
 * demo approval service; it returns a token only after two organizers approve. The model never sees the secret.
 */
import { createInterface } from 'node:readline/promises';
import { DemoApprovalService } from './approval-service.js';
import { describeBatch, toBatchInput, USER_REQUEST, type McpBatchArgs } from './batch.js';
import type { Stack } from './stack.js';
import type { Transcript } from './transcript.js';

export type Provider = 'anthropic' | 'openai';

/** A configuration problem worth one line, not a stack trace. */
export class UsageError extends Error {
  override name = 'UsageError';
}

export interface LlmOptions {
  provider: Provider;
  model?: string;
  senderBatchId: string;
  /** `auto`: Dana and Marcus approve automatically. `prompt`: ask on the terminal for each organizer. */
  approve: 'auto' | 'prompt';
  maxTurns?: number;
  /** Inject a client (tests). Default: a real SDK client built from ANTHROPIC_API_KEY / OPENAI_API_KEY. */
  client?: unknown;
}

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const APPROVAL_TOOL: ToolSpec = {
  name: 'request_human_approval',
  description:
    'Ask the group\'s organizers to approve a payout batch. Two different organizers must approve the exact batch. Returns an approval_token to pass to create_payout_batch together with the IDENTICAL batch (same sender_batch_id, items, amounts, receivers), or approved:false.',
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'One sentence for the organizers: who is paid and why' },
      sender_batch_id: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sender_item_id: { type: 'string' },
            amount_cents: { type: 'integer' },
            currency: { type: 'string' },
            receiver: { type: 'string' },
            recipient_type: { type: 'string', enum: ['EMAIL', 'PHONE', 'USER_HANDLE', 'PAYPAL_ID'] },
            wallet: { type: 'string', enum: ['PAYPAL', 'VENMO'] },
            note: { type: 'string' },
            purpose: { type: 'string' },
          },
          required: ['sender_item_id', 'amount_cents', 'receiver', 'recipient_type'],
        },
      },
    },
    required: ['reason', 'sender_batch_id', 'items'],
  },
};

function systemPrompt(senderBatchId: string): string {
  return [
    'You are the payouts assistant of a neighborhood mutual-aid group. You can send money only through the tools.',
    'Amounts are integer cents (USD). Venmo items need wallet VENMO, recipient_type USER_HANDLE for @handles, a note, and purpose NON_GOODS_OR_SERVICES.',
    `Use sender_batch_id "${senderBatchId}" and sender_item_id "req_lan_heat". Note for Mrs. Lan: "Đã gửi $150 từ hàng xóm".`,
    'Try create_payout_batch first. If it is refused for lack of an approval token, call request_human_approval with the identical batch,',
    'then call create_payout_batch again with the same batch and the approval_token. Never invent or alter a token, and never change the batch after approval.',
    'After the batch is created, call get_payout_batch until items are no longer PENDING, then reconcile_payouts for the last hour with the item(s) as local_items.',
    'Finish with one short sentence for the user.',
  ].join(' ');
}

export async function runLlm(stack: Stack, approvals: DemoApprovalService, t: Transcript, opts: LlmOptions): Promise<void> {
  const { tools: mcpTools } = await stack.client.listTools();
  const specs: ToolSpec[] = [...mcpTools.map((x) => ({ name: x.name, description: x.description ?? '', inputSchema: x.inputSchema as Record<string, unknown> })), APPROVAL_TOOL];

  const exec = async (name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> => {
    if (name === APPROVAL_TOOL.name) return requestApproval(approvals, t, args as unknown as McpBatchArgs & { reason?: string }, opts.approve);
    const summary =
      name === 'create_payout_batch' ? `${describeBatch(args as unknown as McpBatchArgs)} · ${args.approval_token ? 'approval_token' : 'no approval_token'}` : String(args.payout_batch_id ?? args.payout_item_id ?? '');
    await t.emit({ kind: 'call', tool: name, summary, args });
    const r = await stack.call(name, args);
    await t.emit({ kind: 'result', tool: name, ok: !r.isError, summary: r.text.split('\n')[0]!.slice(0, 160), text: r.text });
    return { text: r.text, isError: r.isError };
  };

  await t.emit({ kind: 'user', text: USER_REQUEST });
  if (opts.provider === 'anthropic') await anthropicLoop(specs, exec, t, opts);
  else await openaiLoop(specs, exec, t, opts);
}

async function requestApproval(approvals: DemoApprovalService, t: Transcript, args: McpBatchArgs & { reason?: string }, mode: 'auto' | 'prompt') {
  const what = describeBatch(args);
  await t.emit({ kind: 'call', tool: 'request_human_approval', summary: `${what}${args.reason ? ` · "${args.reason}"` : ''}`, args });
  const req = approvals.request(toBatchInput(args));
  let token: string | null = null;
  for (const [id, who] of [['org_dana', 'Dana (organizer)'], ['org_marcus', 'Marcus (organizer)']] as const) {
    let ok = true;
    if (mode === 'prompt') {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      ok = /^y/i.test(await rl.question(`  ${who}: approve ${what}? [y/N] `));
      rl.close();
    }
    if (!ok) {
      await t.emit({ kind: 'human', who, text: `declined ${what}` });
      return { text: JSON.stringify({ approved: false, reason: `${who} declined` }), isError: false };
    }
    const r = approvals.approve(req.approvalId, id);
    await t.emit({ kind: 'human', who, text: `approved ${what} · ${r.approvals} of ${r.needed}` });
    token = r.token;
  }
  if (!token) return { text: JSON.stringify({ approved: false, reason: 'not enough approvals' }), isError: false };
  const p = DemoApprovalService.describe(token)!;
  await t.emit({ kind: 'token', token, summary: `HMAC-signed for this batch only (digest ${p.digest.slice(0, 10)}…) · ${p.approvers.join(' + ')}` });
  return { text: JSON.stringify({ approved: true, approval_token: token, approvers: p.approvers, expires_at: new Date(p.exp * 1000).toISOString() }), isError: false };
}

type Exec = (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;

async function anthropicLoop(specs: ToolSpec[], exec: Exec, t: Transcript, opts: LlmOptions): Promise<void> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  if (!opts.client && !process.env.ANTHROPIC_API_KEY) throw new UsageError('--llm anthropic needs ANTHROPIC_API_KEY (or use --scripted)');
  const client = (opts.client as InstanceType<typeof Anthropic> | undefined) ?? new Anthropic({ maxRetries: 2, timeout: 60_000 });
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
  const tools = specs.map((s) => ({ name: s.name, description: s.description, input_schema: s.inputSchema as { type: 'object'; [k: string]: unknown } }));
  const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [{ role: 'user', content: USER_REQUEST }];
  for (let turn = 0; turn < (opts.maxTurns ?? 16); turn++) {
    const res = await client.messages.create({ model, max_tokens: 2048, system: systemPrompt(opts.senderBatchId), tools, messages });
    messages.push({ role: 'assistant', content: res.content });
    const results: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }> = [];
    for (const block of res.content) {
      if (block.type === 'text' && block.text.trim()) await t.emit({ kind: 'agent', text: block.text.trim() });
      if (block.type === 'tool_use') {
        const r = await exec(block.name, block.input as Record<string, unknown>);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: r.text, is_error: r.isError });
      }
    }
    if (res.stop_reason !== 'tool_use' || results.length === 0) return;
    messages.push({ role: 'user', content: results });
  }
  await t.emit({ kind: 'agent', text: `(stopped after ${opts.maxTurns ?? 16} turns)` });
}

async function openaiLoop(specs: ToolSpec[], exec: Exec, t: Transcript, opts: LlmOptions): Promise<void> {
  const { default: OpenAI } = await import('openai');
  if (!opts.client && !process.env.OPENAI_API_KEY) throw new UsageError('--llm openai needs OPENAI_API_KEY (or use --scripted)');
  const client = (opts.client as InstanceType<typeof OpenAI> | undefined) ?? new OpenAI({ maxRetries: 2, timeout: 60_000 });
  const model = opts.model ?? process.env.OPENAI_MODEL ?? 'gpt-5.4-mini';
  const tools = specs.map((s) => ({ type: 'function' as const, function: { name: s.name, description: s.description, parameters: s.inputSchema } }));
  const messages: any[] = [
    { role: 'system', content: systemPrompt(opts.senderBatchId) },
    { role: 'user', content: USER_REQUEST },
  ];
  for (let turn = 0; turn < (opts.maxTurns ?? 16); turn++) {
    const res = await client.chat.completions.create({ model, messages, tools });
    const msg = res.choices[0]?.message;
    if (!msg) return;
    messages.push(msg);
    if (msg.content?.trim()) await t.emit({ kind: 'agent', text: msg.content.trim() });
    const calls = (msg.tool_calls ?? []).filter((c): c is Extract<typeof c, { type: 'function' }> => c.type === 'function');
    if (calls.length === 0) return;
    for (const c of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        messages.push({ role: 'tool', tool_call_id: c.id, content: 'Error: arguments were not valid JSON' });
        continue;
      }
      const r = await exec(c.function.name, args);
      messages.push({ role: 'tool', tool_call_id: c.id, content: r.isError ? `Error: ${r.text}` : r.text });
    }
  }
  await t.emit({ kind: 'agent', text: `(stopped after ${opts.maxTurns ?? 16} turns)` });
}
