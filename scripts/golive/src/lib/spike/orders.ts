/**
 * Orders v2 in the sandbox: create a $1 donation order, have the sandbox buyer approve it, capture it, capture it
 * again (ORDER_ALREADY_CAPTURED → the existing capture), and a capture with PayPal-Mock-Response INSTRUMENT_DECLINED.
 *
 * Approval needs a browser. Strategies: 'playwright' logs into the developer's own sandbox buyer account
 * (SANDBOX_BUYER_EMAIL/PASSWORD) on PayPal's sandbox checkout; 'link' just GETs the approve link (what
 * tools/fake-paypal treats as the buyer approving); 'skip' records the approve URL for a human to click.
 */
import type { PayPal } from '@neighborline/paypal';
import { errorShape } from '../paypal-admin.js';

export const RETURN_URL = 'https://example.com/neighborline-golive/return';
export const CANCEL_URL = 'https://example.com/neighborline-golive/cancel';

export type Approver = (approveUrl: string) => Promise<{ ok: boolean; note: string }>;

export interface OrdersProbe {
  orderId?: string;
  createStatus?: string;
  approveUrl?: string;
  createError?: ReturnType<typeof errorShape>;
  approval: { strategy: string; ok: boolean; note: string };
  capture?: { status: string; captureId?: string; captureStatus?: string; amountCents?: number; feeCents?: number; fundingSource?: string; payerEmail?: string };
  captureError?: ReturnType<typeof errorShape>;
  recapture?: { alreadyCaptured: boolean; captureId?: string; error?: ReturnType<typeof errorShape> };
  declined?: { orderId?: string; error?: ReturnType<typeof errorShape>; unexpected?: string };
}

export async function probeOrders(pp: PayPal, runId: string, approver: { strategy: string; approve?: Approver }, log: (s: string) => void): Promise<OrdersProbe> {
  const probe: OrdersProbe = { approval: { strategy: approver.strategy, ok: false, note: '' } };
  try {
    const o = await pp.orders.createDonationOrder({ amountCents: 100, description: 'Neighborline sandbox test donation', customId: `golive_${runId}`, returnUrl: RETURN_URL, cancelUrl: CANCEL_URL, brandName: 'Neighborline (sandbox test)', requestId: `golive-order-${runId}` });
    Object.assign(probe, { orderId: o.id, createStatus: o.status, ...(o.approveUrl ? { approveUrl: o.approveUrl } : {}) });
    log(`    order ${o.id} ${o.status}`);
  } catch (err) {
    probe.createError = errorShape(err);
    return probe;
  }
  if (approver.approve && probe.approveUrl) {
    try {
      probe.approval = { strategy: approver.strategy, ...(await approver.approve(probe.approveUrl)) };
    } catch (err) {
      probe.approval = { strategy: approver.strategy, ok: false, note: (err as Error).message };
    }
  } else probe.approval = { strategy: 'skip', ok: false, note: `no buyer automation; approve by hand at ${probe.approveUrl ?? '(no link)'} then re-run with --force-part orders` };
  log(`    approval (${probe.approval.strategy}): ${probe.approval.ok ? 'ok' : probe.approval.note}`);
  if (probe.approval.ok && probe.orderId) {
    try {
      const c = await pp.orders.captureOrder(probe.orderId);
      probe.capture = {
        status: c.status,
        ...(c.captureId ? { captureId: c.captureId } : {}),
        ...(c.captureStatus ? { captureStatus: c.captureStatus } : {}),
        ...(c.amountCents !== undefined ? { amountCents: c.amountCents } : {}),
        ...(c.feeCents !== undefined ? { feeCents: c.feeCents } : {}),
        ...(c.fundingSource ? { fundingSource: c.fundingSource } : {}),
        ...(c.payerEmail ? { payerEmail: c.payerEmail } : {}),
      };
      log(`    capture ${c.captureId} ${c.captureStatus ?? c.status}`);
      try {
        const again = await pp.orders.captureOrder(probe.orderId, { requestId: `golive-recapture-${runId}` });
        probe.recapture = { alreadyCaptured: again.alreadyCaptured, ...(again.captureId ? { captureId: again.captureId } : {}) };
      } catch (err) {
        probe.recapture = { alreadyCaptured: false, error: errorShape(err) };
      }
    } catch (err) {
      probe.captureError = errorShape(err);
    }
  }
  // Negative testing on Orders: the documented PayPal-Mock-Response header.
  try {
    const o = await pp.orders.createDonationOrder({ amountCents: 100, description: 'Neighborline sandbox negative test', customId: `golive_${runId}_declined`, returnUrl: RETURN_URL, cancelUrl: CANCEL_URL, requestId: `golive-order-declined-${runId}` });
    probe.declined = { orderId: o.id };
    try {
      const c = await pp.orders.captureOrder(o.id, { mockResponse: { mock_application_codes: 'INSTRUMENT_DECLINED' }, requestId: `golive-declined-${runId}` });
      probe.declined.unexpected = `capture returned ${c.status}`;
    } catch (err) {
      probe.declined.error = errorShape(err);
    }
  } catch (err) {
    probe.declined = { error: errorShape(err) };
  }
  return probe;
}

/** tools/fake-paypal: GETting the approve link is the buyer approving. */
export function linkApprover(f: typeof fetch): Approver {
  return async (url) => {
    const res = await f(url, { redirect: 'manual' });
    return { ok: res.status < 400, note: `GET approve link → ${res.status}` };
  };
}
