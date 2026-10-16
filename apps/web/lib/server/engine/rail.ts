/**
 * Web side of the payout rails (apps/approver/src/rails.ts). This server moves no money on either
 * rail; it keeps the group's fallback setting, alerts organizers when PayPal refuses a payout at the
 * account level, and forwards a signed-in organizer's manual record to the approver, which re-verifies
 * the approval's two passkey signatures before it records anything.
 *
 * State lives in the append-only audit log:
 *   group.rail_fallback       { manualFallback } per change, newest wins (RAIL_FALLBACK_ACTION)
 *   organizer.alert           kind rail_unavailable, one per refused batch (key rail_unavailable:<batchId>)
 *   approver.manual_recorded  written by the approver when a hand-over is recorded
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { redactPII } from '@neighborline/core';
import type { RecordManualResponse } from '@neighborline/approver/protocol';
import { appendAudit, auditLog, getBatch, payoutBatches, type Db } from '@neighborline/db';
import type { ManualRecordView, OrganizerAlert, RailSettingsView } from '../../types';
import type { ApproverRefusal } from '../approver-client';
import { HttpError } from '../errors';
import { log } from '../log';
import type { BaseCtx, Ctx } from './context';
import { nowIso } from './events';
import { appendOnce } from './internal';

/**
 * = RAIL_FALLBACK_ACTION in @neighborline/approver/protocol (the approver reads the same rows). Kept as a
 * literal so views (and the intake path through them) never import the approval client; a test pins it.
 */
export const RAIL_FALLBACK_ACTION = 'group.rail_fallback';

export async function railSettings(db: Db, groupId: string): Promise<RailSettingsView> {
  const [row] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, RAIL_FALLBACK_ACTION), eq(auditLog.entityId, groupId)))
    .orderBy(desc(auditLog.seq))
    .limit(1);
  return {
    primary: 'paypal_payouts',
    manualFallback: row?.data.manualFallback === true,
    ...(row ? { updatedBy: row.actor, updatedAt: row.at.toISOString() } : {}),
  };
}

/** A signed-in organizer turns the fallback on or off (audited; the approver reads the same row). */
export async function setManualFallback(ctx: BaseCtx, input: { enabled: boolean; organizerId: string }): Promise<RailSettingsView> {
  await appendAudit(ctx.db, { actor: input.organizerId, action: RAIL_FALLBACK_ACTION, entityType: 'group', entityId: ctx.gen.group.id, data: { manualFallback: input.enabled } });
  return railSettings(ctx.db, ctx.gen.group.id);
}

/** PayPal refused at the account level: one organizer alert per refused batch, offering the manual path. */
export async function alertRailUnavailable(ctx: BaseCtx, refusal: ApproverRefusal): Promise<void> {
  const batchId = refusal.extra.batchId;
  if (!batchId) return;
  const bw = await getBatch(ctx.db, batchId);
  const total = bw?.items.reduce((t, i) => t + i.amountCents, 0) ?? 0;
  const settings = await railSettings(ctx.db, ctx.gen.group.id);
  const summary =
    `PayPal refused a $${(total / 100).toFixed(2)} payout because of the sponsor's account (${refusal.extra.railReason ?? 'account-level error'}). Nothing was sent. ` +
    (settings.manualFallback
      ? 'Manual recording is on: hand the money over another way (cash, a sponsor check) and record it here.'
      : 'Retry once PayPal clears the account, or turn on manual recording below to record a cash or check hand-over.');
  const { created } = await appendOnce(ctx.db, 'organizer.alert', `rail_unavailable:${batchId}`, {
    actor: 'approval-service',
    entityType: 'organizer_alert',
    entityId: `al_rail_${batchId}`,
    data: { kind: 'rail_unavailable', itemIds: bw?.items.map((i) => i.id) ?? [], batchId, summary: redactPII(summary), reason: refusal.extra.railReason ?? null },
  });
  if (created) log.warn('rail.unavailable', { batchId, reason: refusal.extra.railReason });
}

/** Hand-overs recorded on the manual rail, by batch id (for the ledger, the report and the alerts). */
export async function manualRecords(db: Db, batchIds?: readonly string[]): Promise<Map<string, ManualRecordView>> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(batchIds ? and(eq(auditLog.action, 'approver.manual_recorded'), inArray(auditLog.entityId, [...batchIds, '__none__'])) : eq(auditLog.action, 'approver.manual_recorded'));
  const out = new Map<string, ManualRecordView>();
  for (const r of rows) {
    out.set(r.entityId, {
      method: (r.data.method as ManualRecordView['method']) ?? 'other',
      reference: String(r.data.reference ?? ''),
      recordedBy: String(r.data.recordedBy ?? ''),
      recordedAt: r.at.toISOString(),
    });
  }
  return out;
}

/** What happened to each refused batch since its alert (recorded by hand, or PayPal took a retry). */
export async function withRailResolution(db: Db, alerts: OrganizerAlert[]): Promise<OrganizerAlert[]> {
  const ids = alerts.filter((a) => a.kind === 'rail_unavailable' && a.batchId).map((a) => a.batchId!);
  if (!ids.length) return alerts;
  const batches = await db.select({ id: payoutBatches.id, status: payoutBatches.status, paypalBatchId: payoutBatches.paypalBatchId }).from(payoutBatches).where(inArray(payoutBatches.id, ids));
  const manual = await manualRecords(db, ids);
  return alerts.map((a) => {
    const b = a.batchId ? batches.find((x) => x.id === a.batchId) : undefined;
    if (!b) return a;
    if (b.status === 'MANUAL') return { ...a, resolved: { how: 'manual' as const, ...(manual.get(b.id) ? { manual: manual.get(b.id)! } : {}) } };
    if (b.paypalBatchId) return { ...a, resolved: { how: 'paypal' as const } };
    return a;
  });
}

/** Forward a manual record to the approver (it re-verifies everything), then tell the stage and queue. */
export async function recordManual(ctx: Ctx, input: { batchId: string; organizerId: string; method: 'cash' | 'check' | 'other'; receiptNote: string }): Promise<RecordManualResponse> {
  const bw = await getBatch(ctx.db, input.batchId);
  if (!bw) throw new HttpError(404, 'No such payout batch');
  const res = await ctx.approvals.approver.recordManual(input.batchId, { organizerId: input.organizerId, method: input.method, receiptNote: input.receiptNote });
  if (res.recordedNow) {
    const fresh = (await getBatch(ctx.db, input.batchId)) ?? bw;
    for (const it of fresh.items) {
      ctx.bus.emit({ type: 'payout.item_updated', at: nowIso(), itemId: it.id, requestId: it.requestId, status: it.status }, [it.requestId]);
    }
  }
  return res;
}
