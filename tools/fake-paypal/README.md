# @neighborline/fake-paypal

A local stand-in for the PayPal sandbox. It covers the subset of the API Neighborline uses. You can develop, test and
demo with **zero credentials**, and outcomes are deterministic.

```bash
pnpm fake-paypal          # or: pnpm --filter @neighborline/fake-paypal start
WEBHOOK_TARGET_URL=http://localhost:3000/api/webhooks/paypal pnpm fake-paypal
```

| Env | Default | |
|---|---|---|
| `FAKE_PAYPAL_PORT` | `4010` | |
| `WEBHOOK_TARGET_URL` | — | Where to POST webhooks. If unset, events are recorded but not sent |
| `FAKE_PAYPAL_WEBHOOK_ID` | `0FAKEWEBHOOK0NEIGHBORLINE01` | Pass it as `webhook_id` when verifying |
| `FAKE_PAYPAL_PROCESSING_DELAY_MS` | `1500` | Time from batch PENDING to final items. PROCESSING starts at ⅓ of it |
| `FAKE_PAYPAL_AUTO_PROCESS` | `true` | If `false`, batches wait for `POST /__fake/batches/:id/process` |
| `FAKE_PAYPAL_REPORTING_LAG_MS` | `0` | Transaction Search visibility lag. Real PayPal: up to 3h |
| `FAKE_PAYPAL_REJECT_PHONE` | `false` | Mimics real sandbox, which rejects `recipient_type: PHONE` |
| `FAKE_PAYPAL_CLIENT_ID` / `_SECRET` | — | If set, only these credentials get tokens |

## What's implemented

### OAuth
- `POST /v1/oauth2/token`
- Bearer tokens are checked on every API route. A bad token gets a PayPal-shaped 401.

### Payouts
- `POST /v1/payments/payouts`:
  - The same `PayPal-Request-Id` returns the **latest state of the original batch**.
  - A reused `sender_batch_id` gets `400 USER_BUSINESS_ERROR` with a link to the original batch.
  - A Venmo item without a note gets `400 VALIDATION_ERROR`.
- `GET /v1/payments/payouts/:id?page&page_size&total_required`
- `GET /v1/payments/payouts-item/:id`
- `POST /v1/payments/payouts-item/:id/cancel` (UNCLAIMED items only)
- Sandbox test values:
  - `items[0].note`: `ERRPYO001`–`ERRPYO040`.
  - Path: `ERRPYOB001`–`ERRPYOB004`.

### Orders v2
- Create, get and capture, with `PayPal-Request-Id` replay.
- `ORDER_NOT_APPROVED` and `ORDER_ALREADY_CAPTURED` errors.
- `PayPal-Mock-Response` codes: `INSTRUMENT_DECLINED`, `ORDER_NOT_APPROVED`, `ORDER_ALREADY_CAPTURED`,
  `DUPLICATE_INVOICE_ID`, `PAYER_ACTION_REQUIRED`.
- The approve link (`/checkoutnow?token=`) simulates the buyer approving.

### Billing
- Products, plans (including list by `product_id`) and subscriptions.
- The approve link activates the subscription and charges the first cycle.

### Transaction Search
- `GET /v1/reporting/transactions`:
  - The range is at most 31 days and `page_size` at most 500.
  - Returns payouts (`T0001`, negative amounts), captures (`T0006`) and subscription sales (`T0002`).

### Webhooks
- `POST /v1/notifications/verify-webhook-signature` returns `SUCCESS` only for events this fake signed and
  delivered, with an unmodified body and the right `webhook_id`.
- `POST /v1/notifications/simulate-event` returns 202. Simulated events are delivered but can **not** be verified,
  just like with PayPal.
- Subscriptions (`/v1/notifications/webhooks`: list, create, get, `PATCH` with JSON-patch `replace` on `/url` or
  `/event_types`, delete; `/:id/event-types`), the event-type catalog (`/v1/notifications/webhooks-event-types`), the
  event list (`/v1/notifications/webhooks-events?event_type&transaction_id&start_time&end_time&page_size`) and
  `POST /v1/notifications/webhooks-events/:id/resend`. Every event also goes to each matching subscription, signed with
  that subscription's id, so it verifies only with that id. Limits: 10 subscriptions (`WEBHOOK_NUMBER_LIMIT_EXCEEDED`),
  one per URL (`WEBHOOK_URL_ALREADY_EXISTS`), known event types only (`INVALID_EVENT_TYPE`). `scripts/golive`'s
  `sandbox-setup` registers webhooks through these endpoints.
- `GET /v1/notifications/webhooks-events/:id`

Deliveries carry PayPal's headers: `paypal-transmission-id`, `-time` and `-sig`, plus `paypal-cert-url` and
`paypal-auth-algo`. The signature is computed over PayPal's string,
`transmission_id|transmission_time|webhook_id|crc32(body)`. The fake signs with HMAC where PayPal uses RSA.
Deliveries are made in emission order, and each is retried 3×.

### Generic failure injection
`PayPal-Mock-Response` with `INTERNAL_SERVER_ERROR`, `SERVICE_UNAVAILABLE` or `RATE_LIMIT_REACHED` works on any
route. This is fake-only.

## Deterministic outcomes

The receiver decides what happens to each payout item:

| Receiver | Item status | Webhook |
|---|---|---|
| contains `unclaimed` (e.g. `rosa.unclaimed@example.com`) | UNCLAIMED (`RECEIVER_UNREGISTERED`) | `PAYMENT.PAYOUTS-ITEM.UNCLAIMED` |
| Venmo handle `@new-to-venmo…` | UNCLAIMED | `PAYMENT.PAYOUTS-ITEM.UNCLAIMED` |
| contains `@onhold` | ONHOLD | `PAYMENT.PAYOUTS-ITEM.HELD` |
| contains `@blocked` | BLOCKED | `PAYMENT.PAYOUTS-ITEM.BLOCKED` |
| contains `@failed` | FAILED | `PAYMENT.PAYOUTS-ITEM.FAILED` |
| anything else | SUCCESS | `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` |

Webhooks for a batch go out in this order:
1. `PAYMENT.PAYOUTSBATCH.PROCESSING`
2. One item event per item
3. `PAYMENT.PAYOUTSBATCH.SUCCESS`

Batch events carry no item data, which is real PayPal behaviour.

## Control plane (`/__fake/*`, no auth)

| Route | |
|---|---|
| `GET /__fake/state`, `GET /__fake/webhooks`, `GET /__fake/health` | Inspect |
| `POST /__fake/reset` | Wipe business state. Access tokens survive |
| `POST /__fake/config` | Patch config at runtime, e.g. `{"webhookTargetUrl": "…", "processingDelayMs": 0}` |
| `POST /__fake/claim/:payoutItemId` | UNCLAIMED → SUCCESS and emits `SUCCEEDED`. Used in the demo: "the agent helped her claim it" |
| `POST /__fake/items/:id/status` `{status}` | Force any status. `CANCELED` is treated as RETURNED plus a `CANCELED` event |
| `POST /__fake/batches/:id/process` | Finish a batch now |
| `POST /__fake/orders/:id/approve` `{fundingSource?: 'paypal'\|'venmo', payerEmail?}` | Donor approves |
| `POST /__fake/subscriptions/:id/activate` | Subscriber approves |
| `POST /__fake/tokens/expire` | Test token refresh |
| `POST /__fake/faults` `{pathPrefix, status, count, retryAfterSec?}` | Fail the next N matching calls |

## In tests

```ts
import { createFakePayPal } from '@neighborline/fake-paypal';
const fake = await createFakePayPal({ autoProcess: false, webhookTargetUrl }); // random port
// … fake.url, fake.state, await fake.idle() (webhooks drained), fake.reset(), await fake.close()
```
