/**
 * PayPal APIs the web app may use *without* the power to move money out: Orders (donations in),
 * Subscriptions, webhook verification and Transaction Search. There is deliberately no Payouts
 * client here — only lib/server/approval-service.ts constructs one (checked by
 * lib/server/least-privilege.test.ts).
 */
import {
  OrdersApi,
  PayPalClient,
  ReportingApi,
  SubscriptionsApi,
  WebhooksApi,
  resolvePayPalEnv,
  type ResolvedPayPalEnv,
} from '@neighborline/paypal';
import type { Env } from './engine/env';

export interface PublicPayPal {
  env: ResolvedPayPalEnv;
  orders: OrdersApi;
  subscriptions: SubscriptionsApi;
  webhooks: WebhooksApi;
  reporting: ReportingApi;
}

export function createPublicPayPal(env: Env): PublicPayPal {
  const resolved = resolvePayPalEnv(env);
  const client = new PayPalClient({ clientId: resolved.clientId, clientSecret: resolved.clientSecret, baseUrl: resolved.baseUrl });
  return {
    env: resolved,
    orders: new OrdersApi(client),
    subscriptions: new SubscriptionsApi(client),
    webhooks: new WebhooksApi(client),
    reporting: new ReportingApi(client),
  };
}

/** Control plane of tools/fake-paypal (fake mode only): simulated buyer/recipient actions. */
export class FakePayPalControl {
  constructor(private readonly baseUrl: string) {}

  private async post(path: string, body: unknown = {}): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`fake-paypal ${path} → ${res.status}`);
    return res.json().catch(() => ({}));
  }

  /** The donor approves the order in the PayPal popup. */
  approveOrder(orderId: string, fundingSource: 'paypal' | 'venmo' = 'paypal') {
    return this.post(`/__fake/orders/${encodeURIComponent(orderId)}/approve`, { fundingSource });
  }

  /** The neighbor opens a PayPal account with the email and claims the payout. */
  claimItem(paypalItemId: string) {
    return this.post(`/__fake/claim/${encodeURIComponent(paypalItemId)}`);
  }

  reset() {
    return this.post('/__fake/reset');
  }
}
