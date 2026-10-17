# Key day: from keys to a hosted, evidenced submission

Everything that needs real credentials is scripted in [`scripts/golive`](../scripts/golive) and runs as one command:

```bash
pnpm golive                 # preflight → sandbox-setup → sandbox-spike → live-ai → deploy-render → video-vo → finalize-docs
pnpm golive --dry-run       # what each step would do; no network calls, no changes (works with zero keys)
```

**Your part is about 10 minutes of clicks** (below), then one command that runs for **about 45–60 minutes** (the eval
and Render's first build are most of it). Every step is idempotent and resumable: if something stops, fix what it
says and run `pnpm golive` again; finished parts are skipped. Nothing ever runs against live PayPal (the scripts
refuse `api-m.paypal.com`).

## 1. The human checklist (about 10 minutes)

### PayPal sandbox (about 6 minutes), at <https://developer.paypal.com> → log in → **Apps & Credentials** → **Sandbox**

1. **Create App** → name `neighborline-main`, type *Merchant*, sandbox account: the default business account.
   Under its **Features**: keep *Accept payments*, tick **Transaction search**, and **untick Payouts** if it is ticked
   (least privilege: the web app must not be able to move money). Save. Copy **Client ID** and **Secret**.
2. **Create App** again → `neighborline-payouts`, same business account. Features: tick **Payouts** (only). Save.
   Copy its **Client ID** and **Secret**.
3. **Testing tools → Sandbox accounts.** Open the default **Personal** account (`sb-…@personal.example.com`) →
   *View/edit account*: copy its email and password. It receives the PayPal-wallet test payout, approves the test
   checkout, and on the hosted `/demo` stands in for Mrs. Lan's, Jean's and Walter's wallets (sandbox Venmo does not
   settle), so their payouts really reach `SUCCESS`. Check the **Business** account shows a USD balance (new ones have
   $5,000).
4. Optional, for judges: **Create account** → Personal, US. Its email/password go into DEVPOST as the sandbox buyer
   judges may use on `/donate` (it is published, so never reuse a real password).

### OpenAI (1 minute)
5. <https://platform.openai.com/api-keys> → **Create new secret key** (project with billing on). Expect a few dollars
   of usage: the eval, five demo voice notes, three intakes and the voiceover. Optional: an Anthropic key adds a Claude
   column to the eval.

### Render (about 4 minutes)
6. <https://dashboard.render.com/register> with **GitHub**; keep the Hobby workspace; **Billing → Add payment method**
   (about $14.50/month, [DEPLOY.md](DEPLOY.md)).
7. **Account settings → API keys → Create API key**. Copy it (`rnd_…`).
8. **Apply the Blueprint** (Render has no API for this one click): <https://dashboard.render.com/blueprints> →
   **New Blueprint Instance** → connect GitHub, pick `Aaaaarin/neighborline`, branch `main` → name it `neighborline`
   → leave every prompted value **empty** → **Apply**. The first build may fail its health check without keys; that
   is expected, `pnpm golive` fills the keys and redeploys. (If you forget this, `deploy-render` stops and prints the
   same clicks; run `pnpm golive` again afterwards.)

### Put the values in `.env` (repo root, git-ignored)

```bash
PAYPAL_CLIENT_ID=…            # step 1
PAYPAL_CLIENT_SECRET=…
PAYPAL_PAYOUTS_CLIENT_ID=…    # step 2
PAYPAL_PAYOUTS_CLIENT_SECRET=…
SANDBOX_PERSONAL_EMAIL=sb-…@personal.example.com   # step 3
SANDBOX_BUYER_EMAIL=sb-…@personal.example.com      # step 3 (same account is fine)
SANDBOX_BUYER_PASSWORD=…
OPENAI_API_KEY=sk-…           # step 5
RENDER_API_KEY=rnd_…          # step 7
# optional
ANTHROPIC_API_KEY=sk-ant-…
SANDBOX_VENMO_HANDLE=…        # a Venmo username for the Venmo test item (default: neighborline-sandbox-test)
SANDBOX_DEMO_RECEIVER_EMAIL=… # the sandbox Personal account the hosted /demo pays (default: SANDBOX_PERSONAL_EMAIL)
JUDGE_SANDBOX_BUYER_EMAIL=…   # step 4, published in DEVPOST
JUDGE_SANDBOX_BUYER_PASSWORD=…
```

Leave `PAYPAL_MODE`, `PAYPAL_BASE_URL` and the webhook/plan ids alone: golive writes the ids it creates to
`golive-out/golive.env` and pushes them to Render itself.

### Then

```bash
pnpm golive
```

When it is done: upload `golive-out/video/neighborline-draft3-vo.mp4` to YouTube (public, per the rules;
[YOUTUBE.md](submission/YOUTUBE.md)), then

```bash
VIDEO_ID=<the 11-character id> pnpm golive --only finalize-docs
git diff README.md docs/ packages/paypal/   # review, then commit and push
```

## 2. What each step does

| Step | Needs | Does | Writes | Time |
|---|---|---|---|---|
| `preflight` | nothing | Checks every key's format, pings PayPal OAuth for both apps (reads the granted scopes: Payouts on the payouts app only, Transaction Search on the main app), finds ffmpeg/Playwright, lists which steps can run. Stops on a malformed key or a failed OAuth | `golive-out/preflight.json` | seconds |
| `sandbox-setup` | PayPal keys | Webhook subscriptions for `<URL>/api/webhooks/paypal` on both apps (main: orders, captures, subscriptions; payouts app: `PAYMENT.PAYOUTS*`), only if a public URL is known yet; the catalog product and $10/$25/$50 monthly plans (`ensureDonationTiers`); a one-day Transaction Search query to prove the permission | `golive-out/sandbox-setup.json`, ids in `golive.env` | ~20 s |
| `sandbox-spike` | Payouts app (+ main app) | The [real-sandbox checklist](PAYPAL.md#to-verify-in-the-real-sandbox): one batch with a PayPal-wallet item, Venmo by handle and by email, and an unregistered email; a Venmo handle with `@`; a PHONE probe; polling to final statuses; cancel of the UNCLAIMED item; the duplicate `sender_batch_id` (exact error shape, our detection, `PayPal-Request-Id` replay); 25 negative-testing values; Orders (create, buyer approval with Playwright as the sandbox buyer, capture, idempotent re-capture, `INSTRUMENT_DECLINED`); the webhook events PayPal emitted; Transaction Search reconcile | `golive-out/SANDBOX_EVIDENCE.md` + `.json`; on success also `packages/paypal/src/fixtures/duplicate-sender-batch/sandbox-<date>.json` and the "Observed in the sandbox" block of `PAYPAL_NOTES.md` | 3–6 min |
| `live-ai` | OpenAI key | Live eval (`--mode live --check`, regenerates the live columns of [EVAL.md](EVAL.md)); the five demo voice notes with TTS (`make-demo-audio`); three real intakes (vi, es, ht) through the app's API on a private stack (ports 3340/4341–4344, `AI_MODE=live`), passing the app's human check like a browser | `packages/agents/eval/results/*-live-*.json`, `docs/EVAL.md`, `packages/agents/fixtures/audio/`, `golive-out/live-ai/` (traces, `INTAKES.md`) | 15–25 min |
| `deploy-render` | Render key | Validates `render.yaml` with Render, finds the Blueprint's `neighborline` service and its URL, registers the PayPal webhooks for that URL, sets only the env vars that differ (PayPal keys and ids, plans, AI keys, `APP_BASE_URL`, `PAYPAL_MODE`, `LLM_PROVIDER`, `SANDBOX_DEMO_RECEIVER_EMAIL`; `RENDER_API_KEY` on the scheduler), deploys and waits for `live`, runs [`scripts/verify-deploy.sh`](../scripts/verify-deploy.sh) with the internal secret, then plays `/demo` (Lan) through the hosted API and records the sandbox batch id, the stand-in it paid (masked) and the webhook the app verified | `golive-out/deploy/`, `HOSTED_URL` in `golive.env` | 6–12 min |
| `video-vo` | OpenAI key, ffmpeg | `node docs/submission/video/build.mjs --with-vo` with the hosted URL on the end card | `golive-out/video/` (MP4, captions, thumbnail) | 10–15 min |
| `finalize-docs` | whatever is known | Replaces `{HOSTED_URL}`, `{VIDEO_ID}`, `{SANDBOX_BUYER_*}` (from `JUDGE_SANDBOX_BUYER_*` only) in README and `docs/submission/`; from a **real sandbox** run only: the README "Hosted" line and Sandbox reality rows (including "Scripted `/demo` payouts in sandbox" from the hosted run), DEVPOST's *(sandbox)* sentences, [PAYPAL.md](PAYPAL.md)'s checklist, `docs/SANDBOX_EVIDENCE.md`; then the link checker and a GET of the hosted `/demo` | the docs (review before committing) | seconds |

A run ends with `golive-out/SUMMARY.md`: one line per step and the next action for anything not done.

Flags: `--only a,b` (preflight always runs first), `--skip a,b`, `--force` (redo finished parts: a new sandbox run id,
a redeploy, a rebuilt video), `--list`. Optional env: `GOLIVE_WEBHOOK_CAPTURE_URL` (see below),
`GOLIVE_HOSTED_PAYPAL_MODE=fake|sandbox` (default: `sandbox` when both PayPal apps' keys and a demo receiver,
`SANDBOX_DEMO_RECEIVER_EMAIL` or `SANDBOX_PERSONAL_EMAIL`, are set; otherwise the labelled fake), `GOLIVE_HERO_SCENARIO` (default `lan`), `GOLIVE_POLL_SECONDS` (default 300),
`GOLIVE_DEPLOY_TIMEOUT_MIN` (25), `RENDER_OWNER_ID` (if the key sees several workspaces), `VIDEO_OUT`.

**Statuses:** `ok`; `warn` (done, read the note); `pending` (PayPal or Render still working, or a value you add later:
re-run later, the run goes on); `skipped` (no key yet); `failed` (the run stops here and says what to do).

### Things that take time on their own

- **Transaction Search lags up to 3 hours.** The spike's reconcile is `pending` until PayPal shows the payouts. Run
  `pnpm golive --only sandbox-spike` again later (it only redoes the reconcile), then `--only finalize-docs`.
- **A real webhook before deploy** (optional): with a tunnel (`cloudflared tunnel --url http://localhost:4345`) set
  `GOLIVE_WEBHOOK_CAPTURE_URL=https://<tunnel>/capture`. The spike then subscribes that URL on the Payouts app,
  receives a real delivery, verifies it with PayPal's postback API (and a tampered copy, which must fail) and deletes
  the subscription. Without it, `deploy-render`'s hosted run records the webhook the app itself verified.

## 3. Fallbacks and rollback

| If | Do |
|---|---|
| **Sandbox Venmo does not settle** (Venmo items `FAILED`/`UNCLAIMED` in `SANDBOX_EVIDENCE.md`; PayPal documents only the `POSPYO003` mock) | Already handled: the hosted `/demo` pays the sandbox Personal account (`SANDBOX_DEMO_RECEIVER_EMAIL`, default `SANDBOX_PERSONAL_EMAIL`) standing in for Lan's and Jean's Venmo, after the rail checks on their handles, and every screen says so ([DEMO.md](DEMO.md#in-the-real-paypal-sandbox)). Rosa's run uses a fresh unregistered address and really stays `UNCLAIMED` (cancel on the stage). The spike's PayPal-wallet item is the sandbox proof README/DEVPOST cite |
| **The hosted hero ends `UNCLAIMED`/`FAILED`** instead of `SUCCESS` (`deploy-render` warns) | The receiver is not a sandbox **Personal** account (or has no confirmed email): fix `SANDBOX_DEMO_RECEIVER_EMAIL`, then `pnpm golive --only deploy-render,finalize-docs`. Or run the stage on the labelled fake: `GOLIVE_HOSTED_PAYPAL_MODE=fake pnpm golive --only deploy-render,finalize-docs` |
| **The hosted `/demo` run fails in sandbox** (`deploy-render` warns; e.g. `SENDER_RESTRICTED`, no verified webhook) | Same fake-mode command as above; the spike's evidence still stands. Check the Payouts app's webhook delivery log at developer.paypal.com |
| **The duplicate-error shape differs** from what the client expects | The spike marks `duplicate` `warn` and writes the real body to `packages/paypal/src/fixtures/duplicate-sender-batch/`; `pnpm --filter @neighborline/paypal test` then fails until `isDuplicateSenderBatchError` / `findExistingBatchId` in `packages/paypal/src/payouts.ts` match it. Nothing was paid twice either way (`DuplicateBatchError` → `UNKNOWN` → re-check) |
| **Transaction Search permission missing** | Tick it on the main app (step 1), wait a few minutes, `pnpm golive --only sandbox-setup,sandbox-spike` |
| **Render is late or the build fails** | `deploy-render` prints the dashboard link to the failed deploy's logs ([DEPLOY.md Troubleshooting](DEPLOY.md#troubleshooting)). No account in time: submit with "Runs locally with zero credentials: `pnpm i && pnpm dev`" (DEVPOST_FIELDS.md says where), and keep the sandbox evidence |
| **A bad deploy** | Render dashboard → the service → **Events** → an earlier deploy → **Rollback**; or set `GOLIVE_HOSTED_PAYPAL_MODE=fake` and re-run `deploy-render` |
| **Doc edits look wrong** | They are not committed by the script: `git checkout -- README.md docs/ packages/paypal/PAYPAL_NOTES.md` |
| **Unwanted webhook subscriptions** | developer.paypal.com → the app → Webhooks → delete. golive matches by URL, so re-running never duplicates them |
| **OpenAI quota or eval trouble** | `pnpm golive --skip live-ai` deploys anyway (the hosted app falls back to fixtures on model errors, `AI_FALLBACK=fixture`) |
| **ffmpeg missing** | `pnpm golive --skip video-vo`, build the video on a machine with ffmpeg later |

## 4. Safety rails

- Sandbox only: `PAYPAL_BASE_URL` pointing at live PayPal stops preflight; the Playwright buyer refuses any page that
  is not `sandbox.paypal.com`.
- Secrets never print: logs and `golive.log` mask every key; evidence masks receiver emails.
- A run against `tools/fake-paypal` (what the tests use) is labelled "Not sandbox evidence" and `finalize-docs`
  refuses to publish it.
- Re-runs cannot pay twice: every `sender_batch_id` derives from the run id stored in `golive-out/state.json`.
- golive starts its own servers only on its own ports and stops only the process groups it started
  (`golive-out/pids`).

## 5. Tested now, without keys

`pnpm --filter @neighborline/golive test` runs every step against `tools/fake-paypal` (which gained webhook
subscriptions, event types, the event list and resend for this), a mock Render API, a mock hosted app (with the real
`scripts/verify-deploy.sh`), a mock app with the live-AI human check, and a shadow copy of the docs. The dry run is
tested to make no network call. What only key day can show: the real sandbox's answers (that is the point of the
spike), Render's real build, and the real models.
