# API reference: `@neighborline/paypal`

Every export of every entry point, grouped by what you use it for. A test (`src/api-docs.test.ts`) fails if an export
is added without an entry here. Money is always **integer minor units** (`amountCents`); `"150.00"` strings only
exist on the wire.

| Import | Contents |
|---|---|
| `@neighborline/paypal` | Everything below except the MCP server |
| `@neighborline/paypal/approval` | Approval tokens only (no HTTP client). For the service that records human approvals |
| `@neighborline/paypal/webhooks` | Webhook verification, typed events and the payout status machine |
| `@neighborline/paypal/mcp` | `createPayoutsMcpServer` and its types |
| bin `neighborline-payouts-mcp` | The stdio MCP server ([docs/MCP.md](https://github.com/Aaaaarin/neighborline/blob/main/docs/MCP.md)) |

ESM only, Node ≥ 20, types included. Runtime dependencies: `@modelcontextprotocol/sdk` and `zod`.

## Contents

[Setup](#setup) · [Low-level client](#low-level-client) · [Payouts](#payouts) · [Payout status](#payout-status) ·
[Webhooks](#webhooks) · [Orders](#orders-donations) · [Subscriptions](#subscriptions) ·
[Transaction Search and reconciliation](#transaction-search-and-reconciliation) · [Approval tokens](#approval-tokens) ·
[MCP server](#mcp-server) · [Money](#money) · [Retries](#retries) · [Errors](#errors)

## Setup

| Export | Signature | Notes |
|---|---|---|
| `createPayPal` | `(options: PayPalClientOptions \| PayPalClient) => PayPal` | The facade: `{ client, payouts, orders, subscriptions, webhooks, reporting }` |
| `createPayPalFromEnv` | `(env?, extra?: Partial<PayPalClientOptions>) => PayPal & { env: ResolvedPayPalEnv }` | Reads `PAYPAL_MODE`, credentials and URLs from `process.env` (or the record you pass) |
| `resolvePayPalEnv` | `(env?) => ResolvedPayPalEnv` | Pure. `fake` → `FAKE_PAYPAL_URL` (default `http://localhost:4010`) with dummy credentials; `sandbox`/`live` require `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` and throw otherwise |
| `PayPal` | interface | `{ client: PayPalClient; payouts: PayoutsApi; orders: OrdersApi; subscriptions: SubscriptionsApi; webhooks: WebhooksApi; reporting: ReportingApi }` |
| `PayPalMode` | `'fake' \| 'sandbox' \| 'live'` | |
| `ResolvedPayPalEnv` | interface | `{ mode, baseUrl, clientId, clientSecret, webhookId }` |
| `PAYPAL_SANDBOX_URL` | `'https://api-m.sandbox.paypal.com'` | |
| `PAYPAL_LIVE_URL` | `'https://api-m.paypal.com'` | |
| `VERSION` | `string` | This package's version; also the MCP server's reported version |

## Low-level client

| Export | Signature | Notes |
|---|---|---|
| `PayPalClient` | `new PayPalClient(options: PayPalClientOptions)` | OAuth2 client credentials with a cached token, early refresh and one in-flight refresh; one retry of a 401 with a fresh token |
| `PayPalClient#request` | `<T>(options: RequestOptions) => Promise<PayPalResponse<T>>` | Retries 429/5xx with jittered backoff and `Retry-After`; a write is replayed after a network error only when it carries a `PayPal-Request-Id` (always true here: writes get a random key reused across retries). Throws the typed [errors](#errors) |
| `PayPalClient#getAccessToken` | `(forceRefresh?: boolean) => Promise<string>` | |
| `PayPalClient#invalidateToken` | `() => void` | |
| `PayPalClientOptions` | interface | `clientId`, `clientSecret`, `baseUrl` (required); `fetch`, `timeoutMs` (default 30 s per attempt), `retry: Partial<RetryPolicy>`, `tokenRefreshSkewMs` (default 5 min), `onRequest(info: RequestLog)`; `now`, `random`, `sleep` for tests |
| `RequestOptions` | interface | `method`, `path`, `query`, `body` (JSON-serialized for you) or `rawBody` (sent byte for byte), `requestId`, `mockResponse`, `prefer`, `headers`, `retry` (`false` disables) |
| `PayPalResponse<T>` | interface | `{ status, data: T, headers, requestId }` |
| `RequestLog` | interface | `{ method, path, attempt, status?, debugId?, error?, ms }`. Never contains bodies (they hold PII) |
| `MockResponse` | `string \| { mock_application_codes: string }` | Sent as `PayPal-Mock-Response` (sandbox negative testing) |

## Payouts

`paypal.payouts` is a `PayoutsApi`.

| Export | Signature | Notes |
|---|---|---|
| `PayoutsApi#createBatch` | `(input: CreateBatchInput) => Promise<CreateBatchResult>` | `POST /v1/payments/payouts`. `PayPal-Request-Id` defaults to `senderBatchId`. A reused `sender_batch_id` resolves to the original batch (`duplicate: true`); without a link it throws `DuplicateBatchError` |
| `PayoutsApi#getBatch` | `(batchId, { page?, pageSize?, totalRequired? }?) => Promise<BatchDetails>` | One page |
| `PayoutsApi#listAllItems` | `(batchId, pageSize = 1000) => Promise<NormalizedPayoutItem[]>` | Follows pagination |
| `PayoutsApi#getItem` | `(payoutItemId) => Promise<NormalizedPayoutItem>` | Includes PayPal's `errorName` (e.g. `RECEIVER_UNREGISTERED`), which webhooks never carry |
| `PayoutsApi#cancelUnclaimedItem` | `(payoutItemId) => Promise<NormalizedPayoutItem>` | Only for `UNCLAIMED` items; money returns to the sender |
| `buildPayoutRequest` | `(input: CreateBatchInput) => wire body` | Pure validation + wire format. Throws `PayPalInputError` for: no items or more than 15,000, mixed currencies, a non-positive or non-integer amount, duplicate `senderItemId`, a Venmo item without a note, `USER_HANDLE` on the PayPal wallet, `socialFeedPrivacy` off Venmo, an unknown `purpose`, over-long fields |
| `normalizeItem` | `(wireItem) => NormalizedPayoutItem` | Wire item → typed item with cents and a mapped status |
| `isDuplicateSenderBatchError` | `(err: unknown) => err is PayPalApiError` | Matches on the issue text/field, since PayPal's error name for this is undocumented |
| `findExistingBatchId` | `(errorBody: unknown) => string \| undefined` | Scans every link array for `/v1/payments/payouts/{id}` |
| `CreateBatchInput` | interface | `{ senderBatchId, emailSubject?, emailMessage?, items: PayoutItemInput[], requestId?, mockResponse? }` |
| `PayoutItemInput` | interface | `{ senderItemId, amountCents, currency? = 'USD', receiver, recipientType, wallet? = 'PAYPAL', note?, purpose?, socialFeedPrivacy? = 'PRIVATE', notificationLanguage? }` |
| `CreateBatchResult` | interface | `{ batchId, status: BatchStatus, paypalStatus, senderBatchId, timeCreated, duplicate, raw }` |
| `BatchDetails` | interface | `{ batchId, status, paypalStatus, senderBatchId, timeCreated, timeCompleted, amountCents, feesCents, currency, items, totalItems, totalPages, hasNextPage, raw }` |
| `NormalizedPayoutItem` | interface | `{ payoutItemId, payoutBatchId, senderBatchId, senderItemId, transactionId, activityId, status: PayoutItemStatus, paypalStatus, amountCents, currency, feeCents, receiver, recipientType, wallet, timeProcessed, errorName, errorMessage, raw }` |
| `PayoutRecipientType` | `'EMAIL' \| 'PHONE' \| 'USER_HANDLE' \| 'PAYPAL_ID'` | `USER_HANDLE` is a Venmo username. Sandbox rejects `PHONE` |
| `PayoutWallet` | `'PAYPAL' \| 'VENMO'` | One batch can mix both |
| `SocialFeedPrivacy` | `'PRIVATE' \| 'FRIENDS_ONLY' \| 'PUBLIC'` | Venmo only |
| `PAYOUT_PURPOSES` / `PayoutPurpose` | `readonly ['AWARDS', 'PRIZES', 'DONATIONS', 'GOODS', 'SERVICES', 'REBATES', 'CASHBACK', 'DISCOUNTS', 'NON_GOODS_OR_SERVICES']` | Set it explicitly: PayPal's default in the web UI is `GOODS` |

## Payout status

Also exported from `@neighborline/paypal/webhooks`.

| Export | Signature | Notes |
|---|---|---|
| `PAYOUT_ITEM_STATUSES` / `PayoutItemStatus` | `PENDING, SUCCESS, UNCLAIMED, RETURNED, ONHOLD, BLOCKED, FAILED, REFUNDED, REVERSED, CANCELED` | |
| `BATCH_STATUSES` / `BatchStatus` | `CREATING, UNKNOWN, PENDING, PROCESSING, SUCCESS, DENIED, CANCELED, FAILED, FAILED_RAIL, MANUAL` | `CREATING`, `UNKNOWN`, `FAILED_RAIL` and `MANUAL` are local states; `mapBatchStatus` never returns them |
| `PAYPAL_TRANSACTION_STATUSES` / `PayPalTransactionStatus` | PayPal's wire `transaction_status` values | |
| `mapTransactionStatus` | `(status?: string) => PayoutItemStatus` | Wire → local. Unknown or new values map to `PENDING` (re-poll), never to a final state |
| `mapBatchStatus` | `(status?: string) => BatchStatus` | |
| `itemStatusFromEvent` | `(eventType: string) => PayoutItemStatus \| undefined` | `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` → `SUCCESS`, `…DENIED` → `FAILED`, `…HELD` → `ONHOLD`, … |
| `PAYOUT_ITEM_EVENT_TYPES` | `string[]` | The `PAYMENT.PAYOUTS-ITEM.*` events |
| `PAYOUT_BATCH_EVENT_TYPES` | `readonly string[]` | The `PAYMENT.PAYOUTSBATCH.*` events |
| `ITEM_TRANSITIONS` | `Record<PayoutItemStatus, readonly PayoutItemStatus[]>` | The monotonic state machine |
| `canTransition` | `(from, to) => boolean` | |
| `applyItemStatus` | `(current, incoming) => ApplyResult` | Never regresses: a late `HELD` after `SUCCESS` is `{ changed: false, reason: 'stale' }` |
| `ApplyResult` | `{ status; changed: true } \| { status; changed: false; reason: 'same' \| 'stale' \| 'equivalent' }` | `CANCELED`/`RETURNED` for the same cancel are `equivalent` |
| `TERMINAL_STATUSES` | `ReadonlySet<PayoutItemStatus>` | `FAILED, RETURNED, BLOCKED, CANCELED, REFUNDED, REVERSED` |
| `PAID_STATUSES` | `ReadonlySet<PayoutItemStatus>` | `SUCCESS` |

## Webhooks

Also exported from `@neighborline/paypal/webhooks`. `paypal.webhooks` is a `WebhooksApi`.

| Export | Signature | Notes |
|---|---|---|
| `WebhooksApi#verifyWebhookSignature` | `(input: VerifyWebhookInput) => Promise<VerifyWebhookResult>` | `POST /v1/notifications/verify-webhook-signature` with the **raw body spliced in** byte for byte. Missing headers or a non-object body fail without a network call |
| `WebhooksApi#simulateEvent` | `({ eventType, webhookId?, url?, resourceVersion? }) => Promise<{ id, event_type, raw }>` | PayPal's simulator. Simulated events cannot be verified (PayPal's design) |
| `buildVerifyRequestBody` | `(input: VerifyWebhookInput) => string \| { error: 'missing_headers' \| 'invalid_body' }` | Pure |
| `getHeader` | `(headers: HeaderBag, name: string) => string \| undefined` | Case-insensitive over `Headers` or a plain record (Express/Node) |
| `WEBHOOK_HEADERS` | `{ transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo }` | Lower-case header names |
| `parseWebhookEvent` | `(raw: string \| unknown) => WebhookEvent` | Validates the envelope and the resource fields used (zod, passthrough). Throws `WebhookParseError` on malformed known events; unknown event types come back as `kind: 'unknown'` |
| `WebhookEvent` | discriminated union on `kind` | `payout_item` (`status`, `item`), `payout_batch` (`batchId`, `status`, `senderBatchId`), `order_approved`, `capture_completed`, `subscription_activated`, `sale_completed`, `unknown`. All carry `eventId` (dedupe on it), `eventType`, `createTime`, `raw` |
| `WebhookParseError` | `class extends Error` | |
| `VerifyWebhookInput` | interface | `{ headers: HeaderBag; rawBody: string; webhookId: string }` |
| `VerifyWebhookResult` | union | `{ verified: true, status: 'SUCCESS' } \| { verified: false, status: 'FAILURE', reason: 'paypal_failure' \| 'missing_headers' \| 'invalid_body' }` |
| `HeaderBag` | `Headers \| Record<string, string \| string[] \| undefined>` | |

## Orders (donations)

`paypal.orders` is an `OrdersApi`.

| Export | Signature | Notes |
|---|---|---|
| `OrdersApi#createDonationOrder` | `(input: CreateDonationOrderInput) => Promise<OrderSummary>` | `intent: CAPTURE`, `NO_SHIPPING`. Hand `id` to the PayPal JS SDK buttons |
| `OrdersApi#captureOrder` | `(orderId, { requestId?, mockResponse? }?) => Promise<CaptureSummary>` | Idempotent: `ORDER_ALREADY_CAPTURED` returns the existing capture with `alreadyCaptured: true` |
| `OrdersApi#getOrder` | `(orderId) => Promise<CaptureSummary>` | |
| `buildDonationOrder` | `(input: CreateDonationOrderInput) => wire body` | Pure |
| `summarizeCapture` | `(order, alreadyCaptured?) => CaptureSummary` | Pure |
| `CreateDonationOrderInput` | interface | `{ amountCents, currency?, description, customId?, invoiceId?, softDescriptor?, returnUrl?, cancelUrl?, brandName?, requestId?, mockResponse? }` |
| `OrderSummary` | interface | `{ id, status, approveUrl, raw }` |
| `CaptureSummary` | interface | `{ orderId, status, captureId, captureStatus, amountCents, feeCents, currency, customId, payerEmail, fundingSource, alreadyCaptured, raw }` |

## Subscriptions

`paypal.subscriptions` is a `SubscriptionsApi`.

| Export | Signature | Notes |
|---|---|---|
| `SubscriptionsApi#ensureProduct` | `(input: EnsureProductInput) => Promise<{ id, created }>` | Find-or-create by your stable id |
| `SubscriptionsApi#ensureMonthlyPlan` (alias `ensurePlan`) | `({ productId, amountCents, currency?, name? }) => Promise<PlanSummary & { created }>` | Find-or-create by name and price |
| `SubscriptionsApi#listPlans` | `(productId) => Promise<PlanSummary[]>` | |
| `SubscriptionsApi#ensureDonationTiers` | `({ product, tiersCents?, currency? }) => Promise<Record<number, string>>` | cents → plan id. Safe to run on every boot |
| `SubscriptionsApi#getSubscription` | `(id) => Promise<SubscriptionSummary>` | |
| `DEFAULT_DONATION_TIERS_CENTS` | `readonly [1000, 2500, 5000]` | |
| `planName` | `(amountCents, currency = 'USD') => string` | `"Monthly donation 25.00 USD"` |
| `EnsureProductInput` | interface | `{ id, name, description?, type?, category? }` |
| `PlanSummary` | interface | `{ id, productId, name, status, amountCents, currency }` |
| `SubscriptionSummary` | interface | `{ id, status, planId, customId, subscriberEmail, nextBillingTime, lastPaymentCents, approveUrl, raw }` |

## Transaction Search and reconciliation

`paypal.reporting` is a `ReportingApi`.

| Export | Signature | Notes |
|---|---|---|
| `ReportingApi#searchTransactions` | `(input: SearchTransactionsInput) => Promise<PayPalTransaction[]>` | `GET /v1/reporting/transactions`. Ranges over 31 days are split, every page is fetched |
| `chunkDateRange` | `(start: Date, end: Date, maxMs = MAX_WINDOW_MS) => Array<{ start, end }>` | Pure |
| `toRfc3339` | `(d: Date \| string) => string` | Seconds, no milliseconds, as Transaction Search requires |
| `MAX_WINDOW_MS` | `number` | 31 days |
| `TRANSACTION_SEARCH_LAG_MS` | `number` | 3 h: PayPal's documented maximum reporting delay |
| `EVENT_CODES` | `{ MASS_PAY: 'T0001', SUBSCRIPTION_PAYMENT: 'T0002', EXPRESS_CHECKOUT: 'T0006', DONATION: 'T0013', MASS_PAY_REVERSAL: 'T1114', MASS_PAY_REFUND: 'T1115', PAYMENT_REFUND: 'T1107' }` | |
| `SearchTransactionsInput` | interface | `{ startDate, endDate, transactionId?, transactionStatus?: 'D' \| 'P' \| 'S' \| 'V', fields?, pageSize?, page? }` |
| `PayPalTransaction` | interface | `{ transactionId, paypalReferenceId, eventCode, initiationDate, updatedDate, amountCents (signed: payouts are negative), currency, feeCents, status, customField, invoiceId, payerEmail, raw }` |
| `reconcile` | `(localItems: readonly LocalPayoutItem[], txns: readonly PayPalTransaction[], opts?: ReconcileOptions) => ReconcileReport` | Pure. Buckets: `matched`, `amountMismatch`, `currencyMismatch`, `statusDrift`, `missingAtPayPal`, `pendingLag` (younger than the lag: not an error yet), `missingLocally`, `noTransactionId`, `stuckPending`; plus `ok` and a one-line `summary` |
| `LocalPayoutItem` | interface | `{ id, amountCents, status: PayoutItemStatus, transactionId?, lastEventAt? }` |
| `ReconcileOptions` | interface | `{ asOf?, lagMs?, payoutEventCodes?, currency?, stuckAfterMs? = 24 h }` |
| `ReconcileReport` | interface | The buckets above, `ok: boolean`, `summary: string` |

## Approval tokens

Also exported from `@neighborline/paypal/approval`, which loads nothing but `node:crypto`. The design, with a
diagram, is in the [README](./README.md#the-approval-token).

| Export | Signature | Notes |
|---|---|---|
| `batchDigest` | `(batch: Pick<CreateBatchInput, 'senderBatchId' \| 'items'>) => string` | SHA-256 hex over `sender_batch_id` and each item's `senderItemId`, amount, currency, wallet, recipient type and receiver (trimmed, lower-cased). Item order does not matter; the note does not count |
| `signApprovalToken` | `(secret, { approvalId, batch, approvers: string[], ttlSec? = 600, now? }) => string` | `nlap1.<payload>.<HMAC-SHA256>`. The secret must be ≥ 32 characters. Call it only after your own records show the humans approved |
| `createHmacApprovalVerifier` | `(secret, { minApprovers? = 2, now? }?) => ApprovalVerifier` | Checks, in order: shape, signature (constant-time), expiry, `sender_batch_id`, batch digest, distinct approvers (trimmed, case-insensitive) |
| `readApprovalToken` | `(token: string) => ApprovalPayload \| null` | Decodes **without verifying**, for display and logs. Never authorize with it |
| `denyAllApprovals` | `ApprovalVerifier` | The MCP server's default: refuses everything |
| `ApprovalVerifier` | `(req: ApprovalRequest) => ApprovalDecision \| Promise<ApprovalDecision>` | Plug in your own (e.g. look the approval up in your database) |
| `ApprovalRequest` | interface | `{ approvalToken, batch: CreateBatchInput, digest }` |
| `ApprovalDecision` | union | `{ ok: true, approvalId?, approvers? } \| { ok: false, reason }` |
| `ApprovalPayload` | interface | `{ v: 1, approvalId, senderBatchId, digest, approvers, iat, exp }` |

## MCP server

From `@neighborline/paypal/mcp`. Tools, client configuration and the demo: [docs/MCP.md](https://github.com/Aaaaarin/neighborline/blob/main/docs/MCP.md).

| Export | Signature | Notes |
|---|---|---|
| `createPayoutsMcpServer` | `(options: PayoutsMcpOptions) => McpServer` | Six tools: `get_payout_batch`, `get_payout_item`, `search_transactions`, `reconcile_payouts`, `cancel_unclaimed_payout_item`, `create_payout_batch`. Connect it to any transport from `@modelcontextprotocol/sdk` |
| `PayoutsMcpOptions` | interface | `{ paypal: PayPal \| PayPalClient \| PayPalClientOptions; approvalVerifier? = denyAllApprovals; onAudit?(entry: AuditEntry); name?; version?; refusalHint? }` |
| `AuditEntry` | interface | `{ tool, at, outcome: 'ok' \| 'refused' \| 'error', detail?, senderBatchId?, approvalId? }`. No amounts or receivers |
| `DEFAULT_REFUSAL_HINT` | `string` | Appended to every refusal of `create_payout_batch`; override with `refusalHint` |

## Money

| Export | Signature | Notes |
|---|---|---|
| `toPayPalValue` | `(minorUnits: number, currency = 'USD') => string` | `15000 → "150.00"`, `500` JPY → `"500"`. Throws on non-integers, never rounds |
| `fromPayPalValue` | `(value: string, currency = 'USD') => number` | `"150.00" → 15000`. Strict decimal parsing |
| `minorUnitDigits` | `(currency) => 0 \| 2` | Zero-decimal currencies (JPY, HUF, TWD) → 0 |
| `money` | `(amountCents, currency = 'USD') => PayPalMoney` | `{ currency, value }` (Payouts shape) |
| `amount` | `(amountCents, currency = 'USD') => PayPalAmount` | `{ currency_code, value }` (Orders shape) |
| `PayPalMoney` | interface | `{ currency, value }` |
| `PayPalAmount` | interface | `{ currency_code, value }` |

## Retries

| Export | Signature | Notes |
|---|---|---|
| `DEFAULT_RETRY` | `RetryPolicy` | `{ maxRetries: 3, baseDelayMs: 300, maxDelayMs: 8000 }` |
| `RetryPolicy` | interface | `{ maxRetries, baseDelayMs, maxDelayMs }` |
| `isRetryableStatus` | `(status) => boolean` | 429 and 5xx only. A 4xx is never retried |
| `isSafeToReplay` | `(method, hasRequestId) => boolean` | GET, or a write with a `PayPal-Request-Id` |
| `backoffDelayMs` | `(attempt, policy, random?) => number` | Full-jitter exponential |
| `retryAfterMs` | `(header, now?, capMs = 30000) => number \| undefined` | Seconds or HTTP date |

## Errors

| Export | Notes |
|---|---|
| `PayPalError` | Base class of everything below |
| `PayPalApiError` | Non-2xx. `name` (PayPal's, e.g. `UNPROCESSABLE_ENTITY`), `status`, `debugId`, `details: PayPalErrorDetail[]`, `issue` (first `details[].issue`), `hasIssue(code)`, `retryable`, `informationLink`, `links`, `body`, `method`, `path` |
| `PayPalAuthError` | The OAuth token request failed (`extends PayPalApiError`) |
| `PayPalTimeoutError` | `method`, `path`, `timeoutMs` |
| `PayPalNetworkError` | `method`, `path`, `cause` |
| `PayPalInputError` | Rejected locally before anything was sent. `field` |
| `DuplicateBatchError` | The `sender_batch_id` was used before and PayPal gave no link. `senderBatchId`, `cause`. Nothing was paid twice |
| `isAmbiguousPayPalError` | `(err) => boolean`. True when a failed write may have landed (timeouts, network errors, 5xx, 408, 429, `DuplicateBatchError`): keep the batch `UNKNOWN` and re-send the same `sender_batch_id`, never mark it failed |
| `PayPalErrorDetail` | `{ field?, value?, location?, issue, description?, link?, links? }` |
| `PayPalLink` | `{ href, rel, method?, encType? }` |
