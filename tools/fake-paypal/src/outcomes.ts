/**
 * Deterministic payout outcomes for demos and tests. The receiver string decides the item's fate:
 *
 *   contains "unclaimed"            → UNCLAIMED  (e.g. maria.unclaimed@example.com)
 *   Venmo handle "@new-to-venmo…"   → UNCLAIMED  (recipient has no Venmo account yet)
 *   contains "@onhold"              → ONHOLD
 *   contains "@blocked"             → BLOCKED
 *   contains "@failed"              → FAILED
 *   listed in config.unclaimedReceivers → UNCLAIMED (exact match, case-insensitive)
 *   anything else                   → SUCCESS
 */
import type { PayoutItemRec, TransactionStatus } from './state.js';

export function decideOutcome(receiver: string, unclaimedReceivers: readonly string[] = []): TransactionStatus {
  const r = receiver.trim().toLowerCase();
  if (r.includes('unclaimed')) return 'UNCLAIMED';
  if (unclaimedReceivers.some((u) => u.trim().toLowerCase() === r)) return 'UNCLAIMED';
  if (r.startsWith('@new-to-venmo') || r.startsWith('new-to-venmo')) return 'UNCLAIMED';
  if (r.includes('@onhold')) return 'ONHOLD';
  if (r.includes('@blocked')) return 'BLOCKED';
  if (r.includes('@failed')) return 'FAILED';
  return 'SUCCESS';
}

/** Item-level `errors` object PayPal attaches to non-successful items (names from the documented list). */
export function errorsFor(status: TransactionStatus): PayoutItemRec['errors'] | undefined {
  const link = 'https://developer.paypal.com/docs/api/payments.payouts-batch/#errors';
  switch (status) {
    case 'UNCLAIMED':
      return { name: 'RECEIVER_UNREGISTERED', message: 'Receiver is unregistered', information_link: link };
    case 'BLOCKED':
      return { name: 'RISK_DECLINE', message: 'Transaction declined due to risk', information_link: link };
    case 'FAILED':
      return { name: 'RECEIVER_ACCOUNT_LOCKED', message: 'Receiver account is locked or inactive', information_link: link };
    case 'ONHOLD':
      return { name: 'REGULATORY_PENDING', message: 'Transaction is pending regulatory review', information_link: link };
    default:
      return undefined;
  }
}

/** Item statuses that create a ledger transaction (and thus appear in Transaction Search). */
export function createsTransaction(status: TransactionStatus): boolean {
  return status !== 'BLOCKED' && status !== 'FAILED' && status !== 'PENDING';
}

/** Webhook event for an item entering `status`. CANCELED is the event PayPal sends after a cancel (status RETURNED). */
export const ITEM_EVENT_FOR_STATUS: Partial<Record<TransactionStatus | 'CANCELED', string>> = {
  SUCCESS: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
  UNCLAIMED: 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
  ONHOLD: 'PAYMENT.PAYOUTS-ITEM.HELD',
  BLOCKED: 'PAYMENT.PAYOUTS-ITEM.BLOCKED',
  FAILED: 'PAYMENT.PAYOUTS-ITEM.FAILED',
  RETURNED: 'PAYMENT.PAYOUTS-ITEM.RETURNED',
  REFUNDED: 'PAYMENT.PAYOUTS-ITEM.REFUNDED',
  REVERSED: 'PAYMENT.PAYOUTS-ITEM.REVERSED',
  CANCELED: 'PAYMENT.PAYOUTS-ITEM.CANCELED',
};
