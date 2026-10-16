# @neighborline/paypal

A typed PayPal REST client for apps that **send** money: Payouts to PayPal and Venmo, webhooks, Transaction Search
reconciliation. It also covers the donation side: Orders v2 and Subscriptions.

It ships with **`neighborline-payouts-mcp`**, an MCP server that adds the Payouts tools missing from the
[PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit). Moving money through it requires a human approval
token.

Built for [Neighborline](../../README.md), a mutual-aid hotline where two organizers approve and cash lands in PayPal
or Venmo in about 90 seconds. MIT licensed.

- **Money is integer cents.** `toPayPalValue(15000) → "150.00"`. Floats are rejected, never rounded.
- **Idempotent payouts.**
  - A `sender_batch_id` can be used once per 30 days.
  - `PayPal-Request-Id` is set to the `sender_batch_id`.
  - If PayPal reports a duplicate, the client follows PayPal's link back to the original batch.
- **Verified webhooks.** The client splices the *raw* body into `verify-webhook-signature` instead of re-serializing
  it. Events come back as a typed discriminated union. A monotonic item state machine handles webhooks that arrive
  out of order.
- **A careful client:**
  - Cached OAuth tokens, refreshed early from a single in-flight request.
  - Retries with jittered backoff on **429 and 5xx only**. Writes get an idempotency key that is reused across
    retries.
  - Per-attempt timeouts.
  - Typed errors that carry `name`, `debugId`, `details` and `status`.
- **Fully tested offline** against [`tools/fake-paypal`](../../tools/fake-paypal), a local PayPal sandbox look-alike.

> Facts about PayPal's API, with sources and the sandbox caveats, are in [`PAYPAL_NOTES.md`](./PAYPAL_NOTES.md).

## Quick start

```ts
import { createPayPal, PAYPAL_SANDBOX_URL } from '@neighborline/paypal';

const paypal = createPayPal({
  clientId: process.env.PAYPAL_CLIENT_ID!,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
  baseUrl: PAYPAL_SANDBOX_URL,
});

// One batch, mixed PayPal + Venmo. Amounts in cents.
const batch = await paypal.payouts.createBatch({
  senderBatchId: 'nl_3f9c1a…', // derive it from your approval record, so retries can't double-pay
  emailSubject: 'Your neighbors sent you help',
  items: [
    { senderItemId: 'req_lan', amountCents: 15000, wallet: 'VENMO', recipientType: 'USER_HANDLE', receiver: '@lan-nguyen',
      note: 'Đã gửi $150 từ hàng xóm', purpose: 'NON_GOODS_OR_SERVICES' }, // Venmo: note required; feed defaults to PRIVATE
    { senderItemId: 'req_rosa', amountCents: 12000, recipientType: 'EMAIL', receiver: 'rosa@example.com',
      note: 'Ayuda mutua de Eastside', purpose: 'NON_GOODS_OR_SERVICES' },
  ],
});
// → { batchId: 'Y4JB5BNLE8Z88', status: 'PENDING', duplicate: false, … }

const items = await paypal.payouts.listAllItems(batch.batchId);
// → [{ senderItemId: 'req_lan', status: 'SUCCESS', amountCents: 15000, transactionId: '…' }, …]
```

Or wire it from env with `createPayPalFromEnv()`:

| Variable | Used for |
|---|---|
| `PAYPAL_MODE` | `fake`, `sandbox` or `live` |
| `PAYPAL_CLIENT_ID` | Credentials (sandbox and live) |
| `PAYPAL_CLIENT_SECRET` | Credentials (sandbox and live) |
| `PAYPAL_BASE_URL` | API base URL (sandbox and live) |
| `PAYPAL_WEBHOOK_ID` | Webhook verification (sandbox and live) |
| `FAKE_PAYPAL_URL` | Fake mode only |

## Webhooks

```ts
import { parseWebhookEvent, applyItemStatus } from '@neighborline/paypal';

export async function POST(req: Request) {
  const rawBody = await req.text(); // read the raw text BEFORE parsing; PayPal's signature covers these exact bytes
  const check = await paypal.webhooks.verifyWebhookSignature({ headers: req.headers, rawBody, webhookId: process.env.PAYPAL_WEBHOOK_ID! });
  if (!check.verified) return new Response('bad signature', { status: 400 });

  const event = parseWebhookEvent(rawBody); // dedupe on event.eventId: PayPal retries up to 25× over 3 days
  if (event.kind === 'payout_item') {
    const next = applyItemStatus(current.status, event.status); // a late HELD never overwrites SUCCESS
    if (next.changed) await save(event.item.senderItemId, next.status, event.item.transactionId);
  }
  return new Response(null, { status: 200 });
}
```

Event kinds:

| `kind` | PayPal events |
|---|---|
| `payout_item` | `PAYMENT.PAYOUTS-ITEM.*` |
| `payout_batch` | `PAYMENT.PAYOUTSBATCH.*` |
| `order_approved` | `CHECKOUT.ORDER.APPROVED` |
| `capture_completed` | `PAYMENT.CAPTURE.COMPLETED` |
| `subscription_activated` | `BILLING.SUBSCRIPTION.ACTIVATED` |
| `sale_completed` | `PAYMENT.SALE.COMPLETED` |
| `unknown` | Any other event |

Events from PayPal's webhook **simulator** cannot be verified by postback. This is PayPal's documented behaviour.
`webhooks.simulateEvent()` is provided for wiring tests.

## Donations

```ts
const order = await paypal.orders.createDonationOrder({ amountCents: 2500, description: 'Eastside ice-storm fund', customId: 'don_42' });
// hand order.id to the PayPal JS SDK buttons (PayPal / Venmo / Pay Later); after approval:
const capture = await paypal.orders.captureOrder(order.id); // idempotent: a double tap returns the same capture

const tiers = await paypal.subscriptions.ensureDonationTiers({ product: { id: 'NEIGHBORLINE-DONATION', name: 'Monthly gift' } });
// → { 1000: 'P-…', 2500: 'P-…', 5000: 'P-…' }  (safe to run on every boot)
```

## Reconciliation

```ts
const txns = await paypal.reporting.searchTransactions({ startDate: since, endDate: new Date() }); // >31 days is chunked for you
const report = reconcile(localItems, txns); // matched / amountMismatch / missingAtPayPal / missingLocally / pendingLag
```

Transaction Search shows data **up to 3 hours late**. Items younger than that land in `pendingLag`, not
`missingAtPayPal`.

## The MCP server: payouts for agents, with two humans in the loop

The PayPal Agent Toolkit covers orders, invoices, subscriptions and reporting. It does **not** cover Payouts. Payouts
is exactly the API you least want an LLM to call on its own initiative. `neighborline-payouts-mcp` adds these tools:

| Tool | Effect |
|---|---|
| `get_payout_batch`, `get_payout_item` | Read-only status, including PayPal's reason (e.g. `RECEIVER_UNREGISTERED`) |
| `search_transactions`, `reconcile_payouts` | Read-only ledger and reconciliation |
| `cancel_unclaimed_payout_item` | Returns money **to the sender**. Only works on UNCLAIMED items |
| `create_payout_batch` | **Moves money. Requires `approval_token`** |

### The approval-token design

1. An agent drafts a payout. It cannot execute it.
2. Two different organizers approve on their phones. The approval service records both.
3. The approval service mints a token with `signApprovalToken(secret, { approvalId, batch, approvers, ttlSec })`.
   The token is an HMAC over:
   - the `sender_batch_id`
   - a **digest of every item's receiver, amount, currency and wallet**
   - the approver ids
   - an expiry
4. The agent calls `create_payout_batch` with that token. The pluggable `approvalVerifier` checks all of the following
   before anything reaches PayPal:
   - the signature
   - the expiry
   - that the batch matches the approved one exactly
   - that there are at least 2 *distinct* approvers
5. The call is refused if the agent changes one cent, swaps a receiver for a lookalike handle, reuses an expired
   token or presents a single approver. Every call is reported to `onAudit`.

The **default verifier refuses everything**, so an unconfigured server cannot pay anyone. This mirrors PayPal's own
"authorize twice" pattern from its internal MCP Hub, and the "Know Your Agent" framing.

```bash
# stdio; add to any MCP client (Claude Desktop, Cursor, …)
PAYPAL_MODE=sandbox PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… \
NEIGHBORLINE_APPROVAL_SECRET=<≥32 chars, shared with the approval service> \
npx neighborline-payouts-mcp
```

Programmatic use:

```ts
import { createPayoutsMcpServer } from '@neighborline/paypal/mcp';
const server = createPayoutsMcpServer({ paypal, approvalVerifier: myVerifier, onAudit: log });
```

## Errors

| Error | When |
|---|---|
| `PayPalApiError` | Non-2xx. Carries `name` (e.g. `UNPROCESSABLE_ENTITY`), `issue` (first `details[].issue`), `debugId`, `status`, `details`, `hasIssue()` |
| `PayPalAuthError` | The OAuth token request failed |
| `PayPalTimeoutError`, `PayPalNetworkError` | Transport failure. Writes are replayed only with an idempotency key |
| `PayPalInputError` | Rejected locally before sending. Examples: a Venmo item without a note, mixed currencies, float cents |
| `DuplicateBatchError` | The `sender_batch_id` was already used and PayPal gave no link. Nothing was paid twice |

## Development

```bash
pnpm --filter @neighborline/paypal test       # vitest; starts fake-paypal in-process on a random port
pnpm --filter @neighborline/paypal typecheck
pnpm --filter @neighborline/paypal build      # tsup → dist (ESM + d.ts)
```

Sandbox negative testing:
- Orders: pass `mockResponse: { mock_application_codes: 'INSTRUMENT_DECLINED' }`.
- Payouts: put a test value such as `ERRPYO005` in the first item's `note`. Payouts does not use the mock header.
