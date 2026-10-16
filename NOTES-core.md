# NOTES-core — `@neighborline/core` + `@neighborline/db` (domain/data lane)

## Contract changes in `packages/core/src/schemas.ts`
All **additive**. No existing field was renamed, removed or retyped.

| Addition | Why |
|---|---|
| `ComputedAmount.limitedBy?` (`'requested' \| 'category_max' \| 'household_cap' \| 'category_household_cap' \| 'daily_budget'`) | UI can say *why* the amount is what it is |
| `HistoryEntry` | Input to `computeAmount` / `checkRail` (db returns it from `getHistoryForDestination`) |
| `OfficialHandle`, `FiscalSponsor`, `Group` (`officialHandles[]`, `timezone`, `requiredApprovals ≥ 2`) | SPEC §4 `Group`; it had no zod schema |
| `Organizer` (`handles[]` = their own emails/Venmo/phones) | Used to block self-payment + lookalikes |
| `DonationSource`, `Donation` | Donations table / report |

## Core API (all pure, all exported from `@neighborline/core`)
- **policy**: `demoPolicy()`, `validatePolicy()` (zod + invariants), `assertValidPolicy`, `findCategory`, `resolveCategory` (unknown → `other`), `categoryLabel`, `describeCategory`.
- **amounts**: `computeAmount({ policy, extraction, history, todaySpentCents, destination, phone?, now?, requestId? })` → `{ ok: true, computed } | { ok: false, flags }`. `ruleCitation` e.g. `Policy v1 · Utility outage · up to $150 per request`; when limited it appends e.g. `· $100 left of $300 per household in 30 days`. Exhausted caps → `CAP_EXCEEDED`/`BUDGET_EXCEEDED` (block). History counts statuses `awaiting_approval|approved|paying|paid|unclaimed`. Pass `requestId` when recomputing so a request is not counted against itself.
- **rail**: `checkRail({ destination, groupHandles, organizerHandles, history, policy, text, now?, requestId? })` → `RailFlag[]` (block flags first). Also `checkHandles`, `checkInjection`, `hasBlockingFlag`, `namesCompatible`; handles: `normalizeHandle`, `skeleton`, `damerauLevenshtein` (OSA variant), `CONFUSABLES`.
  - Lookalike: skeleton distance ≤ 2 (len ≥ 8), ≤ 1 (len 5–7), exact only (< 5); plus containment ("@eastside-mutualaid-help") and email local-part/domain impersonation. Free-mail domains (gmail, yahoo…) are never compared.
  - `VELOCITY` fires when the destination **already** has `maxRequestsPerDestinationPer30d` counted requests (i.e. this one would exceed).
  - `DUP_DESTINATION_DIFF_NAME` is generous: name order, accents and partial names ("Lan" vs "Nguyễn Thị Lan") never flag.
  - `PROMPT_INJECTION` is **review-only** and multilingual. Polite pleas ("please approve my request", "I need $3,000 for the hospital") are tested **not** to flag. Amounts only flag with a directive verb and > 10× household cap.
- **approvals**: `canonicalJson`, `sha256Hex` (pure JS, NIST vectors + node:crypto parity tested), `approvalHash(content)`, `createApproval(id, content)`, `addApprover(approval, approver, { required?, currentContent?, eligibleOrganizerIds? })`, `canExecute`, `markExecuted`, `voidApproval`, `senderBatchIdFor` (= `'nl_' + hash.slice(0,24)`), `senderItemIdFor` (`'nli_' + 24 hex`). `required` can never be < 2 (throws).
- **state**: `REQUEST_TRANSITIONS`, `transitionRequest` (throws `InvalidTransitionError`), `ITEM_TRANSITIONS`, `applyItemEvent(current, incoming)` (idempotent, never regresses SUCCESS/terminal), `foldItemEvents`, `requestStatusForItem`, `itemStatusForWebhookEvent` (DENIED→FAILED, HELD→ONHOLD), `parsePayPalItemStatus`.
- **i18n**: `render(key, lang, { amount, wallet, name })` — en/es/vi/ht/zh/ar, others fall back to en; `[[Hi {name}. ]]` greeting is dropped when no name; a missing required slot **throws** `MissingTemplateVarError` (a "paid" message without an amount is a bug). `textDirection('ar') === 'rtl'`, `walletName`.
- **money**: `formatUsd(15000) === '$150'`, `toPayPalValue(15000) === '150.00'`, `parseUsdToCents`.
- **report**: `buildReport(input)` → totals, by category/language/wallet/donation source, time-to-cash p50/p90 (nearest rank), approvals-by-language parity, unclaimed rate. Any cell describing < 3 people is the string `'<3'` (`MASK`). Transaction ids are listed only on category + donation-source rows (listing them on several dimensions would let a reader difference out a masked row).

## DB (`@neighborline/db`)
- `createDb()` → `{ db, kind, close }`. `DATABASE_URL` → postgres-js; else PGlite at `PGLITE_DIR` or `./.pglite`; `createDb({ memory: true })` for tests.
- `migrate(db)` runs **embedded** SQL (`src/migrations.generated.ts`, generated from the committed `drizzle/*.sql`), so it works inside Next.js bundles. After schema changes: `pnpm --filter @neighborline/db generate` (drizzle-kit + embed). A test fails if they drift. Editing an applied migration is a hard error.
- Repos: `createGroup`, `getGroup(BySlug)`, `createOrganizer`, `listOrganizers`, `getRailHandles`, `activatePolicy` (needs ≥ 2 organizers of the group in `approvedBy`; immutable by id; retires the previous version), `getActivePolicy`, `getPolicy`, `createRequest`, `getRequest`, `updateRequest(id, patch, { expectStatus?, actor? })` (state machine enforced, status changes audited), `listRequests({ groupId?, status? })`, `countRequestsByStatus`, `getHistoryForDestination(dest, sinceDays, { phone?, groupId?, now? })`, `createOrGetApproval({ requestIds })`, `addApproverTx({ approvalId, organizerId, deviceLabel })`, `getApproval`, `createBatch({ approvalId })`, `updateBatch`, `setPaypalItemId`, `getBatch(BySenderBatchId)`, `upsertItemFromEvent({ senderItemId? | paypalItemId?, status, transactionId?, at? })`, `listItems(ForRequest)`, `getTodaySpentCents(groupId)`, `recordWebhookEvent` (false = duplicate), `markWebhookProcessed`, `recordDonation` (idempotent by order/txn id), `recordNotification`, `markNotification`, `appendAudit`, `listAudit`, `verifyAuditChain`, `listForReport(groupId, period?)`, `seedDemo(db)`.
- Errors: `RepoError` with `code` `NOT_FOUND | CONFLICT | INVALID | NOT_APPROVABLE | NOT_EXECUTABLE`.

## Integrator must know
1. **Intended server flow** (`apps/web` API routes):
   - intake/confirm: `getActivePolicy` → `getHistoryForDestination` → `getTodaySpentCents` → `computeAmount` + `checkRail({ ...await getRailHandles(db, groupId), text: [originalText, englishText] })` → `updateRequest(id, { status: 'awaiting_approval', computed, railFlags, policyVersionId: policy.id })`.
   - `POST /api/approvals`: `createOrGetApproval({ requestIds })` → `addApproverTx(...)` → if `complete`: `createBatch({ approvalId })` → PayPal create-batch with `batch.senderBatchId`, each `item.senderItemId`, `toPayPalValue(item.amountCents)` → `updateBatch(id, { paypalBatchId, status })` + `setPaypalItemId`. `createBatch` is idempotent (double taps return the same batch).
   - webhook: verify → `recordWebhookEvent` (skip if `false`) → `itemStatusForWebhookEvent(event_type)` → `upsertItemFromEvent` → if `changed`, notify via `render(...)` + `recordNotification`.
2. **Block flags** stop `createOrGetApproval` (`NOT_APPROVABLE`). Review flags don't.
3. **Approval voids itself** if a request's amount/destination/status changes after the first signature; create a new one with `createOrGetApproval`.
4. **Demo reset**: the audit log is append-only at the DB level (UPDATE/DELETE/TRUNCATE raise). Reset by creating a fresh database (`createDb({ memory: true })` or a new `PGLITE_DIR`), then `migrate` + `seedDemo` — not by deleting rows.
5. **PGlite is single-process**: don't run `pnpm --filter @neighborline/db seed` while `next dev` holds `./.pglite`. In Next, cache the handle on `globalThis` (HMR) and add `@neighborline/db` to `transpilePackages`; `@electric-sql/pglite` likely needs `serverExternalPackages`.
6. **Payments lane**: core's `itemStatusForWebhookEvent` / `applyItemEvent` should agree with any mapping in `packages/paypal` (DENIED→FAILED, HELD→ONHOLD). Prefer importing core's.
7. Seed: Eastside Mutual Aid (`grp_eastside`, slug `eastside`), official `organizers@eastside-mutualaid.org` + `@eastside-mutualaid`, organizers `org_dana`, `org_marcus`, policy `pol_eastside_v1`, 14 historical requests (13 paid incl. one unclaimed→claimed, 1 declined) across vi/es/ht/zh/ar/en, 60 donors / $4,800. Mrs. Lan (`@lan-nguyen54`, the handle in the agents fixtures and the web stage) has no history → $150 for `utility_outage`.

## Commands
`pnpm --filter @neighborline/core test` · `pnpm --filter @neighborline/db test` · `… typecheck` · `… coverage` · `pnpm --filter @neighborline/db generate` · `pnpm --filter @neighborline/db seed`
