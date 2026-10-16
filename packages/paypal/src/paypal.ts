/** Facade + env wiring: `createPayPal(opts)` or `createPayPalFromEnv()` → { payouts, orders, subscriptions, webhooks, reporting }. */
import { PAYPAL_LIVE_URL, PAYPAL_SANDBOX_URL, PayPalClient, type PayPalClientOptions } from './client.js';
import { OrdersApi } from './orders.js';
import { PayoutsApi } from './payouts.js';
import { ReportingApi } from './reporting.js';
import { SubscriptionsApi } from './subscriptions.js';
import { WebhooksApi } from './webhooks.js';

export interface PayPal {
  client: PayPalClient;
  payouts: PayoutsApi;
  orders: OrdersApi;
  subscriptions: SubscriptionsApi;
  webhooks: WebhooksApi;
  reporting: ReportingApi;
}

export function createPayPal(options: PayPalClientOptions | PayPalClient): PayPal {
  const client = options instanceof PayPalClient ? options : new PayPalClient(options);
  return {
    client,
    payouts: new PayoutsApi(client),
    orders: new OrdersApi(client),
    subscriptions: new SubscriptionsApi(client),
    webhooks: new WebhooksApi(client),
    reporting: new ReportingApi(client),
  };
}

export type PayPalMode = 'fake' | 'sandbox' | 'live';

export interface ResolvedPayPalEnv {
  mode: PayPalMode;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  webhookId: string | undefined;
}

/**
 * Resolve config from env:
 *   PAYPAL_MODE=fake    → FAKE_PAYPAL_URL (default http://localhost:4010), dummy credentials, FAKE_PAYPAL_WEBHOOK_ID
 *   PAYPAL_MODE=sandbox → PAYPAL_BASE_URL (default sandbox), PAYPAL_CLIENT_ID/SECRET, PAYPAL_WEBHOOK_ID
 *   PAYPAL_MODE=live    → PAYPAL_BASE_URL (default live), same credentials
 */
export function resolvePayPalEnv(env: Record<string, string | undefined> = process.env): ResolvedPayPalEnv {
  const mode = (env.PAYPAL_MODE ?? 'fake').toLowerCase() as PayPalMode;
  if (mode === 'fake') {
    return {
      mode,
      baseUrl: env.FAKE_PAYPAL_URL ?? 'http://localhost:4010',
      clientId: env.PAYPAL_CLIENT_ID || 'fake-client-id',
      clientSecret: env.PAYPAL_CLIENT_SECRET || 'fake-client-secret',
      webhookId: env.FAKE_PAYPAL_WEBHOOK_ID ?? env.PAYPAL_WEBHOOK_ID ?? '0FAKEWEBHOOK0NEIGHBORLINE01',
    };
  }
  if (mode !== 'sandbox' && mode !== 'live') throw new Error(`PAYPAL_MODE must be fake|sandbox|live, got "${mode}"`);
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error(`PAYPAL_MODE=${mode} requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET`);
  return { mode, baseUrl: env.PAYPAL_BASE_URL || (mode === 'live' ? PAYPAL_LIVE_URL : PAYPAL_SANDBOX_URL), clientId, clientSecret, webhookId: env.PAYPAL_WEBHOOK_ID || undefined };
}

export function createPayPalFromEnv(env?: Record<string, string | undefined>, extra: Partial<PayPalClientOptions> = {}): PayPal & { env: ResolvedPayPalEnv } {
  const resolved = resolvePayPalEnv(env);
  return { ...createPayPal({ ...extra, clientId: resolved.clientId, clientSecret: resolved.clientSecret, baseUrl: resolved.baseUrl }), env: resolved };
}
