/**
 * Unclaimed-payout follow-up (hourly).
 *
 * PayPal/Venmo payouts to someone without an account (or with an unconfirmed one) sit UNCLAIMED and are
 * returned to the sender 30 days later. Neighbors who don't read English are the most likely to miss the
 * claim email, so the agent follows up in their language on a fixed schedule (1, 3, 7, 14, 21 days)
 * and, on day 25, asks the organizers to step in before the money bounces back.
 *
 *   unclaimedSweep
 *     ├─ renotifyUnclaimed × k   (one run per item due a nudge; app renders the vetted template in item.lang)
 *     └─ alertOrganizers × m     (one per item at day 25)
 */
import { task, type TaskContext } from '@renderinc/sdk/workflows';
import {
  ENDPOINTS,
  type RenotifyRequest,
  type RenotifyResponse,
  type UnclaimedItem,
  type UnclaimedSweepRequest,
  type UnclaimedSweepResponse,
} from '../contract.js';
import { NUDGE_SCHEDULE_HOURS, ORGANIZER_ALERT_DAY, decideUnclaimed, type UnclaimedAction } from '../policy.js';
import { alertOrganizers } from './alerts.js';
import { connect, log } from './shared.js';

export const renotifyUnclaimed = task(
  {
    name: 'renotifyUnclaimed',
    retry: { maxRetries: 4, waitDurationMs: 15_000, backoffScaling: 2 },
    timeoutSeconds: 300,
  },
  async function renotifyUnclaimed(_ctx: TaskContext, req: RenotifyRequest): Promise<RenotifyResponse> {
    const { api } = connect();
    const res = await api.post<RenotifyRequest, RenotifyResponse>(ENDPOINTS.renotify, req);
    log('renotify', { itemId: req.itemId, nudge: req.nudgeNumber, sent: res.sent, lang: res.lang, skipped: res.skippedReason });
    return res;
  },
);

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function escalationSummary(item: UnclaimedItem, deadline: string): string {
  const wallet = item.wallet === 'VENMO' ? 'Venmo' : 'PayPal';
  return (
    `${usd(item.amountCents)} ${wallet} payout for request ${item.requestId} is still unclaimed after ${ORGANIZER_ALERT_DAY} days ` +
    `(${item.nudgeCount} follow-up(s) sent in ${item.lang}). PayPal returns it on ${deadline}. ` +
    `Please reach the neighbor directly, or cancel the item and re-send to a destination they can use.`
  );
}

export interface UnclaimedSweepSummary {
  unclaimed: number;
  renotified: number;
  skipped: number;
  escalated: number;
  deferred: number;
  failed: number;
}

export const unclaimedSweep = task(
  {
    name: 'unclaimedSweep',
    retry: { maxRetries: 2, waitDurationMs: 60_000, backoffScaling: 2 },
    timeoutSeconds: 1800,
  },
  async function unclaimedSweep(ctx: TaskContext): Promise<UnclaimedSweepSummary> {
    const { cfg, api } = connect();
    const now = new Date();
    const { items } = await api.post<UnclaimedSweepRequest, UnclaimedSweepResponse>(ENDPOINTS.unclaimedSweep, {
      now: now.toISOString(),
      minAgeHours: NUDGE_SCHEDULE_HOURS[0],
    });
    const byId = new Map(items.map((i) => [i.itemId, i]));

    // Escalations first: they are the time-critical ones if we hit the fan-out cap.
    const all = items.flatMap((i) => decideUnclaimed(i, now));
    all.sort((a, b) => (a.action === b.action ? 0 : a.action === 'escalate' ? -1 : 1));
    const actions = all.slice(0, cfg.maxFanout);

    const settled = await Promise.allSettled(
      actions.map((a: UnclaimedAction) => {
        if (a.action === 'renotify') {
          return ctx.run(renotifyUnclaimed, { itemId: a.itemId, nudgeNumber: a.nudgeNumber, idempotencyKey: a.idempotencyKey });
        }
        const item = byId.get(a.itemId)!;
        return ctx.run(alertOrganizers, {
          kind: 'unclaimed_day25',
          idempotencyKey: a.idempotencyKey,
          itemIds: [a.itemId],
          deadline: a.deadline,
          summary: escalationSummary(item, a.deadline),
        });
      }),
    );

    const summary: UnclaimedSweepSummary = { unclaimed: items.length, renotified: 0, skipped: 0, escalated: 0, deferred: all.length - actions.length, failed: 0 };
    const failures: string[] = [];
    settled.forEach((r, i) => {
      const a = actions[i]!;
      if (r.status === 'rejected') {
        summary.failed++;
        failures.push(`${a.action} ${a.itemId}: ${String(r.reason)}`);
      } else if (a.action === 'escalate') {
        summary.escalated++;
      } else if ((r.value as RenotifyResponse).sent) {
        summary.renotified++;
      } else {
        summary.skipped++;
      }
    });
    log('unclaimed_sweep_done', { ...summary });
    // Fail the run so it is red in the dashboard; re-running is safe (children dedupe on idempotency keys).
    if (failures.length > 0) throw new Error(`unclaimedSweep: ${failures.length} follow-up(s) failed after retries:\n${failures.join('\n')}`);
    return summary;
  },
);
