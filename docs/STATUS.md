# Neighborline — build status (Oct 17, 2026)

Repo: github.com/Aaaaarin/neighborline (private until you approve making it public)

## Built and green
- 972 unit tests + 34 Playwright end-to-end tests pass; CI green on GitHub (typecheck, tests, build, e2e, audit, secret scan, AI eval gate)
- Voice/text intake in 10 languages, read-back, one clarifying question, appeal flow
- Rules-as-code: plain-English rules -> AI draft with a quoted source per cap -> two signatures activate a new version
- Two-person approval signed with passkeys; separate approval service is the only process with PayPal Payouts credentials
- PayPal: Payouts (PayPal + Venmo), Orders v2, Subscriptions, webhooks (verified, at-least-once), Transaction Search reconcile, idempotent batch ids, account-restriction fallback to manual recording
- Rail protection: lookalike handles, injection, caps; AI eval: 100% injection/impersonation catch, 0 false flags (offline extractor; live model not yet measured)
- Open-source `@neighborline/paypal` package + MCP server that refuses payouts without two human signatures (publish-ready)
- Phone hotline (Twilio) built and tested with simulated calls; switches on with a number
- Render deploy blueprint + Render Workflows jobs written
- Video draft 2 (2:40, captions; voiceover pending key)

## Blocked on you (in priority order)
1. Permission to make the repo public (required by rules)
2. PayPal sandbox Client ID + Secret (ideally two apps: checkout and Payouts-only)
3. OpenAI API key (live AI + voiceover)
4. Render account (hosted demo, ~$15/month until judging ends)
5. Optional: npm org `neighborline` + token; Twilio number; native-speaker review (vi/es/ht)

## Deadline
Submission closes Nov 12, 2026 12:00 PT. Target: submit by Nov 11.
