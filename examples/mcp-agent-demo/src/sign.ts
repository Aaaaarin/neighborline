#!/usr/bin/env node
/**
 * Stand-in approval service for trying the MCP server from Claude Desktop, Cursor or any other MCP client:
 * mints an approval token for one batch once you name two distinct approvers.
 *
 *   NEIGHBORLINE_APPROVAL_SECRET=<same secret as the server> \
 *   pnpm --filter @neighborline/example-mcp-agent-demo sign -- --approver org_dana --approver org_marcus < batch.json
 *
 * batch.json is the batch exactly as the agent sent it to create_payout_batch:
 *   { "sender_batch_id": "...", "items": [{ "sender_item_id": "...", "amount_cents": 15000, "receiver": "@lan-nguyen54",
 *     "recipient_type": "USER_HANDLE", "wallet": "VENMO", "note": "..." }] }
 *
 * In production this is your approval service, after it has checked its own records of who approved what. Never
 * give the secret, or this command, to the agent.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { signApprovalToken } from '@neighborline/paypal/approval';
import { describeBatch, toBatchInput, type McpBatchArgs } from './batch.js';

// `pnpm sign -- --approver …` passes the `--` through; drop it so the flags are still parsed.
const argv = process.argv.slice(2);
if (argv.includes('--')) argv.splice(argv.indexOf('--'), 1);
const { values } = parseArgs({ args: argv, options: { approver: { type: 'string', multiple: true }, batch: { type: 'string' }, ttl: { type: 'string', default: '600' } } });
const secret = process.env.NEIGHBORLINE_APPROVAL_SECRET;
if (!secret || secret.length < 32) {
  console.error('Set NEIGHBORLINE_APPROVAL_SECRET (at least 32 characters, the same value the MCP server has).');
  process.exit(1);
}
const approvers = [...new Set((values.approver ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))];
if (approvers.length < 2) {
  console.error('Name at least two distinct approvers: --approver org_dana --approver org_marcus');
  process.exit(1);
}
const raw = readFileSync(values.batch ?? 0, 'utf8');
const parsed = JSON.parse(raw) as McpBatchArgs & { approval_token?: string };
const token = signApprovalToken(secret, { approvalId: `appr_cli_${Date.now()}`, batch: toBatchInput(parsed), approvers, ttlSec: Number(values.ttl) });
console.error(`Approved ${describeBatch(parsed)} (sender_batch_id ${parsed.sender_batch_id}) by ${approvers.join(' + ')}, valid ${Math.round(Number(values.ttl) / 60)} min:`);
console.log(token);
