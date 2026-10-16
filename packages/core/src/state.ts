/**
 * State machines for help requests and PayPal payout items.
 * Webhooks arrive late, duplicated and out of order; `applyItemEvent` must never regress a
 * terminal/settled state, and applying the same event twice is a no-op.
 */
import type { PayoutItemStatus, RequestStatus } from './schemas.js';

// ---------- Request status ----------

export const REQUEST_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  intake: ['needs_clarification', 'awaiting_approval', 'cancelled', 'declined'],
  needs_clarification: ['intake', 'awaiting_approval', 'cancelled', 'declined'],
  awaiting_approval: ['approved', 'declined', 'cancelled', 'needs_clarification'],
  // approved → awaiting_approval when an approval is voided by a content change
  approved: ['paying', 'awaiting_approval', 'cancelled'],
  paying: ['paid', 'unclaimed', 'returned', 'failed', 'cancelled'],
  unclaimed: ['paid', 'returned', 'cancelled'],
  // paid → returned covers PayPal REFUNDED / REVERSED after success
  paid: ['returned'],
  // returned/failed can be retried with a corrected destination (back through approval)
  returned: ['needs_clarification', 'awaiting_approval'],
  failed: ['needs_clarification', 'awaiting_approval'],
  // declined may be reopened on appeal
  declined: ['awaiting_approval'],
  cancelled: [],
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(readonly from: string, readonly to: string) {
    super(`invalid transition ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/** Returns `to` or throws. Same-state "transitions" are allowed as no-ops. */
export function transitionRequest(from: RequestStatus, to: RequestStatus): RequestStatus {
  if (from === to || canTransitionRequest(from, to)) return to;
  throw new InvalidTransitionError(from, to);
}

/** Organizer queue / "can still be edited" helpers. */
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = ['intake', 'needs_clarification', 'awaiting_approval'];
export const isRequestFinal = (s: RequestStatus): boolean => s === 'paid' || s === 'cancelled';

// ---------- Payout item status ----------

/**
 * Allowed forward moves, from PayPal's documented item lifecycle:
 * PENDING → anything; ONHOLD → settles; UNCLAIMED → SUCCESS | RETURNED | CANCELED (auto-return after 30d);
 * SUCCESS → REFUNDED | REVERSED. FAILED/RETURNED/BLOCKED/CANCELED/REFUNDED/REVERSED are terminal.
 */
export const ITEM_TRANSITIONS: Readonly<Record<PayoutItemStatus, readonly PayoutItemStatus[]>> = {
  PENDING: ['SUCCESS', 'UNCLAIMED', 'ONHOLD', 'BLOCKED', 'FAILED', 'RETURNED', 'REFUNDED', 'REVERSED', 'CANCELED'],
  ONHOLD: ['SUCCESS', 'UNCLAIMED', 'BLOCKED', 'FAILED', 'RETURNED', 'REFUNDED', 'REVERSED', 'CANCELED'],
  UNCLAIMED: ['SUCCESS', 'RETURNED', 'CANCELED'],
  SUCCESS: ['REFUNDED', 'REVERSED'],
  FAILED: [],
  RETURNED: [],
  BLOCKED: [],
  CANCELED: [],
  REFUNDED: [],
  REVERSED: [],
};

export const TERMINAL_ITEM_STATUSES: readonly PayoutItemStatus[] = (Object.keys(ITEM_TRANSITIONS) as PayoutItemStatus[]).filter(
  (s) => ITEM_TRANSITIONS[s].length === 0,
);

export const isItemTerminal = (s: PayoutItemStatus): boolean => ITEM_TRANSITIONS[s].length === 0;

export type ItemEventResult =
  | { status: PayoutItemStatus; changed: true }
  | { status: PayoutItemStatus; changed: false; ignored: 'duplicate' | 'stale' };

/**
 * Apply an incoming item status (from a webhook or a GET poll) to the current one.
 * Idempotent (duplicate → no change) and order-tolerant (a late PENDING after SUCCESS is ignored).
 */
export function applyItemEvent(current: PayoutItemStatus, incoming: PayoutItemStatus): ItemEventResult {
  if (current === incoming) return { status: current, changed: false, ignored: 'duplicate' };
  if (ITEM_TRANSITIONS[current].includes(incoming)) return { status: incoming, changed: true };
  return { status: current, changed: false, ignored: 'stale' };
}

/** Fold a sequence of events (any order, with duplicates) starting from PENDING. */
export function foldItemEvents(events: readonly PayoutItemStatus[], start: PayoutItemStatus = 'PENDING'): PayoutItemStatus {
  return events.reduce<PayoutItemStatus>((s, e) => applyItemEvent(s, e).status, start);
}

/** Item status → request status (what the requester and organizers see). */
export function requestStatusForItem(item: PayoutItemStatus): RequestStatus {
  switch (item) {
    case 'PENDING':
    case 'ONHOLD':
      return 'paying';
    case 'SUCCESS':
      return 'paid';
    case 'UNCLAIMED':
      return 'unclaimed';
    case 'RETURNED':
    case 'REFUNDED':
    case 'REVERSED':
      return 'returned';
    case 'BLOCKED':
    case 'FAILED':
      return 'failed';
    case 'CANCELED':
      return 'cancelled';
  }
}

/** PayPal webhook event_type → item status. Unknown events → null (log and ignore). */
export function itemStatusForWebhookEvent(eventType: string): PayoutItemStatus | null {
  const map: Record<string, PayoutItemStatus> = {
    'PAYMENT.PAYOUTS-ITEM.SUCCEEDED': 'SUCCESS',
    'PAYMENT.PAYOUTS-ITEM.UNCLAIMED': 'UNCLAIMED',
    'PAYMENT.PAYOUTS-ITEM.RETURNED': 'RETURNED',
    'PAYMENT.PAYOUTS-ITEM.BLOCKED': 'BLOCKED',
    'PAYMENT.PAYOUTS-ITEM.CANCELED': 'CANCELED',
    'PAYMENT.PAYOUTS-ITEM.DENIED': 'FAILED',
    'PAYMENT.PAYOUTS-ITEM.FAILED': 'FAILED',
    'PAYMENT.PAYOUTS-ITEM.HELD': 'ONHOLD',
    'PAYMENT.PAYOUTS-ITEM.REFUNDED': 'REFUNDED',
    'PAYMENT.PAYOUTS-ITEM.REVERSED': 'REVERSED',
  };
  return map[eventType] ?? null;
}

/** PayPal transaction_status strings (case-insensitive; "DENIED" → FAILED). */
export function parsePayPalItemStatus(raw: string): PayoutItemStatus | null {
  const s = raw.trim().toUpperCase();
  if (s === 'DENIED') return 'FAILED';
  if (s === 'NEW') return 'PENDING';
  return (Object.keys(ITEM_TRANSITIONS) as PayoutItemStatus[]).includes(s as PayoutItemStatus) ? (s as PayoutItemStatus) : null;
}
