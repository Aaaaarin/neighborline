/**
 * Re-verify each approver's WebAuthn signature over the approval hash before paying.
 *
 * The web app verifies a passkey when the organizer taps Approve and stores the assertion in
 * `approval_assertions`. The approver does not trust that: it loads the stored assertion and the
 * organizer's public key (`organizer_credentials`, revoked keys excluded) from the database and
 * runs the same verifier (@neighborline/passkeys → @simplewebauthn/server) against the hash it
 * recomputed itself. A signature over a different hash, by another organizer's key, or from an
 * origin outside WEBAUTHN_ORIGIN fails.
 *
 * Policy:
 *   - NEIGHBORLINE_REQUIRE_PASSKEYS=true → every counted approver needs a verified assertion.
 *   - Demo keys (server-held, kind 'demo_key') count only when DEMO_MODE is on.
 *   - Otherwise an approver without an assertion is executed and audited as 'unsigned', but an
 *     assertion that IS present must verify (a bad signature is never ignored).
 */
import type { Approver } from '@neighborline/core';
import { getOrganizerCredential, type Db } from '@neighborline/db';
import { expectedFor, verifyApprovalAssertion } from '@neighborline/passkeys';
import type { Env } from './config.js';

export type SignatureKind = 'passkey' | 'demo_key' | 'unsigned';

export interface AssertionCheck {
  organizerId: string;
  signature: SignatureKind;
  ok: boolean;
  reason?: string;
}

export async function checkAssertions(
  db: Db,
  input: { approvers: readonly Approver[]; approvalHash: string; requirePasskeys: boolean; demoMode: boolean; env: Env },
): Promise<AssertionCheck[]> {
  const out: AssertionCheck[] = [];
  for (const ap of input.approvers) {
    const a = ap.assertion;
    if (!a) {
      out.push(
        input.requirePasskeys
          ? { organizerId: ap.organizerId, signature: 'unsigned', ok: false, reason: 'no passkey signature on record' }
          : { organizerId: ap.organizerId, signature: 'unsigned', ok: true },
      );
      continue;
    }
    const fail = (reason: string) => out.push({ organizerId: ap.organizerId, signature: a.kind, ok: false, reason });
    if (a.approvalHash !== input.approvalHash) {
      fail('signature is over a different approval');
      continue;
    }
    if (a.kind === 'demo_key' && !input.demoMode) {
      fail('demo keys are accepted only in DEMO_MODE');
      continue;
    }
    const cred = await getOrganizerCredential(db, a.credentialId);
    if (!cred) {
      fail('unknown or revoked credential');
      continue;
    }
    if (cred.organizerId !== ap.organizerId) {
      fail("credential belongs to a different organizer");
      continue;
    }
    if (cred.kind !== a.kind) {
      fail('assertion kind does not match the credential');
      continue;
    }
    const expected = expectedFor(a, input.env);
    if (!expected) {
      fail(`origin ${a.origin} is not an allowed origin (WEBAUTHN_ORIGIN)`);
      continue;
    }
    const v = await verifyApprovalAssertion({
      assertion: a,
      approvalHash: input.approvalHash,
      credential: { id: cred.id, publicKey: cred.publicKey, counter: 0, kind: cred.kind },
      ...expected,
    });
    if (!v.ok) {
      fail(`signature did not verify: ${v.reason}`);
      continue;
    }
    out.push({ organizerId: ap.organizerId, signature: a.kind, ok: true });
  }
  return out;
}
