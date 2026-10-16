# @neighborline/paypal

[![CI](https://github.com/Aaaaarin/neighborline/actions/workflows/ci.yml/badge.svg)](https://github.com/Aaaaarin/neighborline/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Aaaaarin/neighborline/blob/main/packages/paypal/LICENSE)
![Types included](https://img.shields.io/badge/types-included-3178c6)
![ESM only](https://img.shields.io/badge/module-ESM-f7df1e)
![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-339933)
![MCP server](https://img.shields.io/badge/MCP-server%20included-6b4fbb)

A typed PayPal REST client for apps that **send** money, and an MCP server that lets AI agents pay people **only
with two humans' signed approval**.

- **Payouts** to PayPal and Venmo in one batch, idempotent end to end.
- **Verified webhooks** (raw body spliced in, never re-serialized) as a typed union, plus a payout status machine
  that never walks backwards when events arrive late or twice.
- **Transaction Search reconciliation** that knows about PayPal's 3-hour reporting lag.
- **Donations**: Orders v2 (PayPal, Venmo, Pay Later buttons) and Subscriptions.
- **`neighborline-payouts-mcp`**: the Payouts tools the [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit)
  does not have, behind an HMAC approval token bound to the exact batch.

Built for [Neighborline](https://github.com/Aaaaarin/neighborline), a mutual-aid hotline where two organizers approve
and cash lands in PayPal or Venmo. MIT licensed. Tested offline against a local PayPal look-alike
([`tools/fake-paypal`](https://github.com/Aaaaarin/neighborline/tree/main/tools/fake-paypal)).

[Install](#install) · [Quick start](#60-second-quick-start) · [The approval token](#the-approval-token) ·
[MCP server](#mcp-server-payouts-for-agents) · [Webhooks](#webhooks) · [Reconciliation](#reconciliation) ·
[Donations](#donations) · [Errors](#errors) · [Security notes](#security-notes) · [API reference](./API.md) ·
[Changelog](./CHANGELOG.md)

## Install

```bash
npm install @neighborline/paypal        # Node >= 20, ESM only, types included
```

> **Not on npm yet.** The package is publish-ready (`pnpm --filter @neighborline/paypal pack:check`) but has not been
> published. Until it is, build the tarball from a clone: `pnpm i && pnpm --filter @neighborline/paypal pack:check --keep out`
> and `npm install ./out/neighborline-paypal-0.2.0.tgz`.

| Import | What you get |
|---|---|
| `@neighborline/paypal` | The client and every helper |
| `@neighborline/paypal/approval` | Approval tokens only (`node:crypto`, no HTTP). For your approval service |
| `@neighborline/paypal/webhooks` | Webhook verification, typed events, the payout status machine |
| `@neighborline/paypal/mcp` | `createPayoutsMcpServer` |
| `npx -p @neighborline/paypal neighborline-payouts-mcp` | The stdio MCP server |

## 60-second quick start

**1. Approval tokens, no credentials needed** (`quickstart.mjs`):

```js
import { signApprovalToken, createHmacApprovalVerifier, batchDigest } from '@neighborline/paypal/approval';

const secret = 'a-shared-secret-of-at-least-32-characters!';
const batch = {
  senderBatchId: 'nl_2026_10_16_lan',
  items: [{ senderItemId: 'req_lan', amountCents: 15000, wallet: 'VENMO', recipientType: 'USER_HANDLE', receiver: '@lan-nguyen' }],
};

// Your approval service, after two organizers approved this exact batch:
const token = signApprovalToken(secret, { approvalId: 'appr_1', batch, approvers: ['org_ana', 'org_ben'], ttlSec: 600 });

// The payout side (the MCP server does this for you):
const verify = createHmacApprovalVerifier(secret);
console.log(verify({ approvalToken: token, batch, digest: batchDigest(batch) }));
// → { ok: true, approvalId: 'appr_1', approvers: ['org_ana', 'org_ben'] }

const edited = { ...batch, items: [{ ...batch.items[0], amountCents: 150000 }] }; // one extra zero
console.log(verify({ approvalToken: token, batch: edited, digest: batchDigest(edited) }));
// → { ok: false, reason: 'batch contents differ from what was approved' }
```

**2. A payout in the PayPal sandbox** (get sandbox REST credentials from the
[developer dashboard](https://developer.paypal.com/dashboard/applications/sandbox); no credentials? clone the repo
and run `pnpm fake-paypal`, then use `baseUrl: 'http://localhost:4010'` with any id and secret):

```js
import { createPayPal, PAYPAL_SANDBOX_URL } from '@neighborline/paypal';

const paypal = createPayPal({ clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET, baseUrl: PAYPAL_SANDBOX_URL });

const batch = await paypal.payouts.createBatch({
  senderBatchId: 'nl_2026_10_16_lan',          // derive it from your approval record: a retry can never pay twice
  emailSubject: 'Your neighbors sent you help',
  items: [
    { senderItemId: 'req_lan', amountCents: 15000, wallet: 'VENMO', recipientType: 'USER_HANDLE', receiver: '@lan-nguyen',
      note: 'Đã gửi $150 từ hàng xóm', purpose: 'NON_GOODS_OR_SERVICES' }, // Venmo: note required; feed is PRIVATE
    { senderItemId: 'req_rosa', amountCents: 12000, recipientType: 'EMAIL', receiver: 'rosa@example.com',
      note: 'Ayuda mutua de Eastside', purpose: 'NON_GOODS_OR_SERVICES' },
  ],
});
// → { batchId: 'Y4JB5BNLE8Z88', status: 'PENDING', duplicate: false, … }

const items = await paypal.payouts.listAllItems(batch.batchId);
// → [{ senderItemId: 'req_lan', status: 'SUCCESS', amountCents: 15000, transactionId: '…', … }, …]
```

**3. Give an agent the Payouts tools**: see [MCP server](#mcp-server-payouts-for-agents).

Or wire everything from env with `createPayPalFromEnv()`:

| Variable | Used for |
|---|---|
| `PAYPAL_MODE` | `fake`, `sandbox` or `live` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Credentials (sandbox and live) |
| `PAYPAL_BASE_URL` | API base URL override (sandbox and live) |
| `PAYPAL_WEBHOOK_ID` | Webhook verification (sandbox and live) |
| `FAKE_PAYPAL_URL` | Fake mode only (default `http://localhost:4010`) |

## The approval token

Payouts is the API you least want a model to call on its own initiative. The rule this package enforces is:
**an agent can draft a payout, but only humans can authorize one, and only the exact batch they saw.**

```
  agent (LLM)              approval service              organizers            MCP server              PayPal
  ───────────              ────────────────              ──────────            ──────────              ──────
  drafts batch B ─────────▶ records B, asks two humans ─▶ Ana approves B
                                                         Ben approves B
                           both approvals on record?
                           token = HMAC(secret,
                             sender_batch_id(B),
                             digest(B's receivers,
                               amounts, currencies,
                               wallets),
                             [ana, ben], exp)
  ◀──────────────────────── token
  create_payout_batch(B', token) ──────────────────────────────────────────────▶ verify(token, B'):
                                                                                 · signature (constant time)
                                                                                 · not expired
                                                                                 · sender_batch_id(B') = B
                                                                                 · digest(B') = digest(B)
                                                                                 · ≥ 2 distinct approvers
                                                                                 all pass ──────────▶ POST /v1/payments/payouts
                                                                                 any fails → "Refused: <reason>", audited,
                                                                                             nothing sent
```

- **Bound to the batch, not to the agent.** The digest covers every item's `senderItemId`, amount, currency, wallet,
  recipient type and receiver (trimmed, case-insensitive). Change one cent, swap `@lan-nguyen` for a lookalike, drop
  or add an item, and the digest no longer matches. The note is not covered, so wording can change.
- **Two distinct humans.** Approver ids are compared trimmed and case-insensitively, so `org_ana` and ` ORG_ANA`
  count once. `minApprovers` is configurable (default 2).
- **Short-lived.** `ttlSec` defaults to 10 minutes. Expired tokens are refused.
- **Replay is harmless.** The token authorizes one `sender_batch_id`, and PayPal accepts a `sender_batch_id` once
  per 30 days; a repeat returns the original batch (`duplicate: true`) instead of paying again.
- **Fail closed.** The MCP server's default verifier (`denyAllApprovals`) refuses everything, so an unconfigured
  server cannot pay anyone. A call with no token is refused with a reason and audited.
- **Format:** `nlap1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(secret, "nlap1." + payload))>`. The payload
  is `{ v, approvalId, senderBatchId, digest, approvers, iat, exp }`; `readApprovalToken` decodes it for display
  (never for authorization).
- **Bring your own verifier.** `approvalVerifier` is any `(req) => { ok, reason }` function, sync or async. Look the
  approval up in your database, call your signing service, or require WebAuthn assertions; the HMAC verifier is the
  zero-infrastructure default.

This mirrors the "authorize twice" pattern for agent payments: the agent's mandate is a signed, scoped, expiring
statement from humans, checked by code the agent cannot influence.

## MCP server: Payouts for agents

| Tool | Effect |
|---|---|
| `get_payout_batch`, `get_payout_item` | Read-only status, including PayPal's reason (e.g. `RECEIVER_UNREGISTERED`) |
| `search_transactions`, `reconcile_payouts` | Read-only ledger and reconciliation |
| `cancel_unclaimed_payout_item` | Returns money **to the sender**. Works only on `UNCLAIMED` items |
| `create_payout_batch` | **Moves money. Requires an `approval_token`** |

```bash
# stdio, for any MCP client (Claude Desktop, Cursor, VS Code, your own agent)
PAYPAL_MODE=sandbox PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… \
NEIGHBORLINE_APPROVAL_SECRET=<at least 32 chars, shared with your approval service> \
npx -y --package=@neighborline/paypal neighborline-payouts-mcp
```

Without `NEIGHBORLINE_APPROVAL_SECRET`, `create_payout_batch` refuses every call. Client configuration (Claude
Desktop JSON), the tool reference and a runnable agent demo are in
[docs/MCP.md](https://github.com/Aaaaarin/neighborline/blob/main/docs/MCP.md).

Programmatic use, with your own verifier and audit sink:

```ts
import { createPayoutsMcpServer } from '@neighborline/paypal/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = createPayoutsMcpServer({
  paypal,                                   // a PayPal facade, a PayPalClient or client options
  approvalVerifier: myVerifier,             // default: refuse everything
  onAudit: (e) => auditLog.write(e),        // every call: tool, outcome, sender_batch_id, approval id; no amounts or receivers
  refusalHint: 'Ask two treasurers to approve it in the finance app.',
});
await server.connect(new StdioServerTransport());
```

## Webhooks

```ts
import { parseWebhookEvent, applyItemStatus } from '@neighborline/paypal/webhooks';

export async function POST(req: Request) {
  const rawBody = await req.text(); // read the raw text BEFORE parsing: PayPal signs these exact bytes
  const check = await paypal.webhooks.verifyWebhookSignature({ headers: req.headers, rawBody, webhookId: process.env.PAYPAL_WEBHOOK_ID! });
  if (!check.verified) return new Response('bad signature', { status: 400 });

  const event = parseWebhookEvent(rawBody); // dedupe on event.eventId: PayPal retries up to 25 times over 3 days
  if (event.kind === 'payout_item') {
    const next = applyItemStatus(current.status, event.status); // a late HELD never overwrites SUCCESS
    if (next.changed) await save(event.item.senderItemId, next.status, event.item.transactionId);
  }
  return new Response(null, { status: 200 });
}
```

| `kind` | PayPal events |
|---|---|
| `payout_item` | `PAYMENT.PAYOUTS-ITEM.*` |
| `payout_batch` | `PAYMENT.PAYOUTSBATCH.*` |
| `order_approved` | `CHECKOUT.ORDER.APPROVED` |
| `capture_completed` | `PAYMENT.CAPTURE.COMPLETED` |
| `subscription_activated` | `BILLING.SUBSCRIPTION.ACTIVATED` |
| `sale_completed` | `PAYMENT.SALE.COMPLETED` |
| `unknown` | Anything else |

Events from PayPal's webhook **simulator** cannot be verified by postback (PayPal's documented behaviour);
`webhooks.simulateEvent()` exists for wiring tests.

## Reconciliation

```ts
import { reconcile } from '@neighborline/paypal';

const txns = await paypal.reporting.searchTransactions({ startDate: since, endDate: new Date() }); // > 31 days is chunked
const report = reconcile(localItems, txns);
// matched / amountMismatch / currencyMismatch / statusDrift / missingAtPayPal / missingLocally / pendingLag /
// noTransactionId / stuckPending, plus ok and a one-line summary
```

Transaction Search shows data **up to 3 hours late**. Items younger than that land in `pendingLag`, not
`missingAtPayPal`. `statusDrift` catches a reversal or refund after `SUCCESS`. `stuckPending` lists
`PENDING`/`ONHOLD` items with no transaction id after 24 h: usually a lost webhook, so poll the batch.

## Donations

```ts
const order = await paypal.orders.createDonationOrder({ amountCents: 2500, description: 'Eastside ice-storm fund', customId: 'don_42' });
// hand order.id to the PayPal JS SDK buttons (PayPal / Venmo / Pay Later); after approval:
const capture = await paypal.orders.captureOrder(order.id); // idempotent: a double tap returns the same capture

const tiers = await paypal.subscriptions.ensureDonationTiers({ product: { id: 'NEIGHBORLINE-DONATION', name: 'Monthly gift' } });
// → { 1000: 'P-…', 2500: 'P-…', 5000: 'P-…' }  (safe to run on every boot)
```

## Errors

| Error | When |
|---|---|
| `PayPalApiError` | Non-2xx. `name` (e.g. `UNPROCESSABLE_ENTITY`), `issue`, `debugId`, `status`, `details`, `hasIssue()` |
| `PayPalAuthError` | The OAuth token request failed |
| `PayPalTimeoutError`, `PayPalNetworkError` | Transport failure. Writes are replayed only with an idempotency key |
| `PayPalInputError` | Rejected locally before sending: a Venmo item without a note, mixed currencies, float cents, … |
| `DuplicateBatchError` | The `sender_batch_id` was already used and PayPal gave no link. Nothing was paid twice |

`isAmbiguousPayPalError(err)` tells you when a failed write may still have landed (timeouts, network errors, 5xx,
429). Keep the batch in an unknown state and re-send the same `sender_batch_id`; never mark it failed.

## Security notes

- **No secrets in the package.** Credentials and the approval secret are read from your options or env at runtime.
  The published tarball is checked for credential patterns, test files and sources before release
  (`scripts/pack-check.mjs`).
- **Keep the approval secret out of the agent's reach.** The MCP server only needs to *verify*; the approval service
  *signs*. Anyone holding the secret can mint tokens, so never put it in a prompt, a tool result or the agent's
  environment beyond the MCP server process. Use ≥ 32 random characters (`openssl rand -base64 48`) and rotate it like
  any signing key. For separate trust domains, plug in an asymmetric or database-backed `approvalVerifier`.
- **The token is not the whole policy.** It proves two humans approved *this batch*. Caps, eligibility, recipient
  checks (lookalike handles) and rate limits belong in your approval service before it signs.
- **Least privilege at PayPal.** Give the MCP server a REST app with only the Payouts and Transaction Search
  scopes it needs, and use a dedicated sandbox app while testing.
- **Logs.** `onRequest` and `onAudit` never include request bodies, amounts or receivers (PII). PayPal's `debug_id`
  is included because PayPal support asks for it first.
- **Webhooks.** Always verify before acting, read the raw body first, dedupe on `eventId`, and apply statuses with
  `applyItemStatus` so a replayed or reordered event cannot regress a payout.
- **Supply chain.** Two runtime dependencies (`@modelcontextprotocol/sdk`, `zod`). Releases are built in GitHub
  Actions and published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements).
- Report vulnerabilities privately: [SECURITY.md](https://github.com/Aaaaarin/neighborline/blob/main/SECURITY.md).

Facts about PayPal's API, with sources and sandbox caveats: [PAYPAL_NOTES.md](./PAYPAL_NOTES.md).

## Development

```bash
pnpm --filter @neighborline/paypal test         # vitest; starts fake-paypal in-process on a random port
pnpm --filter @neighborline/paypal typecheck
pnpm --filter @neighborline/paypal build        # tsup → dist (ESM + d.ts)
pnpm --filter @neighborline/paypal pack:check   # pack as published; fail on stray files, bad exports, secrets
pnpm --filter @neighborline/paypal pack:smoke   # install the tarball in /tmp/x and use it against fake PayPal
```

Releasing: [RELEASING.md](https://github.com/Aaaaarin/neighborline/blob/main/docs/RELEASING.md). Sandbox negative
testing: Orders take `mockResponse: { mock_application_codes: 'INSTRUMENT_DECLINED' }`; Payouts take a test value
such as `ERRPYO005` in the first item's `note`.
