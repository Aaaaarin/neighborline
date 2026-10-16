/**
 * Orders v2 for donations. The server creates the order (amount computed server-side, never trusted from the
 * browser); the PayPal JS SDK (PayPal / Venmo / Pay Later buttons) collects buyer approval; the server captures.
 */
import { PayPalApiError } from './errors.js';
import { seg, type MockResponse, type PayPalClient } from './client.js';
import { amount, fromPayPalValue } from './money.js';

export interface CreateDonationOrderInput {
  amountCents: number;
  currency?: string;
  /** Shown to the donor (≤127 chars). */
  description: string;
  /** Your reference, echoed in captures, webhooks and Transaction Search (≤127 chars). */
  customId?: string;
  /** Must be unique per merchant account if sent. */
  invoiceId?: string;
  softDescriptor?: string;
  /** Redirect flow only. Omit when the JS SDK renders the buttons (it handles approval in a popup). */
  returnUrl?: string;
  cancelUrl?: string;
  brandName?: string;
  /** Idempotency key (kept ~6h by PayPal). Required by PayPal when a payment_source is sent. */
  requestId?: string;
  mockResponse?: MockResponse;
}

export interface OrderSummary {
  id: string;
  status: string;
  /** Where to send the buyer (redirect flow). */
  approveUrl: string | undefined;
  raw: unknown;
}

export interface CaptureSummary {
  orderId: string;
  status: string;
  captureId: string | undefined;
  captureStatus: string | undefined;
  amountCents: number | undefined;
  feeCents: number | undefined;
  currency: string | undefined;
  customId: string | undefined;
  payerEmail: string | undefined;
  /** Funding source key from payment_source, e.g. 'paypal' or 'venmo'. */
  fundingSource: string | undefined;
  /** True when PayPal said ORDER_ALREADY_CAPTURED and we returned the existing capture. */
  alreadyCaptured: boolean;
  raw: unknown;
}

interface WireOrder {
  id: string;
  status: string;
  links?: Array<{ href: string; rel: string }>;
  payment_source?: Record<string, { email_address?: string }>;
  payer?: { email_address?: string };
  purchase_units?: Array<{
    custom_id?: string;
    payments?: { captures?: Array<{ id: string; status: string; amount: { currency_code: string; value: string }; custom_id?: string; seller_receivable_breakdown?: { paypal_fee?: { currency_code: string; value: string } } }> };
  }>;
}

export function buildDonationOrder(input: CreateDonationOrderInput) {
  const currency = input.currency ?? 'USD';
  const value = amount(input.amountCents, currency);
  if (input.amountCents <= 0) throw new RangeError('amountCents must be positive');
  return {
    intent: 'CAPTURE' as const,
    purchase_units: [
      {
        reference_id: 'donation',
        description: input.description.slice(0, 127),
        ...(input.customId ? { custom_id: input.customId.slice(0, 127) } : {}),
        ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
        ...(input.softDescriptor ? { soft_descriptor: input.softDescriptor.slice(0, 22) } : {}),
        amount: { ...value, breakdown: { item_total: value } },
        items: [{ name: input.description.slice(0, 127), quantity: '1', unit_amount: value, category: 'DONATION' as const }],
      },
    ],
    ...(input.returnUrl
      ? {
          payment_source: {
            paypal: {
              experience_context: {
                return_url: input.returnUrl,
                ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
                ...(input.brandName ? { brand_name: input.brandName } : {}),
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
              },
            },
          },
        }
      : {}),
  };
}

export function summarizeCapture(o: WireOrder, alreadyCaptured = false): CaptureSummary {
  const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
  const fee = cap?.seller_receivable_breakdown?.paypal_fee;
  const fundingSource = o.payment_source ? Object.keys(o.payment_source)[0] : undefined;
  return {
    orderId: o.id,
    status: o.status,
    captureId: cap?.id,
    captureStatus: cap?.status,
    amountCents: cap ? fromPayPalValue(cap.amount.value, cap.amount.currency_code) : undefined,
    feeCents: fee ? fromPayPalValue(fee.value, fee.currency_code) : undefined,
    currency: cap?.amount.currency_code,
    customId: cap?.custom_id ?? o.purchase_units?.[0]?.custom_id,
    payerEmail: (fundingSource ? o.payment_source?.[fundingSource]?.email_address : undefined) ?? o.payer?.email_address,
    fundingSource,
    alreadyCaptured,
    raw: o,
  };
}

export class OrdersApi {
  constructor(private readonly client: PayPalClient) {}

  async createDonationOrder(input: CreateDonationOrderInput): Promise<OrderSummary> {
    const body = buildDonationOrder(input);
    const res = await this.client.request<WireOrder>({
      method: 'POST',
      path: '/v2/checkout/orders',
      body,
      prefer: 'return=representation',
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.mockResponse ? { mockResponse: input.mockResponse } : {}),
    });
    const approve = res.data.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
    return { id: res.data.id, status: res.data.status, approveUrl: approve?.href, raw: res.data };
  }

  /** Capture an approved order. Idempotent: a repeat (double tap, retry) returns the existing capture. */
  async captureOrder(orderId: string, opts: { requestId?: string; mockResponse?: MockResponse } = {}): Promise<CaptureSummary> {
    try {
      const res = await this.client.request<WireOrder>({
        method: 'POST',
        path: `/v2/checkout/orders/${seg(orderId)}/capture`,
        body: {},
        prefer: 'return=representation',
        requestId: opts.requestId ?? `capture-${orderId}`,
        ...(opts.mockResponse ? { mockResponse: opts.mockResponse } : {}),
      });
      return summarizeCapture(res.data);
    } catch (err) {
      if (err instanceof PayPalApiError && err.status === 422 && err.hasIssue('ORDER_ALREADY_CAPTURED')) {
        return summarizeCapture((await this.getOrderRaw(orderId)) as WireOrder, true);
      }
      throw err;
    }
  }

  async getOrder(orderId: string): Promise<CaptureSummary> {
    return summarizeCapture((await this.getOrderRaw(orderId)) as WireOrder);
  }

  private async getOrderRaw(orderId: string): Promise<unknown> {
    return (await this.client.request({ path: `/v2/checkout/orders/${seg(orderId)}` })).data;
  }
}
