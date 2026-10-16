#!/usr/bin/env node
/**
 * stdio MCP server. Env:
 *   PAYPAL_MODE=fake|sandbox|live, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_BASE_URL, FAKE_PAYPAL_URL
 *   NEIGHBORLINE_APPROVAL_SECRET  (≥32 chars) enables create_payout_batch with HMAC approval tokens.
 *                                  Unset → create_payout_batch always refuses.
 * Logs go to stderr (stdout is the MCP channel).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHmacApprovalVerifier, denyAllApprovals } from '../approval.js';
import { createPayPalFromEnv } from '../paypal.js';
import { createPayoutsMcpServer } from './server.js';

const paypal = createPayPalFromEnv();
const secret = process.env.NEIGHBORLINE_APPROVAL_SECRET;
const server = createPayoutsMcpServer({
  paypal,
  approvalVerifier: secret ? createHmacApprovalVerifier(secret) : denyAllApprovals,
  onAudit: (e) => console.error(`[audit] ${JSON.stringify(e)}`),
});
await server.connect(new StdioServerTransport());
console.error(`[neighborline-payouts-mcp] ready (mode=${paypal.env.mode}, payouts ${secret ? 'enabled with approval tokens' : 'DISABLED: no NEIGHBORLINE_APPROVAL_SECRET'})`);
