/**
 * Persisted Transaction Search reconcile runs. The web app's /ledger shows the latest run (and its
 * per-item outcomes) even after a restart; every run also gets an audit row with the counts.
 */
import { desc } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { reconcileRuns } from '../schema.js';
import { inTx, iso, newId } from '../util.js';
import { appendAudit } from './audit.js';

export type ReconcileItemState = 'matched' | 'mismatch' | 'drift' | 'pending' | 'seeded';

export interface ReconcileItemOutcome {
  state: ReconcileItemState;
  /** Our payout item status when the run happened. */
  localStatus: string;
  /** PayPal's transaction_status for the matching transaction (S, P, D, V…), when one was found. */
  paypalStatus?: string;
  detail?: string;
}

export interface ReconcileRunSummary {
  checked: number;
  matched: number;
  mismatched: number;
  drift: number;
  missingLocally: number;
  pending: number;
  windowStart: string;
  windowEnd: string;
}

export interface ReconcileRun {
  id: string;
  at: string;
  simulated: boolean;
  summary: ReconcileRunSummary;
  items: Record<string, ReconcileItemOutcome>;
}

export async function saveReconcileRun(
  ex: Executor,
  input: { at?: Date; simulated: boolean; summary: ReconcileRunSummary; items: Record<string, ReconcileItemOutcome>; actor?: string },
): Promise<ReconcileRun> {
  const at = input.at ?? new Date();
  const id = newId('rec');
  return inTx(ex, async (tx) => {
    await tx.insert(reconcileRuns).values({ id, at, simulated: input.simulated, summary: { ...input.summary }, items: input.items });
    await appendAudit(tx, {
      actor: input.actor ?? 'reconcile',
      action: 'reconcile.run',
      entityType: 'reconcile_run',
      entityId: id,
      data: { ...input.summary, simulated: input.simulated },
      at,
    });
    return { id, at: at.toISOString(), simulated: input.simulated, summary: input.summary, items: input.items };
  });
}

export async function latestReconcileRun(ex: Executor): Promise<ReconcileRun | null> {
  const [row] = await ex.select().from(reconcileRuns).orderBy(desc(reconcileRuns.at)).limit(1);
  if (!row) return null;
  return { id: row.id, at: iso(row.at), simulated: row.simulated, summary: row.summary as unknown as ReconcileRunSummary, items: row.items as Record<string, ReconcileItemOutcome> };
}
