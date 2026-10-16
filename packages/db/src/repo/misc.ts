/** Donations, webhook events, notifications and the report query. */
import { and, asc, eq, gte, inArray, lt, or, type SQL } from 'drizzle-orm';
import {
  Donation,
  type DonationSource,
  type Lang,
  type MessageKey,
  type ReportInput,
  type RequestStatus,
  type Wallet,
  type PayoutItemStatus,
} from '@neighborline/core';
import type { Executor } from '../client.js';
import { donations, notifications, payoutItems, requests, webhookEvents } from '../schema.js';
import { RepoError, inTx, iso, isoOrNull, newId } from '../util.js';
import { appendAudit } from './audit.js';

// ---------- Webhook events ----------

/** Insert a PayPal webhook event. Returns false if this event id was already recorded (dedupe). */
export async function recordWebhookEvent(
  ex: Executor,
  ev: { id: string; eventType: string; resourceId?: string | null; verified: boolean; raw: unknown },
): Promise<boolean> {
  const inserted = await ex
    .insert(webhookEvents)
    .values({ id: ev.id, eventType: ev.eventType, resourceId: ev.resourceId ?? null, verified: ev.verified, raw: ev.raw })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  return inserted.length > 0;
}

/**
 * At-least-once webhook processing. Records the event (first delivery) and says what to do:
 *   'new'   first delivery: apply it, then markWebhookProcessed
 *   'retry' seen before but never marked processed (the apply crashed or threw): apply it again
 *   'done'  already applied: acknowledge and do nothing
 * Applying twice is safe because every effect is idempotent (the payout item state machine never
 * regresses and a status applied twice is a no-op; donations dedupe on order/transaction id). What must
 * never happen is the opposite: an event acknowledged to PayPal but never applied.
 */
export async function beginWebhookEvent(
  ex: Executor,
  ev: { id: string; eventType: string; resourceId?: string | null; verified: boolean; raw: unknown },
): Promise<'new' | 'retry' | 'done'> {
  if (await recordWebhookEvent(ex, ev)) return 'new';
  const [row] = await ex.select({ processedAt: webhookEvents.processedAt }).from(webhookEvents).where(eq(webhookEvents.id, ev.id));
  return row?.processedAt ? 'done' : 'retry';
}

export async function markWebhookProcessed(ex: Executor, id: string, at = new Date()): Promise<void> {
  await ex.update(webhookEvents).set({ processedAt: at }).where(eq(webhookEvents.id, id));
}

export async function listWebhookEvents(ex: Executor, opts: { limit?: number } = {}) {
  const rows = await ex.select().from(webhookEvents).orderBy(asc(webhookEvents.receivedAt)).limit(opts.limit ?? 500);
  return rows.map((r) => ({ ...r, receivedAt: iso(r.receivedAt), processedAt: isoOrNull(r.processedAt) }));
}

// ---------- Donations ----------

type DonationRow = typeof donations.$inferSelect;
const toDonation = (r: DonationRow): Donation => ({
  id: r.id,
  groupId: r.groupId,
  amountCents: r.amountCents,
  source: r.source as DonationSource,
  donorKey: r.donorKey,
  paypalOrderId: r.paypalOrderId,
  paypalSubscriptionId: r.paypalSubscriptionId,
  transactionId: r.transactionId,
  status: r.status as Donation['status'],
  createdAt: iso(r.createdAt),
});

export type NewDonation = Pick<Donation, 'groupId' | 'amountCents' | 'source'> &
  Partial<Omit<Donation, 'groupId' | 'amountCents' | 'source'>>;

/** Idempotent on PayPal order id / capture transaction id (double capture callbacks are harmless). */
export async function recordDonation(ex: Executor, input: NewDonation): Promise<{ donation: Donation; created: boolean }> {
  const d = Donation.parse({
    donorKey: null,
    paypalOrderId: null,
    paypalSubscriptionId: null,
    transactionId: null,
    status: 'COMPLETED',
    ...input,
    id: input.id ?? newId('don'),
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  return inTx(ex, async (tx) => {
    const inserted = await tx
      .insert(donations)
      .values({ ...d, createdAt: new Date(d.createdAt) })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      await appendAudit(tx, {
        actor: 'paypal',
        action: 'donation.recorded',
        entityType: 'donation',
        entityId: d.id,
        data: { amountCents: d.amountCents, source: d.source, transactionId: d.transactionId },
        at: new Date(d.createdAt),
      });
      return { donation: toDonation(inserted[0]), created: true };
    }
    const keys: SQL[] = [eq(donations.id, d.id)];
    if (d.paypalOrderId) keys.push(eq(donations.paypalOrderId, d.paypalOrderId));
    if (d.transactionId) keys.push(eq(donations.transactionId, d.transactionId));
    const [existing] = await tx.select().from(donations).where(or(...keys));
    if (!existing) throw new RepoError('CONFLICT', 'donation conflict without a matching row');
    return { donation: toDonation(existing), created: false };
  });
}

export async function listDonations(ex: Executor, groupId: string): Promise<Donation[]> {
  const rows = await ex.select().from(donations).where(eq(donations.groupId, groupId)).orderBy(asc(donations.createdAt));
  return rows.map(toDonation);
}

// ---------- Notifications ----------

export interface NotificationRecord {
  id: string;
  requestId: string;
  channel: string;
  lang: Lang;
  messageKey: MessageKey;
  text: string;
  status: 'queued' | 'sent' | 'failed';
  createdAt: string;
  sentAt: string | null;
}

const toNotification = (r: typeof notifications.$inferSelect): NotificationRecord => ({
  id: r.id,
  requestId: r.requestId,
  channel: r.channel,
  lang: r.lang as Lang,
  messageKey: r.messageKey as MessageKey,
  text: r.text,
  status: r.status,
  createdAt: iso(r.createdAt),
  sentAt: isoOrNull(r.sentAt),
});

export async function recordNotification(
  ex: Executor,
  input: { requestId: string; channel: string; lang: Lang; messageKey: MessageKey; text: string; status?: 'queued' | 'sent' | 'failed' },
): Promise<NotificationRecord> {
  const status = input.status ?? 'queued';
  const [row] = await ex
    .insert(notifications)
    .values({ id: newId('ntf'), ...input, status, sentAt: status === 'sent' ? new Date() : null })
    .returning();
  return toNotification(row as typeof notifications.$inferSelect);
}

export async function markNotification(ex: Executor, id: string, status: 'sent' | 'failed'): Promise<void> {
  await ex
    .update(notifications)
    .set({ status, sentAt: status === 'sent' ? new Date() : null })
    .where(eq(notifications.id, id));
}

export async function listNotifications(ex: Executor, requestId: string): Promise<NotificationRecord[]> {
  const rows = await ex.select().from(notifications).where(eq(notifications.requestId, requestId)).orderBy(asc(notifications.createdAt));
  return rows.map(toNotification);
}

// ---------- Report ----------

/** Rows for core buildReport(). Household key = normalized destination, else phone. */
export async function listForReport(
  ex: Executor,
  groupId: string,
  period: { from?: string; to?: string } = {},
): Promise<ReportInput> {
  const reqConds: SQL[] = [eq(requests.groupId, groupId)];
  if (period.from) reqConds.push(gte(requests.createdAt, new Date(period.from)));
  if (period.to) reqConds.push(lt(requests.createdAt, new Date(period.to)));
  const reqRows = await ex.select().from(requests).where(and(...reqConds));
  const ids = reqRows.map((r) => r.id);
  const itemRows = ids.length ? await ex.select().from(payoutItems).where(inArray(payoutItems.requestId, ids)) : [];

  const donConds: SQL[] = [eq(donations.groupId, groupId), eq(donations.status, 'COMPLETED')];
  if (period.from) donConds.push(gte(donations.createdAt, new Date(period.from)));
  if (period.to) donConds.push(lt(donations.createdAt, new Date(period.to)));
  const donRows = await ex.select().from(donations).where(and(...donConds));

  return {
    requests: reqRows.map((r) => ({
      id: r.id,
      lang: r.lang,
      ruleKey: r.ruleKey,
      createdAt: iso(r.createdAt),
      status: r.status as RequestStatus,
      householdKey: r.destinationKey ?? (r.phoneKey ? `PHONE:${r.phoneKey}` : null),
    })),
    items: itemRows.map((i) => ({
      requestId: i.requestId,
      amountCents: i.amountCents,
      wallet: i.wallet as Wallet,
      status: i.status as PayoutItemStatus,
      successAt: isoOrNull(i.successAt),
      wasUnclaimed: i.wasUnclaimed,
      transactionId: i.transactionId,
    })),
    donations: donRows.map((d) => ({
      amountCents: d.amountCents,
      at: iso(d.createdAt),
      source: d.source,
      donorKey: d.donorKey,
      transactionId: d.transactionId,
    })),
    ...(period.from || period.to ? { period } : {}),
  };
}
