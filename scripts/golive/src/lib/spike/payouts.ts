/**
 * The spike's payout batches: PayPal wallet, Venmo by handle (with and without "@"), Venmo by email, an unregistered
 * email (UNCLAIMED expected) and a PHONE probe (sandbox is documented to reject it). Amounts are distinct so each
 * item is easy to find in Transaction Search.
 */
import { buildPayoutRequest, type CreateBatchInput, type NormalizedPayoutItem, type PayPal } from '@neighborline/paypal';
import type { Env } from '../env.js';
import { errorShape } from '../paypal-admin.js';

export interface SpikeItemPlan {
  key: string;
  label: string;
  expect: string;
}

export interface PlannedBatch {
  label: string;
  input: CreateBatchInput;
  items: SpikeItemPlan[];
}

export const DEFAULT_VENMO_HANDLE = 'neighborline-sandbox-test';

export function unregisteredEmail(runId: string): string {
  return `neighborline-unclaimed-${runId}@example.com`;
}

/** Pure: the batches for one spike run. sender_batch_ids are derived from runId, so a re-run resumes, never doubles. */
export function planBatches(env: Env, runId: string): PlannedBatch[] {
  const personal = env.SANDBOX_PERSONAL_EMAIL;
  const handle = (env.SANDBOX_VENMO_HANDLE || DEFAULT_VENMO_HANDLE).replace(/^@/, '');
  const id = (b: string, i: string) => `golive_${runId}_${b}_${i}`;
  const note = (what: string) => `Neighborline sandbox test (${what}). Not real money.`;
  // Batch A is PayPal-wallet only: the real sandbox refuses a whole batch that contains any Venmo item
  // ("Recipient wallet not supported in sandbox", observed 2026-10-28), so Venmo is probed separately in batch B.
  const a: PlannedBatch = {
    label: 'A: PayPal wallet + unregistered',
    input: {
      senderBatchId: `golive_${runId}_a`,
      emailSubject: 'Neighborline sandbox test payout',
      emailMessage: 'This is a PayPal sandbox test from Neighborline. No real money moves.',
      items: [
        { senderItemId: id('a', 'paypal'), amountCents: 101, receiver: personal || unregisteredEmail(`${runId}-p`), recipientType: 'EMAIL', wallet: 'PAYPAL', note: note('PayPal wallet'), purpose: 'DONATIONS', notificationLanguage: 'en-US' },
        { senderItemId: id('a', 'unregistered'), amountCents: 104, receiver: unregisteredEmail(runId), recipientType: 'EMAIL', wallet: 'PAYPAL', note: note('unregistered email'), purpose: 'NON_GOODS_OR_SERVICES', notificationLanguage: 'es-US' },
      ],
    },
    items: [
      { key: 'paypal', label: personal ? 'PayPal wallet, sandbox personal account' : 'PayPal wallet (no SANDBOX_PERSONAL_EMAIL: unregistered)', expect: personal ? 'SUCCESS' : 'UNCLAIMED' },
      { key: 'unregistered', label: 'PayPal wallet, unregistered email', expect: 'UNCLAIMED (RECEIVER_UNREGISTERED)' },
    ],
  };
  const b: PlannedBatch = {
    label: 'B: Venmo probe (handle, @handle, email)',
    input: {
      senderBatchId: `golive_${runId}_b`,
      items: [
        { senderItemId: id('b', 'venmo_handle'), amountCents: 102, receiver: handle, recipientType: 'USER_HANDLE', wallet: 'VENMO', note: note('Venmo by username'), purpose: 'NON_GOODS_OR_SERVICES', socialFeedPrivacy: 'PRIVATE' },
        { senderItemId: id('b', 'venmo_at'), amountCents: 105, receiver: `@${handle}`, recipientType: 'USER_HANDLE', wallet: 'VENMO', note: note('Venmo by @username'), purpose: 'NON_GOODS_OR_SERVICES', socialFeedPrivacy: 'PRIVATE' },
        ...(personal ? [{ senderItemId: id('b', 'venmo_email'), amountCents: 103, receiver: personal, recipientType: 'EMAIL' as const, wallet: 'VENMO' as const, note: note('Venmo by email'), purpose: 'NON_GOODS_OR_SERVICES' as const, socialFeedPrivacy: 'PRIVATE' as const }] : []),
      ],
    },
    items: [
      { key: 'venmo_handle', label: `Venmo, USER_HANDLE "${handle}" (no @)`, expect: 'refused in sandbox ("Recipient wallet not supported in sandbox")' },
      { key: 'venmo_at', label: `Venmo, USER_HANDLE "@${handle}"`, expect: 'refused in sandbox' },
      ...(personal ? [{ key: 'venmo_email', label: 'Venmo, EMAIL of the sandbox personal account', expect: 'refused in sandbox' }] : []),
    ],
  };
  return [a, b];
}

export function phoneProbe(runId: string): CreateBatchInput {
  return { senderBatchId: `golive_${runId}_phone`, items: [{ senderItemId: `golive_${runId}_phone_1`, amountCents: 106, receiver: '4085550123', recipientType: 'PHONE', wallet: 'PAYPAL', note: 'Neighborline sandbox test (PHONE).' }] };
}

export interface BatchRecord {
  label: string;
  senderBatchId: string;
  batchId?: string;
  createdAt?: string;
  duplicateOnCreate?: boolean;
  createError?: ReturnType<typeof errorShape>;
  batchStatus?: string;
  timeCompleted?: string;
  items?: ItemRecord[];
  plan: SpikeItemPlan[];
  finishedPolling?: boolean;
}

export interface ItemRecord {
  senderItemId: string | undefined;
  payoutItemId: string;
  transactionId: string | undefined;
  status: string;
  wallet: string;
  recipientType: string | undefined;
  receiver: string;
  amountCents: number;
  feeCents: number | undefined;
  timeProcessed: string | undefined;
  errorName: string | undefined;
  errorMessage: string | undefined;
  purposeEcho: string | undefined;
}

export function toItemRecord(i: NormalizedPayoutItem): ItemRecord {
  const raw = i.raw as { payout_item?: { purpose?: string } };
  return {
    senderItemId: i.senderItemId,
    payoutItemId: i.payoutItemId,
    transactionId: i.transactionId,
    status: i.paypalStatus,
    wallet: i.wallet,
    recipientType: i.recipientType,
    receiver: i.receiver,
    amountCents: i.amountCents,
    feeCents: i.feeCents,
    timeProcessed: i.timeProcessed,
    errorName: i.errorName,
    errorMessage: i.errorMessage,
    purposeEcho: raw?.payout_item?.purpose,
  };
}

/** Create (or, on a re-run, resolve through the duplicate path) one batch. Never throws. */
export async function createBatchRecord(pp: PayPal, plan: PlannedBatch, now: () => Date): Promise<BatchRecord> {
  const rec: BatchRecord = { label: plan.label, senderBatchId: plan.input.senderBatchId, plan: plan.items };
  buildPayoutRequest(plan.input); // local validation first: a bad plan is our bug, not PayPal's
  try {
    const r = await pp.payouts.createBatch(plan.input);
    rec.batchId = r.batchId;
    rec.batchStatus = r.paypalStatus;
    rec.createdAt = r.timeCreated ?? now().toISOString();
    rec.duplicateOnCreate = r.duplicate;
  } catch (err) {
    rec.createError = errorShape(err);
  }
  return rec;
}

const PENDINGISH = new Set(['PENDING', 'ONHOLD', 'UNKNOWN']);
const BATCH_DONE = new Set(['SUCCESS', 'DENIED', 'CANCELED', 'COMPLETED']);

/** Poll a batch until it and its items stop moving (UNCLAIMED counts as settled for the spike), or time runs out. */
export async function pollBatch(pp: PayPal, rec: BatchRecord, opts: { timeoutMs: number; intervalMs: number; sleep: (ms: number) => Promise<void>; log: (s: string) => void }): Promise<BatchRecord> {
  if (!rec.batchId) return rec;
  const until = Date.now() + opts.timeoutMs;
  let last = '';
  for (;;) {
    try {
      const b = await pp.payouts.getBatch(rec.batchId);
      rec.batchStatus = b.paypalStatus;
      rec.timeCompleted = b.timeCompleted;
      rec.items = b.items.map(toItemRecord);
      const sig = `${b.paypalStatus} ${rec.items.map((i) => i.status).join(',')}`;
      if (sig !== last) opts.log(`    ${rec.senderBatchId} ${b.batchId}: ${sig}`);
      last = sig;
      rec.finishedPolling = BATCH_DONE.has(b.paypalStatus) && rec.items.every((i) => !PENDINGISH.has(i.status));
      if (rec.finishedPolling) break;
    } catch (err) {
      opts.log(`    poll ${rec.batchId}: ${(err as Error).message}`);
    }
    if (Date.now() >= until) break;
    await opts.sleep(opts.intervalMs);
  }
  // Items that did not succeed: GET the item for PayPal's reason (webhooks never carry it).
  for (const it of rec.items ?? []) {
    if (it.status === 'SUCCESS' || it.errorName) continue;
    try {
      const full = await pp.payouts.getItem(it.payoutItemId);
      Object.assign(it, toItemRecord(full));
    } catch {
      /* keep the batch view */
    }
  }
  return rec;
}
