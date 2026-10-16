/** /ledger: every payout item from the db, plus reconcile against PayPal Transaction Search. */
import type { Lang, PayoutItemStatus } from '@neighborline/core';
import { getActivePolicy, listDonations, listItems, listRequests } from '@neighborline/db';
import { reconcile as reconcileItems, TRANSACTION_SEARCH_LAG_MS } from '@neighborline/paypal';
import type { LedgerRow, LedgerView, ReconcileResult, ReconcileState } from '../../types';
import { categoryLabelFor, type BaseCtx } from './context';
import { allBatches, listAlerts } from './queries';

/** Seeded history never went through this PayPal environment, so it is labelled, not "reconciled". */
const isSeeded = (paypalItemId: string | undefined) => !!paypalItemId?.startsWith('SEEDITEM');

export interface ReconcileCache {
  states: Map<string, ReconcileState>;
  at: string | null;
}

export function maskReceiver(receiver: string): string {
  if (receiver.startsWith('@')) return `${receiver.slice(0, 3)}•••••`;
  if (receiver.includes('@')) return `${receiver[0]}•••@•••${receiver.slice(receiver.lastIndexOf('.'))}`;
  return `•••-•••-${receiver.slice(-4)}`;
}

export async function buildLedger(ctx: BaseCtx, cache: ReconcileCache): Promise<LedgerView> {
  const g = ctx.gen.group;
  const [items, batches, reqs, policy, donations] = await Promise.all([
    listItems(ctx.db),
    allBatches(ctx.db),
    listRequests(ctx.db, { groupId: g.id }),
    getActivePolicy(ctx.db, g.id),
    listDonations(ctx.db, g.id),
  ]);
  const alerts = await listAlerts(ctx.db);
  const reqById = new Map(reqs.map((r) => [r.id, r]));
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const rows: LedgerRow[] = [];
  for (const it of items) {
    const r = reqById.get(it.requestId);
    if (!r) continue;
    const b = batchById.get(it.batchId);
    rows.push({
      itemId: it.id,
      batchId: it.batchId,
      senderBatchId: b?.senderBatchId ?? '',
      ...(b?.paypalBatchId ? { paypalBatchId: b.paypalBatchId } : {}),
      requestRef: `NL-${r.id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`,
      createdAt: b?.createdAt ?? it.lastEventAt,
      categoryLabel: categoryLabelFor(policy, r.computed?.ruleKey ?? r.extracted?.category),
      lang: r.lang as Lang,
      wallet: it.wallet,
      receiverMasked: maskReceiver(it.receiver),
      amountCents: it.amountCents,
      status: it.status,
      ...(it.transactionId ? { transactionId: it.transactionId } : {}),
      reconcile: isSeeded(it.paypalItemId) ? 'seeded' : (cache.states.get(it.id) ?? 'pending'),
    });
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sum = (s: PayoutItemStatus) => rows.filter((r) => r.status === s).reduce((t, r) => t + r.amountCents, 0);
  const paid = sum('SUCCESS');
  const inCents = donations.filter((d) => d.status === 'COMPLETED').reduce((t, d) => t + d.amountCents, 0);
  return {
    rows,
    summary: { paidCents: paid, pendingCents: sum('PENDING') + sum('ONHOLD'), unclaimedCents: sum('UNCLAIMED'), items: rows.length, batches: new Set(rows.map((r) => r.batchId)).size },
    lastReconciledAt: cache.at,
    balanceCents: inCents - paid - sum('PENDING') - sum('ONHOLD') - sum('UNCLAIMED'),
    ...(alerts.length ? { alerts } : {}),
  };
}

/** Compare every item PayPal should know about with Transaction Search (last 30 days). */
export async function runReconcile(ctx: BaseCtx, cache: ReconcileCache): Promise<ReconcileResult> {
  const items = (await listItems(ctx.db)).filter((i) => !isSeeded(i.paypalItemId));
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const txns = await ctx.paypal.reporting.searchTransactions({ startDate: start, endDate: end });
  const report = reconcileItems(items, txns, { asOf: end, lagMs: TRANSACTION_SEARCH_LAG_MS });
  const states = new Map<string, ReconcileState>();
  for (const m of report.matched) states.set(m.local.id, 'matched');
  for (const m of report.amountMismatch) states.set(m.local.id, 'mismatch');
  for (const l of report.missingAtPayPal) states.set(l.id, 'mismatch');
  for (const l of [...report.pendingLag, ...report.noTransactionId]) states.set(l.id, 'pending');
  cache.states = states;
  cache.at = end.toISOString();
  return {
    checked: items.length,
    matched: report.matched.length,
    mismatched: report.amountMismatch.length + report.missingAtPayPal.length + report.missingLocally.length,
    at: cache.at,
    simulated: ctx.cfg.paypalMode !== 'sandbox',
  };
}
