# apps/web — integration guide

The web app talks to the domain through **one seam**: the `Services` interface in
`lib/server/services.ts`. Route handlers under `app/api/**` are thin adapters (parse + zod-validate →
call one `services()` method → JSON), and server components (`/demo`, `/organizer`, `/report`, `/trust`,
`/ledger`, `/donate`) call `services()` directly. `createServices()` returns the **real engine**
(`lib/server/engine/engine.ts`, built on `@neighborline/core`, `/db`, `/paypal`, `/agents`).
`ENGINE=mock` switches back to the in-memory `MockEngine` (`lib/server/mock-engine.ts`) as a fallback.

### Real engine layout (`lib/server/engine/`)

| File | Role |
|---|---|
| `engine.ts` | `Engine implements Services`; DB generations, timers, SSE bus, wiring |
| `db-state.ts` | open/migrate/seed a DB generation; demo reset = fresh generation, old one retired after 30 s |
| `demo-extras.ts` | Minh + Ana waiting in the queue (through computeAmount/checkRail), organizer Priya |
| `intake.ts` | startIntake / submitAudio / submitText / confirmIntake (agents.intake → core amounts + rail) |
| `views.ts` | GroupView, RequestView, ThreadView |
| `settle.ts` | item status → core state machine (db.upsertItemFromEvent) → agents.notify in the neighbor's language |
| `webhooks.ts` | verify signature → dedupe (recordWebhookEvent) → settle |
| `ledger.ts`, `report.ts`, `donations.ts` | /ledger + reconcile, /report + /trust, Orders v2 + Subscriptions |
| `scenario-runner.ts` | `/demo` Play: drives the public methods with fixture samples; only human beats are scripted |
| `../approval-service.ts` | **the only module with a Payouts client** (enforced by `lib/server/least-privilege.test.ts`) |

Demo rehearsals get request ids `req_demo_…` and never count against a household's caps, velocity or
the daily budget (otherwise the third visitor to play "Mrs. Lan" would be blocked by her household cap).

```ts
// lib/server/services.ts (abridged — the file is the source of truth)
export interface Services {
  readonly modes: RuntimeModes;                       // { paypalMode, aiMode, engine } → /trust, "Sandbox: simulated" chips

  // intake (neighbor)
  startIntake({ groupSlug, channel, lang? }): Promise<{ requestId }>;          // emit request.created
  submitAudio(requestId, { audio?: Blob, sampleId?: ScenarioId, lang?, photo?: Blob }): Promise<IntakeResult>;
                                                                               // emit request.transcribed, request.readback
  submitText(requestId, { text, lang? }): Promise<IntakeResult>;               // same events
  confirmIntake(requestId, { confirmed, corrections? }): Promise<{ status, thread: ThreadView }>;
                                                                               // emit request.confirmed (+ request.flagged if rail flags)
  getThread(requestId): Promise<ThreadView | null>;                            // the neighbor's chat, in their language
  listSampleVoiceNotes(): SampleVoiceNote[];

  // organizers
  getGroup(): Promise<GroupView>;
  listRequests({ status? }): Promise<RequestView[]>;
  getRequest(requestId): Promise<RequestView | null>;
  approve({ requestIds, organizerId, deviceLabel }): Promise<ApprovalResult>;  // emit approval.added; on 2nd distinct
                                                                               // approver → payout.batch_created + payout.item_updated(PENDING)
  decline({ requestId, organizerId, reasonCode, note? }): Promise<{ status, message }>;   // emit notify.sent
  previewDecline({ requestId, reasonCode, note? }): Promise<{ text, textEn, lang }>;
  cancelPayoutItem({ batchId, itemId }): Promise<{ status }>;                  // only UNCLAIMED

  // PayPal
  handlePaypalWebhook({ headers, rawBody }): Promise<{ verified, eventType }>; // emit webhook.verified, payout.item_updated, notify.sent
  reconcile(): Promise<ReconcileResult>;
  getLedger(): Promise<LedgerView>;

  // donors
  createDonationOrder({ amountCents, source }): Promise<DonationOrder>;
  captureDonationOrder(orderId): Promise<DonationCapture>;                     // emit donation.captured
  getSubscriptionPlan({ amountCents }): Promise<SubscriptionPlan>;
  recordSubscription({ subscriptionId, amountCents }): Promise<{ ok, simulated }>;

  // transparency
  getReport(): Promise<ReportView>;
  getTrust(): Promise<TrustView>;

  // live events for SSE (/api/stream)
  subscribe(listener: (msg: StreamMessage) => void): () => void;
  replay(requestId): StreamMessage[];                                          // history for one request (reloads/late joiners)

  // demo stage only (DEMO_MODE=true)
  playScenario({ scenario, mode: 'auto' | 'manual', speed? }): Promise<ScenarioRun>;
  resetDemo(): Promise<void>;
}
```

All view models live in `lib/types.ts`; they wrap the zod domain types from `@neighborline/core`
(`HelpRequest`, `PayoutItem`, `PayoutBatch`, `StageEvent`, `RailFlag`, …). Money is integer cents.

## Event contract (`StreamMessage`)

```ts
type StreamMessage =
  | { kind: 'hello'; serverTime: string }                                  // sent first; clients compute clock skew
  | { kind: 'stage'; event: StageEvent; requestIds: string[] };            // requestIds scopes the event ([] = broadcast)
```

`/api/stream?requestId=…` filters server-side and **replays that request's history first**, so the
stage never misses `request.created` even though `playScenario` emits it before the browser subscribes.
The real implementation must therefore keep a per-request event log (an in-memory ring buffer per
process is fine for the demo; the DB `audit` table works too) and pass the `requestIds` each event
concerns. For `payout.batch_created` that is every request in the batch.

What each screen reads from events:

| Event | `/demo` rail row | Other effects |
|---|---|---|
| `request.created` | Voice note / text received (starts the stopwatch, uses `at`) | |
| `request.transcribed` | Transcribed and translated | thread refetch |
| `request.readback` | Read back in {language} | quick replies appear |
| `request.confirmed` | {name} confirmed + `computed.ruleCitation` | organizer phones buzz |
| `request.flagged` | one row per block/review flag; block stops the stopwatch | Approve disabled |
| `approval.added` | Approval n of 2 · {organizer name} | |
| `payout.batch_created` | sender_batch_id, payout_batch_id | |
| `payout.item_updated` | PENDING adds payout_item_id; UNCLAIMED/SUCCESS rows; **SUCCESS stops the stopwatch** | Lan's phone turns warm |
| `webhook.verified` | Webhook verified (nth occurrence → nth row) | |
| `notify.sent` | Callback / claim help sent in {language} | |

## Wiring map (mock → real)

| Facade method | Real implementation (see `NOTES-core.md`, `NOTES-agents.md`, `NOTES-paypal.md`) |
|---|---|
| `startIntake` | `db.createRequest` |
| `submitAudio` | `agents.intake.fromAudio({ audio: Uint8Array, mimeType, categories, langHint, speakReadBack: true })` → store `originalText`/`englishText`/`extracted`; delete audio. `sampleId` → `fixtureAudioBytes(<scenario>)` (`lan_vi`, `rosa_es`, `jean_ht`, `walter_en`). `simulatedTranscript = agents.providers.mode !== 'live'` |
| `submitText` | `agents.intake.fromText` (stateless: re-run on previous text + answer) — replaces `mock-text-intake.ts` |
| `confirmIntake` | `getActivePolicy` → `getHistoryForDestination` → `getTodaySpentCents` → core `computeAmount` + `checkRail` → `updateRequest(status: 'awaiting_approval')` → `agents.notify.render({ key: 'confirmed_waiting' })` |
| `approve` | `createOrGetApproval` → `addApproverTx` → if complete: `createBatch` → `paypal` create-batch with `senderBatchId`, `senderItemId`, `toPayPalValue`, `purpose: NON_GOODS_OR_SERVICES`, Venmo `social_feed_privacy: PRIVATE` → `updateBatch`/`setPaypalItemId`. Block flags must throw a 409 (`HttpError`) with the flag detail — the card shows it. |
| `handlePaypalWebhook` | `paypal.WebhooksApi.verify` → `recordWebhookEvent` (skip duplicates) → `itemStatusForWebhookEvent` → `upsertItemFromEvent` → `notifyKeyFor` → `agents.notify.render` → `recordNotification` |
| `getReport` | `db.listForReport` → core `buildReport` → `agents.report.write` → map `narrative` + `numberTrace` to `NarrativeSegment[][]` (`{ figure, ref }` for every grounded number) |
| `getLedger` / `reconcile` | `listItems` + Transaction Search via `@neighborline/paypal`; `reconcile: 'matched' | 'pending' | 'mismatch'` per item |
| `createDonationOrder` / `captureDonationOrder` | `paypal.OrdersApi` (`buildDonationOrder`, `summarizeCapture`) → `recordDonation` |
| `getSubscriptionPlan` | env `PAYPAL_PLAN_ID_<dollars>` or `PAYPAL_PLAN_ID` (create plans once in the sandbox dashboard or with the Subscriptions API) |
| `getTrust` | group + `agents.providers.notes` for the Sandbox-reality lines |
| `playScenario` | Keep `mock-scenario-runner.ts`'s timeline, but drive the real methods above with `fixtureAudioBytes` and the organizer ids `org_dana` / `org_marcus`. |

`RequestView` extras the real implementation must fill:
- `requester.displayName` (first name only) and `area` (neighborhood) — never full names.
- `amountBreakdown` — from core's `ComputedAmount.limitedBy` plus the inputs to `computeAmount` (map
  `category_max → category`, `household_cap|category_household_cap → household`, `daily_budget → daily`).
- `aiTrace` — `{ status, summary }` from the intake agent's `trace` (shown under the summary on `/organizer`).
- `audioSeconds` — for the language chip.

## Next.js config needed when real packages are added

```ts
transpilePackages: ['@neighborline/core', '@neighborline/db', '@neighborline/paypal', '@neighborline/agents'],
serverExternalPackages: ['@electric-sql/pglite', '@paypal/agent-toolkit'],
```
`next.config.ts` already maps `./x.js` imports to `./x.ts` (`resolve.extensionAlias`), which the
workspace packages use. Cache the DB handle and the agents/PayPal clients on `globalThis` exactly as
`services()` does, so dev hot reloads and the per-route bundles share one instance.

## Fixture alignment (resolved)

- Mrs. Lan's Venmo is `@lan-nguyen54` everywhere (agents fixtures, web stage, NOTES-core).
- Category key is `medicine_copay` (core) in the web mock too.
- Stage texts come straight from `packages/agents/fixtures/scenarios/*.json` (`lib/server/fixtures/scenarios.ts`).
- Jean is paid by Venmo `@jean-baptiste-h` (sandbox rejects `recipient_type: PHONE`).
- Rosa's `rosa.m.delgado@example.com` has "no PayPal account yet" in fake PayPal (`unclaimedReceivers`).

## Environment

| Var | Effect in web |
|---|---|
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | `/donate` loads the PayPal JS SDK (buttons + Venmo + Pay Later messaging; subscriptions via a second `vault=true` namespace). Unset → a clearly labelled simulated button. |
| `PAYPAL_PLAN_ID`, `PAYPAL_PLAN_ID_10`, `_25`, `_50` | Monthly plans for the subscription buttons |
| `PAYPAL_MODE` | `sandbox` flips the "simulated" tags off where real calls are made |
| `AI_MODE` | `live` changes the Sandbox-reality line for AI |
| `DEMO_MODE=false` | Disables `/api/demo/*` (play/reset) |

## Extensions to SPEC §5 (documented, additive)

`GET /api/intake/:id/thread`, `GET /api/intake/samples`, `GET /api/requests/:id`,
`POST /api/requests/:id/decline` (+ `/preview`), `POST /api/donate/subscription/activated`,
`GET /api/ledger`, `GET /api/group`, `POST /api/demo/play`. `GET /api/stream` accepts `?requestId=`.

## Tests

`pnpm --filter @neighborline/web test` runs the engine integration tests (vitest: in-memory PGlite +
in-process fake PayPal + fixture AI) and the least-privilege check.
`pnpm --filter @neighborline/web test:e2e` starts tools/fake-paypal on :4110, builds, starts on :3100 (real
engine, `PAYPAL_MODE=fake`) and runs `e2e/*.spec.ts`
(Lan → SUCCESS with the stopwatch frozen; visitor approves as Marcus; lookalike blocked; approval
idempotency over the API; `/call` sample voice note on a phone viewport). Set `BASE_URL` to test a
running server instead. Chromium comes from `PLAYWRIGHT_BROWSERS_PATH`.
