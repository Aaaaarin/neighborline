# Architecture

Neighborline is a pnpm monorepo of TypeScript ESM packages (strict mode). The authoritative domain contract is
[`packages/core/src/schemas.ts`](../packages/core/src/schemas.ts). Money is integer cents everywhere and becomes a
`"150.00"` string only at the PayPal boundary.

## Processes

Money can leave only through one process. Everything else, including every AI call, runs where there is no Payouts
client and no Payouts credential.

```mermaid
flowchart LR
    browser([Neighbors, organizers, donors]) -->|HTTPS| web
    subgraph web[apps/web — Next.js]
      intake[intake + AI agents]
      views[views, SSE, donations, reports]
      appr[approval-service.ts<br/>collects signatures]
    end
    appr -->|HMAC-signed, nonce, ±120 s<br/>POST /v1/execute| approver
    subgraph approver[apps/approver — only process with PAYPAL_PAYOUTS_*]
      verify[recompute hash · ≥2 distinct organizers<br/>re-verify passkeys · re-run computeAmount + checkRail]
    end
    approver -->|Payouts API| paypal[(PayPal)]
    web -->|Orders, Subscriptions,<br/>webhook verify, Transaction Search| paypal
    paypal -->|webhooks| web
    web --> db[(Postgres · dev: tools/dev-db)]
    approver --> db
    workflows[Render Workflows] -->|HMAC-signed /api/internal/*| web
```

| Process | Holds | Can | Cannot |
|---|---|---|---|
| `apps/web` | Main PayPal app keys (Orders, Subscriptions, webhooks, Transaction Search), model keys, `DATABASE_URL`, the approver HMAC key | Run intake and the AI agents, record approvals and passkey signatures, settle webhooks, serve every page | Construct a Payouts client, create a payout batch (one exception: seeding fictional demo history, which never calls PayPal), read `PAYPAL_PAYOUTS_*` (all three fail the build: [`least-privilege.test.ts`](../apps/web/lib/server/least-privilege.test.ts)) |
| `apps/approver` | Payouts app keys, `DATABASE_URL`, the approver HMAC key | Execute an approval record, poll a batch, cancel an unclaimed item, verify a Payouts-app webhook | Trust anything in the request beyond "look at approval X" (see below) |
| `tools/dev-db` (local only) | An in-memory PGlite | Serve it over the Postgres wire protocol on loopback so web and approver share one database in `pnpm dev` and e2e | Start in production (it refuses) |

**What the approver checks before it pays** ([`apps/approver/src/approver.ts`](../apps/approver/src/approver.ts)):

1. The payload it was sent is canonical (`core.approvalPayload`) and hashes to the claimed hash, which equals the hash
   on the stored approval record.
2. The record is `complete` with ≥ max(2, `group.requiredApprovals`) **distinct current organizers**, and the approver
   list in the request matches the record.
3. Each stored passkey (or, in `DEMO_MODE`, labelled demo-key) assertion verifies against that organizer's public key
   and that hash ([`assertions.ts`](../apps/approver/src/assertions.ts)); with `NEIGHBORLINE_REQUIRE_PASSKEYS=true` every
   approver must have one.
4. The content rebuilt from the request rows it reads itself hashes to the same value (amounts and destinations come
   from the database, never from the web request).
5. `core.computeAmount` and `core.checkRail`, re-run on the policy, history, today's spend and official handles it
   reads itself ([`recheck.ts`](../apps/approver/src/recheck.ts)), still allow every approved amount and raise no
   block flag.
6. `db.createBatch` re-checks `canExecute` under row locks and is idempotent per approval; `sender_batch_id` derives
   from the hash. Refusals and executions are appended to the hash-chained audit log (`approver.execute_refused`,
   `approver.executed`).

Requests are HMAC-signed with a per-deployment secret, timestamped (±120 s) and carry a nonce the approver accepts once
([`protocol.ts`](../apps/approver/src/protocol.ts)). In production the approver runs as a separate process in the web
instance with its own environment, or as its own Render private service; see [DEPLOY.md](DEPLOY.md#approver-process).

## Package boundaries

```mermaid
flowchart LR
    web[apps/web<br/>Next.js 15]
    approver[apps/approver<br/>Payouts]
    core[packages/core<br/>pure domain]
    db[packages/db<br/>Drizzle + Postgres/PGlite]
    agents[packages/agents<br/>LLM / STT / TTS]
    paypal[packages/paypal<br/>REST client + MCP server]
    passkeys[packages/passkeys<br/>WebAuthn over the approval hash]
    fake[tools/fake-paypal<br/>local PayPal]
    devdb[tools/dev-db<br/>local shared DB]
    toolkit[("@paypal/agent-toolkit<br/>optional")]

    web --> core
    web --> db
    web --> agents
    web -->|Orders, Webhooks, Reporting only| paypal
    web --> passkeys
    web -->|protocol module only| approver
    approver --> core
    approver --> db
    approver --> passkeys
    approver -->|PayoutsApi| paypal
    db --> core
    agents --> core
    agents -. runtime import .-> toolkit
    paypal -. dev/test only .-> core
    paypal -. dev/test only .-> fake
```

| Package | Owns | Must not |
|---|---|---|
| `packages/core` | zod schemas, policy validation, `computeAmount`, rail checks (handles, injection, history), approval hashing, request and payout-item state machines, i18n catalog, transparency report math, PII redaction | Do I/O. It depends only on `zod` |
| `packages/db` | Drizzle schema, migrations (SQL files embedded into `migrations.generated.ts`), repositories that enforce state transitions and write the audit log | Call PayPal or models |
| `packages/agents` | Provider abstraction (Anthropic, OpenAI, fixtures), the structured-output pipeline, IntakeAgent, PolicyCompiler, NotifyAgent, ReportWriter | Compute amounts, decide eligibility, depend on `@neighborline/paypal` (tested) |
| `packages/paypal` | Typed PayPal REST client, idempotency, webhook verification and parsing, item state machine copy, reconcile, approval tokens, `neighborline-payouts-mcp` | Depend on private packages at runtime (core is a dev dependency, used by a drift test) |
| `packages/passkeys` | WebAuthn challenge = approval hash, verification, labelled demo software authenticator | Hold PayPal keys |
| `apps/approver` | The only Payouts client in the running system; execute / poll / cancel-unclaimed / verify-webhook | Accept amounts, destinations or approvers from its caller |
| `apps/web` | Pages, route handlers, SSE stream, `/api/internal/*`. Everything goes through one interface, `Services`, in [`lib/server/services.ts`](../apps/web/lib/server/services.ts) | Put domain logic in components; import anything but `@neighborline/approver/protocol` from the approver |
| `tools/fake-paypal`, `tools/dev-db` | Local stand-ins for PayPal and Postgres | Ship to production |

### Runtime modes

| Variable | Values | Effect |
|---|---|---|
| `PAYPAL_MODE` | `fake` (default), `sandbox`, `live` | `resolvePayPalEnv()` picks `FAKE_PAYPAL_URL`, the sandbox or the live base URL ([`paypal.ts`](../packages/paypal/src/paypal.ts)). Outside `fake`, the approver requires `PAYPAL_PAYOUTS_CLIENT_ID/SECRET` |
| `AI_MODE` | `fixture` (default), `live` | `createProviders()` picks fixture or real providers ([`create.ts`](../packages/agents/src/providers/create.ts)) |
| `DATABASE_URL` | empty or a Postgres URL | `pnpm dev` and e2e set it to `tools/dev-db`; production uses Render Postgres. Without it the web app alone uses an in-process PGlite (tests) |
| `DEMO_MODE` | `true` / `false` | `false` disables `/api/demo/*`; in the approver it also stops accepting demo keys and stops excluding `req_demo_*` rehearsals from caps |
| `AUDIO_RETENTION` | `none` (default), `24h` | What happens to raw voice recordings after transcription |

## Data model

All tables are in [`packages/db/src/schema.ts`](../packages/db/src/schema.ts). JSON columns hold zod-validated core
types. Timestamps are `timestamptz`.

| Table | Key columns | Notes |
|---|---|---|
| `groups` | `id`, `slug`, `official_handles`, `fiscal_sponsor`, `active_policy_id`, `timezone`, `required_approvals` (default 2) | Official handles feed rail protection. `timezone` sets the daily-budget boundary |
| `organizers` | `id`, `group_id`, `handles`, `lang` | `handles` are the organizer's own accounts, used to block self-payment and lookalikes |
| `policies` | `id`, `group_id`, `version`, `body`, `status` | Unique `(group_id, version)`. A partial unique index allows one `active` policy per group |
| `requests` | `status`, `extracted`, `payout_destination`, `destination_key`, `phone_key`, `computed`, `amount_cents`, `rail_flags` | `destination_key` and `phone_key` are normalized for household and velocity lookups |
| `approvals` | `request_ids`, `total_cents`, `policy_version_id`, `hash`, `status` | Partial unique index: one live (non-void) approval per hash |
| `approval_signatures` | PK `(approval_id, organizer_id)` | "Two distinct organizers" is a database guarantee |
| `payout_batches` | `approval_id` (unique), `sender_batch_id` (unique), `paypal_batch_id` (unique) | One batch per approval |
| `payout_items` | `sender_item_id` (unique), `paypal_item_id` (unique), `status`, `transaction_id`, `was_unclaimed`, `success_at` | `was_unclaimed` and `success_at` feed the report |
| `donations` | `paypal_order_id` (unique), `transaction_id` (unique), `donor_key` | `donor_key` is an opaque non-PII key for distinct-donor counts |
| `webhook_events` | PK = PayPal event id, `verified`, `raw` | The PK is the dedupe key |
| `notifications` | `request_id`, `lang`, `message_key`, `text`, `status` | What was said to the neighbor, in which language |
| `organizer_credentials`, `approval_assertions` | credential id, public key (COSE), kind `passkey`/`demo_key`; assertion per (approval hash, organizer) | The approver re-verifies the stored assertion with the stored public key before paying |
| `audit_log` | `seq`, `actor`, `action`, `entity_*`, `data`, `prev_hash`, `row_hash` | Hash-chained. A trigger rejects UPDATE, DELETE and TRUNCATE ([migration](../packages/db/drizzle/0001_audit_append_only.sql)). Also the durable store for background-job records (`reconcile.window`, `unclaimed.renotify`, `organizer.alert`, `report.generated`), approver decisions and `audio.deleted` |

## State machines

### Help request

Source: `REQUEST_TRANSITIONS` in [`core/src/state.ts`](../packages/core/src/state.ts). The db enforces it in
`updateRequest` and audits every status change.

```mermaid
stateDiagram-v2
    [*] --> intake
    intake --> needs_clarification
    intake --> awaiting_approval
    needs_clarification --> intake
    needs_clarification --> awaiting_approval
    awaiting_approval --> approved: 2nd distinct organizer
    awaiting_approval --> needs_clarification
    awaiting_approval --> declined
    approved --> paying: batch created
    approved --> awaiting_approval: approval voided
    paying --> paid: SUCCESS
    paying --> unclaimed: UNCLAIMED
    paying --> returned
    paying --> failed
    unclaimed --> paid: claimed
    unclaimed --> returned: cancelled or 30 days
    paid --> returned: REFUNDED / REVERSED
    returned --> awaiting_approval: corrected destination
    failed --> awaiting_approval
    declined --> awaiting_approval: appeal
    intake --> cancelled
    approved --> cancelled
    paying --> cancelled
    unclaimed --> cancelled
```

(Every open state can also move to `cancelled`; `intake` and `needs_clarification` can move to `declined`;
`returned` and `failed` can move to `needs_clarification`. The diagram omits some edges for readability.)

### Payout item

Source: `ITEM_TRANSITIONS` and `applyItemEvent` in [`core/src/state.ts`](../packages/core/src/state.ts), mirrored in
[`paypal/src/payout-status.ts`](../packages/paypal/src/payout-status.ts) and kept identical by
[`core-compat.test.ts`](../packages/paypal/src/core-compat.test.ts).

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> SUCCESS
    PENDING --> UNCLAIMED
    PENDING --> ONHOLD
    ONHOLD --> SUCCESS
    ONHOLD --> UNCLAIMED
    UNCLAIMED --> SUCCESS: recipient claims
    UNCLAIMED --> RETURNED: 30 days
    UNCLAIMED --> CANCELED: cancel API
    SUCCESS --> REFUNDED
    SUCCESS --> REVERSED
    PENDING --> FAILED
    PENDING --> BLOCKED
    PENDING --> RETURNED
    FAILED --> [*]
    BLOCKED --> [*]
    RETURNED --> [*]
    CANCELED --> [*]
    REFUNDED --> [*]
    REVERSED --> [*]
```

`applyItemEvent(current, incoming)` returns `changed: false` for a duplicate and for a stale event (one that is not
an allowed forward move), so webhooks can arrive late, twice, or out of order. Webhook event types map to statuses
with `itemStatusForWebhookEvent` (`DENIED → FAILED`, `HELD → ONHOLD`).

## Idempotency design

The rule is that **one two-person approval can produce at most one PayPal batch**, however many times anyone taps,
retries or times out.

### 1. The approval hash pins the content

[`approvalPayload`](../packages/core/src/approvals.ts) builds this object, which `canonicalJson` serializes with
sorted keys and `approvalHash` hashes with SHA-256 (a pure-JS implementation tested against NIST vectors and
`node:crypto`):

```ts
{
  v: 1,
  policyVersionId,                        // the policy version that computed the amounts
  requestIds: [...sorted],
  items: [                                // sorted by requestId
    { requestId, amountCents, wallet, recipientType, receiver /* normalized */ },
  ],
  totalCents,
}
```

Change one cent, one receiver, the wallet, the policy version or the set of requests, and the hash changes.

### 2. The ids PayPal sees derive from the hash

```ts
senderBatchIdFor(approval) = 'nl_'  + approval.hash.slice(0, 24)                          // 27 chars
senderItemIdFor(approval, requestId) = 'nli_' + sha256(`${approval.hash}:${requestId}`).slice(0, 24)  // 28 chars, ≤ 63
```

PayPal refuses a reused `sender_batch_id` for 30 days, so the same approval cannot be paid twice even if our own
database lost track of it.

### 3. Each layer dedupes

| Layer | Mechanism | Code |
|---|---|---|
| Organizer double tap | Same organizer twice is `ok, changed: false` | `addApprover` in [`core/src/approvals.ts`](../packages/core/src/approvals.ts) |
| Concurrent approvals | Approval row locked `FOR UPDATE`; signature PK `(approval_id, organizer_id)` | `addApproverTx` in [`db/src/repo/approvals.ts`](../packages/db/src/repo/approvals.ts) |
| Same requests, new approval | `createOrGetApproval` returns the live approval for the hash (partial unique index) | [`db/src/repo/approvals.ts`](../packages/db/src/repo/approvals.ts) |
| Content changed between signatures | Content is recomputed from locked rows; a mismatch voids the approval | `addApproverTx`, `createBatch` |
| Executing twice | `payout_batches.approval_id` is unique; `createBatch` returns the existing batch | `createBatch` in [`db/src/repo/payouts.ts`](../packages/db/src/repo/payouts.ts) |
| HTTP retry to PayPal | `PayPal-Request-Id = sender_batch_id`; retries only on 429/5xx; network errors replayed only with that key | [`paypal/src/payouts.ts`](../packages/paypal/src/payouts.ts), [`paypal/src/retry.ts`](../packages/paypal/src/retry.ts) |
| PayPal says "already used" | Find `/v1/payments/payouts/{id}` in any link of the error body, GET it, return `duplicate: true`; else `DuplicateBatchError` | `createBatch`, `findExistingBatchId` |
| Duplicate webhook | `webhook_events` PK on the PayPal event id | `recordWebhookEvent` in [`db/src/repo/misc.ts`](../packages/db/src/repo/misc.ts) |
| Out-of-order webhook | Monotonic item state machine | `applyItemEvent` / `upsertItemFromEvent` |
| Donation capture double tap | `PayPal-Request-Id: capture-{orderId}`; `ORDER_ALREADY_CAPTURED` returns the existing capture | [`paypal/src/orders.ts`](../packages/paypal/src/orders.ts) |

## Request flow

1. **Intake** (web). `agents.intake.fromAudio` or `fromText` → store `originalText`, `englishText`, `extraction`. The raw
   recording is wiped right after transcription (`AUDIO_RETENTION=none`).
2. **Confirm** (web). `getActivePolicy` → `getHistoryForDestination` → `getTodaySpentCents` → core `computeAmount` and
   `checkRail({ text: [originalText, englishText] })` → `updateRequest(status: 'awaiting_approval')`.
3. **Approve** (web). Each organizer signs the approval hash (passkey, or a labelled demo key in `DEMO_MODE`) →
   `recordApprovalAssertion` → `createOrGetApproval` (refuses block flags) → `addApproverTx`.
4. **Execute** (approver). When the record is complete, the web app sends `POST /v1/execute`. The approver runs the six
   checks above, then `createBatch` → `PayoutsApi.createBatch({ senderBatchId, items[] })` → `updateBatch`,
   `setPaypalItemId` → audit `approver.executed`.
5. **Webhook** (web). `verifyWebhookSignature` (raw body; payout events for the Payouts app are verified by the
   approver) → `recordWebhookEvent` (skip duplicates) → `itemStatusForWebhookEvent` → `upsertItemFromEvent` → if
   changed, `notifyKeyFor` → `agents.notify.render` → `recordNotification`.
6. **Reconcile and follow-ups** (web, triggered by Render Workflows over signed `/api/internal/*`).
   `paypal.reporting.searchTransactions` → `reconcile(localItems, txns)`; unclaimed sweeps and claim-help nudges;
   organizer alerts; report versions.

## Live events

The `/demo` stage and organizer phones subscribe to `GET /api/stream` (Server-Sent Events). Messages are
`StageEvent`s from core (`request.created`, `request.readback`, `approval.added`, `payout.batch_created`,
`payout.item_updated`, `webhook.verified`, `notify.sent`, …). `?requestId=` replays that request's history first, so
a late subscriber never misses `request.created`.
