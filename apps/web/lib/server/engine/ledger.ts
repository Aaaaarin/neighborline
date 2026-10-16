/** /ledger: every payout item from the db, plus reconcile against PayPal Transaction Search. */
import type { Lang } from '@neighborline/core';
import { getActivePolicy, latestReconcileRun, listItems, listRequests, saveReconcileRun, type ReconcileItemOutcome } from '@neighborline/db';
import { reconcile as reconcileItems, TRANSACTION_SEARCH_LAG_MS, type ReconcileReport } from '@neighborline/paypal';
import type { LedgerRow, LedgerView, ReconcileResult, ReconcileState } from '../../types';
import { categoryLabelFor, type BaseCtx } from './context';
import { allBatches, listAlerts } from './queries';
import { loadFund } from './totals';
import { manualRecords, withRailResolution } from './rail';

/** Seeded history never went through this PayPal environment, so it is labelled, not "reconciled". */
const isSeeded = (paypalItemId: string | undefined) => !!paypalItemId?.startsWith('SEEDITEM');

export interface ReconcileCache {
  states: Map<string, ReconcileState>;
  /** Why an item is not 'matched' (status drift, amount, currency, missing), for /ledger. */
  details?: Map<string, string>;
  at: string | null;
  /** Loaded the last persisted run after a restart. */
  hydrated?: boolean;
}

/** Per-item outcomes of one Transaction Search reconcile (persisted in reconcile_runs). */
export function outcomesOf(report: ReconcileReport): Record<string, ReconcileItemOutcome> {
  const out: Record<string, ReconcileItemOutcome> = {};
  for (const m of report.matched) out[m.local.id] = { state: 'matched', localStatus: m.local.status, paypalStatus: m.paypal.status };
  for (const m of report.amountMismatch) out[m.local.id] = { state: 'mismatch', localStatus: m.local.status, paypalStatus: m.paypal.status, detail: `amount differs by ${m.diffCents} cents` };
  for (const m of report.currencyMismatch) out[m.local.id] = { state: 'mismatch', localStatus: m.local.status, paypalStatus: m.paypal.status, detail: `PayPal shows ${m.paypal.currency}` };
  for (const d of report.statusDrift) out[d.local.id] = { state: 'drift', localStatus: d.local.status, paypalStatus: d.paypal.status, detail: d.detail };
  for (const l of report.missingAtPayPal) out[l.id] = { state: 'mismatch', localStatus: l.status, detail: 'transaction id not found at PayPal' };
  for (const l of [...report.pendingLag, ...report.noTransactionId]) out[l.id] ??= { state: 'pending', localStatus: l.status };
  for (const l of report.stuckPending) out[l.id] = { state: 'drift', localStatus: l.status, detail: 'still PENDING with no PayPal transaction after 24 h (webhook lost?): poll the batch' };
  return out;
}

/** Merge a run into the in-memory view and persist it (survives restarts; audit row per run). */
export async function recordRun(ctx: BaseCtx, cache: ReconcileCache, report: ReconcileReport, window: { start: Date; end: Date }, actor: string) {
  const items = outcomesOf(report);
  cache.details ??= new Map();
  for (const [id, o] of Object.entries(items)) {
    cache.states.set(id, o.state === 'drift' ? 'mismatch' : o.state === 'seeded' ? 'seeded' : o.state);
    if (o.detail) cache.details.set(id, o.detail);
    else cache.details.delete(id);
  }
  const summary = {
    checked: Object.keys(items).length,
    matched: report.matched.length,
    mismatched: report.amountMismatch.length + report.currencyMismatch.length + report.missingAtPayPal.length + report.missingLocally.length,
    drift: report.statusDrift.length + report.stuckPending.length,
    missingLocally: report.missingLocally.length,
    pending: report.pendingLag.length + report.noTransactionId.length,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
  };
  const run = await saveReconcileRun(ctx.db, { at: new Date(), simulated: ctx.cfg.paypalMode !== 'sandbox', summary, items, actor });
  cache.at = run.at;
  return { run, summary };
}

/** After a restart, show the last persisted run instead of "never reconciled". */
async function hydrate(ctx: BaseCtx, cache: ReconcileCache) {
  if (cache.hydrated || cache.at) return;
  cache.hydrated = true;
  const run = await latestReconcileRun(ctx.db).catch(() => null);
  if (!run) return;
  cache.details ??= new Map();
  for (const [id, o] of Object.entries(run.items)) {
    cache.states.set(id, o.state === 'drift' ? 'mismatch' : o.state);
    if (o.detail) cache.details.set(id, o.detail);
  }
  cache.at = run.at;
}

export function maskReceiver(receiver: string): string {
  if (receiver.startsWith('@')) return `${receiver.slice(0, 3)}•••••`;
  if (receiver.includes('@')) return `${receiver[0]}•••@•••${receiver.slice(receiver.lastIndexOf('.'))}`;
  return `•••-•••-${receiver.slice(-4)}`;
}

export async function buildLedger(ctx: BaseCtx, cache: ReconcileCache): Promise<LedgerView> {
  await hydrate(ctx, cache);
  const g = ctx.gen.group;
  const [items, batches, reqs, policy, fund] = await Promise.all([
    listItems(ctx.db),
    allBatches(ctx.db),
    listRequests(ctx.db, { groupId: g.id }),
    getActivePolicy(ctx.db, g.id),
    loadFund(ctx),
  ]);
  const alerts = await withRailResolution(ctx.db, await listAlerts(ctx.db));
  const manual = await manualRecords(ctx.db);
  // Rows for exactly the requests the totals (and /report, /donate) count: same query, same window.
  const inWindow = new Set(fund.input.requests.map((r) => r.id));
  const reqById = new Map(reqs.filter((r) => inWindow.has(r.id)).map((r) => [r.id, r]));
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
      reconcile: isSeeded(it.paypalItemId) ? 'seeded' : b?.status === 'MANUAL' ? 'manual' : (cache.states.get(it.id) ?? 'pending'),
      ...(cache.details?.get(it.id) && !isSeeded(it.paypalItemId) && b?.status !== 'MANUAL' ? { reconcileDetail: cache.details.get(it.id) } : {}),
      ...(b?.status === 'MANUAL' ? { rail: 'manual' as const, ...(manual.get(b.id) ? { manual: manual.get(b.id)! } : {}) } : {}),
      ...((b?.status === 'FAILED_RAIL' || b?.status === 'FAILED') && it.status === 'PENDING' ? { rail: 'refused' as const } : {}),
    });
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const t = fund.totals;
  return {
    rows,
    fund: t,
    summary: { paidCents: t.landedCents, pendingCents: t.sendingCents, unclaimedCents: t.unclaimedCents, items: rows.length, batches: new Set(rows.map((r) => r.batchId)).size },
    lastReconciledAt: cache.at,
    balanceCents: t.leftInFundCents,
    ...(alerts.length ? { alerts } : {}),
  };
}

/** Compare every item PayPal should know about with Transaction Search (last 30 days). */
export async function runReconcile(ctx: BaseCtx, cache: ReconcileCache): Promise<ReconcileResult> {
  // Seeded history never reached this PayPal, and items recorded by hand or refused have no PayPal transaction.
  const offPayPal = new Set((await allBatches(ctx.db)).filter((b) => ['MANUAL', 'FAILED_RAIL', 'FAILED'].includes(b.status)).map((b) => b.id));
  const items = (await listItems(ctx.db)).filter((i) => !isSeeded(i.paypalItemId) && !offPayPal.has(i.batchId));
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const txns = await ctx.paypal.reporting.searchTransactions({ startDate: start, endDate: end });
  const report = reconcileItems(items, txns, { asOf: end, lagMs: TRANSACTION_SEARCH_LAG_MS });
  const { summary } = await recordRun(ctx, cache, report, { start, end }, 'organizer');
  return {
    checked: items.length,
    matched: summary.matched,
    mismatched: summary.mismatched,
    drift: summary.drift,
    at: cache.at ?? end.toISOString(),
    simulated: ctx.cfg.paypalMode !== 'sandbox',
  };
}
