/**
 * Approval tokens: "agents can't move money without two humans".
 *
 * The service that records human approvals (Neighborline's approval-service) mints a short-lived token bound to
 * the *exact* batch: sender_batch_id + a digest of every item's receiver/amount/currency/wallet. An agent holding
 * the token can execute that batch and nothing else; changing one cent or one receiver invalidates it.
 *
 * Format: `nlap1.<base64url(payload JSON)>.<base64url(HMAC-SHA256(secret, "nlap1." + payloadB64))>`
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { CreateBatchInput, PayoutItemInput } from './payouts.js';

export interface ApprovalRequest {
  approvalToken: string;
  batch: CreateBatchInput;
  /** sha256 of the canonical batch (see batchDigest). */
  digest: string;
}

export type ApprovalDecision = { ok: true; approvalId?: string; approvers?: string[] } | { ok: false; reason: string };

export type ApprovalVerifier = (req: ApprovalRequest) => ApprovalDecision | Promise<ApprovalDecision>;

/** Default: refuse everything. Money only moves when the host app plugs in a real verifier. */
export const denyAllApprovals: ApprovalVerifier = () => ({ ok: false, reason: 'No approval verifier configured; payouts are disabled for agents.' });

export interface ApprovalPayload {
  v: 1;
  approvalId: string;
  senderBatchId: string;
  digest: string;
  approvers: string[];
  iat: number;
  exp: number;
}

const PREFIX = 'nlap1';
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function canonicalItem(i: PayoutItemInput) {
  return [i.senderItemId, i.amountCents, (i.currency ?? 'USD').toUpperCase(), i.wallet ?? 'PAYPAL', i.recipientType, i.receiver.trim().toLowerCase()];
}

/** Order-independent digest of the money-relevant fields of a batch. */
export function batchDigest(batch: Pick<CreateBatchInput, 'senderBatchId' | 'items'>): string {
  const items = batch.items.map(canonicalItem).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash('sha256').update(JSON.stringify({ senderBatchId: batch.senderBatchId, items })).digest('hex');
}

function assertSecret(secret: string): void {
  if (!secret || secret.length < 32) throw new Error('approval secret must be at least 32 characters');
}

function mac(secret: string, payloadB64: string): string {
  return b64url(createHmac('sha256', secret).update(`${PREFIX}.${payloadB64}`).digest());
}

export function signApprovalToken(
  secret: string,
  input: { approvalId: string; batch: Pick<CreateBatchInput, 'senderBatchId' | 'items'>; approvers: string[]; ttlSec?: number; now?: number },
): string {
  assertSecret(secret);
  const iat = Math.floor((input.now ?? Date.now()) / 1000);
  const payload: ApprovalPayload = { v: 1, approvalId: input.approvalId, senderBatchId: input.batch.senderBatchId, digest: batchDigest(input.batch), approvers: input.approvers, iat, exp: iat + (input.ttlSec ?? 600) };
  const p = b64url(JSON.stringify(payload));
  return `${PREFIX}.${p}.${mac(secret, p)}`;
}

/** HMAC verifier: valid signature, unexpired, bound to this exact batch, ≥ minApprovers distinct humans. */
export function createHmacApprovalVerifier(secret: string, opts: { minApprovers?: number; now?: () => number } = {}): ApprovalVerifier {
  assertSecret(secret);
  const minApprovers = opts.minApprovers ?? 2;
  return ({ approvalToken, batch, digest }) => {
    const parts = approvalToken.split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: 'malformed approval token' };
    const [, p, sig] = parts as [string, string, string];
    const expected = Buffer.from(mac(secret, p));
    const got = Buffer.from(sig);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, reason: 'approval token signature invalid' };
    let payload: ApprovalPayload;
    try {
      payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as ApprovalPayload;
    } catch {
      return { ok: false, reason: 'approval token payload unreadable' };
    }
    const nowSec = Math.floor((opts.now?.() ?? Date.now()) / 1000);
    if (payload.v !== 1 || typeof payload.exp !== 'number' || payload.exp < nowSec) return { ok: false, reason: 'approval token expired' };
    if (payload.senderBatchId !== batch.senderBatchId) return { ok: false, reason: 'approval token is for a different sender_batch_id' };
    if (payload.digest !== digest) return { ok: false, reason: 'batch contents differ from what was approved' };
    const distinct = new Set((payload.approvers ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean));
    if (distinct.size < minApprovers) return { ok: false, reason: `needs ${minApprovers} distinct human approvers, token has ${distinct.size}` };
    return { ok: true, approvalId: payload.approvalId, approvers: [...distinct] };
  };
}
