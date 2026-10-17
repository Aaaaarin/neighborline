# Neighborline — build status (Oct 17, 2026)

Repo: github.com/Aaaaarin/neighborline (private until you approve making it public)

## Built and green
- 1103 unit and integration tests (`pnpm test`, 11 packages), 38 Playwright end-to-end tests and 18 Render Workflows
  tests pass; typecheck and the production web build are green; CI on GitHub runs typecheck, tests, build, e2e,
  dependency audit, secret scan and the AI eval gate
- Voice/text intake in 10 languages, read-back, one clarifying question with quick answers, decline + REVIEW appeal;
  Vietnamese address forms (bà, ông, chị… → chúng cháu / chúng tôi) in every status message
- Rules-as-code: plain-English rules → AI draft with a quoted source per cap → two signatures activate a new version
- Two-person approval signed with passkeys; a separate approval service is the only process with PayPal Payouts
  credentials and re-checks policy, rail, hash and signatures before it pays
- PayPal: Payouts (PayPal + Venmo), Orders v2, Subscriptions, webhooks (verified, at-least-once), Transaction Search
  reconcile, idempotent batch ids, account-restriction fallback (`FAILED_RAIL`) to manual recording
- **Sandbox `/demo` that really settles:** with `PAYPAL_MODE=sandbox` and `SANDBOX_DEMO_RECEIVER_EMAIL`, Lan's, Jean's
  and Walter's payouts go to a PayPal sandbox account standing in for their Venmo/email (after the rail checks on the
  scripted destination), Rosa's to a fresh unregistered address so it genuinely goes `UNCLAIMED` (cancel on the
  stage, no faked claim); the stage, both phones, the organizer card and `/trust` say so
  ([DEMO.md](DEMO.md#in-the-real-paypal-sandbox))
- Rail protection: lookalike handles, injection, caps; AI eval: 100% injection/impersonation catch, 0 false flags
  (offline extractor; live model not yet measured)
- Abuse protection for a public deployment: shared Postgres rate limits, a human check (Turnstile or proof of work)
  on model-using intake, organizers-only queue outside demo mode
- Open-source `@neighborline/paypal` package + MCP server that refuses payouts without two human signatures
  (publish-ready)
- Phone hotline (Twilio) built and tested with simulated calls; switches on with a number
- Render Blueprint + Render Workflows jobs written; **`pnpm golive`** scripts the whole key day (sandbox setup and
  spike, live AI, Render deploy with the hosted `/demo` run, voiceover, doc finalization), tested end to end against
  fakes ([GOLIVE.md](GOLIVE.md))
- Video Draft 4 (2:40.5, captions, re-recorded takes with Lan's elder register; code card shows the 1093-test run
  from before the sandbox stand-in tests); voiceover renders once the OpenAI key exists

## Blocked on you
Everything that needs a human is one checklist: **[docs/GOLIVE.md](GOLIVE.md)** (about 10 minutes of clicks: PayPal
sandbox apps and accounts, OpenAI key, Render account and Blueprint; then `pnpm golive`, the YouTube upload and
`--only finalize-docs`). Beyond it: permission to make the repo public, the Devpost submission, and optionally a
native-speaker review of the vi/es/ht copy, an npm token and a Twilio number.

## Deadline
Submission closes Nov 12, 2026 12:00 PT. Target: submit by Nov 11.
