/**
 * Transaction Search v1. PayPal limits one call to a 31-day window and shows data up to ~3h late, so
 * `searchTransactions` splits long ranges into ≤31-day chunks and follows pagination within each.
 */
import type { PayPalClient } from './client.js';
import { fromPayPalValue } from './money.js';

export const MAX_WINDOW_MS = 31 * 24 * 3_600_000;
/** Documented: "It takes a maximum of three hours for executed transactions to appear". */
export const TRANSACTION_SEARCH_LAG_MS = 3 * 3_600_000;

export const EVENT_CODES = {
  MASS_PAY: 'T0001',
  SUBSCRIPTION_PAYMENT: 'T0002',
  EXPRESS_CHECKOUT: 'T0006',
  DONATION: 'T0013',
  MASS_PAY_REVERSAL: 'T1114',
  MASS_PAY_REFUND: 'T1115',
  PAYMENT_REFUND: 'T1107',
} as const;

export interface SearchTransactionsInput {
  startDate: Date | string;
  endDate: Date | string;
  transactionId?: string;
  /** D (denied) | P (pending) | S (success) | V (reversed/refunded). */
  transactionStatus?: 'D' | 'P' | 'S' | 'V';
  fields?: 'all' | 'transaction_info' | string;
  /** 1–500. */
  pageSize?: number;
  /** Fetch only this page of each window. Omit to fetch all pages. */
  page?: number;
}

export interface PayPalTransaction {
  transactionId: string;
  paypalReferenceId: string | undefined;
  eventCode: string;
  initiationDate: string;
  updatedDate: string | undefined;
  /** Signed: payouts are negative (money out). */
  amountCents: number;
  currency: string;
  feeCents: number | undefined;
  status: string;
  customField: string | undefined;
  invoiceId: string | undefined;
  payerEmail: string | undefined;
  raw: unknown;
}

/** RFC 3339 with seconds, no millis — the format Transaction Search requires. */
export function toRfc3339(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) throw new RangeError(`invalid date: ${String(d)}`);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Split [start, end] into consecutive windows of at most 31 days (pure; exported for tests). */
export function chunkDateRange(start: Date, end: Date, maxMs = MAX_WINDOW_MS): Array<{ start: Date; end: Date }> {
  if (end.getTime() < start.getTime()) throw new RangeError('endDate is before startDate');
  const out: Array<{ start: Date; end: Date }> = [];
  for (let s = start.getTime(); s <= end.getTime(); ) {
    const e = Math.min(end.getTime(), s + maxMs - 1000);
    out.push({ start: new Date(s), end: new Date(e) });
    s = e + 1000;
  }
  return out;
}

interface WireTxn {
  transaction_info: {
    transaction_id: string;
    paypal_reference_id?: string;
    transaction_event_code: string;
    transaction_initiation_date: string;
    transaction_updated_date?: string;
    transaction_amount: { currency_code: string; value: string };
    fee_amount?: { currency_code: string; value: string };
    transaction_status: string;
    custom_field?: string;
    invoice_id?: string;
  };
  payer_info?: { email_address?: string };
}

function normalize(t: WireTxn): PayPalTransaction {
  const i = t.transaction_info;
  return {
    transactionId: i.transaction_id,
    paypalReferenceId: i.paypal_reference_id,
    eventCode: i.transaction_event_code,
    initiationDate: i.transaction_initiation_date,
    updatedDate: i.transaction_updated_date,
    amountCents: fromPayPalValue(i.transaction_amount.value, i.transaction_amount.currency_code),
    currency: i.transaction_amount.currency_code,
    feeCents: i.fee_amount ? fromPayPalValue(i.fee_amount.value, i.fee_amount.currency_code) : undefined,
    status: i.transaction_status,
    customField: i.custom_field,
    invoiceId: i.invoice_id,
    payerEmail: t.payer_info?.email_address,
    raw: t,
  };
}

export class ReportingApi {
  constructor(private readonly client: PayPalClient) {}

  async searchTransactions(input: SearchTransactionsInput): Promise<PayPalTransaction[]> {
    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    const pageSize = input.pageSize ?? 500;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new RangeError('pageSize must be 1–500');
    const out: PayPalTransaction[] = [];
    for (const w of chunkDateRange(start, end)) {
      for (let page = input.page ?? 1; ; page++) {
        const res = await this.client.request<{ transaction_details?: WireTxn[]; total_pages?: number }>({
          path: '/v1/reporting/transactions',
          query: {
            start_date: toRfc3339(w.start),
            end_date: toRfc3339(w.end),
            transaction_id: input.transactionId,
            transaction_status: input.transactionStatus,
            fields: input.fields ?? 'all',
            page_size: pageSize,
            page,
          },
        });
        out.push(...(res.data.transaction_details ?? []).map(normalize));
        if (input.page !== undefined || page >= (res.data.total_pages ?? 1)) break;
      }
    }
    return out;
  }
}
