/**
 * The record an approver service receives for each approver (`approval.approvers[i].assertion`).
 * The schema lives in @neighborline/core (`ApproverAssertion`) so every package agrees on it;
 * see NOTES-passkeys.md at the repo root for how to re-verify one.
 */
import { ApproverAssertion } from '@neighborline/core';

export const ApprovalAssertion = ApproverAssertion;
export type ApprovalAssertion = ApproverAssertion;
export type SignerKind = ApproverAssertion['kind'];

/** The WebAuthn fields a browser sends (AuthenticationResponseJSON.response + id). */
export interface AssertionParts {
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  userHandle?: string;
}
