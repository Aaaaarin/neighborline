/**
 * Payouts v1: create batch, get batch (paged), get item, cancel unclaimed item — plus the async lifecycle
 * (PENDING → PROCESSING → items final → SUCCESS) with webhooks. Idempotency mirrors PayPal:
 *   - same PayPal-Request-Id  → 201 with the *latest state* of the original batch
 *   - reused sender_batch_id  → 400 USER_BUSINESS_ERROR with a HATEOAS link to the original batch
 */
import { centsToValue, link, valueToCents, type FakeContext } from '../context.js';
import { ppError, validation, type ErrorDetail } from '../errors.js';
import type { Ctx, Reply, Router } from '../http.js';
import { createsTransaction, decideOutcome, errorsFor, ITEM_EVENT_FOR_STATUS } from '../outcomes.js';
import type { BatchRec, BatchStatus, PayoutItemRec, PayoutItemRequest, TransactionStatus } from '../state.js';
import { negativeCreatePayout, negativeGetBatch } from './payouts-negative.js';

const API = 'payments.payouts-batch';
const RECIPIENT_TYPES = new Set(['EMAIL', 'PHONE', 'PAYPAL_ID', 'USER_HANDLE']);
const WALLETS = new Set(['PAYPAL', 'VENMO']);
const PURPOSES = new Set(['AWARDS', 'PRIZES', 'DONATIONS', 'GOODS', 'SERVICES', 'REBATES', 'CASHBACK', 'DISCOUNTS', 'NON_GOODS_OR_SERVICES']);
const PRIVACY = new Set(['PUBLIC', 'FRIENDS_ONLY', 'PRIVATE']);

export function registerPayoutRoutes(router: Router, ctx: FakeContext): void {
  router
    .add('POST', '/v1/payments/payouts', (c) => createPayout(ctx, c))
    .add('GET', '/v1/payments/payouts/:id', (c) => getBatch(ctx, c))
    .add('GET', '/v1/payments/payouts-item/:id', (c) => ({ status: 200, body: itemView(ctx, requireItem(ctx, c.params.id!), 'self') }))
    .add('POST', '/v1/payments/payouts-item/:id/cancel', (c) => cancelItem(ctx, c));
}

function createResponse(ctx: FakeContext, b: BatchRec) {
  return {
    batch_header: {
      payout_batch_id: b.payout_batch_id,
      batch_status: b.batch_status,
      time_created: b.time_created,
      sender_batch_header: b.sender_batch_header,
    },
    links: [link(ctx, `/v1/payments/payouts/${b.payout_batch_id}`, 'self')],
  };
}

function validateItems(ctx: FakeContext, header: Record<string, unknown>, items: unknown): ErrorDetail[] {
  if (!Array.isArray(items) || items.length === 0) return [{ field: 'items', location: 'body', issue: 'Items must contain at least one payout item.' }];
  if (items.length > 15_000) return [{ field: 'items', location: 'body', issue: 'A batch can contain at most 15000 items.' }];
  const errs: ErrorDetail[] = [];
  items.forEach((raw, i) => {
    const it = (raw ?? {}) as PayoutItemRequest;
    const f = (name: string) => `items[${i}].${name}`;
    const type = it.recipient_type ?? (header.recipient_type as string | undefined);
    const wallet = (it.recipient_wallet ?? 'PAYPAL').toUpperCase();
    if (!type || !RECIPIENT_TYPES.has(type)) errs.push({ field: f('recipient_type'), location: 'body', issue: 'recipient_type is required and must be EMAIL, PHONE, PAYPAL_ID or USER_HANDLE.' });
    if (type === 'PHONE' && ctx.config.rejectPhoneRecipients) errs.push({ field: f('recipient_type'), location: 'body', issue: 'PHONE recipient_type is not supported in sandbox.' });
    if (!WALLETS.has(wallet)) errs.push({ field: f('recipient_wallet'), location: 'body', issue: 'recipient_wallet must be PAYPAL or VENMO.' });
    if (type === 'USER_HANDLE' && wallet !== 'VENMO') errs.push({ field: f('recipient_type'), location: 'body', issue: 'USER_HANDLE is only supported for VENMO recipients.' });
    if (typeof it.receiver !== 'string' || !it.receiver || it.receiver.length > 127) errs.push({ field: f('receiver'), location: 'body', issue: 'receiver is required (max 127 characters).' });
    const cents = valueToCents(it.amount?.value);
    if (cents === null || cents <= 0) errs.push({ field: f('amount.value'), location: 'body', issue: 'Amount must be a positive decimal string with at most 2 decimals.' });
    if (!it.amount?.currency || !/^[A-Z]{3}$/.test(it.amount.currency)) errs.push({ field: f('amount.currency'), location: 'body', issue: 'Currency must be a 3-letter ISO-4217 code.' });
    if (wallet === 'VENMO' && !it.note?.trim()) errs.push({ field: f('note'), location: 'body', issue: 'Note is required for Venmo payouts.' });
    if (it.purpose !== undefined && !PURPOSES.has(it.purpose)) errs.push({ field: f('purpose'), location: 'body', issue: 'Invalid purpose.' });
    const privacy = it.application_context?.social_feed_privacy;
    if (privacy !== undefined && !PRIVACY.has(privacy)) errs.push({ field: f('application_context.social_feed_privacy'), location: 'body', issue: 'Invalid social_feed_privacy.' });
    if (it.sender_item_id !== undefined && String(it.sender_item_id).length > 63) errs.push({ field: f('sender_item_id'), location: 'body', issue: 'sender_item_id max length is 63.' });
  });
  return errs;
}

/** Observed 2026-10-28: one Venmo item fails the whole batch in the real sandbox, unless its note is the mock POSPYO003. */
function refuseSandboxVenmo(items: PayoutItemRequest[]): void {
  const errs: ErrorDetail[] = [];
  items.forEach((it, i) => {
    if ((it.recipient_wallet ?? 'PAYPAL').toUpperCase() === 'VENMO' && it.note?.trim() !== 'POSPYO003') {
      errs.push({ field: `items[${i}].recipient_wallet`, location: 'body', issue: 'Recipient wallet not supported in sandbox.' });
    }
  });
  if (errs.length) throw validation(errs, API);
}

function createPayout(ctx: FakeContext, c: Ctx): Reply {
  const body = c.json<{ sender_batch_header?: Record<string, unknown>; items?: unknown }>();
  const requestId = c.header('paypal-request-id');
  const idemKey = requestId ? `payouts:${requestId}` : undefined;
  const replay = idemKey ? ctx.state.idempotency.get(idemKey) : undefined;
  if (replay) {
    const b = ctx.state.batches.get(replay.resourceId)!;
    return { status: 201, body: createResponse(ctx, b), headers: { 'x-fake-idempotent-replay': 'true' } };
  }
  const header = body.sender_batch_header ?? {};
  const senderBatchId = typeof header.sender_batch_id === 'string' ? header.sender_batch_id : undefined;
  if (senderBatchId && senderBatchId.length > 256) throw validation([{ field: 'sender_batch_header.sender_batch_id', location: 'body', issue: 'Max length is 256.' }], API);
  negativeCreatePayout(body);
  const errs = validateItems(ctx, header, body.items);
  if (errs.length) throw validation(errs, API);
  if (ctx.config.sandboxRealism) refuseSandboxVenmo(body.items as PayoutItemRequest[]);

  if (senderBatchId && ctx.state.senderBatchIds.has(senderBatchId)) {
    const existing = ctx.state.senderBatchIds.get(senderBatchId)!;
    throw ppError(400, 'USER_BUSINESS_ERROR', undefined, [
      {
        field: 'SENDER_BATCH_ID',
        location: 'body',
        issue: 'Batch with given sender_batch_id already exists',
        link: [link(ctx, `/v1/payments/payouts/${existing}`, 'self')],
      },
    ], API);
  }

  const items = body.items as PayoutItemRequest[];
  const now = ctx.now();
  const batch: BatchRec = {
    payout_batch_id: ctx.ids.payoutBatch(),
    batch_status: 'PENDING',
    time_created: ctx.iso(now),
    sender_batch_header: header as BatchRec['sender_batch_header'],
    itemIds: [],
    currency: items[0]!.amount.currency,
    amountCents: items.reduce((s, it) => s + (valueToCents(it.amount.value) ?? 0), 0),
  };
  for (const it of items) {
    const rec: PayoutItemRec = {
      payout_item_id: ctx.ids.payoutItem(),
      transaction_status: 'PENDING',
      payout_item_fee: { currency: it.amount.currency, value: '0.00' },
      payout_batch_id: batch.payout_batch_id,
      payout_item: {
        ...it,
        recipient_type: it.recipient_type ?? (header.recipient_type as string),
        recipient_wallet: (it.recipient_wallet ?? 'PAYPAL').toUpperCase(),
      },
    };
    if (senderBatchId) rec.sender_batch_id = senderBatchId;
    ctx.state.items.set(rec.payout_item_id, rec);
    batch.itemIds.push(rec.payout_item_id);
  }
  ctx.state.batches.set(batch.payout_batch_id, batch);
  if (senderBatchId) ctx.state.senderBatchIds.set(senderBatchId, batch.payout_batch_id);
  if (idemKey) ctx.state.idempotency.set(idemKey, { bodyHash: c.rawBody, resourceId: batch.payout_batch_id });
  if (ctx.config.autoProcess) scheduleProcessing(ctx, batch.payout_batch_id);
  return { status: 201, body: createResponse(ctx, batch) };
}

export function scheduleProcessing(ctx: FakeContext, batchId: string): void {
  const delay = Math.max(0, ctx.config.processingDelayMs);
  ctx.schedule(() => markProcessing(ctx, batchId), Math.floor(delay / 3));
  ctx.schedule(() => finalizeBatch(ctx, batchId), delay);
}

function batchEvent(ctx: FakeContext, b: BatchRec, eventType: string, summary: string): void {
  ctx.webhooks.emit(eventType, 'payouts', batchView(ctx, b, { page: 1, pageSize: 0 }, false), summary);
}

export function markProcessing(ctx: FakeContext, batchId: string): void {
  const b = ctx.state.batches.get(batchId);
  if (!b || b.batch_status !== 'PENDING') return;
  b.batch_status = 'PROCESSING';
  batchEvent(ctx, b, 'PAYMENT.PAYOUTSBATCH.PROCESSING', 'Payouts batch is being processed.');
}

/** Resolve every PENDING item by outcome rules, emit item events, then mark the batch SUCCESS. Idempotent. */
export function finalizeBatch(ctx: FakeContext, batchId: string): void {
  const b = ctx.state.batches.get(batchId);
  if (!b || b.batch_status === 'SUCCESS' || b.batch_status === 'DENIED' || b.batch_status === 'CANCELED') return;
  markProcessing(ctx, batchId);
  for (const id of b.itemIds) {
    const item = ctx.state.items.get(id)!;
    if (item.transaction_status !== 'PENDING') continue;
    setItemStatus(ctx, item, decideOutcome(item.payout_item.receiver, ctx.config.unclaimedReceivers));
  }
  b.batch_status = 'SUCCESS';
  b.time_completed = ctx.iso();
  batchEvent(ctx, b, 'PAYMENT.PAYOUTSBATCH.SUCCESS', 'Payouts batch completed successfully.');
}

/** Move an item to `status` (or `CANCELED` = cancel → RETURNED) and emit the matching webhook. */
export function setItemStatus(ctx: FakeContext, item: PayoutItemRec, status: TransactionStatus | 'CANCELED'): void {
  const wire: TransactionStatus = status === 'CANCELED' ? 'RETURNED' : status;
  item.transaction_status = wire;
  item.time_processed = ctx.iso();
  const errors = errorsFor(wire);
  if (errors) item.errors = errors;
  else delete item.errors;
  if (createsTransaction(wire) && !item.transaction_id) {
    item.transaction_id = ctx.ids.transaction();
    item.activity_id = ctx.ids.transaction();
    item.txnAtMs = ctx.now();
  }
  const eventType = ITEM_EVENT_FOR_STATUS[status];
  if (eventType) ctx.webhooks.emit(eventType, 'payouts_item', itemView(ctx, item, 'item'), summaryFor(eventType, item));
}

function summaryFor(eventType: string, item: PayoutItemRec): string {
  const verb = eventType.split('.').pop()!.toLowerCase();
  return `A payout item has ${verb === 'held' ? 'been held' : verb === 'unclaimed' ? 'been unclaimed' : verb}: ${item.payout_item_id}`;
}

export function itemView(ctx: FakeContext, item: PayoutItemRec, rel: 'self' | 'item') {
  const { txnAtMs: _t, ...wire } = item;
  return { ...wire, links: [link(ctx, `/v1/payments/payouts-item/${item.payout_item_id}`, rel)] };
}

function requireItem(ctx: FakeContext, id: string): PayoutItemRec {
  const item = ctx.state.items.get(id);
  if (!item) throw ppError(404, 'INVALID_RESOURCE_ID', undefined, undefined, API);
  return item;
}

function batchView(ctx: FakeContext, b: BatchRec, p: { page: number; pageSize: number }, includeTotals: boolean) {
  const all = b.itemIds.map((id) => ctx.state.items.get(id)!);
  const pageItems = p.pageSize > 0 ? all.slice((p.page - 1) * p.pageSize, p.page * p.pageSize) : [];
  const totalPages = p.pageSize > 0 ? Math.max(1, Math.ceil(all.length / p.pageSize)) : 1;
  const base = `/v1/payments/payouts/${b.payout_batch_id}`;
  const pageLink = (n: number, rel: string) => link(ctx, `${base}?page_size=${p.pageSize}&page=${n}&total_required=${includeTotals}`, rel);
  const links = [pageLink(p.page, 'self')];
  if (p.pageSize > 0 && p.page < totalPages) links.push(pageLink(p.page + 1, 'next'));
  if (p.page > 1) links.push(pageLink(p.page - 1, 'previous'));
  return {
    ...(includeTotals ? { total_items: all.length, total_pages: totalPages } : {}),
    batch_header: {
      payout_batch_id: b.payout_batch_id,
      batch_status: b.batch_status,
      time_created: b.time_created,
      ...(b.time_completed ? { time_completed: b.time_completed, time_closed: b.time_completed } : {}),
      sender_batch_header: b.sender_batch_header,
      funding_source: 'BALANCE',
      amount: { currency: b.currency, value: centsToValue(b.amountCents) },
      fees: { currency: b.currency, value: '0.00' },
    },
    ...(p.pageSize > 0 ? { items: pageItems.map((it) => itemView(ctx, it, 'item')) } : {}),
    links,
  };
}

function getBatch(ctx: FakeContext, c: Ctx): Reply {
  const id = c.params.id!;
  const simulated = negativeGetBatch(id);
  if (simulated) return { status: 200, body: syntheticBatch(ctx, id, simulated) };
  const b = ctx.state.batches.get(id);
  if (!b) throw ppError(404, 'INVALID_RESOURCE_ID', undefined, undefined, API);
  const page = Number(c.query.get('page') ?? '1');
  const pageSize = Number(c.query.get('page_size') ?? '1000');
  if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw validation([{ field: 'page/page_size', location: 'query', issue: 'page and page_size must be integers between 1 and 1000.' }], API);
  }
  return { status: 200, body: batchView(ctx, b, { page, pageSize }, c.query.get('total_required') === 'true') };
}

function syntheticBatch(ctx: FakeContext, id: string, status: BatchStatus) {
  return {
    batch_header: {
      payout_batch_id: id,
      batch_status: status,
      time_created: ctx.iso(),
      sender_batch_header: { sender_batch_id: `test_${id}` },
      amount: { currency: 'USD', value: '0.00' },
      fees: { currency: 'USD', value: '0.00' },
    },
    items: [],
    links: [link(ctx, `/v1/payments/payouts/${id}`, 'self')],
  };
}

/** Items this fake cancelled (real PayPal then answers ITEM_ALREADY_CANCELLED, negative-testing value ERRPYO007). */
const cancelled = new WeakSet<PayoutItemRec>();

function cancelItem(ctx: FakeContext, c: Ctx): Reply {
  const item = requireItem(ctx, c.params.id!);
  if (cancelled.has(item)) throw ppError(400, 'ITEM_ALREADY_CANCELLED', 'Item has already been cancelled.', undefined, API);
  if (item.transaction_status !== 'UNCLAIMED') {
    throw ppError(400, 'ITEM_INCORRECT_STATUS', 'Item cannot be cancelled because it is not in UNCLAIMED status.', undefined, API);
  }
  setItemStatus(ctx, item, 'CANCELED');
  cancelled.add(item);
  return { status: 200, body: itemView(ctx, item, 'self') };
}
