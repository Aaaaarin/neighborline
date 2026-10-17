/**
 * Transaction Search against the spike's payouts: does each item's transaction_id appear, with the same amount and a
 * consistent status, and how long after time_processed did it show up? PayPal documents "up to 3 hours", so a miss on
 * young items is `pending` (re-run `pnpm golive --only sandbox-spike` later), not a failure.
 */
import { mapTransactionStatus, reconcile, TRANSACTION_SEARCH_LAG_MS, type LocalPayoutItem, type PayPal } from '@neighborline/paypal';
import { errorShape } from '../paypal-admin.js';
import type { BatchRecord } from './payouts.js';

export interface ReconcileProbe {
  checkedAt: string;
  window: { start: string; end: string };
  fetched: number;
  matched: Array<{ payoutItemId: string; transactionId: string; eventCode: string; paypalStatus: string; amountCents: number; firstSeenAt: string; lagMinutes: number | null }>;
  pendingLag: string[];
  missingAtPayPal: string[];
  noTransactionId: string[];
  mismatches: string[];
  summary: string;
  error?: ReturnType<typeof errorShape>;
  status: 'ok' | 'pending' | 'warn' | 'failed';
}

export async function probeReconcile(pp: PayPal, batches: BatchRecord[], now: Date, previous?: ReconcileProbe): Promise<ReconcileProbe> {
  const items = batches.flatMap((b) => (b.items ?? []).map((i) => ({ i, created: b.createdAt })));
  const earliest = items.reduce((m, x) => Math.min(m, Date.parse(x.created ?? now.toISOString())), now.getTime());
  const window = { start: new Date(earliest - 3_600_000).toISOString(), end: now.toISOString() };
  const base: ReconcileProbe = { checkedAt: now.toISOString(), window, fetched: 0, matched: [], pendingLag: [], missingAtPayPal: [], noTransactionId: [], mismatches: [], summary: '', status: 'ok' };
  let txns;
  try {
    txns = await pp.reporting.searchTransactions({ startDate: window.start, endDate: window.end });
  } catch (err) {
    return { ...base, error: errorShape(err), status: 'failed', summary: `Transaction Search failed: ${(err as Error).message}` };
  }
  const local: LocalPayoutItem[] = items.map(({ i, created }) => ({
    id: i.payoutItemId,
    amountCents: i.amountCents,
    status: mapTransactionStatus(i.status),
    ...(i.transactionId ? { transactionId: i.transactionId } : {}),
    lastEventAt: i.timeProcessed ?? created,
  }));
  const r = reconcile(local, txns, { asOf: now, lagMs: TRANSACTION_SEARCH_LAG_MS });
  const seenBefore = new Map((previous?.matched ?? []).map((m) => [m.payoutItemId, m.firstSeenAt]));
  const byId = new Map(items.map(({ i }) => [i.payoutItemId, i]));
  const matched = r.matched.map(({ local: l, paypal: p }) => {
    const firstSeenAt = seenBefore.get(l.id) ?? now.toISOString();
    const processed = byId.get(l.id)?.timeProcessed;
    return {
      payoutItemId: l.id,
      transactionId: p.transactionId,
      eventCode: p.eventCode,
      paypalStatus: p.status,
      amountCents: p.amountCents,
      firstSeenAt,
      lagMinutes: processed ? Math.max(0, Math.round((Date.parse(firstSeenAt) - Date.parse(processed)) / 60_000)) : null,
    };
  });
  const mismatches = [
    ...r.amountMismatch.map((m) => `${m.local.id}: amount ${m.local.amountCents} vs ${m.paypal.amountCents}`),
    ...r.currencyMismatch.map((m) => `${m.local.id}: currency ${m.paypal.currency}`),
    ...r.statusDrift.map((m) => `${m.local.id}: ${m.detail}`),
  ];
  const status = mismatches.length || r.missingAtPayPal.length ? 'warn' : r.pendingLag.length ? 'pending' : 'ok';
  return {
    ...base,
    fetched: txns.length,
    matched,
    pendingLag: r.pendingLag.map((l) => l.id),
    missingAtPayPal: r.missingAtPayPal.map((l) => l.id),
    noTransactionId: r.noTransactionId.map((l) => l.id),
    mismatches,
    summary: r.summary,
    status,
  };
}
