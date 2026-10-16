# NOTES-passkeys — how an approval is signed, and how to re-verify it

Audience: the approval service (`apps/approver`) and anyone auditing a payout later.

## The claim this makes true

"Two different humans approve" means two **distinct organizer credentials** each produced a WebAuthn
signature over **the exact approval hash** that the payout is executed from. The approver identity is
taken from the credential that signed, never from a request body.

## Signing (web app)

1. The organizer taps **Approve**. The browser calls `POST /api/approvals/challenge {requestIds}`.
   The server recomputes the approval content from the live request rows (`db.contentFromRequests`)
   and returns `approvalHash` (= `core.approvalHash(content)`, 64 hex) plus WebAuthn request options whose
   **challenge is `base64url(hexToBytes(approvalHash))`** (`@neighborline/passkeys` `challengeForApprovalHash`),
   `userVerification: 'required'`.
2. The browser runs `startAuthentication({ optionsJSON })` (`@simplewebauthn/browser` 14) → the phone
   asks for Face ID / fingerprint / PIN → `POST /api/approvals {requestIds, signer: {kind: 'passkey', assertion}}`.
3. The server (`apps/web/lib/server/engine/passkeys.ts` `signTap`):
   - recomputes the hash from the rows **again** (content changed → 409, "review it again");
   - loads the credential by `assertion.id` from `organizer_credentials` (must be `kind = 'passkey'`, not revoked);
   - checks `clientDataJSON.origin` against the allowlist (`expectedFor`, see below);
   - `verifyApprovalAssertion` (wraps `@simplewebauthn/server` `verifyAuthenticationResponse`, UV required);
   - stores the assertion in `approval_assertions` (PK `approval_hash, organizer_id`; first one wins) and an
     audit row `approval.signed_with_passkey` — **before** `ApprovalService.approve` records the approver;
   - calls the approval service with `organizerId = credential.organizer_id`, `deviceLabel = credential.device_label`.

### DEMO_MODE (`DEMO_MODE != 'false'`)

`signer: {kind: 'demo_key', organizerId}` makes the server sign with that organizer's **server-held P-256
software key** (`createSoftwareAuthenticator`, registered as an `organizer_credentials` row with
`kind = 'demo_key'`, label `"<Name>’s phone (demo key)"`). It produces a real WebAuthn-format assertion
(authenticatorData + clientDataJSON + DER ECDSA signature) over the same challenge and goes through the same
`verifyApprovalAssertion`, but sets only the User-Present flag (**UV = 0**, no human unlocked anything).
Audit action: `approval.signed_with_demo_key`. With `DEMO_MODE=false` the server refuses to mint demo-key
signatures (403). Scripted /demo organizers, the seeded queue and a judge without a platform authenticator use it;
the UI says "Signed with demo key" wherever that happens.

## The payload: `approval.approvers[i].assertion`

`db.getApproval(id)` / `listApprovalsForRequest` fill it from `approval_assertions` (joined on
`approvals.hash` + organizer). Schema: `core` `ApproverAssertion` (zod), re-exported by
`@neighborline/passkeys` as `ApprovalAssertion`.

```jsonc
{
  "id": "apr_…", "hash": "9f2c…(64 hex)", "status": "complete", "requestIds": ["req_…"], "totalCents": 15000,
  "approvers": [
    {
      "organizerId": "org_dana",
      "at": "2026-10-16T18:00:01.000Z",
      "deviceLabel": "Dana’s iPhone",
      "assertion": {
        "v": 1,
        "kind": "passkey",                 // or "demo_key"
        "credentialId": "b64url",          // = organizer_credentials.id
        "authenticatorData": "b64url",     // rpIdHash(32) | flags(1) | signCount(4) [| ext]
        "clientDataJSON": "b64url",        // {"type":"webauthn.get","challenge":b64url(hash bytes),"origin":…}
        "signature": "b64url",             // ES256 DER (or RS256), over authenticatorData || SHA-256(clientDataJSON)
        "userHandle": "b64url",            // optional (UTF-8 organizer id for passkeys enrolled here)
        "rpId": "neighborline.onrender.com",
        "origin": "https://neighborline.onrender.com",
        "approvalHash": "9f2c…",           // must equal approval.hash
        "deviceLabel": "Dana’s iPhone",
        "verifiedAt": "2026-10-16T18:00:01.000Z"
      }
    }
  ]
}
```

## Re-verifying (approval service, auditors)

For **each** approver of the approval you are about to execute:

```ts
import { verifyApprovalAssertion, expectedFor } from '@neighborline/passkeys';
import { getOrganizerCredential } from '@neighborline/db';

const a = approver.assertion;                              // missing → unsigned
if (!a || a.approvalHash !== approval.hash) reject();
const cred = await getOrganizerCredential(db, a.credentialId);   // null if unknown or revoked
if (!cred || cred.organizerId !== approver.organizerId || cred.kind !== a.kind) reject();
if (a.kind === 'demo_key' && env.DEMO_MODE === 'false') reject();
const exp = expectedFor(a, env);                            // origin allowlist + RP ID (same rules as web)
if (!exp) reject();
const r = await verifyApprovalAssertion({
  assertion: a, approvalHash: approval.hash,
  credential: { id: cred.id, publicKey: cred.publicKey, counter: 0, kind: cred.kind },   // counter 0 when re-verifying
  ...exp,
});
if (!r.ok) reject(r.reason);
```

Then require ≥ `group.requiredApprovals` **distinct `credential.organizerId`s** with valid assertions, and
recompute `approval.hash` from the live rows (as `createBatch` already does). Read the public key from the
database, never from the payload. `passkey` assertions require UV; `demo_key` ones cannot have it.

### Origin / RP ID (`@neighborline/passkeys` `relying-party.ts`)

| Env | Meaning |
|---|---|
| `WEBAUTHN_ORIGIN` | comma-separated allowed origins (production: the public https origin) |
| `WEBAUTHN_RP_ID` | RP ID; default = hostname of the origin |
| `APP_BASE_URL` | fallback origin when `WEBAUTHN_ORIGIN` is unset; then `http://localhost:3000` |
| `DEMO_MODE`, `NODE_ENV` | unless `DEMO_MODE=false` **and** `NODE_ENV=production`, `http://localhost:*` / `http://127.0.0.1:*` are also allowed |

## Enrollment and sessions

- `/organizer` first run: pick who you are → `POST /api/organizer/passkeys/options` → `startRegistration`
  → `POST /api/organizer/passkeys` (attestation `none`, resident key + UV required). Stores
  `organizer_credentials(id, organizer_id, public_key (COSE, b64url), counter, transports, device_label, kind)`.
- Who may enroll: the organizer when already signed in (adding a device), or anyone with that organizer's invite
  code: single use, expiring, stored as SHA-256 in `organizer_invites` (`pnpm --filter @neighborline/web organizer-invite <id> [--ttl 72h]`
  prints one; `register` spends it in the transaction that stores the passkey; THREAT_MODEL R13).
  `DEMO_MODE` does not waive it (QA P1-6); a /demo visitor plays Marcus with a passkey bound to their own runs instead.
- Sign-in (`/api/organizer/signin`) uses a discoverable credential and sets an HttpOnly HMAC cookie
  (`nl_organizer`, 12 h). The cookie only says who is looking at the queue; **it never authorizes a payout** —
  every tap is signed separately.

## Revocation

`POST /api/organizer/passkeys/revoke {credentialId}` (needs a live session; `db.revokeOrganizerCredential` sets
`revoked_at` and writes `organizer.passkey_revoked` naming who revoked it). Any signed-in organizer of the group may
revoke any organizer's passkey (lost phone); demo keys cannot be revoked from the UI. After that,
`getOrganizerCredential` returns null, so: sign-in and Approve taps with it fail (401), a session cookie minted by it
no longer counts (`liveSession`), the approval service refuses approvals it signed that are not paid yet
("unknown or revoked credential"), and its signatures on an open policy draft stop counting.

## Policy drafts (rules editor)

The same WebAuthn ceremony signs policy drafts: the challenge is the 32 bytes of core `policyDraftHash` (SHA-256 over
`{domain: 'neighborline/policy-draft/v1', groupId, basePolicyId, version, body}`), via
`POST /api/policy/challenge` → `POST /api/policy/sign`. Assertions are stored as audit rows
(`policy.signed_with_passkey` / `policy.signed_with_demo_key`, entity = draft hash), not in `approval_assertions`,
and are re-verified from the stored public keys each time they are counted. Two distinct organizers with valid
signatures activate the draft (`db.activatePolicy`); see `apps/web/lib/server/engine/policy-editor.ts`.

## Known limits

- One human can enroll two organizers' passkeys if they hold both invite codes (or in DEMO_MODE). Invite codes
  are the control; a passkey proves a device holder, not a legal identity.
- The approval challenge is deterministic (the hash), so an assertion can be replayed — but only for the same
  organizer over the same content, which is a no-op (idempotent approval). Counters are checked on the live tap.
- Session secret: set `NEIGHBORLINE_SESSION_SECRET` (≥ 32 chars) in production, or sessions end on every
  restart. (Invite codes do not depend on it.)
- Demo keys are random per process; their public keys are stored per credential id, so old demo signatures stay
  verifiable after a restart.
