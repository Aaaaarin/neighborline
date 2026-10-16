# NOTES-trust — exact copy for /trust, README and DEVPOST after the security pass

From: security/payments agent. For: web/design (UX) agent and docs/submission agent.
Code that these sentences describe: `apps/web/lib/server/security/*`, `apps/web/middleware.ts`,
`apps/approver/src/{assertions,config,approver}.ts`, `packages/passkeys/src/{encoding,relying-party}.ts`.

## 1. "In this demo" (already wired, do not retype)

`TrustView.inThisDemo` (built by `lib/server/security/demo-disclosure.ts` from `DEMO_MODE` and
`PAYPAL_MODE`) now feeds the "In this demo" row on /trust. With the hosted config (fake PayPal,
demo mode on) it reads, verbatim:

> This demo runs on a local fake PayPal, so no real money moves. Dana, Marcus and Priya are fictional.
> This is everything the demo relaxes: Dana’s approval in /demo is scripted and signed with a demo key
> this server holds. No person unlocks it, and every card it signs says “demo key”. You play Marcus. You
> can sign as him with his demo key, or with a passkey on your own device that this server ties to your
> browser. Either one signs only the runs you started yourself: never the shared queue, a rules change or
> a sign-in. Your demo runs don’t count against a household’s monthly limit or the daily budget, and other
> visitors can’t see them. Everything else works as it would for real organizers. The second approval
> still has to come from a different organizer. The approval service re-checks both signatures and
> recomputes every amount before it pays. Joining as a real organizer still needs an invite code.

With demo mode off:

> Demo mode is off on this server. There are no demo keys: every approval is signed with an organizer’s
> own passkey, and the approval service refuses anything else.

`inThisDemo.relaxed[]` and `inThisDemo.unchanged[]` hold the same sentences as lists if the design
wants two short lists instead of one paragraph (layout is yours; please keep the sentences as they are).

## 2. Sentences on /trust that are now wrong or need softening (please edit, layout is yours)

| Where | Current | Replace with |
|---|---|---|
| Privacy list | “**Organizers see first names** and a neighborhood: enough to recognise a neighbor, no more.” | “**The public sees first names** and a neighborhood, never a transcript, phone number, address or full handle. Signed-in organizers see the request itself, because they have to check it; the neighbor who sent it sees their own thread.” |
| Privacy list (new item) | — | “**Each visitor’s demo is their own.** Runs you start on /demo or /call are tied to your browser: other visitors can’t see, approve or reset them.” |
| Passkeys, “Joining as an organizer” | “A new organizer needs an invite code from an existing one to enroll their first passkey.” | keep; it is now true in demo mode too. Optionally add: “In this demo you can also add a passkey for Marcus without a code, but it only ever signs your own demo runs.” |
| Passkeys, “What is signed” | “The approval hash: SHA-256 over …” | “The approval hash (SHA-256 over the request ids, each amount, wallet and receiver, and the policy version) together with a one-time number from our server, so a signature can never be reused for a later payout, even an identical one.” |
| Approval service box | “The batch id is a hash of the approval record, so a retry can never pay twice.” | “The batch id is derived from the approval record, so a retry or a double tap can never pay twice; if PayPal doesn’t answer in time, we ask again with the same id instead of guessing.” |
| Sandbox reality, “Organizer passkeys” detail | (now generated from config) | no change needed |

## 3. README / DEVPOST security bullets (true as of this commit)

- Every payout needs two different organizers, each signing a WebAuthn challenge that binds the approval
  hash to a single-use server nonce. The approval service re-verifies both signatures with the stored
  public keys and nonces, recomputes every amount from the policy, and refuses unsigned approvers outright.
- `DEMO_MODE` fails closed: it is on only when explicitly set or when PayPal is the local fake, and the
  approval service refuses to start with `DEMO_MODE=true` and live PayPal.
- Payout idempotency: `sender_batch_id` = 24 hex of SHA-256(domain ‖ approval id ‖ approval hash). Double
  taps and retries share one id; a timeout leaves the batch `UNKNOWN` (never `FAILED`) and it is resolved by
  re-sending the same id after a fresh policy re-check.
- Webhooks are verified, then applied at least once: an event is marked processed only after its effects
  are applied, and every effect is idempotent.
- Nightly and on-demand reconcile against Transaction Search compares amount, currency and status
  (`transaction_status` S/P/D/V vs our item status), flags items stuck `PENDING` for 24 h, and keeps every
  run (shown on /ledger).
- Public reads are redacted (first name + area, masked destination, no transcript); each visitor sees
  their own runs in full and never another visitor’s; reset is not public.
- Every state-changing API call must be same-origin and (except uploads) `application/json`; bodies are
  capped (64 KB JSON, 2-minute / 4 MB voice notes); intake and live-AI calls are rate-limited per IP,
  per visitor and globally.
- CSP with a per-request nonce and `strict-dynamic` (PayPal and Venmo hosts allowed for the JS SDK),
  `frame-ancestors 'none'`, HSTS in production, `Permissions-Policy` limited to microphone and passkeys.

## 4. Small UI follow-ups I did not make (your files)

- `ApproveCard`: when `view.redacted` is true, show one line such as “Sign in as an organizer to see the
  full request” instead of an empty transcript area.
- `LedgerTable`: show `row.reconcileDetail` for mismatched rows (it explains status drift, e.g. “we have
  SUCCESS, PayPal Transaction Search says reversed or refunded (V)”), and include `ReconcileResult.drift`
  in the note after “Reconcile now”.
- `/call` recorder: stop at 2:00 and send `durationSeconds` with the audio form; the server refuses a
  declared duration over 120 s or a file over 4 MB with 413 and a plain message.
