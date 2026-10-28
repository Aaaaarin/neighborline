/**
 * Background jobs behind POST /api/internal/* (called by Render Workflows, contract in
 * workflows/src/contract.ts). Every operation is idempotent: the workflow retries on network errors,
 * 408/425/429 and 5xx.
 *
 * Durable state lives in the hash-chained audit log (append-only by trigger), not in new tables:
 *   reconcile.window       one row per window idempotency key
 *   unclaimed.renotify     one row per follow-up (dedupe on idempotencyKey)
 *   organizer.alert        one row per alert key; read back for /organizer and /ledger
 *   report.generated       one row per stored report version
 * None of this can move money: these routes run in the web process, which has no Payouts client.
 */
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { redactDeep, redactPII, type PayoutItemStatus } from '@neighborline/core';
import { appendAudit, auditLog, donations, getRequest, listItems, payoutItems, recordNotification, type Db } from '@neighborline/db';
import { isReportingNotReady, reconcile as reconcileItems } from '@neighborline/paypal';
import { notifyKeyFor } from '@neighborline/agents';
import type {
  OrganizerAlertRequest,
  OrganizerAlertResponse,
  ReconcileMismatch,
  ReconcileRequest,
  ReconcileResponse,
  RenotifyRequest,
  RenotifyResponse,
  ReportRefreshRequest,
  ReportRefreshResponse,
  UnclaimedItem,
  UnclaimedSweepRequest,
  UnclaimedSweepResponse,
} from '../internal-contract';
import type { ReportView } from '../../types';
import { HttpError } from '../errors';
import { log } from '../log';
import type { BaseCtx } from './context';
import { nowIso } from './events';
import { recordRun, type ReconcileCache } from './ledger';
import { buildReportView } from './report';

type AuditRow = typeof auditLog.$inferSelect;

/** Append an audit row unless one with the same action + key exists (serialized by the audit table lock). */
export async function appendOnce(db: Db, action: string, key: string, row: { actor: string; entityType: string; entityId: string; data: Record<string, unknown> }): Promise<{ created: boolean; row: AuditRow }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${auditLog} IN SHARE ROW EXCLUSIVE MODE`);
    const [existing] = await tx
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, action), sql`${auditLog.data}->>'idempotencyKey' = ${key}`))
      .limit(1);
    if (existing) return { created: false, row: existing };
    const e = await appendAudit(tx, { ...row, action, data: { ...row.data, idempotencyKey: key } });
    const [inserted] = await tx.select().from(auditLog).where(eq(auditLog.seq, e.seq));
    return { created: true, row: inserted! };
  });
}

async function auditRows(db: Db, action: string): Promise<AuditRow[]> {
  return db.select().from(auditLog).where(eq(auditLog.action, action)).orderBy(asc(auditLog.seq));
}

const isSeeded = (paypalItemId: string | null | undefined) => !!paypalItemId?.startsWith('SEEDITEM');

/* ---------------- reconcile ---------------- */

export async function reconcileWindow(ctx: BaseCtx, cache: ReconcileCache, req: ReconcileRequest): Promise<ReconcileResponse> {
  const start = new Date(req.startDate);
  const end = new Date(req.endDate);
  if (!(start < end)) throw new HttpError(400, 'startDate must be before endDate');
  if (end.getTime() - start.getTime() > 31 * 86_400_000) throw new HttpError(400, 'window longer than 31 days');
  const rows = await ctx.db
    .select()
    .from(payoutItems)
    .where(and(gte(payoutItems.createdAt, start), lt(payoutItems.createdAt, end)))
    .orderBy(asc(payoutItems.createdAt));
  const local = rows.filter((r) => !isSeeded(r.paypalItemId));
  let txns;
  try {
    txns = await ctx.paypal.reporting.searchTransactions({ startDate: start, endDate: end });
  } catch (err) {
    if (isReportingNotReady(err)) {
      // Reporting lag (a brand-new account): every item in the window is pending, nothing is a mismatch. Not a failure, so no retry storm.
      log.info('internal.reconcile.reporting_not_ready', { window: `${start.toISOString()}/${end.toISOString()}`, items: local.length });
      return { window: { startDate: start.toISOString(), endDate: end.toISOString() }, checked: local.length, matched: 0, mismatches: [], pendingLag: local.map((r) => ({ itemId: r.id, paidAt: r.createdAt.toISOString() })), fetchedTransactions: 0, reportingNotReady: true };
    }
    log.warn('internal.reconcile.paypal_failed', { error: err instanceof Error ? err.message : String(err) });
    throw new HttpError(502, 'PayPal Transaction Search failed');
  }
  const lagMs = Math.max(0, req.lagHours) * 3_600_000;
  const report = reconcileItems(
    local.map((r) => ({ id: r.id, amountCents: r.amountCents, status: r.status as PayoutItemStatus, transactionId: r.transactionId ?? undefined, lastEventAt: r.createdAt.toISOString() })),
    txns,
    { asOf: end, lagMs },
  );
  const byId = new Map(local.map((r) => [r.id, r]));
  const knownTx = new Set((await listItems(ctx.db)).map((i) => i.transactionId).filter(Boolean));
  const mismatches: ReconcileMismatch[] = [];
  const localOf = (id: string) => {
    const r = byId.get(id)!;
    return { senderItemId: r.senderItemId, ...(r.paypalItemId ? { paypalItemId: r.paypalItemId } : {}), ...(r.transactionId ? { transactionId: r.transactionId } : {}), local: { status: r.status as PayoutItemStatus, amountCents: r.amountCents } };
  };
  for (const m of report.amountMismatch) mismatches.push({ itemId: m.local.id, kind: 'amount_mismatch', ...localOf(m.local.id), paypal: { status: m.paypal.status, amountCents: Math.abs(m.paypal.amountCents) } });
  for (const m of report.currencyMismatch) mismatches.push({ itemId: m.local.id, kind: 'amount_mismatch', ...localOf(m.local.id), paypal: { status: m.paypal.status, amountCents: Math.abs(m.paypal.amountCents) } });
  for (const d of report.statusDrift) mismatches.push({ itemId: d.local.id, kind: 'status_mismatch', ...localOf(d.local.id), paypal: { status: d.paypal.status, amountCents: Math.abs(d.paypal.amountCents) } });
  for (const l of report.stuckPending) mismatches.push({ itemId: l.id, kind: 'status_mismatch', ...localOf(l.id) });
  for (const l of report.missingAtPayPal) mismatches.push({ itemId: l.id, kind: 'missing_at_paypal', ...localOf(l.id) });
  for (const t of report.missingLocally) {
    if (knownTx.has(t.transactionId)) continue; // ours, created outside this window
    mismatches.push({ itemId: `paypal:${t.transactionId}`, kind: 'unknown_at_paypal', transactionId: t.transactionId, paypal: { status: t.status, amountCents: Math.abs(t.amountCents) } });
  }
  // Items without a transaction id yet that are inside the lag window are pending, not mismatches.
  const pendingLag = [...report.pendingLag, ...report.noTransactionId.filter((l) => end.getTime() - Date.parse(l.lastEventAt ?? '') < Math.max(lagMs, 3_600_000))].map((l) => ({
    itemId: l.id,
    paidAt: l.lastEventAt ?? end.toISOString(),
  }));
  await recordRun(ctx, cache, report, { start, end }, 'workflow');
  for (const p of pendingLag) if (!cache.states.has(p.itemId) || cache.states.get(p.itemId) === 'pending') cache.states.set(p.itemId, 'pending');
  const out: ReconcileResponse = {
    window: { startDate: start.toISOString(), endDate: end.toISOString() },
    checked: local.length,
    matched: report.matched.length,
    mismatches,
    pendingLag,
    fetchedTransactions: txns.length,
  };
  await appendOnce(ctx.db, 'reconcile.window', req.idempotencyKey, {
    actor: 'workflow',
    entityType: 'reconcile',
    entityId: req.idempotencyKey,
    data: { window: out.window, checked: out.checked, matched: out.matched, mismatches: mismatches.length, pendingLag: pendingLag.length },
  });
  return out;
}

/* ---------------- unclaimed follow-ups ---------------- */

export async function unclaimedSweep(ctx: BaseCtx, req: UnclaimedSweepRequest): Promise<UnclaimedSweepResponse> {
  const now = new Date(req.now);
  const at = Number.isNaN(now.getTime()) ? new Date() : now;
  const rows = await ctx.db.select().from(payoutItems).where(eq(payoutItems.status, 'UNCLAIMED')).orderBy(asc(payoutItems.createdAt));
  if (!rows.length) return { items: [] };
  const ids = rows.map((r) => r.id);
  const statusRows = await ctx.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, 'payout.item_status'), inArray(auditLog.entityId, ids)))
    .orderBy(asc(auditLog.seq));
  const nudges = await auditRows(ctx.db, 'unclaimed.renotify');
  const alerts = await auditRows(ctx.db, 'organizer.alert');
  const items: UnclaimedItem[] = [];
  for (const r of rows) {
    const since = statusRows.filter((s) => s.entityId === r.id && s.data.to === 'UNCLAIMED').at(-1)?.at ?? r.lastEventAt;
    if (at.getTime() - since.getTime() < req.minAgeHours * 3_600_000) continue;
    const req2 = await getRequest(ctx.db, r.requestId);
    const mine = nudges.filter((n) => n.entityId === r.id);
    const alerted = alerts.find((a) => a.data.kind === 'unclaimed_day25' && Array.isArray(a.data.itemIds) && (a.data.itemIds as string[]).includes(r.id));
    items.push({
      itemId: r.id,
      requestId: r.requestId,
      lang: req2?.lang ?? 'en',
      wallet: r.wallet as 'PAYPAL' | 'VENMO',
      amountCents: r.amountCents,
      payoutCreatedAt: r.createdAt.toISOString(),
      unclaimedSince: since.toISOString(),
      nudgeCount: mine.length,
      lastNudgeAt: mine.at(-1)?.at.toISOString() ?? null,
      organizerAlertedAt: alerted?.at.toISOString() ?? null,
    });
  }
  return { items };
}

export async function renotifyUnclaimed(ctx: BaseCtx, req: RenotifyRequest): Promise<RenotifyResponse> {
  const [row] = await ctx.db.select().from(payoutItems).where(eq(payoutItems.id, req.itemId));
  if (!row) throw new HttpError(404, 'No such payout item');
  const [dup] = await ctx.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, 'unclaimed.renotify'), sql`${auditLog.data}->>'idempotencyKey' = ${req.idempotencyKey}`))
    .limit(1);
  if (dup) return { sent: false, skippedReason: 'duplicate', lang: String(dup.data.lang ?? ''), channel: String(dup.data.channel ?? ''), ...(dup.data.notificationId ? { notificationId: String(dup.data.notificationId) } : {}) };
  if (row.status !== 'UNCLAIMED') return { sent: false, skippedReason: 'no_longer_unclaimed' };
  const r = await getRequest(ctx.db, row.requestId);
  if (!r) return { sent: false, skippedReason: 'no_contact_channel' };
  const key = notifyKeyFor({ itemStatus: 'UNCLAIMED' }) ?? 'unclaimed_help';
  const n = await ctx.agents.notify.render({ key, lang: r.lang, amountCents: row.amountCents, wallet: row.wallet as 'PAYPAL' | 'VENMO', addressForm: r.extracted?.addressForm });
  const channel = r.channel === 'sms' ? 'sms' : 'whatsapp';
  // Record first under the key (so a retry after this point cannot send twice), then send.
  const { created } = await appendOnce(ctx.db, 'unclaimed.renotify', req.idempotencyKey, {
    actor: 'workflow',
    entityType: 'payout_item',
    entityId: row.id,
    data: { nudgeNumber: req.nudgeNumber, lang: r.lang, channel },
  });
  if (!created) return { sent: false, skippedReason: 'duplicate', lang: r.lang, channel };
  const rec = await recordNotification(ctx.db, { requestId: r.id, channel, lang: r.lang, messageKey: key, text: n.text, status: 'sent' });
  ctx.meta.message(r.id, { from: 'line', kind: 'claim_help', lang: r.lang, text: n.text, textEn: n.textEn, meta: { channel, amountCents: row.amountCents, wallet: row.wallet as 'PAYPAL' | 'VENMO' } });
  if (ctx.outbound && r.contact?.phone) {
    await ctx.outbound.notify({ id: rec.id, requestId: r.id, key, lang: r.lang, text: n.text, textEn: n.textEn, phone: r.contact.phone, ...(r.extracted?.addressForm ? { addressForm: r.extracted.addressForm } : {}) }).catch(() => undefined);
  }
  ctx.bus.emit({ type: 'notify.sent', at: nowIso(), requestId: r.id, lang: r.lang, text: n.text, channel }, [r.id]);
  return { sent: true, lang: r.lang, channel, notificationId: rec.id };
}

/* ---------------- organizer alerts ---------------- */

export async function organizerAlert(ctx: BaseCtx, req: OrganizerAlertRequest): Promise<OrganizerAlertResponse> {
  const alertId = `al_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const raw = req.detail === undefined ? undefined : JSON.stringify(req.detail);
  const detail = raw === undefined ? undefined : raw.length <= 4000 ? redactDeep(JSON.parse(raw) as unknown) : { truncated: true };
  const { created, row } = await appendOnce(ctx.db, 'organizer.alert', req.idempotencyKey, {
    actor: 'workflow',
    entityType: 'organizer_alert',
    entityId: alertId,
    data: { kind: req.kind, itemIds: req.itemIds, summary: redactPII(req.summary.slice(0, 300)), ...(req.deadline ? { deadline: req.deadline } : {}), ...(detail !== undefined ? { detail } : {}) },
  });
  return { alertId: row.entityId, created, channels: ['organizer_queue', 'ledger'] };
}

/* ---------------- report versions ---------------- */

export interface ReportStore {
  latest: { version: number; view: ReportView; totalPayouts: number; donations?: number } | null;
}

async function totalDonations(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(donations).where(eq(donations.status, 'COMPLETED'));
  return Number(row?.n ?? 0);
}

async function totalPayouts(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(payoutItems).where(eq(payoutItems.status, 'SUCCESS'));
  return Number(row?.n ?? 0);
}

export async function reportRefresh(ctx: BaseCtx, store: ReportStore, req: ReportRefreshRequest): Promise<ReportRefreshResponse> {
  const total = await totalPayouts(ctx.db);
  const versions = await auditRows(ctx.db, 'report.generated');
  const last = versions.at(-1);
  const sinceLast = total - Number(last?.data.totalPayouts ?? 0);
  if (!req.force && last && sinceLast < req.minNewPayouts) return { regenerated: false, skippedReason: 'not_due', newPayoutsSinceLast: sinceLast, totalPayouts: total };
  const view = await buildReportView(ctx);
  const version = versions.length + 1;
  const narrativeSource: 'llm' | 'template' = /template/i.test(view.narrative.writtenBy) ? 'template' : 'llm';
  await ctx.db.transaction(async (tx) => {
    await appendAudit(tx, { actor: 'workflow', action: 'report.generated', entityType: 'report', entityId: `v${version}`, data: { version, totalPayouts: total, reason: req.reason, narrativeSource, generatedAt: view.generatedAt } });
  });
  store.latest = { version, view, totalPayouts: total, donations: await totalDonations(ctx.db) };
  return { regenerated: true, newPayoutsSinceLast: sinceLast, totalPayouts: total, reportVersion: version, generatedAt: view.generatedAt, narrativeSource };
}

/**
 * /report: the stored version while nothing new was paid or given and its window still ends today; otherwise a
 * fresh build (not stored as a version), so /report never lags the ledger's window (totals.ts).
 */
export async function currentReport(ctx: BaseCtx, store: ReportStore): Promise<ReportView> {
  const today = new Date().toISOString().slice(0, 10);
  const l = store.latest;
  if (l && l.view.period.to === today && l.totalPayouts === (await totalPayouts(ctx.db)) && l.donations === (await totalDonations(ctx.db))) return l.view;
  return buildReportView(ctx);
}
