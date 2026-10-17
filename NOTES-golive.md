# NOTES-golive: requests from the release lane (scripts/golive, docs/GOLIVE.md)

## Done: route the scripted scenarios to a sandbox account when PAYPAL_MODE=sandbox (fallback for Venmo)

Shipped as `SANDBOX_DEMO_RECEIVER_EMAIL` (the request called it `DEMO_SANDBOX_RECEIVER`):
[`apps/web/lib/server/engine/sandbox-standin.ts`](apps/web/lib/server/engine/sandbox-standin.ts). With
`PAYPAL_MODE=sandbox`, `DEMO_MODE` on and the variable set, `/demo` runs (`req_demo_*` only) pay Lan, Jean and Walter
to that sandbox Personal account's PayPal wallet by `EMAIL`, after the rail checks on the scripted destination; Rosa's
run pays a fresh unregistered address so it genuinely goes `UNCLAIMED` (cancel on the stage, no faked claim). The
stage, both phones, the organizer card and `/trust` say so; the swap is audited (`demo.sandbox_stand_in`). golive's
`deploy-render` sets it from `SANDBOX_DEMO_RECEIVER_EMAIL`, else `SANDBOX_PERSONAL_EMAIL`, and defaults the hosted
`PAYPAL_MODE` to sandbox when a receiver exists; `finalize-docs` writes the README row and DEVPOST sentence from the
hosted run. Tests: `apps/web/test/sandbox-standin.test.ts` (engine in sandbox mode against tools/fake-paypal),
`scripts/golive/src/deploy-render.test.ts`, `units.test.ts`, `finalize.test.ts`. Docs: [docs/GOLIVE.md](docs/GOLIVE.md),
[docs/DEMO.md](docs/DEMO.md#in-the-real-paypal-sandbox).
