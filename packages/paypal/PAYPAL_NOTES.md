# PayPal REST cheat sheet (verified Oct 16 2026)

This is what `@neighborline/paypal` and `tools/fake-paypal` are built against. Every fact has a source. **[obs]** marks
behaviour that the official docs do not spell out and that we took from community-observed sandbox responses. The code
handles these cases defensively, and they need checking against the real sandbox (see "To verify in sandbox").

Base URLs: sandbox `https://api-m.sandbox.paypal.com`, live `https://api-m.paypal.com`.

## OAuth2 (client credentials)
- `POST /v1/oauth2/token`, Basic auth `base64(client_id:client_secret)`, `Content-Type: application/x-www-form-urlencoded`,
  body `grant_type=client_credentials`.
- The response contains `scope`, `access_token`, `token_type: "Bearer"`, `app_id`, `expires_in` (seconds; the sample
  shows 31668, about 8.8h) and `nonce`. When the token expires, request a new one. Cache it and don't mint one per
  call (the payouts rate-limit guidance says the same).
- A bad client returns `401 {"error":"invalid_client","error_description":"Client Authentication failed"}`. This is
  OAuth-style and does **not** use the `{name,message,debug_id}` shape that API errors use.
- Sources: https://developer.paypal.com/api/rest.md

## Error shape (all REST APIs)
- `{ name, message, debug_id, information_link?, details?: [{field?, value?, location?, issue, description?}], links? }`.
- Always log `debug_id`, because PayPal support asks for it.
- Sources: https://docs.paypal.ai/reference/api/rest/payouts/create-batch-payout.md ,
  https://docs.paypal.ai/reference/api/rest/payouts-item/show-payout-item-details.md

## Payouts v1
Scope: `https://uri.paypal.com/payments/payouts`.

### `POST /v1/payments/payouts` → `201`
- **`sender_batch_header`:**
  - `sender_batch_id` (≤256 chars)
  - `recipient_type?` (`EMAIL|PHONE|PAYPAL_ID`; the default for items)
  - `email_subject?` (≤255 chars)
  - `email_message?` (≤1000 chars)
  - `note?`
- **`items[]`** (1–15,000 per call):
  - `recipient_type` is `EMAIL|PHONE|PAYPAL_ID|USER_HANDLE` (USER_HANDLE is a Venmo handle). It is required on each
    item when the header has none.
  - `amount: {value: "150.00", currency: "USD"}`
  - `receiver` (≤127 chars)
  - `note` (≤4000 ASCII / 1000 non-ASCII chars)
  - `sender_item_id` (≤63 chars)
  - `recipient_wallet` (`PAYPAL` default | `VENMO`)
  - `notification_language`
  - `alternate_notification_method.phone`
  - `application_context: { social_feed_privacy: PUBLIC|FRIENDS_ONLY|PRIVATE (default PRIVATE), logo_url, holler_url (deprecated) }`.
    This is Venmo metadata.
  - `purpose`: `AWARDS|PRIZES|DONATIONS|GOODS|SERVICES|REBATES|CASHBACK|DISCOUNTS|NON_GOODS_OR_SERVICES`. The Payouts
    Web default is `GOODS`.
- **Response:**
  - `batch_header`:
    - `payout_batch_id` (13 chars, e.g. `Y4JB5BNLE8Z88`)
    - `batch_status`: `DENIED|PENDING|PROCESSING|SUCCESS|CANCELED`. A batch that passes the initial scan is `PENDING`.
    - `time_created`
    - `sender_batch_header`
  - `links[]`: `self` GET
- **One currency per call:** to pay in another currency, make a separate call.
- **Rate limit:** 400 POSTs per minute. Over that, you get `429 RATE_LIMIT_REACHED`.
- **Sandbox does not support `recipient_type: PHONE`.**
- Sources:
  - https://docs.paypal.ai/reference/api/rest/payouts/create-batch-payout.md
  - https://developer.paypal.com/api/payouts/standard.md
  - https://developer.paypal.com/api/payments.payouts-batch/v1/definitions/payout_item_detail
  - https://developer.paypal.com/api/payouts/test-go-live.md

### Idempotency (the key part)
- **`sender_batch_id`:** if you reuse an ID from the last 30 days, the request is rejected. The error identifies the
  duplicate and carries a **HATEOAS link to the original batch**. PayPal completes a payment only once per
  `sender_batch_id` in 30 days. On a 5xx, retry with the **same** `sender_batch_id`.
- **The error `name` is not documented.** [obs] Sandbox returns
  `400 {"name":"USER_BUSINESS_ERROR", "details":[{"field":"SENDER_BATCH_ID","issue":"Batch with given sender_batch_id already exists","link":[{"href":".../v1/payments/payouts/<batch_id>","rel":"self","method":"GET"}]}]}`.
  Note that the link key here is `link`, not `links`.
- **How we resolve it:**
  - `isDuplicateSenderBatchError()` matches on the issue text or the field, not on `name` alone.
  - `findExistingBatchId()` scans *all* link arrays in the error body for `/v1/payments/payouts/{id}`.
  - `createBatch` then GETs that batch and returns it with `duplicate: true`.
  - If no link is present, it throws a typed `DuplicateBatchError`. The caller then uses its stored `paypalBatchId`.
  - `GET /v1/payments/payouts` has **no** search-by-`sender_batch_id` endpoint, so we persist the mapping.
- **`PayPal-Request-Id`** (1–1000 chars) is stored for 30 days on payouts.
  - A repeated request with the same key returns the **latest state of the original payout**.
  - If two *simultaneous* requests share a key, PayPal processes the first and fails the second.
    `PREVIOUS_REQUEST_IN_PROGRESS` is listed as a payouts test value.
  - If you change the body under the same key, the request is treated as a different request.
  - We send `PayPal-Request-Id = sender_batch_id`, which gives belt-and-braces protection.
- Sources:
  - https://developer.paypal.com/api/payouts/customize.md
  - https://developer.paypal.com/api/payouts/standard/customize.md
  - https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-post

### Reads and cancel
- **`GET /v1/payments/payouts/{payout_batch_id}?page=&page_size=&total_required=&fields=`**
  - `page` defaults to 1; `page_size` max 1000; `total_required` defaults to false.
  - Returns `{batch_header, items[], links, total_items?, total_pages?}`.
- **`GET /v1/payments/payouts-item/{payout_item_id}`** returns:
  - `payout_item_id`, `transaction_id`, `activity_id`, `transaction_status`
  - `payout_item_fee`: starts at 0 and is filled in at PENDING
  - `payout_batch_id`, `sender_batch_id`, `payout_item` (echo of the request item)
  - `currency_conversion`, `time_processed`, `errors`, `links`
- **`POST /v1/payments/payouts-item/{payout_item_id}/cancel`:**
  - Works on **`UNCLAIMED` only**. Afterwards, the only possible `transaction_status` is `RETURNED`.
  - Unclaimed items are auto-returned after 30 days.
- **`transaction_status` values:**
  - `SUCCESS`
  - `FAILED`: no money deducted
  - `PENDING`
  - `UNCLAIMED`: recipient has no account; PayPal emails or texts a claim link
  - `RETURNED`: unclaimed for 30 days, or cancelled
  - `ONHOLD`
  - `BLOCKED`
  - `REFUNDED`: recipient refunded it
  - `REVERSED`: only for web-upload payouts
- Sources:
  - https://docs.paypal.ai/api-reference/payments_payouts_batch_v1.json
  - https://developer.paypal.com/payouts/use-payouts/track-payout-item-status.md

### Venmo payouts
- Set `recipient_wallet: "VENMO"`. Recipients can be `PHONE` (US mobile), `EMAIL` or `USER_HANDLE` (Venmo username).
  The product is US-only.
- **A note is required for Venmo:**
  - Payouts Web says "A message must be included for each recipient".
  - The sandbox test value `ERRPYO013` simulates "VALIDATION_ERROR FOR VENMO NOTE MISSING".
- `application_context.social_feed_privacy` defaults to `PRIVATE`. We always send `PRIVATE` explicitly. The
  Venmo-specific page says only that the note "inherits the recipient's privacy settings".
- Sandbox positive test value `POSPYO003` returns "201 for Venmo". Remember that sandbox rejects `PHONE`, so test
  Venmo with `EMAIL` or `USER_HANDLE`.
- Sources:
  - https://developer.paypal.com/payouts/use-payouts/venmo.md
  - https://docs.paypal.ai/send-payouts/send-money
  - https://docs.paypal.ai/send/test-go-live

### Payouts negative testing (sandbox)
Payouts does **not** use the `PayPal-Mock-Response` header. You put a test value in the payload or in the path instead.
- **`POST /v1/payments/payouts`:** put the value in `items[0].note`.
  - `ERRPYO001` SENDER_RESTRICTED
  - `ERRPYO002` SENDER_EMAIL_UNCONFIRMED
  - `ERRPYO003` AUTHORIZATION_ERROR
  - `ERRPYO005` INSUFFICIENT_FUNDS
  - `ERRPYO006` INTERNAL_ERROR
  - `ERRPYO010` VALIDATION_ERROR
  - `ERRPYO011` REQUIRED_SCOPE_MISSING
  - `ERRPYO012` SENDER_LOCKED
  - `ERRPYO014` USER_BUSINESS_ERROR
  - `ERRPYO035` RATE_LIMIT_VALIDATION
  - `ERRPYO036` REQUEST_TIMEOUT_EXCEEDED
  - `ERRPYO038` NON_HOLDING_CURRENCY
  - `ERRPYO039` PREVIOUS_REQUEST_IN_PROGRESS
  - `ERRPYO040` CIP_NOT_VERIFIED
  - `ERRPYO013` goes in `items[0].sender_batch_id` and gives the Venmo note-missing error.
  - `POSPYO001` returns 201; `POSPYO003` returns 201 for Venmo.
- **`GET /v1/payments/payouts/{id}`:** use the path value.
  - `ERRPYOB001` SUCCESS, `ERRPYOB002` PENDING, `ERRPYOB003` PROCESSING, `ERRPYOB004` DENIED
  - `ERRPYO018` DUPLICATE_ITEM, among others
- **Cancel:**
  - `ERRPOI001` INVALID_RESOURCE_ID
  - `ERRPYO004` BATCH_NOT_COMPLETED
  - `ERRPYO007` ITEM_ALREADY_CANCELLED
  - `ERRPYO009` ITEM_INCORRECT_STATUS
- **Item GET:** `ERRPYO041`–`ERRPYO061`, e.g. `ERRPYO047` RECEIVER_UNREGISTERED, `ERRPYO052` RISK_DECLINE.
- **The docs give no HTTP status for these errors.** The fake chooses statuses: 422 for business errors, 400 for
  validation errors, 500 for INTERNAL_ERROR and 429 for rate limits.
- Webhook payloads never include error objects. To get the reason for a failure, GET the item.
- Source: https://docs.paypal.ai/send/test-go-live , https://developer.paypal.com/api/payouts/test-go-live.md

### Payouts webhooks
- **Batch events:** `PAYMENT.PAYOUTSBATCH.PROCESSING|SUCCESS|DENIED`. These carry **no item info**, so follow the
  HATEOAS links to get the items.
- **Item events:** `PAYMENT.PAYOUTS-ITEM.SUCCEEDED|UNCLAIMED|RETURNED|BLOCKED|CANCELED|DENIED|FAILED|HELD|REFUNDED`.
- `PAYMENT.PAYOUTS-ITEM.REVERSED` is **not** in either official list. We still map it defensively.
- The item resource is the payout-item detail (`payout_item_id`, `transaction_status`, `payout_item`, `links`, …).
- Sources: https://developer.paypal.com/payouts/webhooks.md , https://docs.paypal.ai/send/webhook-reference

## Webhooks
- **Delivery headers:**
  - `PAYPAL-TRANSMISSION-ID`
  - `PAYPAL-TRANSMISSION-TIME`
  - `PAYPAL-TRANSMISSION-SIG`
  - `PAYPAL-CERT-URL`
  - `PAYPAL-AUTH-ALGO` (`SHA256withRSA`)
- **The signature** is over `transmission_id|transmission_time|webhook_id|crc32(raw body)`. **Re-serializing the
  body changes the CRC32.**
- **`POST /v1/notifications/verify-webhook-signature`:**
  - Body: `{auth_algo, cert_url, transmission_id, transmission_sig, transmission_time, webhook_id, webhook_event}`,
    all required.
  - Response: `{verification_status: "SUCCESS"|"FAILURE"}`.
  - We splice the **raw body bytes** in as `webhook_event`; we do not `JSON.stringify(JSON.parse(raw))`.
- **Retries and dedupe:** PayPal retries delivery up to 25 times over 3 days. Dedupe on `event.id`. Order is not
  guaranteed, so we apply item status with a monotonic state machine (`applyItemStatus`).
- **`POST /v1/notifications/simulate-event`:**
  - Body: `{webhook_id | url, event_type, resource_version?}`; returns `202` with the event.
  - **Simulated events cannot be verified with verify-webhook-signature.** They carry sample data and are not tied
    to an app.
- Sources:
  - https://docs.paypal.ai/reference/api/rest/verify-webhook-signature/verify-webhook-signature.md
  - https://docs.paypal.ai/reference/api/rest/simulate-event/simulate-webhook-event.md
  - https://developer.paypal.com/api/rest/webhooks/simulator.md
  - https://hookdeck.com/webhooks/platforms/how-to-secure-and-verify-paypal-webhooks-with-hookdeck.md

## Orders v2 (donations)
- **`POST /v2/checkout/orders`:**
  - `intent: CAPTURE`
  - `purchase_units[]` (1–10), each with `reference_id`, `description`, `custom_id`, `invoice_id` (unique per
    merchant), `soft_descriptor` and `amount{currency_code,value,breakdown}`.
  - `items[].category` is `DIGITAL_GOODS|PHYSICAL_GOODS|DONATION`.
  - `payment_source.paypal.experience_context` takes `return_url`, `cancel_url`, `user_action`,
    `shipping_preference` (`NO_SHIPPING`) and `brand_name`. The old `application_context` is deprecated.
- **Headers:**
  - `PayPal-Request-Id` is kept for 6h (up to 72h). It is **mandatory when `payment_source` is sent**.
  - `Prefer: return=minimal|representation`.
  - An idempotent repeat returns **200** instead of 201.
- **Statuses:** `CREATED|SAVED|APPROVED|VOIDED|COMPLETED|PAYER_ACTION_REQUIRED`. Links include
  `approve`/`payer-action`, `self`, `edit` and `capture`.
- **`POST /v2/checkout/orders/{id}/capture`** returns the capture at `purchase_units[].payments.captures[]`.
  `ORDER_ALREADY_CAPTURED` is a 422 issue.
- **`PayPal-Mock-Response: {"mock_application_codes":"<ISSUE>"}`** gives negative testing for Orders v2 and
  Payments v1/v2 only (e.g. `DUPLICATE_INVOICE_ID`, `INSTRUMENT_DECLINED`).
- Sources:
  - https://docs.paypal.ai/reference/api/rest/orders/create-order.md
  - https://developer.paypal.com/negative-testing/request-headers

## Catalog Products + Subscriptions v1
- **`POST /v1/catalogs/products`:**
  - Fields: `id?` (6–50 chars; otherwise PayPal generates `PROD-…`), `name`, `type` (`PHYSICAL|DIGITAL|SERVICE`),
    `category?`, `description?`, `home_url?`, `image_url?`.
  - `PayPal-Request-Id` is kept for 72h.
- **`POST /v1/billing/plans`:**
  - Fields: `product_id`, `name`, `status`, and
    `billing_cycles[{frequency{interval_unit:MONTH,interval_count:1}, tenure_type:REGULAR, sequence:1, total_cycles:0, pricing_scheme{fixed_price{value,currency_code}}}]`.
  - Also `payment_preferences{auto_bill_outstanding, payment_failure_threshold}`.
  - `GET /v1/billing/plans?product_id=` lists plans.
- **`GET /v1/billing/subscriptions/{id}`** status is `APPROVAL_PENDING|APPROVED|ACTIVE|SUSPENDED|CANCELLED|EXPIRED`.
  Each recurring charge raises `PAYMENT.SALE.COMPLETED` (a v1 sale: `amount.total`, `billing_agreement_id`).
- Sources:
  - https://developer.paypal.com/api/catalog-products/v1/products-create
  - https://developer.paypal.com/api/subscriptions/v1

## Transaction Search v1
- **`GET /v1/reporting/transactions`**
  - Required: `start_date` and `end_date`, RFC 3339 with seconds. **The range can be at most 31 days.**
  - Optional filters: `transaction_id`, `transaction_type`, `transaction_status` (`D|P|S|V`), `transaction_amount`,
    `transaction_currency`.
  - `fields=all`; `page_size` 1–500 (default 100); `page` starts at 1. The search covers the last 3 years.
- **Data shows up to 3 hours after execution.** Reconcile must not flag recent items as missing.
- **Needs the Transaction Search permission** on the REST app, with scope
  `https://uri.paypal.com/services/reporting/search/read`.
- **Event codes:** payouts are `T0001` (Mass payment), with `T1114` mass-pay reversal and `T1115` mass-pay refund.
  Checkout is `T0006`, donations `T0013`, subscriptions `T0002`, refunds `T1107`.
- Sources:
  - https://docs.paypal.ai/reference/api/rest/transactions/list-transactions.md
  - https://developer.paypal.com/reports/reference/t-codes
  - https://developer.paypal.com/payouts/use-payouts/view-transactions.md

## To verify in the real sandbox (Oct 21–24)
1. The duplicate `sender_batch_id` error body: the exact name, status and link location. Our matcher is loose on
   purpose.
2. Whether Venmo payouts reach `SUCCESS` in sandbox, or only through `POSPYO003`. Sandbox `PHONE` rejection.
3. Whether a payout item's `transaction_id` equals the Transaction Search `transaction_id` (expected) and the lag.
4. Whether Venmo `USER_HANDLE` needs the leading `@` stripped.

## Pages we could not fetch (permission prompt timed out)
- https://developer.paypal.com/docs/api/payments.payouts-batch/v1/
- https://developer.paypal.com/api/payments.payouts-batch/v1/definitions/payout_item
- https://developer.paypal.com/api/payments.payouts-batch/v1.md

We covered the same facts from the docs.paypal.ai mirror and the OpenAPI spec linked above.
