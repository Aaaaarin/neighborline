/**
 * Verify one approver's WebAuthn assertion against the approval hash it claims to sign.
 * Used by the web app when the tap arrives, and usable by the approval service to re-verify
 * every approver before it pays (stateless: needs only the stored public key).
 */
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { challengeFor, fromB64url } from './encoding.js';
import type { AssertionParts, SignerKind } from './assertion.js';

export interface StoredCredential {
  /** base64url credential id */
  id: string;
  /** base64url COSE public key */
  publicKey: string;
  /** last seen signature counter; pass 0 when re-verifying an old assertion */
  counter?: number;
  kind: SignerKind;
}

export type VerifyResult =
  | { ok: true; newCounter: number; origin: string; rpId: string; userVerified: boolean }
  | { ok: false; reason: string };

export async function verifyApprovalAssertion(input: {
  assertion: AssertionParts;
  approvalHash: string;
  credential: StoredCredential;
  expectedOrigin: string | string[];
  expectedRpId: string | string[];
  /** The server nonce the challenge was bound to (stored with the assertion); omit for legacy bare-hash challenges. */
  serverNonce?: string | null | undefined;
}): Promise<VerifyResult> {
  const { assertion: a, credential: c } = input;
  if (a.credentialId !== c.id) return { ok: false, reason: 'assertion was made by a different credential' };
  let expectedChallenge: string;
  try {
    expectedChallenge = challengeFor(input.approvalHash, input.serverNonce);
  } catch {
    return { ok: false, reason: 'bad approval hash or server nonce' };
  }
  try {
    const res = await verifyAuthenticationResponse({
      response: {
        id: a.credentialId,
        rawId: a.credentialId,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          authenticatorData: a.authenticatorData,
          clientDataJSON: a.clientDataJSON,
          signature: a.signature,
          ...(a.userHandle ? { userHandle: a.userHandle } : {}),
        },
      },
      expectedChallenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.expectedRpId,
      credential: { id: c.id, publicKey: fromB64url(c.publicKey) as Parameters<typeof verifyAuthenticationResponse>[0]['credential']['publicKey'], counter: c.counter ?? 0 },
      // A passkey must prove a human unlocked it (biometric / PIN). The demo key cannot, and says so.
      requireUserVerification: c.kind === 'passkey',
    });
    if (!res.verified) return { ok: false, reason: 'signature did not verify' };
    const i = res.authenticationInfo;
    return { ok: true, newCounter: i.newCounter, origin: i.origin, rpId: i.rpID, userVerified: i.userVerified };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
