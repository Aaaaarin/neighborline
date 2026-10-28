/**
 * Nightly reconcile of payout items against PayPal Transaction Search.
 *
 *   nightlyReconcile
 *     ├─ reconcileWindow × N   (parallel, one per 24 h slice of the last 72 h; each retried on its own)
 *     ├─ recheckAfterLag       (only if some items were too fresh for Transaction Search: waits out
 *     │    └─ reconcileWindow   PayPal's ≤3 h lag, then reconciles those items again)
 *     └─ alertOrganizers       (only if mismatches remain)
 *
 * A window where Transaction Search answers "Data for the given start date is not available." (a brand-new account,
 * observed in the sandbox 2026-10-28) comes back as `reportingNotReady`: its items stay pending, nobody is alerted.
 */
import { task, type TaskContext } from '@renderinc/sdk/workflows';
import { ENDPOINTS, type ReconcileMismatch, type ReconcileRequest, type ReconcileResponse } from '../contract.js';
import { dedupeMismatches, lagRecheckPlan, planLagRecheck, reconcileWindows, type ReconcileWindow } from '../policy.js';
import { alertOrganizers } from './alerts.js';
import { connect, log, sleep } from './shared.js';

export const reconcileWindow = task(
  {
    name: 'reconcileWindow',
    // 30 s, 60 s, 2 min, 4 min, 8 min: rides out a cold start, a deploy, or a PayPal 5xx/429 burst.
    retry: { maxRetries: 5, waitDurationMs: 30_000, backoffScaling: 2 },
    timeoutSeconds: 600,
  },
  async function reconcileWindow(_ctx: TaskContext, window: ReconcileWindow): Promise<ReconcileResponse> {
    const { cfg, api } = connect();
    const res = await api.post<ReconcileRequest, ReconcileResponse>(ENDPOINTS.reconcile, { ...window, lagHours: cfg.lagHours });
    log('reconcile_window', {
      window: `${window.startDate}/${window.endDate}`,
      checked: res.checked,
      matched: res.matched,
      mismatches: res.mismatches.length,
      pendingLag: res.pendingLag.length,
      // PayPal's reporting has no data for this window yet (new account): lag, not a failure.
      ...(res.reportingNotReady ? { reportingNotReady: true } : {}),
    });
    return res;
  },
);

export const recheckAfterLag = task(
  {
    name: 'recheckAfterLag',
    retry: { maxRetries: 2, waitDurationMs: 60_000, backoffScaling: 2 },
    // Waits at most lag (3 h) + 10 min, then one reconcile call.
    timeoutSeconds: 4 * 3600 + 1800,
  },
  async function recheckAfterLag(ctx: TaskContext, pending: Array<{ itemId: string; paidAt: string }>): Promise<ReconcileResponse | null> {
    const { cfg } = connect();
    const plan = planLagRecheck(pending, cfg.lagHours, new Date());
    if (!plan) return null;
    // The wait is computed from absolute timestamps, so a retried attempt does not wait twice.
    log('lag_recheck_wait', { items: pending.length, waitMinutes: Math.round(plan.waitMs / 60_000) });
    if (plan.waitMs > 0) await sleep(plan.waitMs);
    const endDate = new Date(Math.ceil(Date.now() / 60_000) * 60_000).toISOString();
    return ctx.run(reconcileWindow, {
      startDate: plan.startDate,
      endDate,
      idempotencyKey: `reconcile-recheck:${plan.startDate}/${endDate}`,
    });
  },
);

export interface NightlyReconcileOptions {
  lookbackHours?: number;
  sliceHours?: number;
}

export interface NightlyReconcileSummary {
  windows: number;
  checked: number;
  matched: number;
  mismatches: ReconcileMismatch[];
  rechecked: number;
  stillPendingLag: number;
  /** Some window had no Transaction Search data yet (PayPal's reporting isn't ready): those items stay pending. */
  reportingNotReady: boolean;
  alertId: string | null;
}

export const nightlyReconcile = task(
  {
    name: 'nightlyReconcile',
    retry: { maxRetries: 1, waitDurationMs: 300_000 },
    timeoutSeconds: 5 * 3600,
  },
  async function nightlyReconcile(ctx: TaskContext, opts: NightlyReconcileOptions = {}): Promise<NightlyReconcileSummary> {
    const { cfg } = connect();
    const windows = reconcileWindows(
      new Date(),
      opts.lookbackHours ?? cfg.reconcileLookbackHours,
      opts.sliceHours ?? cfg.reconcileSliceHours,
    );
    const results = await Promise.all(windows.map((w) => ctx.run(reconcileWindow, w)));

    const { recheck: pending, notReady } = lagRecheckPlan(results);
    const recheck = pending.length > 0 ? await ctx.run(recheckAfterLag, pending) : null;

    const mismatches = dedupeMismatches(...results.map((r) => r.mismatches), recheck?.mismatches ?? []);
    let alertId: string | null = null;
    if (mismatches.length > 0) {
      const first = windows[0]?.startDate ?? '';
      const last = windows[windows.length - 1]?.endDate ?? '';
      const alert = await ctx.run(alertOrganizers, {
        kind: 'reconcile_mismatch',
        idempotencyKey: `reconcile_mismatch:${first}/${last}`,
        itemIds: [...new Set(mismatches.map((m) => m.itemId))],
        summary: `Nightly reconcile: ${mismatches.length} payout item(s) disagree with PayPal Transaction Search between ${first} and ${last}.`,
        detail: mismatches.slice(0, 50),
      });
      alertId = alert.alertId;
    }

    const summary: NightlyReconcileSummary = {
      windows: windows.length,
      checked: results.reduce((n, r) => n + r.checked, 0),
      matched: results.reduce((n, r) => n + r.matched, 0),
      mismatches,
      rechecked: pending.length,
      stillPendingLag: (recheck?.pendingLag.length ?? 0) + notReady.length,
      reportingNotReady: notReady.length > 0 || results.some((r) => r.reportingNotReady === true) || recheck?.reportingNotReady === true,
      alertId,
    };
    log('nightly_reconcile_done', { ...summary, mismatches: mismatches.length });
    return summary;
  },
);
