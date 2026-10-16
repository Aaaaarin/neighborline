# Security policy

Neighborline moves money and handles data about vulnerable people. We take reports seriously and we are grateful
for them.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability reporting: the repository's
**Security** tab → **Report a vulnerability**. (Maintainers: this must be enabled under *Settings → Code security*.)

Please include:
- what an attacker can do (for example: move money without two approvals, change an amount after approval, forge a
  webhook, read a neighbor's data, leak a credential),
- the steps or a proof of concept against a **local** setup (`pnpm dev`, `PAYPAL_MODE=fake`),
- the commit you tested.

Never test against real PayPal accounts you do not own, and never use real neighbors' data.

**What to expect.** We aim to acknowledge a report within 3 days, share an assessment within 7 days, and credit you
in the fix unless you prefer otherwise. This is a small volunteer project, so these are goals, not guarantees.

## Scope

In scope:
- The money path: approvals, approval hashing, `sender_batch_id` derivation, payout execution, webhook verification
  and dedupe ([THREAT_MODEL.md](THREAT_MODEL.md) maps each control to code).
- `@neighborline/paypal`, including `neighborline-payouts-mcp` and its approval tokens.
- Prompt injection that changes an amount, a destination, or a decision (the model reading injected text is
  expected; the model's output reaching money without checks is a bug).
- Leaked secrets in the repository or its history.
- Privacy: PII in logs, re-identification through the public report.

Known and documented, so not new findings (but fixes are welcome):
- The demo has **no organizer authentication** (THREAT_MODEL R1).
- The web app's in-memory engine is a demo stand-in while the real wiring lands (R2).
- Transitive dependency advisories reported by `pnpm audit` (R5).
- `tools/fake-paypal` is a development tool: by default it signs webhooks with a fixed local key, and its `/__fake/*` control
  routes have no authentication by design. It must never be deployed.

## Supported versions

| Version | Supported |
|---|---|
| `main` | Yes |
| `@neighborline/paypal` 0.1.x | Yes |
| Anything older | No |

## Handling secrets

- Credentials come from environment variables only (see [`.env.example`](.env.example)). `.env*` files are
  gitignored.
- Only `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (a public client id) is exposed to browsers.
- `NEIGHBORLINE_APPROVAL_SECRET` must be at least 32 characters; the MCP server refuses all payouts without it.
- CI scans the full git history with gitleaks on every push and pull request.
- If you find a committed secret, report it privately as above; we will rotate it before removing it from history.
