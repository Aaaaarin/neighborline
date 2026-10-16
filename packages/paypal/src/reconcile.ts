/**
 * Reconcile our payout ledger against PayPal Transaction Search (pure function).
 *
 *   matched          – same transaction id, same absolute amount
 *   amountMismatch   – same transaction id, different amount (investigate!)
 *   missingAtPayPal  – we have a transaction id PayPal does not list, and it is older than the reporting lag
 *   pendingLag       – same, but younger than the lag (~3h): not an error yet
 *   missingLocally   – PayPal lists a payout (T0001) we have no record of (investigate!)
 *   noTransactionId  – local items PayPal never assigned a transaction id (PENDING/BLOCKED/FAILED): nothing to match
 */
import type { PayoutItemStatus } from './payout-status.js';
import { EVENT_CODES, TRANSACTION_SEARCH_LAG_MS, type PayPalTransaction } from './reporting.js';

/** Structural subset of core's `PayoutItem` (a core PayoutItem can be passed directly). */
export interface LocalPayoutItem {
  id: string;
  amountCents: number;
  status: PayoutItemStatus;
  transactionId?: string | undefined;
  /** When we last saw the item change (ISO); used for the lag window. */
  lastEventAt?: string | undefined;
}

export interface ReconcileOptions {
  /** Defaults to now. */
  asOf?: Date;
  lagMs?: number;
  /** PayPal event codes that count as "our payouts" for missingLocally. Default: T0001 (mass pay). */
  payoutEventCodes?: readonly string[];
}

export interface ReconcileReport {
  matched: Array<{ local: LocalPayoutItem; paypal: PayPalTransaction }>;
  amountMismatch: Array<{ local: LocalPayoutItem; paypal: PayPalTransaction; diffCents: number }>;
  missingAtPayPal: LocalPayoutItem[];
  pendingLag: LocalPayoutItem[];
  missingLocally: PayPalTransaction[];
  noTransactionId: LocalPayoutItem[];
  ok: boolean;
  summary: string;
}

export function reconcile(localItems: readonly LocalPayoutItem[], paypalTransactions: readonly PayPalTransaction[], opts: ReconcileOptions = {}): ReconcileReport {
  const asOf = (opts.asOf ?? new Date()).getTime();
  const lag = opts.lagMs ?? TRANSACTION_SEARCH_LAG_MS;
  const codes = new Set(opts.payoutEventCodes ?? [EVENT_CODES.MASS_PAY]);
  const byId = new Map<string, PayPalTransaction>();
  for (const t of paypalTransactions) if (!byId.has(t.transactionId)) byId.set(t.transactionId, t);

  const report: ReconcileReport = { matched: [], amountMismatch: [], missingAtPayPal: [], pendingLag: [], missingLocally: [], noTransactionId: [], ok: true, summary: '' };
  const seen = new Set<string>();

  for (const local of localItems) {
    if (!local.transactionId) {
      report.noTransactionId.push(local);
      continue;
    }
    const pp = byId.get(local.transactionId);
    if (!pp) {
      const at = local.lastEventAt ? Date.parse(local.lastEventAt) : Number.NaN;
      if (Number.isFinite(at) && asOf - at < lag) report.pendingLag.push(local);
      else report.missingAtPayPal.push(local);
      continue;
    }
    seen.add(pp.transactionId);
    const diff = Math.abs(pp.amountCents) - local.amountCents;
    if (diff === 0) report.matched.push({ local, paypal: pp });
    else report.amountMismatch.push({ local, paypal: pp, diffCents: diff });
  }
  for (const t of byId.values()) if (!seen.has(t.transactionId) && codes.has(t.eventCode)) report.missingLocally.push(t);

  report.ok = report.amountMismatch.length === 0 && report.missingAtPayPal.length === 0 && report.missingLocally.length === 0;
  report.summary =
    `${report.matched.length} matched, ${report.amountMismatch.length} amount mismatch, ` +
    `${report.missingAtPayPal.length} missing at PayPal, ${report.missingLocally.length} missing locally, ` +
    `${report.pendingLag.length} within ${Math.round(lag / 3_600_000)}h reporting lag, ${report.noTransactionId.length} without transaction id`;
  return report;
}
