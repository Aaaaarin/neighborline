# Neighborline — Product & Engineering Spec (v1, Oct 16 2026)

> A hotline, not a dashboard. A neighbor leaves a voice note in any language, two organizers approve,
> PayPal or Venmo cash lands in ~90 seconds — then the agent calls them back in their language.

Hackathon: PayPal AI Hackathon (Devpost). Deadline **Nov 12 2026, 12:00 PT**. Judged equally on
Technological Implementation, Design, Potential Impact, Innovation, Presentation (<3 min video).
Research behind every decision lives in the claude.ai project docs (`research/*.md`).

## 1. Users and the one story we tell

| Actor | Device | What they need |
|---|---|---|
| **Neighbor** (requester) | phone: voice note / WhatsApp / browser | Ask for help in their language, know what's happening, get the money, no app or English needed |
| **Organizer** (2+ volunteers) | phone | Approve fast and safely; never be the bottleneck; never be fooled by impersonators |
| **Donor** | web | Give once (Orders v2: PayPal / Venmo / Pay Later) or monthly (Subscriptions); see where money went |
| **Fiscal sponsor** | web | Compliance: business account, Payouts enabled, purpose codes, audit trail |

Hero story (video): *Eastside, the morning after an ice storm.* Mrs. Lan (Vietnamese) sends a voice note:
power out 2 days, needs a space heater and groceries. Agent reads back in Vietnamese, files request against
the group's rules ($150 cap for "utility outage" category). Two organizer phones buzz → Approve, Approve.
One Payouts batch (mixed PayPal + Venmo) → webhook SUCCESS → her phone: "Đã gửi $150 vào Venmo của bạn".
On-screen timer from voice note to payout ID. Second beat: Spanish speaker's payout returns UNCLAIMED →
agent calls/texts her in Spanish with claim help → SUCCESS. Third beat (5s): a lookalike organizer handle
"@eastside-mutualaid" vs "@eastside-mutuaiaid" is blocked by rail protection.

**Rule: no dashboard in the first 60 seconds of the video.** The requester's phone is the main character.

## 2. Principles (these are judged — keep them visible in product + README)
1. **AI never decides who deserves help.** No need scores, no fraud scores on people. AI transcribes,
   translates, extracts structured fields, cites the rule, drafts messages. **Code computes every amount**
   from the versioned policy. **Two humans approve** every payout.
2. **The intake agent cannot move money.** Only the approver (`apps/approver`, a separate process) holds PayPal
   Payouts credentials, and it only executes a valid two-person approval record that it re-verifies itself from the
   database: approval hash, ≥ 2 distinct organizers, their passkey signatures over that hash, and every amount
   recomputed from the policy. The web app (intake, AI agents, UI) has no Payouts client and never sees
   `PAYPAL_PAYOUTS_*`; a test fails the build otherwise. (Least privilege; mirrors PayPal's own "authorize twice"
   MCP Hub pattern.)
3. **Every AI output is schema-validated** (zod). Validate → repair (one LLM repair pass) → if still invalid
   or low-confidence, **re-ask the neighbor in their language** instead of guessing.
4. **Protect the rail, not suspect the person:** lookalike organizer handles, same payout destination under
   different names, velocity caps, rule-cap violations, prompt-injection in request text.
5. **Idempotent money:** `sender_batch_id` = hash(approval record); retries/double taps return the original
   batch. All webhooks signature-verified. Nightly reconcile against Transaction Search.
6. **Privacy by default:** raw audio wiped right after transcription (`AUDIO_RETENTION=none`, or `24h` then deleted),
   only the transcript kept; emails, phone numbers and handles masked in logs and AI traces (`core.redactPII`);
   transparency report is aggregate-only; Venmo `social_feed_privacy: PRIVATE`.
7. **Honest about sandbox:** a "Sandbox reality" panel states what is simulated (e.g., Venmo SUCCESS via
   PayPal's documented mock if real sandbox Venmo does not settle; SMS sender registration).

## 3. Architecture

```
apps/approver            The approval service, a separate Node process (node:http). The ONLY process with
                         Payouts credentials. HMAC-signed, nonce-checked POST /v1/execute | /v1/poll/:batchId |
                         /v1/cancel-unclaimed/:itemId | /v1/verify-webhook. Re-derives hash, approvers,
                         signatures, amounts (computeAmount) and rail checks from the DB before paying.
apps/web (Next.js 15, App Router, TS, Tailwind)        ← UI + API routes (server); no Payouts client
  /             landing + "Try the hotline" CTA
  /demo         STAGE: requester phone | organizer A | organizer B | live PayPal event rail + timer
  /call         requester phone (standalone, mobile) — record voice / type / photo
  /organizer    organizer phone queue (mobile)
  /donate       donor page: PayPal JS SDK buttons (Orders v2, Venmo, Pay Later msg) + monthly (Subscriptions)
  /report       AI-written aggregate transparency report; every line links a PayPal transaction id
  /trust        Trust & Compliance panel (Know Your Agent framing) + Sandbox reality
  /ledger       organizer ledger (payout items, states, reconcile status)
  /api/*        route handlers (see §5)

packages/core            domain types, policy engine (rules-as-code), amounts, approvals,
                         rail-protection checks, state machines, i18n message catalog. NO I/O.
packages/paypal          @neighborline/paypal — OSS: typed PayPal client (OAuth, Payouts, Orders,
                         Subscriptions, Webhooks verify, Transaction Search), idempotency helpers,
                         payout item state machine, mock-response helpers. + MCP server
                         (`neighborline-payouts-mcp`) adding Payouts tools missing from the
                         PayPal Agent Toolkit.
packages/agents          LLM/STT/TTS provider abstraction + agents: intake, policy-compiler,
                         callback/notify, report-writer. Offline "fixture" provider for tests/demo.
packages/db              Drizzle ORM schema + repo functions. Postgres in prod (Supabase/Render),
                         PGlite (embedded Postgres) for local dev + tests.
tools/fake-paypal        Local fake PayPal sandbox (HTTP) implementing the subset we use, emitting
                         webhooks — enables dev/tests with no credentials and deterministic demos.
tools/dev-db             Local only: one PGlite served over the Postgres wire protocol on loopback, so web and
                         approver (two processes) share a database in `pnpm dev` and e2e.
packages/passkeys        WebAuthn: the challenge an organizer signs IS the approval hash; verification shared by
                         web (at tap time) and approver (before paying).
```

Process layout: `pnpm dev` = dev-db :4030 + fake-paypal :4010 + approver :4020 + web :3000. On Render the approver
runs as a second process in the web instance with its own environment (secrets on stdin); a private-service
variant is in render.yaml. Background jobs (Render Workflows) call HMAC-signed `/api/internal/*` on the web app.

Runtime mode via env `PAYPAL_MODE=fake|sandbox` and `AI_MODE=fixture|live`.

## 4. Domain model (packages/core)

> **Authoritative contract: `packages/core/src/schemas.ts`** (zod). Amounts there are integer cents (`amountCents`); the sketch below uses USD for readability.

```ts
type Lang = 'en'|'es'|'vi'|'ht'|'zh'|'ar'|'fr'|'tl'|'ko'|'ru'; // BCP-47 primary subtag, extensible

interface Group { id; name; slug; payoutHandle /* the group's official PayPal/Venmo identity */;
  fiscalSponsor: { name; paypalBusinessVerified: boolean; payoutsEnabled: boolean; charityConfirmed: boolean };
  policyVersionId; approvalThresholdUsd /* above → 2 approvers; default ALWAYS 2 */ }

interface Policy {                    // compiled from plain English, human-reviewed, versioned, immutable
  id; groupId; version: number; sourceText: string; createdBy; approvedBy: string[];
  currency: 'USD';
  categories: Array<{ key: string /* 'utility_outage' */; label: Record<Lang,string>;
                      maxUsd: number; perHouseholdPer30dUsd: number; requiresPhoto?: boolean }>;
  householdCapPer30dUsd: number; dailyBudgetUsd: number;
  maxRequestsPerDestinationPer30d: number;
}

interface HelpRequest {
  id; groupId; createdAt; channel: 'web_voice'|'web_text'|'whatsapp'|'phone'|'sms';
  lang: Lang; originalText: string; englishText: string; audioRef?: string; photoRefs: string[];
  extracted: IntakeExtraction;           // zod-validated AI output (below)
  confirmedByRequester: boolean;         // read-back confirmed
  payoutDestination: { wallet: 'PAYPAL'|'VENMO'; type: 'EMAIL'|'USER_HANDLE'|'PHONE'; value: string; nameOnFile?: string };
  status: RequestStatus; policyVersionId; computed: { amountUsd: number; ruleKey: string; ruleCitation: string } | null;
  railFlags: RailFlag[];
}
type RequestStatus = 'intake'|'needs_clarification'|'awaiting_approval'|'approved'|'paying'|'paid'
                   |'unclaimed'|'returned'|'failed'|'declined'|'cancelled';

interface IntakeExtraction { // AI output, zod schema in core/schemas.ts
  lang: Lang; summaryEn: string; summaryNative: string;
  category: string /* must be a policy category key or 'other' */;
  householdSize?: number; urgency: 'today'|'this_week'|'later';
  requestedItems: string[]; requestedAmountUsd?: number;
  payout?: { wallet: 'PAYPAL'|'VENMO'; type: 'EMAIL'|'USER_HANDLE'|'PHONE'; value: string };
  missing: Array<'payout'|'category'|'household'|'location'>;
  confidence: number /* 0..1 extractor self-report, used only to trigger re-ask */;
}

interface Approval { id; requestIds: string[]; approvers: Array<{ organizerId; at; deviceLabel }>;
  totalUsd; policyVersionId; hash /* sha256 canonical JSON */; }

interface PayoutBatch { id; approvalId; senderBatchId /* = 'nl_' + approval.hash.slice(0,24) */;
  paypalBatchId?; status; items: PayoutItem[]; createdAt; }
interface PayoutItem { id; requestId; senderItemId; paypalItemId?; amountUsd; wallet; receiver;
  status: 'PENDING'|'SUCCESS'|'UNCLAIMED'|'RETURNED'|'ONHOLD'|'BLOCKED'|'FAILED'|'REFUNDED'|'REVERSED'|'CANCELED';
  transactionId?; lastEventAt; }

type RailFlag = { code: 'LOOKALIKE_HANDLE'|'DUP_DESTINATION_DIFF_NAME'|'VELOCITY'|'CAP_EXCEEDED'
  |'BUDGET_EXCEEDED'|'PROMPT_INJECTION'|'DEST_IS_GROUP_HANDLE'; severity: 'block'|'review'; detail: string };
```

**Amount computation (pure function):** `computeAmount(policy, request, history) → {amountUsd, ruleKey,
ruleCitation} | {blocked: RailFlag[]}`: min(requestedAmount ?? category.maxUsd, category.maxUsd,
remaining household cap, remaining daily budget). Never from the LLM.

**Lookalike detection:** normalize (lowercase, strip @ . _ -, confusables map: 0→o,1→l,i→l,rn→m,vv→w,
cyrillic homoglyphs), Damerau-Levenshtein ≤ 2 vs group's official handles and organizer handles → `block`.

**Prompt injection:** request text checked by heuristics (instructions to ignore rules, "approve", amounts
> cap, system-prompt markers) → `review` flag; agent never executes instructions from request text (it has no tools that matter).

## 5. API (apps/web route handlers)
```
POST /api/intake/start            {groupSlug, channel, lang?} → {requestId}
POST /api/intake/:id/audio        multipart audio → transcribe → extract → {readBack: {text, lang, audioUrl?}, extraction, missing}
POST /api/intake/:id/text         {text}
POST /api/intake/:id/confirm      {confirmed: boolean, corrections?} → status awaiting_approval | needs_clarification
GET  /api/requests?status=        organizer queue (computed amount + rule citation + rail flags)
POST /api/approvals               {requestIds, signer} → records a signed approver; when 2 distinct → approver process executes
POST /api/payouts/:batchId/cancel-item {itemId}       (only UNCLAIMED)
POST /api/webhooks/paypal         verify signature → update item state → trigger notify agent
GET  /api/stream                  SSE: request/approval/payout events for /demo stage
POST /api/donate/order            create Order v2 (server) ; POST /api/donate/order/:id/capture
POST /api/donate/subscription     returns plan id for JS SDK subscription button
GET  /api/report                  aggregate report JSON + AI narrative
POST /api/reconcile               Transaction Search reconcile (also scheduled nightly)
POST /api/demo/reset              reseed demo data
GET  /api/health                  Render health check (+ approver up/down)
POST /api/internal/*              Render Workflows jobs, HMAC-signed (workflows/src/contract.ts)
```

## 6. Agents (packages/agents)
- **Providers:** `LLM` (Anthropic Claude or OpenAI, structured output via tool/JSON schema), `STT`
  (OpenAI gpt-4o-transcribe / whisper-1), `TTS` (OpenAI tts). `fixture` provider returns canned,
  deterministic outputs keyed by input hash/fixture id — used in tests and as offline demo fallback.
- **IntakeAgent:** audio→STT→detect lang→extract `IntakeExtraction` (zod)→repair loop→read-back text in
  requester's language (+TTS audio). Clarifying question in their language if `missing` non-empty.
- **PolicyCompiler:** plain-English rules → `Policy` draft JSON (zod) + diff explanation; requires 2 organizer approvals to activate.
- **NotifyAgent:** status messages in requester's language from a vetted template catalog (AI fills
  slots + translates; templates for paid / unclaimed-claim-help / declined-with-appeal / needs-info).
- **ReportWriter:** aggregate stats (by category, language, time-to-cash p50/p90, approvals by language) →
  narrative; uses PayPal Agent Toolkit `list_transactions` for donation inflows; every figure traced to rows.

## 7. Quality bar
- Unit tests (vitest) for core (policy, amounts, lookalike, injection, state machines) and paypal package
  (against fake-paypal). E2E (Playwright) for the demo flow in fake mode. CI on GitHub Actions.
- Lint + typecheck clean. `pnpm dev` works with zero credentials (fake + fixture modes).
- Accessibility: WCAG AA contrast, large tap targets, screen-reader labels; requester UI usable with voice only.
- Design: warm, human, calm. Not a fintech dashboard. Phone frames on /demo. Typeface pairing + palette defined in apps/web/DESIGN.md.

## 8. Milestones
- **M1 (Oct 16–20):** monorepo, core + tests, fake-paypal, paypal package, db, intake agent (fixture), /demo stage end-to-end in fake mode.
- **M2 (Oct 21–26):** live AI + real sandbox; voice; donor flows; webhooks; reconcile; report; trust; design pass 1. **Go/no-go Oct 24.**
- **M3 (Oct 27–Nov 3):** host on Render (+Workflows), MCP server package, security/threat model, prompt-injection CI, E2E, design pass 2, optional WhatsApp/Twilio.
- **M4 (Nov 4–11):** video, thumbnail, README, Devpost write-up, final QA, submit by Nov 11.
