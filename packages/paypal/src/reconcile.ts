/**
 * Reconcile our payout ledger against PayPal Transaction Search (pure function).
 *
 *   matched          – same transaction id, same absolute amount
 *   amountMismatch   – same transaction id, different amount (investigate!)
 *   missingAtPayPal  – we have a transaction id PayPal does not list, and it is older than the reporting lag
 *   pendingLag       – same, but younger than the lag (~3h): not an error yet
 *   missingLocally   – PayPal lists a payout (T0001) we have no record of (investigate!)
 *   noTransactionId  – local items PayPal never assigned a transaction id (PENDING/BLOCKED/FAILED): nothing to match
 *   statusDrift      – same transaction id and amount, but PayPal's transaction_status disagrees with our item
 *                      status (we say SUCCESS, PayPal says reversed/denied/pending; or the other way round)
 *   currencyMismatch – same transaction id, different currency (we only ever send USD)
 *   stuckPending     – PENDING/ONHOLD items with no transaction id for longer than `stuckAfterMs` (default 24h):
 *                      a webhook was probably lost; poll the batch
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
  /** Currency we pay in. Default USD. */
  currency?: string;
  /** Untracked PENDING/ONHOLD items older than this are reported as stuck. Default 24 h. */
  stuckAfterMs?: number;
}

/**
 * Which local item statuses are consistent with PayPal's Transaction Search `transaction_status`
 * (S = success, P = pending, D = denied, V = reversed / refunded). Unknown codes are not judged.
 */
export const CONSISTENT_LOCAL_STATUSES: Readonly<Record<string, readonly PayoutItemStatus[]>> = {
  S: ['SUCCESS'],
  P: ['PENDING', 'UNCLAIMED', 'ONHOLD'],
  D: ['FAILED', 'BLOCKED', 'RETURNED', 'CANCELED'],
  V: ['RETURNED', 'REFUNDED', 'REVERSED', 'CANCELED'],
};

/** Why a matched transaction's status disagrees with ours, or null when it does not. */
export function statusDriftOf(localStatus: PayoutItemStatus, paypalStatus: string): string | null {
  const ok = CONSISTENT_LOCAL_STATUSES[paypalStatus.toUpperCase()];
  if (!ok || ok.includes(localStatus)) return null;
  const said = { S: 'completed', P: 'pending', D: 'denied', V: 'reversed or refunded' }[paypalStatus.toUpperCase() as 'S' | 'P' | 'D' | 'V'];
  return `we have ${localStatus}, PayPal Transaction Search says ${said} (${paypalStatus})`;
}

export interface ReconcileReport {
  matched: Array<{ local: LocalPayoutItem; paypal: PayPalTransaction }>;
  amountMismatch: Array<{ local: LocalPayoutItem; paypal: PayPalTransaction; diffCents: number }>;
  missingAtPayPal: LocalPayoutItem[];
  pendingLag: LocalPayoutItem[];
  missingLocally: PayPalTransaction[];
  noTransactionId: LocalPayoutItem[];
  statusDrift: Array<{ local: LocalPayoutItem; paypal: PayPalTransaction; detail: string }>;
  currencyMismatch: Array<{ local: LocalPayoutItem; paypal: PayPalTransaction }>;
  stuckPending: LocalPayoutItem[];
  ok: boolean;
  summary: string;
}

export function reconcile(localItems: readonly LocalPayoutItem[], paypalTransactions: readonly PayPalTransaction[], opts: ReconcileOptions = {}): ReconcileReport {
  const asOf = (opts.asOf ?? new Date()).getTime();
  const lag = opts.lagMs ?? TRANSACTION_SEARCH_LAG_MS;
  const codes = new Set(opts.payoutEventCodes ?? [EVENT_CODES.MASS_PAY]);
  const byId = new Map<string, PayPalTransaction>();
  for (const t of paypalTransactions) if (!byId.has(t.transactionId)) byId.set(t.transactionId, t);

  const currency = (opts.currency ?? 'USD').toUpperCase();
  const stuckAfter = opts.stuckAfterMs ?? 24 * 3_600_000;
  const report: ReconcileReport = {
    matched: [],
    amountMismatch: [],
    missingAtPayPal: [],
    pendingLag: [],
    missingLocally: [],
    noTransactionId: [],
    statusDrift: [],
    currencyMismatch: [],
    stuckPending: [],
    ok: true,
    summary: '',
  };
  const seen = new Set<string>();

  for (const local of localItems) {
    if (!local.transactionId) {
      report.noTransactionId.push(local);
      const at = local.lastEventAt ? Date.parse(local.lastEventAt) : Number.NaN;
      if ((local.status === 'PENDING' || local.status === 'ONHOLD') && Number.isFinite(at) && asOf - at > stuckAfter) report.stuckPending.push(local);
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
    if (pp.currency && pp.currency.toUpperCase() !== currency) {
      report.currencyMismatch.push({ local, paypal: pp });
      continue;
    }
    const diff = Math.abs(pp.amountCents) - local.amountCents;
    if (diff !== 0) {
      report.amountMismatch.push({ local, paypal: pp, diffCents: diff });
      continue;
    }
    const drift = pp.status ? statusDriftOf(local.status, pp.status) : null;
    if (drift) report.statusDrift.push({ local, paypal: pp, detail: drift });
    else report.matched.push({ local, paypal: pp });
  }
  for (const t of byId.values()) if (!seen.has(t.transactionId) && codes.has(t.eventCode)) report.missingLocally.push(t);

  report.ok =
    report.amountMismatch.length === 0 &&
    report.missingAtPayPal.length === 0 &&
    report.missingLocally.length === 0 &&
    report.statusDrift.length === 0 &&
    report.currencyMismatch.length === 0 &&
    report.stuckPending.length === 0;
  report.summary =
    `${report.matched.length} matched, ${report.amountMismatch.length} amount mismatch, ` +
    `${report.statusDrift.length} status drift, ${report.currencyMismatch.length} currency mismatch, ${report.stuckPending.length} stuck pending, ` +
    `${report.missingAtPayPal.length} missing at PayPal, ${report.missingLocally.length} missing locally, ` +
    `${report.pendingLag.length} within ${Math.round(lag / 3_600_000)}h reporting lag, ${report.noTransactionId.length} without transaction id`;
  return report;
}
