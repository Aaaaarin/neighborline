# NOTES from the payments lane (packages/paypal, tools/fake-paypal)

These are requests for other lanes and integration notes. Nothing here has been edited outside my lane.

## For apps/web (web agent)

1. **Add these dependencies and transpile config:**
   - Add `"@neighborline/paypal": "workspace:*"` to `apps/web/package.json`.
   - Add `transpilePackages: ['@neighborline/core', '@neighborline/paypal']` to `next.config.ts`.
   - The package uses `node:crypto`. **Only import it from server code** (route handlers and `server-only` modules).
2. **Create one server-side instance**, for example in `lib/server/paypal.ts`:
   ```ts
   import 'server-only';
   import { createPayPalFromEnv } from '@neighborline/paypal';
   export const paypal = createPayPalFromEnv(); // PAYPAL_MODE=fake → FAKE_PAYPAL_URL; sandbox → PAYPAL_CLIENT_ID/SECRET
   ```
3. **`POST /api/approvals`.** Execute only once there are 2 distinct approvers:
   ```ts
   const res = await paypal.payouts.createBatch({
     senderBatchId: 'nl_' + approval.hash.slice(0, 24),          // SPEC §4; idempotent across double taps/retries
     emailSubject: 'Your neighbors sent you help',
     items: requests.map(r => ({
       senderItemId: r.id,                                       // ≤63 chars; echoed in webhooks → map back to the request
       amountCents: r.computed.amountCents,
       receiver: r.payoutDestination.value,
       recipientType: r.payoutDestination.type,                 // EMAIL | PHONE | USER_HANDLE
       wallet: r.payoutDestination.wallet,                      // PAYPAL | VENMO
       note: notifyText(r.lang),                                // REQUIRED for Venmo; ≤1000 chars if non-ASCII
       purpose: 'NON_GOODS_OR_SERVICES',                        // mutual aid isn't goods/services; DONATIONS is the alternative
       notificationLanguage: bcp47(r.lang),                     // e.g. 'es-US' (used only for recipients without PayPal)
     })),
   });
   // persist res.batchId as PayoutBatch.paypalBatchId. res.duplicate === true means "already sent earlier".
   ```
   - `PayPalInputError` means a local validation failure. Show it to organizers.
   - `DuplicateBatchError` means "already paid". Look up the stored `paypalBatchId`.
4. **`POST /api/webhooks/paypal`:**
   - Read `await req.text()` **before** parsing.
   - Call `paypal.webhooks.verifyWebhookSignature({ headers: req.headers, rawBody, webhookId: paypal.env.webhookId! })`.
   - Call `parseWebhookEvent(rawBody)`, then dedupe on `event.eventId`.
   - For `kind === 'payout_item'`, find the item by `event.item.senderItemId`. Apply
     `applyItemStatus(current, event.status)`, and persist and broadcast only if `changed`. Store
     `event.item.transactionId` and `payoutItemId`.
   - For `kind === 'payout_batch'`, PayPal sends no item data. Optionally call
     `paypal.payouts.listAllItems(event.batchId)` and apply each item's status the same way.
   - Always return 200 quickly. PayPal retries up to 25× over 3 days.
5. **`POST /api/payouts/:batchId/cancel-item`:** call `paypal.payouts.cancelUnclaimedItem(paypalItemId)`. The status
   becomes RETURNED, and you will also receive a `PAYMENT.PAYOUTS-ITEM.CANCELED` webhook. Both map to a final state.
6. **Donations:**
   - `POST /api/donate/order`: call `paypal.orders.createDonationOrder({ amountCents, description, customId })` and
     return `{ id }` to the JS SDK.
   - `.../capture`: call `paypal.orders.captureOrder(id)`.
   - `fundingSource` in the result is `'paypal'` or `'venmo'`.
   - Subscriptions: run `paypal.subscriptions.ensureDonationTiers({ product: { id: 'NEIGHBORLINE-DONATION', name: 'Neighborline monthly gift' } })`
     at startup, or in a script, to get `{1000,2500,5000} → plan_id`. This replaces the `PAYPAL_PLAN_ID_*` env vars.
7. **`POST /api/reconcile`:** call
   `reconcile(localItems, await paypal.reporting.searchTransactions({ startDate, endDate }))`. Show `pendingLag`
   separately ("PayPal reports lag up to 3h"), not as errors.
8. **Demo "agent helped her claim it":**
   - In fake mode, `POST {FAKE_PAYPAL_URL}/__fake/claim/{paypalItemId}` flips UNCLAIMED → SUCCESS and fires
     `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`.
   - Demo receivers: `rosa.unclaimed@example.com` → UNCLAIMED, `@new-to-venmo-…` → UNCLAIMED, everything else → SUCCESS.
9. **Sandbox reality panel (/trust):**
   - Sandbox rejects `recipient_type: PHONE` for payouts. Some seeded/fixture destinations use PHONE, so use EMAIL or
     a Venmo `USER_HANDLE` in sandbox mode.
   - Simulator webhooks can't be verified.
   - Transaction Search lags by up to 3h.
   - It is unverified whether Venmo payouts settle in sandbox.

## For root config (whoever owns it)

- Add these to `.env.example`:
  - `FAKE_PAYPAL_WEBHOOK_ID=0FAKEWEBHOOK0NEIGHBORLINE01`
  - `WEBHOOK_TARGET_URL=http://localhost:3000/api/webhooks/paypal` (read by fake-paypal)
  - `FAKE_PAYPAL_PROCESSING_DELAY_MS=1500`
  - `NEIGHBORLINE_APPROVAL_SECRET=` (≥32 chars; this enables `neighborline-payouts-mcp` create_payout_batch)
- `pnpm dev` could run fake-paypal alongside Next. For example:
  `concurrently "pnpm fake-paypal" "pnpm --filter @neighborline/web dev"` with
  `WEBHOOK_TARGET_URL=http://localhost:3000/api/webhooks/paypal`.

## For packages/core (domain agent)

- `packages/paypal` mirrors `PayoutItemStatus` and `PayoutBatch['status']` locally so the npm package doesn't depend
  on private core. `src/core-compat.test.ts` fails if they drift. If you change those enums, ping payments.
- `@neighborline/paypal` ships its own copy of the payout item state machine (`ITEM_TRANSITIONS`, `applyItemStatus`)
  so the published package stands alone. `core-compat.test.ts` asserts it is **identical** to core's
  `ITEM_TRANSITIONS`, `applyItemEvent` and `itemStatusForWebhookEvent`. Core stays the source of truth. If you change
  core's table, the paypal test fails, and payments mirrors the change.
