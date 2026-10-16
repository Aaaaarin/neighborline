/**
 * The hash two organizers sign to activate a new policy version. It pins the exact draft (every
 * category, cap and label, plus the plain-English source text), the version it would become and the
 * version it replaces, so a signature over one draft can never activate another — or the same draft
 * on top of a policy that changed in the meantime. Domain-separated from payout approval hashes.
 */
import type { Policy } from './schemas.js';
import { canonicalJson } from './approvals.js';
import { sha256Hex } from './sha256.js';

export const POLICY_DRAFT_DOMAIN = 'neighborline/policy-draft/v1';

/** Policy minus identity, timestamps and approvals: what organizers review. */
export type PolicyDraftBody = Omit<Policy, 'id' | 'groupId' | 'createdAt' | 'approvedBy' | 'version'>;

export interface PolicyDraftContent {
  groupId: string;
  /** The active policy this draft replaces (null for a group's first policy). */
  basePolicyId: string | null;
  version: number;
  body: PolicyDraftBody;
}

export function policyDraftPayload(c: PolicyDraftContent): Record<string, unknown> {
  return { domain: POLICY_DRAFT_DOMAIN, groupId: c.groupId, basePolicyId: c.basePolicyId, version: c.version, body: c.body };
}

/** sha256 (hex) over the canonical JSON of the draft payload. */
export function policyDraftHash(c: PolicyDraftContent): string {
  return sha256Hex(canonicalJson(policyDraftPayload(c)));
}
