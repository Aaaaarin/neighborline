/**
 * Re-verification of a two-person approval record from the database (steps 2–5 of approver.ts), shared
 * by both rails: a PayPal payout and a manual hand-over record need exactly the same authority.
 *   2. the record is complete with ≥ max(2, group.requiredApprovals) DISTINCT current organizers;
 *   3. each organizer's stored WebAuthn signature over the approval hash re-verifies;
 *   4. the approval content rebuilt from the request rows hashes to the record's hash;
 *   5. core.computeAmount + core.checkRail, re-run from the policy, still allow every amount.
 */
import { approvalHash, distinctApprovers, type Group, type HelpRequest } from '@neighborline/core';
import { contentFromRequests, getApproval, getGroup, getRequest, listOrganizers, type Db } from '@neighborline/db';
import { checkAssertions, type AssertionCheck } from './assertions.js';
import type { Env } from './config.js';
import type { ApproverError } from './protocol.js';
import { recheckPolicy } from './recheck.js';

export type ApprovalRecord = NonNullable<Awaited<ReturnType<typeof getApproval>>>;
export type Verified = { ok: true; group: Group; requests: HelpRequest[]; sigs: AssertionCheck[] };
export type Refused = { ok: false; status: number; code: ApproverError['code']; message: string };

export async function verifyApprovalRecord(
  db: Db,
  input: {
    approval: ApprovalRecord;
    groupId: string;
    hash: string;
    /** The approvers the web app claimed (execute only); must match the record. */
    claimedApprovers?: readonly string[];
    demoMode: boolean;
    env: Env;
    now: Date;
  },
): Promise<Verified | Refused> {
  const { approval, hash } = input;
  const no = (status: number, code: ApproverError['code'], message: string): Refused => ({ ok: false, status, code, message });
  const group = await getGroup(db, input.groupId);
  if (!group) return no(404, 'not_found', 'group not found');
  const required = Math.max(2, group.requiredApprovals);
  const organizerIds = new Set((await listOrganizers(db, group.id)).map((o) => o.id));
  const counted = approval.approvers.filter((a) => organizerIds.has(a.organizerId));
  if (distinctApprovers(counted) < required) {
    return no(403, 'too_few_approvers', `needs ${required} distinct organizers; the record has ${distinctApprovers(counted)}`);
  }
  if (input.claimedApprovers) {
    const claimed = [...new Set(input.claimedApprovers)].sort();
    const recorded = [...new Set(approval.approvers.map((a) => a.organizerId))].sort();
    if (claimed.join('\n') !== recorded.join('\n')) return no(409, 'approver_mismatch', 'the approvers in the request do not match the approval record');
  }

  // 3. Signatures over the hash, re-verified with the organizers' public keys.
  const sigs = await checkAssertions(db, { approvers: counted, approvalHash: hash, requestIds: approval.requestIds, demoMode: input.demoMode, env: input.env });
  const bad = sigs.filter((s) => !s.ok);
  if (bad.length) return no(403, 'assertion_invalid', bad.map((s) => `${s.organizerId}: ${s.reason}`).join('; '));

  // 4. Content from the request rows, read here.
  const requests: HelpRequest[] = [];
  for (const id of approval.requestIds) {
    const r = await getRequest(db, id);
    if (!r || r.groupId !== group.id) return no(409, 'tampered', `request ${id} is missing or belongs to another group`);
    requests.push(r);
  }
  let dbHash: string;
  try {
    dbHash = approvalHash(contentFromRequests(requests));
  } catch (err) {
    return no(409, 'tampered', `requests no longer form a valid approval: ${err instanceof Error ? err.message : err}`);
  }
  if (dbHash !== hash) return no(409, 'tampered', 'the requests changed after they were approved (amount, destination or policy differs)');

  // 5. Policy re-check from first principles (the batch's own requests are excluded from history and
  // today's spend, so a retry or a manual record is judged exactly like the first attempt).
  const re = await recheckPolicy(db, { group, policyVersionId: approval.policyVersionId, requests, demoMode: input.demoMode, now: input.now });
  if (!re.ok) return no(409, 'policy_violation', re.problems.join('; '));
  return { ok: true, group, requests, sigs };
}
