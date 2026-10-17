/**
 * The --llm loops, driven by scripted fake model clients (no keys, no network). Proves the wiring: MCP tools and
 * request_human_approval are offered, tool results flow back in each provider's format, and the same three-beat
 * story (refused → approval → paid) happens over the real stdio MCP server.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DemoApprovalService } from './approval-service.js';
import { lanBatch } from './batch.js';
import { runLlm } from './llm.js';
import { startStack, type Stack } from './stack.js';
import { Transcript } from './transcript.js';

const secret = randomBytes(32).toString('base64url');
let stack: Stack;
beforeAll(async () => {
  stack = await startStack({ approvalSecret: secret, processingDelayMs: 50 });
}, 30_000);
afterAll(() => stack?.close());
beforeEach(() => stack.fake!.reset());

const quiet = () => new Transcript({ cps: 0, pauseMs: 0, color: false, verbose: false, write: () => {} });
const batch = lanBatch('nl_llm_test');

/** What a well-behaved model does, one turn at a time, given the last tool output (as text). */
function plan(turn: number, lastToolText: string): { text?: string; tool?: { name: string; input: Record<string, unknown> } } {
  switch (turn) {
    case 0:
      return { text: 'Sending the payout.', tool: { name: 'create_payout_batch', input: { ...batch } } };
    case 1:
      expect(lastToolText).toMatch(/^Refused: no approval_token/);
      return { tool: { name: 'request_human_approval', input: { reason: 'Heating bill for Mrs. Lan', ...batch } } };
    case 2: {
      const { approval_token } = JSON.parse(lastToolText) as { approval_token: string };
      return { tool: { name: 'create_payout_batch', input: { ...batch, approval_token } } };
    }
    case 3: {
      const { batchId } = JSON.parse(lastToolText) as { batchId: string };
      return { tool: { name: 'get_payout_batch', input: { payout_batch_id: batchId } } };
    }
    default:
      return { text: 'Paid $150.00 to @lan-nguyen54 on Venmo after two organizers approved.' };
  }
}

function eventsSummary(t: Transcript) {
  return t.events.map((e) => (e.kind === 'call' || e.kind === 'result' ? `${e.kind}:${e.tool}` : e.kind));
}

const expectedStory = [
  'user', 'agent', 'call:create_payout_batch', 'result:create_payout_batch',
  'call:request_human_approval', 'human', 'human', 'token',
  'call:create_payout_batch', 'result:create_payout_batch', 'call:get_payout_batch', 'result:get_payout_batch', 'agent',
];

describe('--llm loops (fake model clients)', () => {
  it('anthropic: tool_use / tool_result round trips', async () => {
    const requests: any[] = [];
    let turn = 0;
    const client = {
      messages: {
        create: async (req: any) => {
          requests.push(structuredClone(req));
          const last = req.messages.at(-1);
          const lastText = Array.isArray(last.content) ? (last.content.find((c: any) => c.type === 'tool_result')?.content ?? '') : '';
          const step = plan(turn++, lastText);
          const content: any[] = [];
          if (step.text) content.push({ type: 'text', text: step.text });
          if (step.tool) content.push({ type: 'tool_use', id: `tu_${turn}`, name: step.tool.name, input: step.tool.input });
          return { content, stop_reason: step.tool ? 'tool_use' : 'end_turn' };
        },
      },
    };
    const t = quiet();
    await runLlm(stack, new DemoApprovalService(secret), t, { provider: 'anthropic', senderBatchId: 'nl_llm_test', approve: 'auto', client });
    expect(eventsSummary(t)).toEqual(expectedStory);
    expect(requests[0].tools.map((x: any) => x.name)).toEqual(expect.arrayContaining(['create_payout_batch', 'get_payout_batch', 'reconcile_payouts', 'request_human_approval']));
    expect(requests[0].system).toMatch(/Never invent or alter a token/);
    const refusal = requests[1].messages.at(-1).content[0];
    expect(refusal).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: true });
    expect(stack.fake!.state.batches.size).toBe(1);
  }, 30_000);

  it('openai: tool_calls / role:tool round trips', async () => {
    let turn = 0;
    const client = {
      chat: {
        completions: {
          create: async (req: any) => {
            const last = req.messages.at(-1);
            const step = plan(turn++, last.role === 'tool' ? String(last.content).replace(/^Error: /, '') : '');
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: step.text ?? null,
                    ...(step.tool ? { tool_calls: [{ id: `call_${turn}`, type: 'function', function: { name: step.tool.name, arguments: JSON.stringify(step.tool.input) } }] } : {}),
                  },
                },
              ],
            };
          },
        },
      },
    };
    const t = quiet();
    await runLlm(stack, new DemoApprovalService(secret), t, { provider: 'openai', senderBatchId: 'nl_llm_test', approve: 'auto', client });
    expect(eventsSummary(t)).toEqual(expectedStory);
    expect(stack.fake!.state.batches.size).toBe(1);
  }, 30_000);
});
