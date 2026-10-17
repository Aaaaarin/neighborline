# NOTES-golive: requests from the release lane (scripts/golive, docs/GOLIVE.md)

## Web/agents lane: route the scripted scenarios to a sandbox account when PAYPAL_MODE=sandbox (fallback for Venmo)

PayPal documents no way to make a sandbox **Venmo** payout settle (only the `POSPYO003` mock). If key day's
`sandbox-spike` shows the Venmo items `FAILED`/`UNCLAIMED`, the hosted `/demo` hero (Mrs. Lan → `@lan-nguyen54`
on Venmo) cannot reach `SUCCESS` in sandbox mode, and today the only fallback is `PAYPAL_MODE=fake` for the stage.

Request: an optional env `DEMO_SANDBOX_RECEIVER` (e.g. `sb-…@personal.example.com`). When it is set and
`PAYPAL_MODE=sandbox`, the `/demo` scenarios (only demo runs, `req_demo_*`) pay that sandbox personal account by
`EMAIL` on the `PAYPAL` wallet instead of the scripted handle, and the stage says so ("Sandbox: paid to a PayPal
sandbox test account instead of Lan's Venmo"). Rail checks still run on the scripted destination first. golive's
`deploy-render` would then set it from `SANDBOX_PERSONAL_EMAIL` when the spike's Venmo items did not succeed.
Until then GOLIVE.md documents the fake-mode fallback.
