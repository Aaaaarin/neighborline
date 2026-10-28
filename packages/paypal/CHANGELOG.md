# Changelog

All notable changes to `@neighborline/paypal`. Versions follow [semver](https://semver.org); while the version is
0.x, a minor bump may change behaviour, and every such change is listed here.

## Unreleased

### Added (from the real sandbox run, 2026-10-28)
- `isReportingNotReady(err)`: Transaction Search answers `404 INVALID_REQUEST` "Data for the given start date is not
  available." on a brand-new account. Callers treat it as reporting lag (pending), not as a failure.
- `WebhooksApi#listEvents` and the pure `webhookEventsQuery`: `GET /v1/notifications/webhooks-events` with
  `start_time` and `end_time` both in second-precision UTC. The sandbox refused a millisecond `start_time` with no
  `end_time` (400 `VALIDATION_ERROR`) and accepted this form.

## 0.2.0 — 2026-10-16 (first npm release candidate, not yet published)

0.1.0 was only ever used inside the monorepo; 0.2.0 is the first version built to be published.

### Packaging
- Publish-ready: ESM-only `exports` map with `types` first for every entry, `sideEffects: false`, `engines.node >= 20`,
  `publishConfig` with `access: public` and `provenance: true`, keywords, and a `files` allowlist (`dist`, README,
  API.md, CHANGELOG, PAYPAL_NOTES, LICENSE). The tarball is 33 files, about 96 kB.
- New subpath entry points: `@neighborline/paypal/approval` (approval tokens only; loads nothing but `node:crypto`)
  and `@neighborline/paypal/webhooks` (verification, typed events, the payout status machine), next to `./mcp`.
- `scripts/pack-check.mjs` (`pack:check`) packs with pnpm and fails on stray files, missing export or bin targets,
  `workspace:` ranges or credential-looking strings; `scripts/pack-smoke.mjs` (`pack:smoke`) installs the tarball in a
  clean project and exercises every subpath, `tsc` with `nodenext`, and the MCP bin against fake PayPal.
- `prepublishOnly` refuses `npm publish` from the package folder (npm ignores the `publishConfig` export overrides);
  releases publish the checked tarball from `.github/workflows/release-paypal.yml` with npm provenance.
- `API.md`: a reference for every export, kept complete by a test. README rewritten: quick start, the approval-token
  design with a diagram, security notes.
- The workspace `package.json` no longer has a `main` field (`exports` already covers every consumer), so
  `npm pack --dry-run` no longer lists `src/index.ts`.

### MCP server
- `create_payout_batch` without an `approval_token` (or with an empty one) is now refused by the tool itself, with
  the reason `no approval_token; an agent cannot authorize a payout on its own`, and the refusal is audited.
  Previously it failed schema validation, which was neither audited nor phrased for the agent. The field is
  therefore optional in the input schema; its description and the tool description still say it is required.
- `refusalHint` option (default `DEFAULT_REFUSAL_HINT`) replaces the Neighborline-specific sentence appended to every
  refusal.
- The server reports the package `VERSION` (new export) instead of a hard-coded `0.1.0`.

### Approval tokens
- `readApprovalToken(token)`: decode a token's payload without verifying it, for display and logs.
- Dedicated unit tests for `batchDigest`, signing, verification and every refusal reason.

### Reconcile
- `reconcile()` adds three buckets: `currencyMismatch`, `statusDrift` (PayPal's `transaction_status` S/P/D/V checked
  against the local item status) and `stuckPending`
  (`PENDING`/`ONHOLD` with no transaction id after `stuckAfterMs`, default 24 h).

### Payouts
- `BATCH_STATUSES` adds two local states (mirroring `@neighborline/core`): `FAILED_RAIL` (PayPal refused the create
  call at the account level, e.g. `SENDER_RESTRICTED`, `SENDER_LOCKED`, `AUTHORIZATION_ERROR`; nothing was sent) and
  `MANUAL` (the caller recorded the payout as made outside PayPal). `mapBatchStatus` never returns either.

### Errors
- `isAmbiguousPayPalError(err)`: true for timeouts, network errors, 5xx, 408, 429 and a `DuplicateBatchError`
  without a link, where PayPal may have accepted (or certainly accepted) a write.
  Callers should keep the batch in an unknown state and re-send with the same `sender_batch_id` instead of marking it
  failed.

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
