/**
 * Two-person approvals. The approval hash pins exactly what was approved (requests, amounts,
 * destinations, policy version). Any change voids it; PayPal's sender_batch_id derives from it,
 * so retries and double taps can never create a second batch.
 */
import type { Approval, Approver, PayoutDestination } from './schemas.js';
import { sha256Hex } from './sha256.js';
import { normalizeDestinationValue } from './identity.js';

export const MIN_APPROVERS = 2;

export type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [k: string]: CanonicalValue | undefined };

/** Deterministic JSON: object keys sorted (UTF-16 order), undefined members dropped, -0 → 0. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) throw new TypeError('canonicalJson: only plain objects');
      const rec = value as Record<string, unknown>;
      const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export interface ApprovalItem {
  requestId: string;
  amountCents: number;
  destination: Pick<PayoutDestination, 'wallet' | 'type' | 'value'>;
}

export interface ApprovalContent {
  policyVersionId: string;
  items: readonly ApprovalItem[];
}

/** The exact object that gets hashed. Exposed so auditors can recompute it. */
export function approvalPayload(content: ApprovalContent): Record<string, CanonicalValue> {
  const ids = content.items.map((i) => i.requestId);
  if (ids.length === 0) throw new Error('approval needs at least one request');
  if (new Set(ids).size !== ids.length) throw new Error('approval has duplicate requestIds');
  for (const i of content.items) {
    if (!Number.isSafeInteger(i.amountCents) || i.amountCents <= 0) {
      throw new RangeError(`approval amount for ${i.requestId} must be positive integer cents`);
    }
  }
  const items = [...content.items]
    .sort((a, b) => (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0))
    .map((i) => ({
      requestId: i.requestId,
      amountCents: i.amountCents,
      wallet: i.destination.wallet,
      recipientType: i.destination.type,
      receiver: normalizeDestinationValue(i.destination),
    }));
  return {
    v: 1,
    policyVersionId: content.policyVersionId,
    requestIds: items.map((i) => i.requestId),
    items,
    totalCents: items.reduce((a, i) => a + i.amountCents, 0),
  };
}

export function approvalHash(content: ApprovalContent): string {
  return sha256Hex(canonicalJson(approvalPayload(content)));
}

export function createApproval(id: string, content: ApprovalContent): Approval {
  const payload = approvalPayload(content);
  return {
    id,
    requestIds: payload.requestIds as string[],
    approvers: [],
    totalCents: payload.totalCents as number,
    policyVersionId: content.policyVersionId,
    hash: sha256Hex(canonicalJson(payload)),
    status: 'pending',
  };
}

export type AddApproverFailure = 'VOID' | 'ALREADY_EXECUTED' | 'CONTENT_CHANGED' | 'NOT_AN_ORGANIZER' | 'INVALID_APPROVER';

export type AddApproverResult =
  | { ok: true; approval: Approval; changed: boolean; complete: boolean }
  | { ok: false; approval: Approval; reason: AddApproverFailure };

export interface AddApproverOptions {
  /** Distinct organizers needed. Never below 2 (SPEC §2.1). */
  required?: number;
  /** Current content of the requests; if its hash differs, the approval is voided. */
  currentContent?: ApprovalContent;
  /** If given, only these organizer ids may approve. */
  eligibleOrganizerIds?: Iterable<string>;
}

export function requiredApprovers(required?: number): number {
  const n = required ?? MIN_APPROVERS;
  if (!Number.isInteger(n) || n < MIN_APPROVERS) throw new RangeError(`at least ${MIN_APPROVERS} approvers are required`);
  return n;
}

/** Pure: returns a new Approval. Double taps by the same organizer are a no-op (ok, changed=false). */
export function addApprover(approval: Approval, approver: Approver, opts: AddApproverOptions = {}): AddApproverResult {
  const required = requiredApprovers(opts.required);
  if (approval.status === 'void') return { ok: false, approval, reason: 'VOID' };
  if (approval.status === 'executed') return { ok: false, approval, reason: 'ALREADY_EXECUTED' };
  if (opts.currentContent && approvalHash(opts.currentContent) !== approval.hash) {
    return { ok: false, approval: { ...approval, status: 'void' }, reason: 'CONTENT_CHANGED' };
  }
  const organizerId = approver.organizerId.trim();
  if (!organizerId) return { ok: false, approval, reason: 'INVALID_APPROVER' };
  if (opts.eligibleOrganizerIds && !new Set(opts.eligibleOrganizerIds).has(organizerId)) {
    return { ok: false, approval, reason: 'NOT_AN_ORGANIZER' };
  }
  if (approval.approvers.some((a) => a.organizerId === organizerId)) {
    return { ok: true, approval, changed: false, complete: approval.status === 'complete' };
  }
  const approvers = [...approval.approvers, { ...approver, organizerId }];
  const complete = distinctApprovers(approvers) >= required;
  return {
    ok: true,
    approval: { ...approval, approvers, status: complete ? 'complete' : 'pending' },
    changed: true,
    complete,
  };
}

export const distinctApprovers = (approvers: readonly Approver[]): number =>
  new Set(approvers.map((a) => a.organizerId)).size;

/** The approval-service gate: only a complete, untampered approval with ≥2 distinct humans executes. */
export function canExecute(approval: Approval, currentContent: ApprovalContent, required?: number): boolean {
  return (
    approval.status === 'complete' &&
    distinctApprovers(approval.approvers) >= requiredApprovers(required) &&
    approvalHash(currentContent) === approval.hash
  );
}

export function markExecuted(approval: Approval): Approval {
  if (approval.status !== 'complete') throw new Error(`cannot execute approval in status '${approval.status}'`);
  return { ...approval, status: 'executed' };
}

export function voidApproval(approval: Approval): Approval {
  if (approval.status === 'executed') throw new Error('cannot void an executed approval');
  return { ...approval, status: 'void' };
}

/** PayPal sender_batch_id: deterministic, so a retried POST is rejected/deduped by PayPal. */
export function senderBatchIdFor(approval: Pick<Approval, 'hash'>): string {
  if (!/^[0-9a-f]{64}$/.test(approval.hash)) throw new Error('approval hash must be 64 hex chars');
  return `nl_${approval.hash.slice(0, 24)}`;
}

/** PayPal sender_item_id for one request inside an approval (≤ 63 chars). */
export function senderItemIdFor(approval: Pick<Approval, 'hash'>, requestId: string): string {
  return `nli_${sha256Hex(`${approval.hash}:${requestId}`).slice(0, 24)}`;
}
