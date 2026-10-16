/**
 * Payout item state machine. PayPal does not guarantee webhook order and GETs can race webhooks, so updates are
 * applied monotonically: a late "HELD" after "SUCCEEDED" is ignored instead of regressing the item.
 */

/**
 * Mirrors `PayoutItemStatus` / `PayoutBatch['status']` in @neighborline/core (kept identical by core-compat.test.ts)
 * so the published package has no dependency on the private core package.
 */
export const PAYOUT_ITEM_STATUSES = ['PENDING', 'SUCCESS', 'UNCLAIMED', 'RETURNED', 'ONHOLD', 'BLOCKED', 'FAILED', 'REFUNDED', 'REVERSED', 'CANCELED'] as const;
export type PayoutItemStatus = (typeof PAYOUT_ITEM_STATUSES)[number];
/**
 * UNKNOWN is local only: the create call failed ambiguously (timeout, network, 5xx) and is resolved by
 * re-sending the same sender_batch_id.
 *
 * Batch states. PayPal's own are PENDING, PROCESSING, SUCCESS, DENIED, CANCELED (and FAILED via the
 * create call); CREATING, UNKNOWN, FAILED_RAIL (refused at the account level, nothing sent) and MANUAL
 * (recorded as paid outside PayPal) are local states a caller keeps. mapBatchStatus never returns them.
 */
export const BATCH_STATUSES = ['CREATING', 'UNKNOWN', 'PENDING', 'PROCESSING', 'SUCCESS', 'DENIED', 'CANCELED', 'FAILED', 'FAILED_RAIL', 'MANUAL'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/** PayPal `transaction_status` (wire) values. */
export const PAYPAL_TRANSACTION_STATUSES = ['SUCCESS', 'FAILED', 'PENDING', 'UNCLAIMED', 'RETURNED', 'ONHOLD', 'BLOCKED', 'REFUNDED', 'REVERSED'] as const;
export type PayPalTransactionStatus = (typeof PAYPAL_TRANSACTION_STATUSES)[number];

/** Wire `transaction_status` → our status. Unknown/new values map to PENDING (re-poll), never to a final state. */
export function mapTransactionStatus(status: string | undefined): PayoutItemStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILED':
      return 'FAILED';
    case 'UNCLAIMED':
      return 'UNCLAIMED';
    case 'RETURNED':
      return 'RETURNED';
    case 'ONHOLD':
      return 'ONHOLD';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'REVERSED':
      return 'REVERSED';
    default:
      return 'PENDING';
  }
}

/** Item webhook event type → status. CANCELED means *we* cancelled an unclaimed item (wire status RETURNED). */
const ITEM_EVENT_STATUS: Record<string, PayoutItemStatus> = {
  'PAYMENT.PAYOUTS-ITEM.SUCCEEDED': 'SUCCESS',
  'PAYMENT.PAYOUTS-ITEM.UNCLAIMED': 'UNCLAIMED',
  'PAYMENT.PAYOUTS-ITEM.RETURNED': 'RETURNED',
  'PAYMENT.PAYOUTS-ITEM.BLOCKED': 'BLOCKED',
  'PAYMENT.PAYOUTS-ITEM.CANCELED': 'CANCELED',
  'PAYMENT.PAYOUTS-ITEM.DENIED': 'FAILED',
  'PAYMENT.PAYOUTS-ITEM.FAILED': 'FAILED',
  'PAYMENT.PAYOUTS-ITEM.HELD': 'ONHOLD',
  'PAYMENT.PAYOUTS-ITEM.REFUNDED': 'REFUNDED',
  // Not in PayPal's published event list; mapped defensively.
  'PAYMENT.PAYOUTS-ITEM.REVERSED': 'REVERSED',
};
export const PAYOUT_ITEM_EVENT_TYPES = Object.keys(ITEM_EVENT_STATUS);

export function itemStatusFromEvent(eventType: string): PayoutItemStatus | undefined {
  return ITEM_EVENT_STATUS[eventType];
}

export const PAYOUT_BATCH_EVENT_TYPES = ['PAYMENT.PAYOUTSBATCH.PROCESSING', 'PAYMENT.PAYOUTSBATCH.SUCCESS', 'PAYMENT.PAYOUTSBATCH.DENIED'] as const;

export function mapBatchStatus(status: string | undefined): BatchStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'PROCESSING':
      return 'PROCESSING';
    case 'SUCCESS':
      return 'SUCCESS';
    case 'DENIED':
      return 'DENIED';
    case 'CANCELED':
      return 'CANCELED';
    default:
      return 'PENDING';
  }
}

/** Money has left our hands and will not come back without a new event. */
export const TERMINAL_STATUSES: ReadonlySet<PayoutItemStatus> = new Set(['FAILED', 'RETURNED', 'BLOCKED', 'CANCELED', 'REFUNDED', 'REVERSED']);
/** The recipient has (or can still get) the money — the request counts as paid. */
export const PAID_STATUSES: ReadonlySet<PayoutItemStatus> = new Set(['SUCCESS']);

/**
 * Allowed forward moves (identical to ITEM_TRANSITIONS in @neighborline/core; enforced by core-compat.test.ts).
 * PENDING → anything; ONHOLD → settles; UNCLAIMED → claimed, returned or cancelled; SUCCESS → refund/reversal.
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

export function canTransition(from: PayoutItemStatus, to: PayoutItemStatus): boolean {
  return ITEM_TRANSITIONS[from].includes(to);
}

export type ApplyResult =
  | { status: PayoutItemStatus; changed: true }
  | { status: PayoutItemStatus; changed: false; reason: 'same' | 'stale' | 'equivalent' };

/**
 * Merge an incoming status (webhook or GET) into the current one. Never regresses: stale/out-of-order updates
 * are reported as `changed: false` so callers can log them instead of corrupting state.
 */
export function applyItemStatus(current: PayoutItemStatus, incoming: PayoutItemStatus): ApplyResult {
  if (current === incoming) return { status: current, changed: false, reason: 'same' };
  // A cancel shows up as CANCELED (event) and RETURNED (wire status): same outcome, keep the first one seen.
  if ((current === 'CANCELED' && incoming === 'RETURNED') || (current === 'RETURNED' && incoming === 'CANCELED')) {
    return { status: current, changed: false, reason: 'equivalent' };
  }
  if (canTransition(current, incoming)) return { status: incoming, changed: true };
  return { status: current, changed: false, reason: 'stale' };
}
