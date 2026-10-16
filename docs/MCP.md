# The Payouts guard for AI agents: `neighborline-payouts-mcp`

An [MCP](https://modelcontextprotocol.io) server that gives an AI agent PayPal Payouts (PayPal and Venmo) with one
hard rule: **the agent can draft a payout, but money moves only with an approval token that two humans' approval
produced, bound to that exact batch.** It ships in [`@neighborline/paypal`](../packages/paypal) (MIT) and is the
same code path Neighborline's own approval service uses.

The [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit) covers orders, invoices, subscriptions and
reporting, but not Payouts. Payouts is the API you least want a model to call on its own initiative, so this server
fills the gap with a guard rather than a raw wrapper.

[Tools](#tools) · [How the guard works](#how-the-guard-works) · [Run it](#run-it) · [Claude Desktop](#claude-desktop) ·
[Other clients](#cursor-vs-code-and-other-clients) · [In your own agent](#in-your-own-agent-code) ·
[Demo](#runnable-demo) · [Security checklist](#security-checklist)

## Tools

| Tool | Effect | Annotations |
|---|---|---|
| `get_payout_batch` | Batch status and every item: status, cents, wallet, PayPal's reason (`RECEIVER_UNREGISTERED`, …) | read-only |
| `get_payout_item` | One item, e.g. to explain `UNCLAIMED` to a recipient | read-only |
| `search_transactions` | PayPal Transaction Search; ranges over 31 days are split | read-only |
| `reconcile_payouts` | Your ledger vs Transaction Search: matched, amount mismatches, missing either side, within the 3-hour reporting lag | read-only |
| `cancel_unclaimed_payout_item` | Returns an `UNCLAIMED` item's money **to the sender**. Pays no one | destructive, idempotent |
| `create_payout_batch` | **Sends money. Needs `approval_token`.** Refused, with a reason and an audit entry, if the token is missing, forged, expired, for another batch, for different contents, or carries fewer than 2 distinct approvers | destructive, idempotent |

Amounts are integer cents. A repeated `sender_batch_id` returns the original batch instead of paying twice.

## How the guard works

```
agent ──create_payout_batch(B)────────────────────────────────▶ server: "Refused: no approval_token; an agent
                                                                         cannot authorize a payout on its own."
agent ──"please approve B"──▶ your approval service ──▶ Ana ✓, Ben ✓ (two different humans, the exact batch B)
                              signApprovalToken(secret, { batch: B, approvers: [ana, ben], ttlSec: 600 })
agent ◀──────────────────────── token  (HMAC over sender_batch_id + digest of every receiver/amount/currency/wallet)
agent ──create_payout_batch(B, token)─────────────────────────▶ server verifies: signature · expiry · same
                                                                 sender_batch_id · same digest · ≥ 2 approvers
                                                                 ──▶ PayPal POST /v1/payments/payouts
```

- The **secret** lives in two places only: your approval service (signs) and the MCP server process (verifies). The
  agent sees tokens, never the secret.
- The **digest** covers each item's `sender_item_id`, amount, currency, wallet, recipient type and receiver
  (trimmed, case-insensitive). One cent, one character of a handle, or one extra item changes it.
- **Fail closed:** without `NEIGHBORLINE_APPROVAL_SECRET` (or a custom `approvalVerifier`), every
  `create_payout_batch` call is refused.
- **Audit:** every call is reported to `onAudit` (in the bin: `[audit] {…}` lines on stderr) with tool, outcome,
  `sender_batch_id` and approval id, and no amounts or receivers.

Token format and the full design: [packages/paypal/README.md](../packages/paypal/README.md#the-approval-token).

## Run it

| Variable | |
|---|---|
| `PAYPAL_MODE` | `fake` (local [fake PayPal](../tools/fake-paypal), no credentials), `sandbox` or `live` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | REST app credentials (sandbox or live) |
| `PAYPAL_BASE_URL` | Optional API base override |
| `FAKE_PAYPAL_URL` | Fake mode only (default `http://localhost:4010`; start it with `pnpm fake-paypal`) |
| `NEIGHBORLINE_APPROVAL_SECRET` | ≥ 32 characters, shared with your approval service. Unset → payouts disabled |

```bash
# Once @neighborline/paypal is on npm:
npx -y --package=@neighborline/paypal neighborline-payouts-mcp

# From a clone, today:
pnpm install && pnpm --filter @neighborline/paypal build
node packages/paypal/dist/mcp/bin.js                  # or, from TypeScript: pnpm --filter @neighborline/paypal mcp
```

The server speaks MCP over stdio; logs go to stderr.

## Claude Desktop

Settings → Developer → Edit Config opens `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`). Add the server, then restart Claude Desktop.

**PayPal sandbox, once the package is published:**

```json
{
  "mcpServers": {
    "neighborline-payouts": {
      "command": "npx",
      "args": ["-y", "--package=@neighborline/paypal", "neighborline-payouts-mcp"],
      "env": {
        "PAYPAL_MODE": "sandbox",
        "PAYPAL_CLIENT_ID": "<sandbox REST app client id>",
        "PAYPAL_CLIENT_SECRET": "<sandbox REST app secret>",
        "NEIGHBORLINE_APPROVAL_SECRET": "<openssl rand -base64 48>"
      }
    }
  }
}
```

**From a clone, with no credentials** (run `pnpm install && pnpm --filter @neighborline/paypal build`, and
`pnpm fake-paypal` in a terminal; use absolute paths):

```json
{
  "mcpServers": {
    "neighborline-payouts": {
      "command": "node",
      "args": ["/absolute/path/to/neighborline/packages/paypal/dist/mcp/bin.js"],
      "env": {
        "PAYPAL_MODE": "fake",
        "FAKE_PAYPAL_URL": "http://localhost:4010",
        "NEIGHBORLINE_APPROVAL_SECRET": "<at least 32 characters>"
      }
    }
  }
}
```

Then try:

1. Ask: *"Pay Mrs. Lan $150 on Venmo, handle @lan-nguyen, note 'from your neighbors', sender_batch_id
   nl_desktop_1."* Claude calls `create_payout_batch` and is refused: *no approval_token*.
2. Ask Claude for the batch as JSON (the `create_payout_batch` arguments), save it as `batch.json`, and play the
   approval service with two approvers:

   ```bash
   NEIGHBORLINE_APPROVAL_SECRET=<same value> \
   pnpm --filter @neighborline/example-mcp-agent-demo sign --approver org_ana --approver org_ben < batch.json
   ```

3. Paste the token: *"Approved, token: nlap1…"*. Claude retries with the same batch, and the batch is created.
   Ask it to change the amount and retry: refused, *batch contents differ from what was approved*.
4. *"Check the batch and reconcile it."* → `get_payout_batch` shows `SUCCESS`, `reconcile_payouts` matches it.

Pasting a token by hand is the demo shortcut. In production the token comes from the approval service to the agent's
host (a tool like the demo's `request_human_approval`), after the humans approve in their own app.

## Cursor, VS Code and other clients

The same `command`, `args` and `env` work in any stdio MCP client: `.cursor/mcp.json` takes the same
`mcpServers` object as Claude Desktop, and VS Code's `.vscode/mcp.json` takes it under `"servers"` with
`"type": "stdio"`. Claude Code:

```bash
claude mcp add neighborline-payouts \
  -e PAYPAL_MODE=sandbox -e PAYPAL_CLIENT_ID=… -e PAYPAL_CLIENT_SECRET=… -e NEIGHBORLINE_APPROVAL_SECRET=… \
  -- npx -y --package=@neighborline/paypal neighborline-payouts-mcp
```

## In your own agent code

Spawn the bin with the official client, as [`examples/mcp-agent-demo`](../examples/mcp-agent-demo) does:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: 'npx', args: ['-y', '--package=@neighborline/paypal', 'neighborline-payouts-mcp'],
  env: { ...process.env, PAYPAL_MODE: 'sandbox', NEIGHBORLINE_APPROVAL_SECRET: process.env.APPROVAL_SECRET! },
}));
const r = await client.callTool({ name: 'create_payout_batch', arguments: { ...batch, approval_token } });
```

Or embed the server in your process with your own verifier (say, one that looks the approval up in your database, or
checks WebAuthn assertions) and audit sink:

```ts
import { createPayPalFromEnv } from '@neighborline/paypal';
import { createPayoutsMcpServer } from '@neighborline/paypal/mcp';

const server = createPayoutsMcpServer({
  paypal: createPayPalFromEnv(),
  approvalVerifier: async ({ approvalToken, batch, digest }) => {
    const approval = await db.approvals.findByToken(approvalToken);
    if (!approval || approval.digest !== digest || approval.approvers.length < 2) return { ok: false, reason: 'not approved' };
    return { ok: true, approvalId: approval.id, approvers: approval.approvers };
  },
  onAudit: (entry) => auditLog.write(entry),
  refusalHint: 'Ask two treasurers to approve it in the finance app.',
});
```

Your approval service signs with `signApprovalToken` from `@neighborline/paypal/approval`, a subpath that loads
nothing but `node:crypto`.

## Runnable demo

[`examples/mcp-agent-demo`](../examples/mcp-agent-demo): the four beats (refused without a token → two organizers
sign → paid, `SUCCESS` → reconciled) over a real stdio connection, scripted with no keys or driven by Claude or an
OpenAI model.

```bash
pnpm --filter @neighborline/example-mcp-agent-demo demo            # scripted, ~3 s
pnpm --filter @neighborline/example-mcp-agent-demo demo --tamper   # + an edited amount, refused
ANTHROPIC_API_KEY=… pnpm --filter @neighborline/example-mcp-agent-demo demo:llm anthropic
```

## Security checklist

- Give the server process the approval secret and the PayPal credentials, and **nothing else**: not the model keys,
  not your database. The demo strips `ANTHROPIC_*` and `OPENAI_*` from the server's environment.
- Never place the approval secret in a prompt, a tool result, a system message or a file the agent can read.
- Sign tokens only after your service has checked its own records of the approvals, your caps and the recipient
  (lookalike handles). The token proves "two humans approved this batch"; it is not your whole policy.
- Keep `ttlSec` short (default 10 minutes) and `sender_batch_id` deterministic per approval, so retries are safe.
- Use a PayPal REST app with only Payouts and Transaction Search enabled, and a separate sandbox app for testing.
- Ship the `[audit]` lines (stderr) to your logs, and alert on `refused` bursts: an agent probing for a way around
  the guard looks like that.
