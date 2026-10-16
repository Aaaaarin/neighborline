/**
 * Transaction Search v1: GET /v1/reporting/transactions. Enforces the documented 31-day window and page_size ≤ 500,
 * and a configurable visibility lag (real PayPal: up to ~3h). Rows come from payout items (T0001, debits),
 * order captures (T0006) and subscription sales (T0002).
 */
import { centsToValue, valueToCents, type FakeContext } from '../context.js';
import { ppError } from '../errors.js';
import type { Ctx, Reply, Router } from '../http.js';
import type { TransactionStatus } from '../state.js';

const API = 'transaction-search/v1';
const MAX_RANGE_MS = 31 * 86_400_000;
const RFC3339_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

interface Row {
  atMs: number;
  updatedMs: number;
  transaction_info: Record<string, unknown>;
  payer_info?: Record<string, unknown>;
}

const PAYOUT_TXN_STATUS: Partial<Record<TransactionStatus, string>> = {
  SUCCESS: 'S',
  UNCLAIMED: 'P',
  ONHOLD: 'P',
  RETURNED: 'V',
  REFUNDED: 'V',
  REVERSED: 'V',
};

export function registerReportingRoutes(router: Router, ctx: FakeContext): void {
  router.add('GET', '/v1/reporting/transactions', (c) => search(ctx, c));
}

function bad(field: string, issue: string) {
  return ppError(400, 'INVALID_REQUEST', undefined, [{ field, location: 'query', issue }], API);
}

function collectRows(ctx: FakeContext): Row[] {
  const rows: Row[] = [];
  const account = 'FAKEMERCHANT01';
  for (const item of ctx.state.items.values()) {
    const status = PAYOUT_TXN_STATUS[item.transaction_status];
    if (!item.transaction_id || item.txnAtMs === undefined || !status) continue;
    const cents = valueToCents(item.payout_item.amount.value) ?? 0;
    const updated = item.time_processed ? Date.parse(item.time_processed) : item.txnAtMs;
    rows.push({
      atMs: item.txnAtMs,
      updatedMs: updated,
      transaction_info: {
        paypal_account_id: account,
        transaction_id: item.transaction_id,
        paypal_reference_id: item.payout_batch_id,
        paypal_reference_id_type: 'PAY',
        transaction_event_code: 'T0001',
        transaction_initiation_date: ctx.iso(item.txnAtMs).replace('Z', '+0000'),
        transaction_updated_date: ctx.iso(updated).replace('Z', '+0000'),
        transaction_amount: { currency_code: item.payout_item.amount.currency, value: centsToValue(-cents) },
        fee_amount: { currency_code: item.payout_item.amount.currency, value: centsToValue(-(valueToCents(item.payout_item_fee.value) ?? 0)) },
        transaction_status: status,
        transaction_subject: item.payout_item.note ?? '',
        ...(item.payout_item.sender_item_id ? { invoice_id: item.payout_item.sender_item_id } : {}),
        ...(item.sender_batch_id ? { custom_field: item.sender_batch_id } : {}),
        protection_eligibility: '02',
      },
      payer_info: { email_address: item.payout_item.receiver, account_id: 'FAKERECEIVER', address_status: 'N', payer_status: 'Y' },
    });
  }
  for (const order of ctx.state.orders.values()) {
    const cap = order.capture;
    if (!cap) continue;
    rows.push({
      atMs: cap.txnAtMs,
      updatedMs: cap.txnAtMs,
      transaction_info: {
        paypal_account_id: account,
        transaction_id: cap.id,
        paypal_reference_id: order.id,
        paypal_reference_id_type: 'ODR',
        transaction_event_code: 'T0006',
        transaction_initiation_date: ctx.iso(cap.txnAtMs).replace('Z', '+0000'),
        transaction_updated_date: ctx.iso(cap.txnAtMs).replace('Z', '+0000'),
        transaction_amount: { currency_code: cap.amount.currency_code, value: cap.amount.value },
        fee_amount: { currency_code: cap.amount.currency_code, value: centsToValue(-cap.feeCents) },
        transaction_status: 'S',
        ...(cap.custom_id ? { custom_field: cap.custom_id } : {}),
        ...(cap.invoice_id ? { invoice_id: cap.invoice_id } : {}),
        protection_eligibility: '02',
      },
      payer_info: { email_address: order.payer?.email_address ?? 'donor@example.com', account_id: order.payer?.payer_id ?? 'FAKEPAYER', address_status: 'N', payer_status: 'Y' },
    });
  }
  for (const sub of ctx.state.subscriptions.values()) {
    for (const sale of sub.sales) {
      rows.push({
        atMs: sale.txnAtMs,
        updatedMs: sale.txnAtMs,
        transaction_info: {
          paypal_account_id: account,
          transaction_id: sale.id,
          paypal_reference_id: sub.id,
          paypal_reference_id_type: 'SUB',
          transaction_event_code: 'T0002',
          transaction_initiation_date: ctx.iso(sale.txnAtMs).replace('Z', '+0000'),
          transaction_updated_date: ctx.iso(sale.txnAtMs).replace('Z', '+0000'),
          transaction_amount: { currency_code: sale.currency, value: centsToValue(sale.amountCents) },
          transaction_status: 'S',
          ...(sale.custom ? { custom_field: sale.custom } : {}),
          protection_eligibility: '02',
        },
      });
    }
  }
  return rows.sort((a, b) => a.atMs - b.atMs);
}

function search(ctx: FakeContext, c: Ctx): Reply {
  const start = c.query.get('start_date');
  const end = c.query.get('end_date');
  if (!start || !RFC3339_SECONDS.test(start)) throw bad('start_date', 'start_date is required in RFC 3339 format with seconds.');
  if (!end || !RFC3339_SECONDS.test(end)) throw bad('end_date', 'end_date is required in RFC 3339 format with seconds.');
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (e < s) throw bad('end_date', 'end_date must be after start_date.');
  if (e - s > MAX_RANGE_MS) throw bad('end_date', 'Date range is greater than 31 days.');
  const pageSize = Number(c.query.get('page_size') ?? '100');
  const page = Number(c.query.get('page') ?? '1');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw bad('page_size', 'page_size must be between 1 and 500.');
  if (!Number.isInteger(page) || page < 1) throw bad('page', 'page must be >= 1.');
  const txnId = c.query.get('transaction_id');
  const status = c.query.get('transaction_status');
  const fields = (c.query.get('fields') ?? 'transaction_info').split(',');
  const all = fields.includes('all');
  const visibleBefore = ctx.now() - ctx.config.reportingLagMs;

  const rows = collectRows(ctx).filter(
    (r) =>
      r.atMs <= visibleBefore &&
      r.atMs >= s &&
      r.atMs <= e &&
      (!txnId || r.transaction_info.transaction_id === txnId) &&
      (!status || r.transaction_info.transaction_status === status),
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const lastRefreshed = ctx.iso(visibleBefore).replace('Z', '+0000');
  const qs = (p: number) => {
    const q = new URLSearchParams(c.query);
    q.set('page', String(p));
    return `${ctx.baseUrl()}/v1/reporting/transactions?${q.toString()}`;
  };
  const links = [{ href: qs(page), rel: 'self', method: 'GET' }];
  if (page < totalPages) links.push({ href: qs(page + 1), rel: 'next', method: 'GET' }, { href: qs(totalPages), rel: 'last', method: 'GET' });
  return {
    status: 200,
    body: {
      transaction_details: slice.map((r) => ({
        transaction_info: r.transaction_info,
        ...(all || fields.includes('payer_info') ? { payer_info: r.payer_info ?? {} } : {}),
        ...(all ? { shipping_info: {}, cart_info: {}, store_info: {}, auction_info: {}, incentive_info: {} } : {}),
      })),
      account_number: 'FAKEMERCHANT01',
      start_date: start,
      end_date: end,
      last_refreshed_datetime: lastRefreshed,
      page,
      total_items: rows.length,
      total_pages: totalPages,
      links,
    },
  };
}
