/**
 * Wire protocol between the web app and the approver (`@neighborline/approver/protocol`).
 *
 * This is the ONLY module of the approver that the web app may import (enforced by
 * apps/web/lib/server/least-privilege.test.ts). It has no PayPal or database code: just request
 * shapes and HMAC signing with node:crypto.
 *
 * Every request is signed with NEIGHBORLINE_APPROVER_SECRET:
 *   x-nl-approver-timestamp: <unix seconds>         (±120 s accepted)
 *   x-nl-approver-nonce:     <32 hex chars, random>  (each nonce is accepted once: replay protection)
 *   x-nl-approver-signature: v1=<hex HMAC-SHA256(secret, `${ts}.${nonce}.${METHOD}.${path}.${rawBody}`)>
 *
 * A signature only proves the request came from the web process. It is NOT trusted for anything
 * about money: the approver recomputes the approval hash, the amounts, the rail checks and the
 * approver count from the database before it pays (see execute.ts).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const APPROVER_HEADERS = {
  timestamp: 'x-nl-approver-timestamp',
  nonce: 'x-nl-approver-nonce',
  signature: 'x-nl-approver-signature',
} as const;
export const APPROVER_MAX_SKEW_SECONDS = 120;
export const APPROVER_MIN_SECRET_LENGTH = 32;
export const DEFAULT_APPROVER_PORT = 4020;

export const APPROVER_ROUTES = {
  health: '/v1/health',
  execute: '/v1/execute',
  poll: (batchId: string) => `/v1/poll/${encodeURIComponent(batchId)}`,
  cancelUnclaimed: (itemId: string) => `/v1/cancel-unclaimed/${encodeURIComponent(itemId)}`,
  verifyWebhook: '/v1/verify-webhook',
  /** Manual rail: record an organizer-attested cash/check hand-over for a FAILED_RAIL batch (moves no money). */
  recordManual: (batchId: string) => `/v1/record-manual/${encodeURIComponent(batchId)}`,
} as const;

/**
 * The group setting "if PayPal is unavailable or the account is restricted, switch to manual recording"
 * lives in the append-only audit log: the newest row with this action wins (data: { manualFallback }).
 * Written by the web app (a signed-in organizer), read by the approver before it records anything.
 */
export const RAIL_FALLBACK_ACTION = 'group.rail_fallback';

/* ---------------- signing ---------------- */

export function approverSignatureBase(ts: string, nonce: string, method: string, path: string, rawBody: string): string {
  return `${ts}.${nonce}.${method.toUpperCase()}.${path}.${rawBody}`;
}

function hmac(secret: string, base: string): string {
  return 'v1=' + createHmac('sha256', secret).update(base).digest('hex');
}

export function signApproverRequest(
  secret: string,
  method: string,
  path: string,
  rawBody: string,
  opts: { nowMs?: number; nonce?: string } = {},
): Record<string, string> {
  const ts = String(Math.floor((opts.nowMs ?? Date.now()) / 1000));
  const nonce = opts.nonce ?? randomBytes(16).toString('hex');
  return {
    [APPROVER_HEADERS.timestamp]: ts,
    [APPROVER_HEADERS.nonce]: nonce,
    [APPROVER_HEADERS.signature]: hmac(secret, approverSignatureBase(ts, nonce, method, path, rawBody)),
  };
}

export type ApproverVerify =
  | { ok: true; nonce: string; tsMs: number }
  | { ok: false; reason: 'no_secret' | 'missing' | 'stale' | 'bad_nonce' | 'bad_signature' };

export function verifyApproverRequest(args: {
  secret: string | undefined;
  method: string;
  path: string;
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  nowMs?: number;
}): ApproverVerify {
  const { secret } = args;
  if (!secret || secret.length < APPROVER_MIN_SECRET_LENGTH) return { ok: false, reason: 'no_secret' };
  const get = (k: string) => {
    const v = args.headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const ts = get(APPROVER_HEADERS.timestamp);
  const nonce = get(APPROVER_HEADERS.nonce);
  const sig = get(APPROVER_HEADERS.signature);
  if (!ts || !nonce || !sig) return { ok: false, reason: 'missing' };
  if (!/^[0-9a-f]{32}$/.test(nonce)) return { ok: false, reason: 'bad_nonce' };
  const tsNum = Number(ts);
  const now = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (!Number.isInteger(tsNum) || Math.abs(now - tsNum) > APPROVER_MAX_SKEW_SECONDS) return { ok: false, reason: 'stale' };
  const expected = Buffer.from(hmac(secret, approverSignatureBase(ts, nonce, args.method, args.path, args.rawBody)));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, nonce, tsMs: tsNum * 1000 };
}

/**
 * Remembers nonces for as long as their timestamp is acceptable, so a captured request cannot be
 * replayed inside the skew window either. Bounded: when full, new requests are refused (fail closed).
 */
export class NonceCache {
  private seen = new Map<string, number>();

  constructor(
    private readonly ttlMs = 2 * APPROVER_MAX_SKEW_SECONDS * 1000,
    private readonly max = 100_000,
  ) {}

  /** true = first time (accept); false = replay or cache full (reject). */
  accept(nonce: string, nowMs = Date.now()): boolean {
    if (this.seen.size >= this.max) this.prune(nowMs);
    if (this.seen.has(nonce)) return false;
    if (this.seen.size >= this.max) return false;
    this.seen.set(nonce, nowMs + this.ttlMs);
    return true;
  }

  prune(nowMs = Date.now()): void {
    for (const [n, exp] of this.seen) if (exp <= nowMs) this.seen.delete(n);
  }

  get size(): number {
    return this.seen.size;
  }
}

/* ---------------- request / response shapes ---------------- */

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);

/** The canonical approval payload (core `approvalPayload`), exactly as hashed. */
export const ApprovalPayloadWire = z
  .object({
    v: z.literal(1),
    policyVersionId: z.string().min(1),
    requestIds: z.array(z.string().min(1)).min(1).max(50),
    items: z
      .array(
        z
          .object({
            requestId: z.string().min(1),
            amountCents: z.number().int().positive(),
            wallet: z.enum(['PAYPAL', 'VENMO']),
            recipientType: z.enum(['EMAIL', 'USER_HANDLE', 'PHONE']),
            receiver: z.string().min(1).max(127),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    totalCents: z.number().int().positive(),
  })
  .strict();
export type ApprovalPayloadWire = z.infer<typeof ApprovalPayloadWire>;

/**
 * One approver as the web app saw it. `assertion` is informational: the approver re-reads the
 * stored WebAuthn assertion from the database (approval_assertions) and re-verifies it with the
 * organizer's public key; it never trusts a signature carried in this body.
 */
export const ApproverWire = z.object({
  organizerId: z.string().min(1),
  at: z.string(),
  deviceLabel: z.string().max(80),
  assertion: z.object({ kind: z.enum(['passkey', 'demo_key']), credentialId: z.string() }).nullable(),
});
export type ApproverWire = z.infer<typeof ApproverWire>;

export const ExecuteRequest = z
  .object({
    approvalId: z.string().min(1),
    hash: Hex64,
    payload: ApprovalPayloadWire,
    approvers: z.array(ApproverWire).min(1).max(20),
  })
  .strict();
export type ExecuteRequest = z.infer<typeof ExecuteRequest>;

export interface ExecuteResponse {
  /** How the batch went out: PayPal Payouts, or recorded by hand on the manual rail (no money moved by us). */
  rail?: 'paypal_payouts' | 'manual';
  approvalId: string;
  hash: string;
  batchId: string;
  senderBatchId: string;
  paypalBatchId: string;
  /** true only for the call that handed the batch to PayPal (re-executes return false). */
  sentNow: boolean;
  totalCents: number;
  itemCount: number;
  approvers: Array<{ organizerId: string; signature: 'passkey' | 'demo_key' | 'unsigned' }>;
}

/** `organizerId` is checked against the group when present (the web app passes the session's organizer). */
export const CancelUnclaimedRequest = z.object({ organizerId: z.string().min(1).optional(), batchId: z.string().min(1).optional() }).strict();
export type CancelUnclaimedRequest = z.infer<typeof CancelUnclaimedRequest>;
export interface CancelUnclaimedResponse {
  itemId: string;
  senderItemId: string;
  paypalItemId: string;
  status: 'CANCELED';
}

export interface PollResponse {
  batchId: string;
  paypalBatchId: string;
  items: Array<{ payoutItemId: string; senderItemId?: string; status: string; transactionId?: string }>;
}

/**
 * Manual rail. `organizerId` is the signed-in organizer the web app vouches for (the approver checks they
 * belong to the group); the money authority is still the approval's two re-verified passkey signatures.
 */
export const RecordManualRequest = z
  .object({
    organizerId: z.string().min(1),
    method: z.enum(['cash', 'check', 'other']),
    receiptNote: z.string().trim().min(8).max(500),
  })
  .strict();
export type RecordManualRequest = z.infer<typeof RecordManualRequest>;
export interface RecordManualResponse {
  batchId: string;
  approvalId: string;
  status: 'MANUAL';
  rail: 'manual';
  /** e.g. MANUAL-3F9A…: write it on the receipt. Never a PayPal id. */
  reference: string;
  method: 'cash' | 'check' | 'other';
  recordedBy: string;
  recordedAt: string;
  totalCents: number;
  itemCount: number;
  /** true only for the call that recorded it (a repeat returns the same record). */
  recordedNow: boolean;
  /** Always false: the manual rail records, it never moves money. */
  movedMoney: false;
}

export const VerifyWebhookRequest = z.object({ headers: z.record(z.string()), rawBody: z.string().max(1_000_000) }).strict();
export type VerifyWebhookRequest = z.infer<typeof VerifyWebhookRequest>;
export interface VerifyWebhookResponse {
  verified: boolean;
  reason?: 'not_configured' | 'failed';
}

export interface ApproverHealth {
  ok: true;
  service: 'neighborline-approver';
  version?: string;
  paypalMode: 'fake' | 'sandbox' | 'live';
  /** 'dedicated' = PAYPAL_PAYOUTS_CLIENT_* (a separate PayPal app); 'shared-fallback' = the main app's keys (dev only) */
  credentials: 'fake' | 'dedicated' | 'shared-fallback';
  requirePasskeys: boolean;
  demoMode: boolean;
}

/** Error body for every non-2xx response. `code` is stable; `message` is safe to show an organizer. */
export interface ApproverError {
  error: string;
  /** rail_unavailable: the batch that PayPal refused (now FAILED_RAIL), and PayPal's reason. */
  batchId?: string;
  railReason?: string;
  code:
    | 'unauthorized'
    | 'replayed'
    | 'bad_request'
    | 'not_found'
    | 'hash_mismatch'
    | 'tampered'
    | 'not_complete'
    | 'too_few_approvers'
    | 'approver_mismatch'
    | 'assertion_invalid'
    | 'policy_violation'
    | 'not_executable'
    | 'not_cancellable'
    | 'paypal_error'
    /** PayPal may or may not have accepted the batch (timeout / network / 5xx). Batch is UNKNOWN; re-execute resolves it. */
    | 'paypal_unknown'
    /** PayPal refused at the account level (restricted, locked, not authorized). Batch is FAILED_RAIL; nothing was sent. */
    | 'rail_unavailable'
    /** The manual rail refused: not a FAILED_RAIL batch, the group's fallback is off, or the attestation is invalid. */
    | 'manual_not_allowed'
    | 'internal';
}
