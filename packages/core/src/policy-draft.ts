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

/** A "(v1)"-style version marker at the end of the rules text's first line (the title). */
const TITLE_VERSION = /\(v\d+\)(\s*)$/;

/**
 * The rules text with its title's version marker set to `version` ("… rules for quick cash help (v2)").
 * Only the first line is touched, and only when it already ends with a "(vN)" marker; any other text
 * comes back unchanged, so organizers who never number their rules never see one appear.
 */
export function stampPolicyVersion(sourceText: string, version: number): string {
  const nl = sourceText.indexOf('\n');
  const title = nl === -1 ? sourceText : sourceText.slice(0, nl);
  if (!TITLE_VERSION.test(title)) return sourceText;
  return title.replace(TITLE_VERSION, `(v${version})$1`) + (nl === -1 ? '' : sourceText.slice(nl));
}

/** The rules text with the title's version marker taken out (to compare two versions' wording). */
export function policyTextSansVersion(sourceText: string): string {
  const nl = sourceText.indexOf('\n');
  const title = nl === -1 ? sourceText : sourceText.slice(0, nl);
  return title.replace(TITLE_VERSION, '').trimEnd() + (nl === -1 ? '' : sourceText.slice(nl));
}
