# Neighborline — build status (Oct 29, 2026)

Repo: github.com/Aaaaarin/neighborline (private until you say "yes, public")

## Live
- **Hosted:** <https://neighborline.onrender.com> from [`render.free.yaml`](../render.free.yaml): free web instance (approver
  as a separate process) + free Postgres, `PAYPAL_MODE=sandbox`, `AI_MODE=live` with `LLM_PROVIDER=openai`. It sleeps
  after 15 idle minutes (first visit about a minute). No Workflows or cron on the free Blueprint. The $50 hackathon
  credit is on the Render account
- **The free Postgres expires 30 days after creation (about Nov 28).** Judging is Dec 1–15, so before Nov 28: add a
  card, then Blueprint → Settings → Blueprint path → `render.yaml` (upgrades the same resources in place and adds the
  Workflows tasks and the cron job)
- AI on the hosted app: OpenAI for extraction and speech-to-text; the web "listen" read-back uses the browser's
  `speechSynthesis`; OpenAI TTS is used by the phone line and the video voiceover

## Verified for real
- **PayPal sandbox spike, Oct 28** ([SANDBOX_EVIDENCE.md](SANDBOX_EVIDENCE.md), raw in `docs/evidence/raw/`):
  wallet payout SUCCESS, unregistered email UNCLAIMED, duplicate `sender_batch_id` resolved, donation captured,
  3 monthly-giving plans; the sandbox refuses Venmo items (stand-ins documented); cancel of UNCLAIMED answers 500
- **Hosted runs, Oct 29** ([raw](evidence/raw/hosted-20261029.json)): Lan SUCCESS, batch `9D4A2K6DW4Y5N`, with
  PayPal's signed webhook verified by the app (webhooks registered); Rosa UNCLAIMED, cancel 500 shown as "try
  again"; the impersonator blocked with no batch; a Korean `/call` request through live OpenAI extraction, priced by
  the rules, approved and paid in sandbox
- **Tests (Oct 29):** 1144 unit and integration tests (`pnpm test`, 11 packages), 38 Playwright end-to-end tests,
  19 Render Workflows tests. CI green: typecheck, unit tests, build, Playwright e2e (ubuntu-24.04), dependency audit
  (3 documented ignores, incl. zod GHSA-mrhx-c7xc-m3w5), gitleaks
- Not yet: a live-model score on the eval ([EVAL.md](EVAL.md)); `/ledger` Reconcile now on the hosted app (needs an
  organizer passkey session); the phone line (no Twilio number)

## Blocked on you
1. **Card on Render → switch the Blueprint path to `render.yaml` before Nov 28** (see above)
2. **"Yes, public"** for the repo
3. **YouTube upload** of the video, then `pnpm golive --only finalize-docs` for the link
4. **Video:** voiced Draft 5 is cut (OpenAI TTS narration, 2:55.0, `$VIDEO_OUT/neighborline-draft5-vo.mp4`); watch it, then upload
5. **Devpost submission** ([submission/DEVPOST.md](submission/DEVPOST.md), [CHECKLIST.md](submission/CHECKLIST.md))
- Optional: native-speaker review of the vi/es/ht copy, an npm token, a Twilio number

## Deadline
Submission closes Nov 12, 2026 12:00 PT (target Nov 11). Judging Dec 1–15: the hosted app must be on the paid
Blueprint by then.
