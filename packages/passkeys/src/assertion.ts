/**
 * The record an approver service receives for each approver (`approval.approvers[i].assertion`).
 * Everything needed to re-verify the signature later, offline, against the credential's stored
 * public key: see NOTES-passkeys.md at the repo root.
 */
import { z } from 'zod';

export const SignerKind = z.enum(['passkey', 'demo_key']);
export type SignerKind = z.infer<typeof SignerKind>;

const b64url = z.string().regex(/^[A-Za-z0-9_-]*$/, 'base64url');

export const ApprovalAssertion = z.object({
  v: z.literal(1),
  /** 'passkey' = a WebAuthn authenticator the organizer holds; 'demo_key' = server-held software key (DEMO_MODE only). */
  kind: SignerKind,
  credentialId: b64url.min(1),
  /** base64url, exactly as the authenticator returned them */
  authenticatorData: b64url.min(37),
  clientDataJSON: b64url.min(1),
  signature: b64url.min(1),
  userHandle: b64url.optional(),
  /** What the server checked at signing time (re-verifiers must check against their own allowlist). */
  rpId: z.string().min(1),
  origin: z.string().min(1),
  /** hex SHA-256 approval hash; the WebAuthn challenge is base64url(hexToBytes(approvalHash)) */
  approvalHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Human label of the credential, e.g. "Dana's iPhone" or "Dana's phone (demo key)" */
  deviceLabel: z.string().min(1).max(80),
  verifiedAt: z.string(),
});
export type ApprovalAssertion = z.infer<typeof ApprovalAssertion>;

/** The four WebAuthn fields a browser sends (AuthenticationResponseJSON.response + id). */
export interface AssertionParts {
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  userHandle?: string;
}
