# apps/web — integration guide

The web app talks to the domain through **one seam**: the `Services` interface in
`lib/server/services.ts`. Route handlers under `app/api/**` are thin adapters (parse + zod-validate →
call one `services()` method → JSON), and server components (`/demo`, `/organizer`, `/report`, `/trust`,
`/ledger`, `/donate`) call `services()` directly. `createServices()` returns the **real engine**
(`lib/server/engine/engine.ts`, built on `@neighborline/core`, `/db`, `/paypal`, `/agents`).
`ENGINE=mock` switches to the in-memory `MockEngine` (`lib/server/mock-engine.ts`), a UI-only fallback that moves no
money; it is never set in deployment (THREAT_MODEL R2).

### Real engine layout (`lib/server/engine/`)

| File | Role |
|---|---|
| `engine.ts` | `Engine implements Services`; DB generations, timers, SSE bus, wiring |
| `db-state.ts` | open/migrate/seed a DB generation; demo reset = fresh generation, old one retired after 30 s |
| `demo-extras.ts` | Minh + Ana waiting in the queue (through computeAmount/checkRail), organizer Priya |
| `intake.ts` | startIntake / submitAudio / submitText / confirmIntake (agents.intake → core amounts + rail) |
| `views.ts` | GroupView, RequestView, ThreadView |
| `settle.ts` | item status → core state machine (db.upsertItemFromEvent) → agents.notify in the neighbor's language |
| `webhooks.ts` | verify signature → `beginWebhookEvent` (new / retry / done) → settle → `markWebhookProcessed` (applied at least once) |
| `ledger.ts`, `report.ts`, `donations.ts` | /ledger + reconcile, /report + /trust, Orders v2 + Subscriptions |
| `scenario-runner.ts` | `/demo` Play: drives the public methods with fixture samples; only human beats are scripted |
| `policy-editor.ts`, `policy-drafts.ts` | `/organizer/rules`: `agents.policy.compile` → draft stored in the audit log under core `policyDraftHash` → queue preview (`railFor` under the draft) → two organizers' signatures over the draft hash → `db.activatePolicy` + re-price waiting requests (pending approvals voided) |
| `internal.ts` | background jobs behind `/api/internal/*` (reconcile window, unclaimed sweep/renotify, organizer alerts, report versions); state in the audit log |
| `../approval-service.ts` | collects organizer signatures (`createOrGetApproval` → `addApproverTx`) and, when complete, asks the **approver process** to execute via `../approver-client.ts` (HMAC-signed HTTP). **The web app has no Payouts client, creates no payout batches and never sees `PAYPAL_PAYOUTS_*`** (enforced by `lib/server/least-privilege.test.ts`) |
| `../audio-retention.ts`, `../log.ts` | `AUDIO_RETENTION=none|24h` for raw recordings; JSON logger that redacts emails, phones and handles |

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
  approve(input: ApproveInput): Promise<ApprovalResult>;                      // passkey/demo-key signature over the approval hash;
                                                                               // emit approval.added; on 2nd distinct approver the
                                                                               // approver process pays → payout.batch_created + item PENDING
  liveSession(session): Promise<OrganizerSession | null>;                     // null once that passkey is revoked
  revokePasskey({ credentialId, session }): Promise<{ organizerId, deviceLabel, signedOut }>;
  policyEditor(): Promise<PolicyEditorView>;                                   // active rules, open draft, versions
  compilePolicy({ sourceText, session }): Promise<CompilePolicyOutcome>;       // draft only; DEMO_MODE or a live session
  policyChallenge({ draftHash, origin, organizerId? }): Promise<ApprovalChallenge>;  // challenge = draft hash
  signPolicy(PolicySignInput & { origin? }): Promise<PolicySignResult>;        // 2nd distinct valid signature activates
  decline({ requestId, organizerId, reasonCode, note? }): Promise<{ status, message }>;   // emit notify.sent
  previewDecline({ requestId, reasonCode, note? }): Promise<{ text, textEn, lang }>;
  cancelPayoutItem({ batchId, itemId }): Promise<{ status }>;                  // only UNCLAIMED; executed by the approver

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

  // background jobs (real engine only; POST /api/internal/*, contract in workflows/src/contract.ts)
  readonly internal?: { reconcileWindow; unclaimedSweep; renotify; organizerAlert; reportRefresh };
  approverUp?(): Promise<boolean>;                                             // for GET /api/health
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

## Wiring map

| Facade method | Real implementation (see `NOTES-core.md`, `NOTES-agents.md`, `NOTES-paypal.md`) |
|---|---|
| `startIntake` | `db.createRequest` |
| `submitAudio` | `agents.intake.fromAudio({ audio: Uint8Array, mimeType, categories, langHint, speakReadBack: true })` → store `originalText`/`englishText`/`extracted`; then `disposeAudio`: with `AUDIO_RETENTION=none` (default) the buffer is zero-filled and only the transcript is kept, with `24h` it is written 0600 and swept after 24 h; an `audio.deleted`/`audio.retained` audit row records the size. `sampleId` → `fixtureAudioBytes(<scenario>)` (`lan_vi`, `rosa_es`, `jean_ht`, `walter_en`). `simulatedTranscript = agents.providers.mode !== 'live'` |
| `submitText` | `agents.intake.fromText` (stateless: re-run on previous text + answer) — replaces `mock-text-intake.ts` |
| `confirmIntake` | `getActivePolicy` → `getHistoryForDestination` → `getTodaySpentCents` → core `computeAmount` + `checkRail` → `updateRequest(status: 'awaiting_approval')` → `agents.notify.render({ key: 'confirmed_waiting' })` |
| `approve` | web: verify + record the organizer's assertion → `createOrGetApproval` → `addApproverTx` → if complete: `POST /v1/execute` to **apps/approver** with `{ approvalId, hash, payload (core approvalPayload), approvers }`. The approver re-reads everything from the database (hash, ≥ 2 distinct organizers, signatures, amounts via `computeAmount`, `checkRail`), then `createBatch` → PayPal create-batch with `senderBatchId`, `senderItemId`, `purpose: NON_GOODS_OR_SERVICES`, Venmo `social_feed_privacy: PRIVATE` → `updateBatch`/`setPaypalItemId`. Block flags throw a 409 (`HttpError`) with the flag detail; approver refusals come back as 403/409 with its reason. |
| `handlePaypalWebhook` | `paypal.WebhooksApi.verify` (main app's `PAYPAL_WEBHOOK_ID`; for `PAYMENT.PAYOUTS*` events that fail it, the approver verifies against the Payouts app's webhook) → `beginWebhookEvent` (skip only events already processed) → `itemStatusForWebhookEvent` → `upsertItemFromEvent` → `notifyKeyFor` → `agents.notify.render` → `recordNotification` → `markWebhookProcessed` |
| `getReport` | `db.listForReport` → core `buildReport` → `agents.report.write` → map `narrative` + `numberTrace` to `NarrativeSegment[][]` (`{ figure, ref }` for every grounded number) |
| `getLedger` / `reconcile` | `listItems` + Transaction Search via `@neighborline/paypal` (amount, currency and status drift, stuck `PENDING`); `reconcile: 'matched' \| 'pending' \| 'mismatch' \| 'seeded'` per item with `reconcileDetail`; every run saved (`saveReconcileRun`) |
| `createDonationOrder` / `captureDonationOrder` | `paypal.OrdersApi` (`buildDonationOrder`, `summarizeCapture`) → `recordDonation` |
| `getSubscriptionPlan` | env `PAYPAL_PLAN_ID_<dollars>` or `PAYPAL_PLAN_ID` (create plans once in the sandbox dashboard or with the Subscriptions API) |
| `getTrust` | group + `agents.providers.notes` for the Sandbox-reality lines |
| `playScenario` | `engine/scenario-runner.ts`: drives the real methods above with `fixtureAudioBytes`; only the human beats are scripted (`BEATS`: note arrives 1.5 s, listening 7 s, each organizer's look 6 s, at speed 1). Dana and, in auto mode, Marcus sign with labelled demo keys. Ids are `req_demo_<visitor tag>_…` |

`RequestView` extras the real implementation must fill:
- `requester.displayName` (first name only) and `area` (neighborhood) — never full names.
- `amountBreakdown` — from core's `ComputedAmount.limitedBy` plus the inputs to `computeAmount` (map
  `category_max → category`, `household_cap|category_household_cap → household`, `daily_budget → daily`).
- `aiTrace` — `{ status, summary }` from the intake agent's `trace` (shown under the summary on `/organizer`).
- `audioSeconds` — for the language chip.

## Next.js config for the workspace packages

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
| `DEMO_MODE` | Fails closed: unset means on only with `PAYPAL_MODE=fake`. Off disables `/api/demo/play`, demo keys and demo-visitor passkeys. `/api/demo/reset` additionally needs the internal HMAC (`NEIGHBORLINE_INTERNAL_SECRET`) |
| `APPROVER_URL`, `NEIGHBORLINE_APPROVER_SECRET` | Where the approver listens (default `http://127.0.0.1:4020`) and the HMAC key shared with it. `pnpm dev` / `render-start.sh` set both |
| `DATABASE_URL`, `DEV_DB_CONTROL_URL` | The database shared with the approver; `pnpm dev` points both at `tools/dev-db`, whose control URL lets `/demo` reset swap in a fresh database |
| `NEIGHBORLINE_INTERNAL_SECRET` | HMAC key for `/api/internal/*` (Render Workflows) |
| `AUDIO_RETENTION`, `AUDIO_DIR` | `none` (default) or `24h` for raw voice recordings |
| `PAYPAL_PAYOUTS_*` | **Never** given to the web process (the build fails if web code reads them); only the approver gets them |

## Extensions to SPEC §5 (documented, additive)

`GET /api/health`, `POST /api/internal/{reconcile,unclaimed-sweep,unclaimed/renotify,organizer-alert,report-refresh}` (HMAC-signed, Render Workflows),
`GET /api/intake/:id/thread`, `GET /api/intake/samples`, `GET /api/requests/:id`,
`POST /api/requests/:id/decline` (+ `/preview`), `POST /api/donate/subscription/activated`,
`GET /api/ledger`, `GET /api/group`, `POST /api/demo/play`, `GET /api/policy`, `POST /api/policy/{draft,challenge,sign}`,
`POST /api/approvals/challenge`, `GET /api/organizer/me`, `POST /api/organizer/passkeys` (+ `/options`, `/revoke`),
`POST /api/organizer/signin` (+ `/options`), `POST /api/organizer/signout`. `GET /api/stream` accepts `?requestId=`.

## Tests

`pnpm --filter @neighborline/web test` runs the engine integration tests (vitest: in-memory PGlite +
in-process fake PayPal + the real approver HTTP service on a random port sharing that database + fixture AI),
the internal-endpoint tests, the privacy tests and the least-privilege check.
`pnpm --filter @neighborline/web test:e2e` starts tools/dev-db on :4130, tools/fake-paypal on :4110, apps/approver on
:4120, builds into `.next-e2e`, starts on :3100 (real engine, `PAYPAL_MODE=fake`) and runs the 32 tests in
`e2e/*.spec.ts`: Lan → SUCCESS with the stopwatch frozen; a visitor approves as Marcus with a passkey or the demo key; a visitor's own `/call` request is paid after they approve it as Marcus;
lookalike blocked; approval idempotency and visitor isolation over the API; cross-site and non-JSON requests refused;
the nonce CSP; an organizer enrolls a passkey; `/call` on a phone (sample voice note, a Chinese clarifying question
answered after a refresh, category quick answers, the 2,000-character limit, decline and REVIEW); the rules editor;
axe checks on every page (desktop, phone width and the dark stage). Override the ports with `E2E_PORT`,
`E2E_FAKE_PAYPAL_PORT`, `E2E_APPROVER_PORT`, `E2E_DEV_DB_PORT` and the build dir with `NEXT_DIST_DIR`. Set `BASE_URL`
to test a running server instead. Chromium comes from `PLAYWRIGHT_BROWSERS_PATH`.

**Custom build dirs leave the tree clean.** Any `next build` / `next dev` with `NEXT_DIST_DIR` (e2e, QA, parallel
agents) gets a generated tsconfig, `.next-tsconfig-<dir>.json` (git-ignored by `.next*`), that extends `tsconfig.json`
and already lists `<dir>/types/**/*.ts`, so Next has nothing to add to the tracked `tsconfig.json`
([`lib/dist-tsconfig.ts`](lib/dist-tsconfig.ts), wired through `typescript.tsconfigPath` in `next.config.ts`).
`next-env.d.ts` is regenerated by Next on every build with the dist dir in it, so it is git-ignored, as Next
recommends; the tracked `next-types.d.ts` carries its `next` type references for a fresh checkout.
