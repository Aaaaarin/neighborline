# Changelog

## 0.1.0 — 2026-10-16

First release. Every name below is an export of `@neighborline/paypal` (or a method on one).

### Client
- `PayPalClient`:
  - OAuth2 client credentials, with cached tokens, early refresh and a single in-flight refresh.
  - Refreshes the token once on 401.
  - Per-attempt timeouts.
  - Jittered retries on 429 and 5xx (`isRetryableStatus`, `backoffDelayMs`), and honours `Retry-After` (`retryAfterMs`).
  - `PayPal-Request-Id` on every write; writes are replayed after a network error only with that key (`isSafeToReplay`).
  - Passes the `PayPal-Mock-Response` header through (`mockResponse`).
- Typed errors: `PayPalError` (base), `PayPalApiError`, `PayPalAuthError`, `PayPalTimeoutError`, `PayPalNetworkError`,
  `PayPalInputError` and `DuplicateBatchError`.
- `createPayPal`, `createPayPalFromEnv` and `resolvePayPalEnv` (`PAYPAL_MODE=fake|sandbox|live`).

### Payouts (`PayoutsApi`)
- `createBatch`, `getBatch` (one page), `listAllItems` (follows pagination), `getItem`, `cancelUnclaimedItem`.
- Venmo: a note is required, `socialFeedPrivacy` defaults to `PRIVATE`, and `USER_HANDLE` recipients are supported.
- `purpose` support (Neighborline sends `NON_GOODS_OR_SERVICES`).
- `createBatch` resolves a duplicate `sender_batch_id` to the original batch (`duplicate: true`); without a link to it,
  it throws `DuplicateBatchError`.

### Payout status
- A payout item state machine that stays correct when webhooks arrive late, twice or out of order:
  `applyItemStatus(current, incoming)`, `canTransition`, `itemStatusFromEvent`, `mapTransactionStatus`, `mapBatchStatus`.

### Webhooks (`WebhooksApi`)
- `verifyWebhookSignature` splices the raw body into the verification request (`buildVerifyRequestBody`).
- `parseWebhookEvent` returns a typed union (`WebhookEvent`), throwing `WebhookParseError` on bad input.
- `simulateEvent` (sandbox simulator; simulated events cannot be signature-verified, by PayPal design).

### Orders and Subscriptions
- `OrdersApi`: `createDonationOrder`, `captureOrder` (idempotent: `ORDER_ALREADY_CAPTURED` returns the existing
  capture), `getOrder`; helpers `buildDonationOrder`, `summarizeCapture`.
- `SubscriptionsApi`: `ensureProduct`, `ensureMonthlyPlan` (alias `ensurePlan`), `listPlans`, `ensureDonationTiers`
  ($10/$25/$50 by default, `DEFAULT_DONATION_TIERS_CENTS`), `getSubscription`.

### Transaction Search (`ReportingApi`)
- `searchTransactions` with automatic 31-day chunking (`chunkDateRange`) and pagination.
- Pure `reconcile(localItems, transactions, { asOf, lagMs })`, aware of the reporting lag
  (`TRANSACTION_SEARCH_LAG_MS`, 3 h).

### Approval tokens
- `batchDigest`, `signApprovalToken`, `createHmacApprovalVerifier`, `denyAllApprovals`: HMAC tokens bound to one
  batch digest, ≥ 2 distinct approvers and an expiry.

### MCP server (`@neighborline/paypal/mcp`, bin `neighborline-payouts-mcp`)
- Read tools: `get_payout_batch`, `get_payout_item`, `search_transactions`, `reconcile_payouts`.
- `cancel_unclaimed_payout_item` (money returns to the sender).
- `create_payout_batch`, refused unless it carries a valid approval token; the default verifier denies everything.
