## What and why

<!-- One or two sentences. Link the issue: "Closes #123". -->

## Lane

<!-- core · db · paypal / fake-paypal · agents · web · docs/devex. If you touched another lane, say why. -->

## How I tested it

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm --filter @neighborline/web test:e2e` (if the UI or an API route changed)
- [ ] New or changed behavior has tests, including cases that must **not** trigger (for rail checks and injection rules)

## Money-path and AI review checklist

Tick each box, or write "n/a" next to it. This is the checklist from [THREAT_MODEL.md](../THREAT_MODEL.md#reviewing-ai-written-code);
it applies whether a person or an AI wrote the code.

- [ ] No model output reaches an amount, a payout destination or a PayPal call without zod validation and grounding
- [ ] Money stays in integer cents; it becomes `"150.00"` only at the PayPal boundary
- [ ] This cannot create a second PayPal batch for one approval; every new write to PayPal is idempotent
- [ ] Webhook paths trust nothing before signature verification and event-id dedupe
- [ ] No secrets, tokens or credentialed URLs; any new env var is in `.env.example` with an empty value
- [ ] No new dependency, or: the name is checked letter by letter, it is maintained, and the PR says why it is needed
- [ ] No log line includes a request body, a receiver, a phone number or a transcript
- [ ] Docs changed in this PR are true of the code (unbuilt things are marked roadmap)

## Screenshots

<!-- For UI changes: before/after, light and dark, phone width if relevant. -->
