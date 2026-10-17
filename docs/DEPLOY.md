# Deploying Neighborline on Render

The hosted demo has to stay up, free to use and without restrictions for judges until the judging
period ends on **Dec 15 2026, 8:00 am PT**. Winners are announced around Dec 21. Everything is defined in
[`render.yaml`](../render.yaml), so one Blueprint creates the whole stack.

> **Key day:** steps 3-6 below are scripted by `pnpm golive` ([GOLIVE.md](GOLIVE.md)): after the one Blueprint click it
> sets the env vars through Render's API, registers the PayPal webhooks, deploys, runs `scripts/verify-deploy.sh`
> and a hosted `/demo` run. This page stays the manual reference.

| Resource | Render type | What it does | Plan / cost |
|---|---|---|---|
| `neighborline` | Web service (Node 22) | Next.js app, API, PayPal webhooks, SSE stage, **plus the approver (`apps/approver`) as a separate process** — the only process with Payouts credentials | `0.5c-512mb` (Starter) **$7/mo**, never sleeps |
| `neighborline-db` | Render Postgres 17 | Requests, approvals, payouts, audit log | `0.1c-256mb` (Basic-256mb) **$6/mo** + 1 GB at $0.30/GB |
| `neighborline-workflows` | **Render Workflow** | Nightly reconcile, unclaimed-payout follow-up, report refresh | Flex compute, billed per second: **~$0.10–0.50/mo** at demo volume |
| `neighborline-scheduler` | Cron job (every 15 min) | Starts due workflow runs through the Render API | **$1/mo minimum** ($0.00016/min while it runs) |
| `neighborline-internal`, `neighborline-secrets` | Environment groups | Generated HMAC and approval secrets | free |

**Total: about $14.50/month**, prorated by the second. Deployed by Nov 3 and kept up through Dec 21, that is
about **$23**. Shut down right after judging (Dec 15) and it is about **$20**. The workspace stays on the free
Hobby plan. Paid resources need a payment method on file. Check the hackathon's Render page
(<https://paypalaihackathon.devpost.com/details/render>) for a credit or promo code before adding a card.

```
 judges / neighbors ──HTTPS──▶ ┌ neighborline instance ─────────────────────────────┐ ◀──webhooks── PayPal sandbox
                               │ next start ($PORT)   ──HMAC, loopback──▶ approver   │ ──Payouts──▶ PayPal (Payouts app)
                               │ no Payouts creds        127.0.0.1:4020   (Payouts    │
                               │                                          creds only) │
                               └──────┬────────────────────────▲──────────────┬──────┘
                                      │ private net            │ POST /api/internal/* (HMAC-signed)
                                      ▼                        │              │
                              neighborline-db ◀────────────────┼──────────────┘ (both processes read/write it)
                                                     neighborline-workflows ◀── startTask (Render API) ── neighborline-scheduler (cron */15)
```

Why there is no Dockerfile: Render's native Node runtime builds the pnpm monorepo directly (`scripts/render-build.sh`),
and Workflows only support the `node`/`python` runtimes anyway. Docker would add build time and nothing else.

---

## 0. Before the first deploy (integrator checklist)

The Blueprint assumes the web app has these. Missing ones make the deploy fail or the workflows go red:

- [x] `GET /api/health` returns 200 quickly, with no PayPal or LLM calls (it also reports whether the approver answers). This is Render's health check.
- [x] The 5 `POST /api/internal/*` routes in [Endpoint contract](#endpoint-contract-for-the-integrator).
- [x] `APP_BASE_URL` falls back to `RENDER_EXTERNAL_URL` when it is empty (`scripts/render-start.sh` exports it for both processes).
- [x] The app listens on `$PORT` (`next start -p $PORT -H 0.0.0.0`); the approver listens on `127.0.0.1:4020` only.
- [ ] A **second PayPal sandbox REST app used only for Payouts** (step 4). Without `PAYPAL_PAYOUTS_CLIENT_ID/SECRET` the approver refuses to start in sandbox mode, and the instance restarts in a loop.

## 1. Create a Render account with GitHub

1. Go to <https://dashboard.render.com/register> and choose **GitHub**. Use the account that can see `Aaaaarin/neighborline`.
2. When asked for a workspace plan, keep **Hobby** ($0).
3. **Billing → Add payment method.** Paid instances, the cron job and Workflows all need one.

## 2. Connect the repository

1. **Account settings → Git providers → GitHub → Configure** (or wait for the prompt in step 3).
2. In GitHub's "Render" app install screen, choose **Only select repositories → `Aaaaarin/neighborline`** → *Install*.

## 3. Apply the Blueprint

1. Dashboard → **New → Blueprint**.
2. Pick `Aaaaarin/neighborline`, branch `main`. Render finds `render.yaml` at the repo root.
3. Name the Blueprint `neighborline`. Review the 4 resources and 2 environment groups it lists.
4. Render now asks for every `sync: false` value. Fill them in using the table in step 4.
   - You can leave `PAYPAL_WEBHOOK_ID` empty for now (step 5 fills it in).
   - `PAYPAL_PAYOUTS_CLIENT_*` are **required** for `PAYPAL_MODE=sandbox` (see step 4). `PAYPAL_PAYOUTS_WEBHOOK_ID` can wait for step 5.
   - You can leave `RENDER_API_KEY` empty if you haven't made one yet (step 4).
5. Click **Apply**. The first build takes about 3–5 minutes for the web app and about 1 minute each for the workflow and cron.
   The web service gets the URL `https://neighborline.onrender.com`. If that name is taken, Render adds a suffix. Note the real URL.
6. If you guessed `APP_BASE_URL` before you knew the URL, fix it: **neighborline → Environment → APP_BASE_URL** → the real URL → *Save, rebuild, and deploy*.

> Region is `oregon` for every resource. Private networking only works within one region. Region can't be changed later.

## 4. Secrets

| Key | Service | Where to get it |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | web | developer.paypal.com → **Apps & Credentials** → *Sandbox* → your app |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | web | The same Client ID. Next.js inlines it at **build** time, so changing it needs a rebuild |
| `PAYPAL_PAYOUTS_CLIENT_ID`, `PAYPAL_PAYOUTS_CLIENT_SECRET` | web service, handed **only to the approver process** | **Required in sandbox.** developer.paypal.com → Apps & Credentials → Sandbox → **Create App** (e.g. `neighborline-payouts`) under the same business sandbox account; enable the **Payouts** feature on it. On the main app (`PAYPAL_CLIENT_ID`), **turn Payouts off** so the web process's keys cannot send money even at PayPal |
| `PAYPAL_PAYOUTS_WEBHOOK_ID` | web service, handed only to the approver | Step 5: payout webhooks go to the Payouts app; the approver verifies them for the web app |
| `NEIGHBORLINE_APPROVER_SECRET` | none | HMAC key between Next and the approver. `scripts/render-start.sh` generates a fresh one on every boot; it exists only in those two processes |
| `PAYPAL_WEBHOOK_ID` | web | Step 5 |
| `ANTHROPIC_API_KEY` | web | console.anthropic.com → API keys. Also set a monthly **spend limit** for it in the Anthropic Console: the app's buckets cap request rates, only the provider caps the bill |
| `OPENAI_API_KEY` | web | platform.openai.com → API keys (speech-to-text and text-to-speech). Set a monthly budget for its project in the OpenAI dashboard for the same reason |
| `APP_BASE_URL` | web | `https://<your-service>.onrender.com` |
| `RENDER_API_KEY` | scheduler | Render → **Account settings → API keys → Create API key**. This is the cron job's only secret |
| `NEIGHBORLINE_INTERNAL_SECRET` | group `neighborline-internal` (web + workflow) | **Generated by Render.** Don't change it |
| `NEIGHBORLINE_APPROVAL_SECRET` | group `neighborline-secrets` (web only) | **Generated by Render** |
| `NEIGHBORLINE_SESSION_SECRET` | group `neighborline-secrets` (web only) | **Generated by Render.** Signs organizer sessions and visitor cookies (each judge's runs are tied to theirs), human-check challenges and passes, and keys the rate-limit rows. Rotating it signs everyone out. Every web instance must share it |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` (optional) | web | Cloudflare dashboard → **Turnstile** → *Add widget* (mode **Managed**, hostname = your `onrender.com` host). Add both in the service's **Environment**. With both set and `AI_MODE=live`, intake uses Turnstile instead of proof of work and the CSP allows `challenges.cloudflare.com`; with either missing, nothing changes. Cloudflare's test pair (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`) always passes |

Non-secret settings on the web service that matter for security (render.yaml):

| Key | Hosted value | Meaning |
|---|---|---|
| `DEMO_MODE` | `true` | Fails closed when unset (on only with `PAYPAL_MODE=fake`); the approver refuses `true` with `PAYPAL_MODE=live`. What it relaxes is printed on `/trust` ("In this demo") from the config |
| `RATE_LIMITS` | `on` | Token buckets per IP, per visitor and a global live-AI bucket, and per calling number on the phone line (`off` only for e2e) |
| `RATE_LIMIT_STORE` | unset (`auto`) | `auto`: the buckets live in Postgres (`rate_limit_buckets`) whenever the engine has a shared database, so every instance and restart share one budget; keys are HMAC'd, expired rows are swept, a database error falls back to per-process buckets. `memory`: always per process |
| `HUMAN_CHECK` | unset (`auto`) | Bot check before model-using intake. `auto`: none in fixture mode; with `AI_MODE=live`, Turnstile if both keys are set, else a background proof of work. `off` \| `pow` \| `turnstile` force one (`pow` is what e2e runs). Signed-in organizers and the scripted `/demo` are never asked |
| `HUMAN_CHECK_POW_BITS` | unset (`14`) | Proof-of-work difficulty: 32 puzzles of this many zero bits, about 200 ms in a laptop browser. Each +1 doubles it (phones are 3 to 5 times slower) |
| `PUBLIC_QUEUE` | unset (follows `DEMO_MODE`) | Whether anonymous readers see the redacted organizer queue. The hosted demo shows it to judges; a real group (`DEMO_MODE` off) shows each visitor only their own requests (THREAT_MODEL R12) |
| `TRUST_PROXY_HOPS` | `1` | Render's proxy appends the client address to `X-Forwarded-For`; the limiter trusts exactly that hop |

Organizer invite codes: `DATABASE_URL=<the service's database> pnpm --filter @neighborline/web organizer-invite org_dana [--ttl 72h]`
prints a single-use code for one organizer, once; the database keeps only its SHA-256 and expiry (THREAT_MODEL R13). A real organizer seat needs one even in demo mode; a judge never needs one (they play
Marcus on their own runs).

Why the PayPal and AI keys are `sync: false` on the web service and not in an environment group:
- Render's environment groups can't hold prompted (`sync: false`) values, so they would have to be committed.
- Only the web service needs those keys. Workflows and the cron job get only what they use: the HMAC secret and the Render API key.

The money-moving secrets never leave the web service's instance, and inside it they reach only the approver process (next section). `NEIGHBORLINE_APPROVAL_SECRET` (MCP approval tokens) is unrelated to the approver and is not needed by the hosted demo.

To rotate a secret: open the service (or group) → **Environment** → edit → *Save, rebuild, and deploy*. If you rotate `NEIGHBORLINE_INTERNAL_SECRET`, both the web service and the workflow pick it up on their next deploy or run.

## 5. Point PayPal webhooks at Render

1. developer.paypal.com → **Apps & Credentials** → *Sandbox* → open the app whose credentials are in `PAYPAL_CLIENT_ID`.
2. **Webhooks → Add webhook**.
   - Webhook URL: `https://<your-service>.onrender.com/api/webhooks/paypal`.
   - Event types:
     - `PAYMENT.PAYOUTSBATCH.PROCESSING`, `.SUCCESS`, `.DENIED`
     - `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `.UNCLAIMED`, `.RETURNED`, `.FAILED`, `.BLOCKED`, `.CANCELED`, `.DENIED`, `.HELD`, `.REFUNDED`, `.REVERSED`
     - `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`
     - `BILLING.SUBSCRIPTION.ACTIVATED`, `PAYMENT.SALE.COMPLETED`

   Or pick *All events*.
3. Save, then copy the **Webhook ID** shown in the list.
4. Render → **neighborline → Environment → `PAYPAL_WEBHOOK_ID`** → paste → *Save, rebuild, and deploy*.

5. Payout events (`PAYMENT.PAYOUTS*`) are delivered to the **Payouts app's** webhooks. Open the Payouts app → **Webhooks → Add webhook**
   with the same URL and the `PAYMENT.PAYOUTSBATCH.*` and `PAYMENT.PAYOUTS-ITEM.*` events, copy its ID into `PAYPAL_PAYOUTS_WEBHOOK_ID`.
   The web app first verifies with `PAYPAL_WEBHOOK_ID`; for an unverified `PAYMENT.PAYOUTS*` event it asks the approver
   (`POST /v1/verify-webhook`), which verifies with the Payouts app's credentials. The web app never sees them.
   Even without this webhook, sandbox payouts settle through the approver's read-only poll (`/v1/poll`) at 5 s, 15 s, 45 s, …
> Events from PayPal's *Webhooks simulator* can't be signature-verified, so a 400 response to them is expected.

## 6. Verify

1. **Smoke test the web app** from your laptop:
   ```bash
   scripts/verify-deploy.sh https://<your-service>.onrender.com
   # Also test a signed internal call. Copy the secret from Render → Env Groups → neighborline-internal:
   NEIGHBORLINE_INTERNAL_SECRET='…' scripts/verify-deploy.sh https://<your-service>.onrender.com
   ```
2. **Workflows → neighborline-workflows → Tasks** should list 8 tasks:
   - `nightlyReconcile`, `reconcileWindow`, `recheckAfterLag`
   - `unclaimedSweep`, `renotifyUnclaimed`
   - `refreshReport`, `alertOrganizers`, `smokeTest`

   Open **smokeTest → Start Task**, input `[]`. It should succeed with `signedCallOk: true`.
   This proves the workflow can reach the web app over the private network and that the HMAC secrets match.
3. **neighborline-scheduler → Trigger Run.** The log shows `dispatched` lines with `trn-…` run IDs, and the matching runs appear under the workflow's tasks.
   To start the reconcile right away, run `nightlyReconcile` from the dashboard with input `[]`.
4. **End to end:** play the Mrs. Lan scenario on `/demo`. The payout should show up in the PayPal sandbox, and PayPal's webhook delivery log should show a `200` from `/api/webhooks/paypal`.
5. Optional: run `python3 scripts/validate-render-yaml.py` before you change `render.yaml`. It also checks against Render's official JSON Schema when it can download it. For a server-side check, use `render blueprints validate render.yaml`.

---

## Approver process

SPEC §2 principle 2 says only the approval service holds Payouts credentials. On Render that is enforced like this:

| | Next.js (`neighborline` web) | Approver (`apps/approver`) |
|---|---|---|
| Started by | `scripts/render-start.sh`: `exec env -u PAYPAL_PAYOUTS_* … next start` | `scripts/render-start.sh`: `env -i` + an allow-list, `127.0.0.1:4020` |
| PayPal keys | Main app (`PAYPAL_CLIENT_ID`): Orders, Subscriptions, webhooks, Transaction Search. No Payouts client in the code (`least-privilege.test.ts`) | Payouts app (`PAYPAL_PAYOUTS_CLIENT_ID`), received as JSON on **stdin**, so they never appear in `/proc/<pid>/environ` |
| Database | `DATABASE_URL` | `DATABASE_URL` (same Postgres) |
| Can move money | No. It can only ask the approver to look at an approval record | Yes, after re-deriving hash, two distinct organizers, signatures, amounts and rail checks from the database |
| If it exits | Render restarts the instance | The start script stops the instance, Render restarts both |

**Why the same instance and not a Render private service.** Render private services have no free instance type
(<https://render.com/free>: free instances exist only for web services, Postgres and Key Value), so a separate
`neighborline-approver` costs **+$7/mo** (≈ $11 more through judging). The same-instance layout costs nothing extra and
still separates code, credentials and environment by process. Its limit, stated plainly: both processes run as the
same Unix user in one container, so an attacker with **arbitrary code execution** in the Next process could still
attack the approver process (for example by reading its memory). It does protect against everything short of that:
logic bugs and prompt-injected tool use in the web app (there is no Payouts code to misuse), SSRF or dependency code
that dumps environment variables (the web process has no Payouts variables), and any web code path calling PayPal
Payouts directly (the build fails).

**Upgrade to full isolation** (recommended for real money): uncomment the `neighborline-approver` private-service block
at the end of `render.yaml`, move `PAYPAL_PAYOUTS_*` to it, create an env group `neighborline-approver-link` holding
`NEIGHBORLINE_APPROVER_SECRET` (generated) and attach it to both services, and on `neighborline` set
`SKIP_EMBEDDED_APPROVER=true` and `APPROVER_URL=http://<approver hostport>`. Then the web container has no Payouts
credentials at all, and the approver is reachable only on the private network. A Postgres role per process (web without
`INSERT` on `payout_batches`) is the next step after that; Render Postgres gives one role by default, so it is not in
the Blueprint.

## Cold starts and keeping it warm for judges

A **free** web service spins down after 15 minutes without inbound traffic. Waking it takes about 1 minute, and judges see a loading page meanwhile.
Free instances also have only 0.1 CPU, which makes Next.js server rendering and the live AI calls noticeably slow, and Render may restart them at any time.

- **Recommended (in `render.yaml`): Starter web instance, $7/mo.** It never sleeps and has 5× the CPU.
- **Budget option, about $7.30/mo total.** The web service is free and Postgres stays paid.
  1. Set the web plan to `free`.
  2. On `neighborline-scheduler`:
     - Change the schedule to `*/10 * * * *`.
     - Add `KEEP_WARM_URL=https://<service>.onrender.com/api/health`.
  3. On `neighborline-workflows`, add `NEIGHBORLINE_BASE_URL=https://<service>.onrender.com`. Free web services can't receive private-network traffic.
  4. The 750 free instance hours per month cover exactly one always-on service.

  Trade-offs: random restarts, 512 MB RAM, slow AI pages, and the fake PayPal's memory is wiped on every restart.

## Fake-mode fallback

If the PayPal sandbox misbehaves during judging, set `PAYPAL_MODE=fake` on the web service and *Save and deploy*.
`scripts/render-start.sh` then starts `tools/fake-paypal` inside the same instance on `127.0.0.1:4010`. It delivers signed webhooks to Next over loopback.
- No PayPal credentials are needed. The approver process still runs and is still the only process that calls the (fake) Payouts API.
- Outcomes are deterministic: Rosa's payout goes UNCLAIMED, everything else goes SUCCESS.
- The `/trust` page says the mode out loud.
- Caveats:
  - The fake's state is in memory and resets on every deploy.
  - The fake's buyer-approval links point at loopback, so donor checkout in fake mode is the app's simulated button, not the real PayPal JS SDK.

It is **not** a separate private service. A private service costs $7/mo more, and the fake's webhooks have to reach the web app. Loopback inside one instance does that with zero network setup.

---

## How Render Workflows is used

Render Workflows runs task functions, each on its own instance, with per-task retries, timeouts, run history and chaining (`ctx.run`).
Neighborline uses it for the three background jobs a real mutual-aid group needs. These are real jobs, not decoration:

| Task (slug `neighborline-workflows/<name>`) | Trigger | What it does | Retry / timeout |
|---|---|---|---|
| `nightlyReconcile` | cron, daily at 10:00 UTC | Splits the last 72 h into 24 h windows and runs `reconcileWindow` on each **in parallel**. Items newer than PayPal's 3 h Transaction Search lag go to `recheckAfterLag`, which waits out the lag and reconciles them again. Mismatches that remain → `alertOrganizers` | 1 retry, 5 h |
| `reconcileWindow` | chained | `POST /api/internal/reconcile` for one window | 5 retries, 30 s × 2ⁿ backoff (rides out cold starts and PayPal 5xx/429), 10 min |
| `recheckAfterLag` | chained | Sleeps until the newest pending item is older than 3 h + 10 min, then reruns `reconcileWindow`. The wait is computed from absolute times, so a retry doesn't wait twice | 2 retries, 4.5 h |
| `unclaimedSweep` | cron, hourly | Lists UNCLAIMED items. Follow-ups are due at 1, 3, 7, 14 and 21 days, never twice within 20 h. One `renotifyUnclaimed` run per due item, in the requester's language. At **day 25** after the payout, one `alertOrganizers` run per item, before PayPal auto-returns it on day 30 | 2 retries, 30 min |
| `renotifyUnclaimed` | chained | `POST /api/internal/unclaimed/renotify` with idempotency key `renotify:<item>:<n>` | 4 retries, 5 min |
| `alertOrganizers` | chained | `POST /api/internal/organizer-alert` (deduped by key) | 4 retries, 5 min |
| `refreshReport` | cron, hourly (+ optionally the app after the Nth payout) | `POST /api/internal/report-refresh {minNewPayouts: 5}`. The app regenerates the donor report only if 5+ payouts happened since the last version | 3 retries, 10 min |
| `smokeTest` | manual | Health check plus a signed no-op call | 2 retries |

The timing rules live in `workflows/src/policy.ts`. They are pure functions with unit tests, and AI decides none of them.

The scheduler sends every dispatch with an idempotency key (`reconcile:<day>`, `unclaimed:<hour>`, `report:<hour>`). Render dedupes repeated keys for 24 h, so the 15-minute ticks start each job once per period, and a missed tick heals itself on the next one.

**Optional instant report refresh from the app.** After the Nth `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` since the last report, the app can start the task directly:
```ts
await fetch('https://api.render.com/v1/task-runs', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.RENDER_API_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ task: 'neighborline-workflows/refreshReport', input: [{ minNewPayouts: 5, force: false, reason: 'payout_threshold' }],
                         idempotencyKey: `report-after-${totalPayouts - (totalPayouts % 5)}` }),
});
```
This needs `RENDER_API_KEY` on the web service. A Render API key has account-wide scope, which is why the hourly cron path is the default.

### Render Workflows facts (checked Oct 16 2026)

- **Status:** public beta since Apr 7 2026. Blueprint support (`type: workflow`) arrived Sep 16 2026. Flex compute arrived Sep 1 2026. Source: <https://render.com/changelog>.
- **Languages:** TypeScript and Python SDKs. TypeScript package `@renderinc/sdk` (1.2.0, Sep 23 2026). Tasks are `task({ name, retry, timeoutSeconds, plan }, fn)`, and the server auto-starts. Sources: <https://render.com/docs/workflows-sdk-typescript>, <https://render.com/docs/workflows-defining>.
- **Triggers:**
  - SDK `render.workflows.startTask(slug, input, { idempotencyKey })`
  - REST `POST /v1/task-runs`
  - CLI
  - Dashboard

  Source: <https://render.com/docs/workflows-running>. **Workflows has no native scheduling: "use a cron job"** (<https://render.com/docs/workflows>).
- **Retries:** the default is 3 retries starting at 1 s with ×2 backoff. They are configurable with `maxRetries`, `waitDurationMs` and `backoffScaling`.
- **Timeouts:** the default is 2 h. The range is 30 s to 24 h.
- **Payloads:** arguments are capped at 4 MB per run and must be JSON-serializable.
- **Limits** (<https://render.com/docs/workflows-limits>):
  - 50 API-started runs per minute on Hobby.
  - 1,000 chained runs per minute.
  - New compute is capped at 16 CPU per minute on Hobby.
  - 500 tasks per workflow.
- **Pricing** (<https://render.com/pricing>): no free allowance is documented. Flex (the default plan, up to 1 CPU and 4 GB) costs $0.20 per CPU-hour plus $0.05 per GB-hour of actual use, prorated per second. Fixed plans run from `2c-4g` at $0.40/h to `8c-32g` at $2.50/h. Run state is kept for 30 days at $0.25/GB.
- **Limitations:**
  - No preview environments.
  - No Docker runtime.
  - No HIPAA workspaces.
  - Runs can make outbound and private-network calls but cannot receive connections.

### Fallback without Workflows

If Workflows is unavailable (for example during a beta incident), set `DISPATCH_MODE=inline` on `neighborline-scheduler`. Also add `NEIGHBORLINE_INTERNAL_SECRET` and `NEIGHBORLINE_BASE_URL` to it.
The cron job then runs the same task code in its own process. The trade-offs:
- Retries become a simple in-process loop.
- You lose per-run history in the dashboard.
- Chained work is serial.
- A slow lag recheck blocks the next tick, because Render runs at most one instance of a cron job at a time.

---

## Endpoint contract for the integrator

Types live in [`workflows/src/contract.ts`](../workflows/src/contract.ts), and signing lives in [`workflows/src/signing.ts`](../workflows/src/signing.ts).

**Status: implemented** in `apps/web/app/api/health` and `apps/web/app/api/internal/*` (logic in
[`lib/server/engine/internal.ts`](../apps/web/lib/server/engine/internal.ts); the contract and signing files are copied
into `apps/web/lib/server/internal-contract.ts` / `internal-auth.ts` and a test fails if they drift). Durable state for
these jobs is written to the hash-chained audit log, not to new tables: `reconcile.window`, `unclaimed.renotify`,
`organizer.alert` and `report.generated` rows, each deduped by its idempotency key. Alerts appear as `alerts` on the
organizer group view and the ledger view. None of these routes can move money: they run in the web process.

**Auth for every `/api/internal/*` route:**
- Read the raw body first.
- Call `verifyInternalRequest({ secret: process.env.NEIGHBORLINE_INTERNAL_SECRET, method, path: url.pathname, rawBody, headers: req.headers })`. Copy the function into `apps/web/lib/server/internal-auth.ts`; it only needs `node:crypto`.
- The signature is `x-neighborline-signature: v1=HMAC_SHA256(secret, "<ts>.<METHOD>.<path>.<rawBody>")`, with `x-neighborline-timestamp` in unix seconds and ±300 s allowed.
- Return 401 when verification fails.
- Use the Node runtime with `dynamic = 'force-dynamic'`.

**Retries and idempotency:**
- The workflow retries on network errors, 408, 425, 429 and 5xx, so every route must be idempotent.
- Any other 4xx counts as a permanent failure.

| Route | Request → Response | Must |
|---|---|---|
| `GET /api/health` (public) | → `{ ok: true, version?, paypalMode?, aiMode?, db? }` | Respond in under 5 s. No PayPal or LLM calls |
| `POST /api/internal/reconcile` | `{ startDate, endDate, lagHours, idempotencyKey }` → `{ window, checked, matched, mismatches[], pendingLag[{itemId, paidAt}], fetchedTransactions }` | Page through `paypal.reporting.searchTransactions`: ≤31-day ranges, ≤500 rows per page. Run `reconcile(localItems, txns)`. Classify items newer than `endDate − lagHours` as `pendingLag`, not as mismatches. Store the reconcile status (it shows on `/ledger`). Return 502/503 when PayPal fails |
| `POST /api/internal/unclaimed-sweep` | `{ now, minAgeHours }` → `{ items: [{ itemId, requestId, lang, wallet, amountCents, payoutCreatedAt, unclaimedSince, nudgeCount, lastNudgeAt, organizerAlertedAt }] }` | **Read-only.** Return items whose status is UNCLAIMED. `nudgeCount` and `lastNudgeAt` count follow-ups sent by `renotify` |
| `POST /api/internal/unclaimed/renotify` | `{ itemId, nudgeNumber, idempotencyKey }` → `{ sent, skippedReason?, lang?, channel?, notificationId? }` | Recheck that the item is still UNCLAIMED (if not, return `no_longer_unclaimed`). Render the NotifyAgent **unclaimed claim-help** template in the request's `lang`. Then `recordNotification`, emit `notify.sent`, and dedupe on `idempotencyKey` |
| `POST /api/internal/organizer-alert` | `{ kind: 'unclaimed_day25' \| 'reconcile_mismatch', idempotencyKey, itemIds, summary, deadline?, detail? }` → `{ alertId, created, channels }` | Record one alert per key, plus an audit row. Show it on `/organizer` and `/ledger`. For `unclaimed_day25`, set the item's `organizerAlertedAt` |
| `POST /api/internal/report-refresh` | `{ minNewPayouts, force, reason }` → `{ regenerated, skippedReason?, newPayoutsSinceLast, totalPayouts, reportVersion?, generatedAt?, narrativeSource? }` | If `force` is set or at least `minNewPayouts` new payouts happened since the last report: `buildReport` → `agents.report.write` → store a new version that `/report` serves. Otherwise return `{ regenerated: false, skippedReason: 'not_due' }` quickly |

The existing UI route `POST /api/reconcile` can stay as it is. The internal route is the signed, windowed variant.

### Other notes for the integrator

- **Demo reset is not public.** `POST /api/demo/reset` needs the same HMAC as `/api/internal/*` (`NEIGHBORLINE_INTERNAL_SECRET`); the workflow task `nightlyDemoReset` calls it when `DEMO_RESET_HOUR_UTC` is set on the scheduler. Judges don't need a reset: each visitor's runs are separate (visitor cookie) and demo runs don't count against caps.
- **Demo reset on Postgres.** With `DATABASE_URL` set, the reset returns 409 because the audit log is append-only, so `DEMO_RESET_HOUR_UTC` is left unset in render.yaml.
  - Repeated `/demo` plays worked without a reset in local fake mode. Before judging, also check that the daily-budget and velocity caps don't block a busy day of judge replays.
  - If a reset is required, there are two options:
    - Switch the web service to embedded PGlite on a Render persistent disk (`PGLITE_DIR=/var/data/pglite`, 1 GB disk, about $0.25/mo). This disables zero-downtime deploys.
    - Implement generation-per-schema on Postgres.
- **Single instance only.** SSE fan-out, the per-request event log, WebAuthn challenges and the rate-limit buckets are in process memory. Don't raise `numInstances` or enable autoscaling.
- **Boot is idempotent.** `migrate` and `seedDemo` run on every boot and skip work when the data is already there (already true in `engine/db-state.ts`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy hangs then fails on the health check | Check the log for `[render-start]` and `config.invalid` lines: in sandbox mode the approver exits without `PAYPAL_PAYOUTS_CLIENT_ID/SECRET`, and the start script then stops the instance |
| Approve returns 503 "approval service is unreachable" | The approver process is down or still booting; `GET /api/health` shows `approver: "down"`. See the instance log for `svc":"approver"` lines |
| Build fails at `pnpm install --frozen-lockfile` | Run `pnpm install` locally and commit `pnpm-lock.yaml` |
| `smokeTest` fails with `HTTP 401 (permanent)` | Web and workflow have different `NEIGHBORLINE_INTERNAL_SECRET` values. Redeploy both after changing the group |
| `smokeTest` fails with `ECONNREFUSED` / `ENOTFOUND` | The web service is on the free plan (it can't receive private traffic). Set `NEIGHBORLINE_BASE_URL` on the workflow |
| Scheduler logs `dispatch_failed … 404` | `WORKFLOW_SLUG` doesn't match. Copy the slug from the workflow's page |
| Scheduler logs `429` | More than 50 API-started runs per minute on Hobby. Ticks only start 2–3 runs, so look for a loop |
| PayPal webhooks return 400 | `PAYPAL_WEBHOOK_ID` doesn't match the app that sent the event, or the event came from the simulator |
| Fake mode: `EADDRINUSE 4010` | Another fake is already running in the instance. Redeploy to clear it |
| A POST returns 403 "cross-origin request from …" | The page's origin is not the service's: set `APP_BASE_URL` (or `WEBAUTHN_ORIGIN`) to the public URL |
| 429 "Too many requests from this device" | The per-IP / per-visitor limiter (`RATE_LIMITS`). Wait for `Retry-After`; tune in `apps/web/lib/server/security/rate-limit.ts`. The buckets are in the `rate_limit_buckets` table; deleting a row refills that bucket |
| 403 `human_check_required` on intake | The browser has no human pass (`HUMAN_CHECK`). The pages earn one automatically; an API client must `POST /api/human/challenge` and `/api/human/verify` first. With Turnstile, check that the widget's hostname matches `APP_BASE_URL` and that both keys are set |
| 503 "We could not check this browser" | Turnstile's siteverify was unreachable; intake fails closed. Retry, or unset the Turnstile keys to fall back to proof of work |
| Approver refuses to start: "DEMO_MODE=true is not allowed with PAYPAL_MODE=live" | Intended. Unset `DEMO_MODE` (it defaults off outside fake mode) |
