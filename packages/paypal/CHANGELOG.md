# Changelog

## 0.1.0 — 2026-10-16

First release.

### Client
- `PayPalClient`:
  - OAuth2 client credentials, with cached tokens, early refresh and a single in-flight refresh.
  - Refreshes the token once on 401.
  - Per-attempt timeouts.
  - Jittered retries on 429 and 5xx, and honours `Retry-After`.
  - `PayPal-Request-Id` on every write.
  - Passes the `PayPal-Mock-Response` header through.
- Typed errors: `PayPalApiError`, `PayPalAuthError`, `PayPalTimeoutError`, `PayPalNetworkError`, `PayPalInputError`
  and `DuplicateBatchError`.

### Payouts
- Create, get and paginate batches; get items; cancel unclaimed items.
- Venmo: a note is required, `social_feed_privacy` defaults to PRIVATE, and `USER_HANDLE` recipients are supported.
- `purpose` support.
- Resolves duplicate `sender_batch_id` errors to the original batch.

### Payout status
- A payout item state machine (`applyItemStatus`) that stays correct when webhooks arrive out of order.

### Webhooks
- `verifyWebhookSignature` splices the raw body into the verification request.
- `parseWebhookEvent` returns a typed union.
- `simulateEvent`.

### Orders and Subscriptions
- Orders v2 donations, with idempotent capture.
- Subscriptions: `ensureProduct`, `ensurePlan` and `ensureDonationTiers` ($10/$25/$50).

### Transaction Search
- Automatic 31-day chunking and pagination.
- Pure `reconcile()`, aware of the reporting lag.

### MCP server
- `neighborline-payouts-mcp`: an MCP server that exposes approval-token-gated Payouts tools.
