/**
 * Pure decision logic (no I/O) so it is unit-tested and identical in every task run.
 * AI never decides anything here; these are deterministic timing rules.
 */
import type { ReconcileMismatch, UnclaimedItem } from './contract.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---------- reconcile ----------

export interface ReconcileWindow {
  startDate: string;
  endDate: string;
  idempotencyKey: string;
}

/**
 * Non-overlapping slices covering [floorHour(now) - lookback, floorHour(now)).
 * Consecutive nightly runs overlap by (lookback - 24h), so an item that was still inside
 * PayPal's reporting lag one night is checked again the next night.
 */
export function reconcileWindows(now: Date, lookbackHours: number, sliceHours: number): ReconcileWindow[] {
  if (sliceHours <= 0 || lookbackHours <= 0) throw new Error('hours must be positive');
  if (sliceHours > 31 * 24) throw new Error('Transaction Search allows at most 31 days per request');
  const end = Math.floor(now.getTime() / HOUR) * HOUR;
  const start = end - lookbackHours * HOUR;
  const out: ReconcileWindow[] = [];
  for (let s = start; s < end; s += sliceHours * HOUR) {
    const e = Math.min(s + sliceHours * HOUR, end);
    const startDate = new Date(s).toISOString();
    const endDate = new Date(e).toISOString();
    out.push({ startDate, endDate, idempotencyKey: `reconcile:${startDate}/${endDate}` });
  }
  return out;
}

export interface LagRecheckPlan {
  /** How long to wait so every pending item is older than the lag (+ safety margin). */
  waitMs: number;
  /** Window to reconcile again once the wait is over (end is filled in after waiting). */
  startDate: string;
}

/** Margin on top of PayPal's documented 3h lag. */
export const LAG_SAFETY_MS = 10 * 60_000;

export function planLagRecheck(pending: Array<{ paidAt: string }>, lagHours: number, now: Date): LagRecheckPlan | null {
  if (pending.length === 0) return null;
  const times = pending.map((p) => Date.parse(p.paidAt)).filter(Number.isFinite);
  if (times.length === 0) return null;
  const newest = Math.max(...times);
  const oldest = Math.min(...times);
  return {
    waitMs: Math.max(0, newest + lagHours * HOUR + LAG_SAFETY_MS - now.getTime()),
    startDate: new Date(oldest - 5 * 60_000).toISOString(),
  };
}

/**
 * Which pending items to re-check after the lag. Windows where Transaction Search had no data at all yet
 * (`reportingNotReady`, a brand-new account) are not re-checked in 3 h: they stay pending until tomorrow's run,
 * and are counted, never alerted on.
 */
export function lagRecheckPlan(results: ReadonlyArray<{ pendingLag: Array<{ itemId: string; paidAt: string }>; reportingNotReady?: true }>): {
  recheck: Array<{ itemId: string; paidAt: string }>;
  notReady: Array<{ itemId: string; paidAt: string }>;
} {
  const ready = results.filter((r) => !r.reportingNotReady);
  const notReady = results.filter((r) => r.reportingNotReady);
  return { recheck: ready.flatMap((r) => r.pendingLag), notReady: notReady.flatMap((r) => r.pendingLag) };
}

export function dedupeMismatches(...lists: ReconcileMismatch[][]): ReconcileMismatch[] {
  const seen = new Map<string, ReconcileMismatch>();
  for (const list of lists) for (const m of list) seen.set(`${m.itemId}:${m.kind}`, m);
  return [...seen.values()];
}

// ---------- unclaimed payouts ----------

/** Follow-up nudges, in hours since the item became UNCLAIMED: 1, 3, 7, 14, 21 days. */
export const NUDGE_SCHEDULE_HOURS = [24, 72, 168, 336, 504] as const;
/** Never nudge the same person twice within this gap, whatever the schedule says. */
export const MIN_NUDGE_GAP_HOURS = 20;
/** PayPal returns unclaimed payout items to the sender 30 days after the payout. */
export const PAYPAL_AUTO_RETURN_DAYS = 30;
/** Organizers get a heads-up with this many days elapsed (5 days before auto-return). */
export const ORGANIZER_ALERT_DAY = 25;

export type UnclaimedAction =
  | { action: 'renotify'; itemId: string; nudgeNumber: number; idempotencyKey: string }
  | { action: 'escalate'; itemId: string; deadline: string; idempotencyKey: string };

export function decideUnclaimed(item: UnclaimedItem, now: Date): UnclaimedAction[] {
  const t = now.getTime();
  const since = Date.parse(item.unclaimedSince);
  const created = Date.parse(item.payoutCreatedAt);
  if (!Number.isFinite(since) || !Number.isFinite(created)) return [];
  const deadlineMs = created + PAYPAL_AUTO_RETURN_DAYS * DAY;
  if (t >= deadlineMs) return []; // PayPal has (or is about to have) returned it; reconcile/webhook will show RETURNED.

  const actions: UnclaimedAction[] = [];
  const ageHours = (t - since) / HOUR;
  const due = NUDGE_SCHEDULE_HOURS.filter((h) => ageHours >= h).length;
  const lastNudge = item.lastNudgeAt ? Date.parse(item.lastNudgeAt) : Number.NaN;
  const gapOk = !Number.isFinite(lastNudge) || t - lastNudge >= MIN_NUDGE_GAP_HOURS * HOUR;
  if (item.nudgeCount < due && gapOk) {
    const nudgeNumber = item.nudgeCount + 1;
    actions.push({ action: 'renotify', itemId: item.itemId, nudgeNumber, idempotencyKey: `renotify:${item.itemId}:${nudgeNumber}` });
  }
  if (t - created >= ORGANIZER_ALERT_DAY * DAY && !item.organizerAlertedAt) {
    actions.push({
      action: 'escalate',
      itemId: item.itemId,
      deadline: new Date(deadlineMs).toISOString(),
      idempotencyKey: `unclaimed_day25:${item.itemId}`,
    });
  }
  return actions;
}

// ---------- scheduler ----------

export type TaskName = 'nightlyReconcile' | 'unclaimedSweep' | 'refreshReport' | 'nightlyDemoReset';
export interface DueJob {
  task: TaskName;
  input: unknown[];
  /** Render dedupes startTask calls with the same key for 24 h, so every cron tick can safely re-dispatch. */
  idempotencyKey: string;
}

/**
 * Jobs due at `now`. The cron ticks every 10–15 min; hourly/daily jobs are keyed by hour/day, so
 * only the first tick in each period starts a run and a late or missed tick is self-healing.
 */
export function dueJobs(now: Date, opts: { reconcileHourUtc: number; reportEveryNPayouts: number; demoResetHourUtc?: number | null }): DueJob[] {
  const iso = now.toISOString();
  const day = iso.slice(0, 10); // YYYY-MM-DD
  const hour = iso.slice(0, 13); // YYYY-MM-DDTHH
  const jobs: DueJob[] = [
    { task: 'unclaimedSweep', input: [], idempotencyKey: `unclaimed:${hour}` },
    {
      task: 'refreshReport',
      input: [{ minNewPayouts: opts.reportEveryNPayouts, force: false, reason: 'schedule' }],
      idempotencyKey: `report:${hour}`,
    },
  ];
  if (now.getUTCHours() === opts.reconcileHourUtc) {
    jobs.unshift({ task: 'nightlyReconcile', input: [], idempotencyKey: `reconcile:${day}` });
  }
  // The hosted demo (DEMO_MODE) starts each day from a clean seed; only when DEMO_RESET_HOUR_UTC is set.
  if (opts.demoResetHourUtc != null && now.getUTCHours() === opts.demoResetHourUtc) {
    jobs.push({ task: 'nightlyDemoReset', input: [], idempotencyKey: `demo-reset:${day}` });
  }
  return jobs;
}
