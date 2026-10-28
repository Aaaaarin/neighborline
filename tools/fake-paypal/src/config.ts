/** Runtime configuration of the fake (all overridable at runtime via POST /__fake/config). */

export interface FakeConfig {
  /** Where webhooks are POSTed. Unset → events are recorded but not delivered. */
  webhookTargetUrl?: string;
  /** Webhook id the fake "is" — must be passed as `webhook_id` to verify-webhook-signature. */
  webhookId: string;
  /** Batch PENDING → items final after this many ms (PROCESSING at ~1/3). */
  processingDelayMs: number;
  /** When false, batches stay PENDING until POST /__fake/batches/:id/process. */
  autoProcess: boolean;
  /** Access token lifetime (seconds) returned by /v1/oauth2/token. Sandbox issues ~32400s. */
  tokenTtlSec: number;
  /** Transaction Search visibility lag (real PayPal: up to ~3h). Default 0 so demos reconcile instantly. */
  reportingLagMs: number;
  /** Real sandbox rejects recipient_type PHONE for payouts. Off by default so demo data keeps working. */
  rejectPhoneRecipients: boolean;
  /**
   * Receivers that behave like an email/handle with no PayPal account yet (item → UNCLAIMED), in addition to the
   * substring rules in outcomes.ts. Demo world: Rosa has not opened a PayPal account with her email yet.
   */
  unclaimedReceivers: string[];
  /** When both set, /v1/oauth2/token only accepts these credentials. */
  clientId?: string;
  clientSecret?: string;
  /** HMAC key used to sign webhooks (stands in for PayPal's RSA key). Not a PayPal secret. */
  signingSecret: string;
  /** Webhook delivery attempts per event (real PayPal: up to 25 over 3 days). */
  webhookMaxAttempts: number;
  /**
   * Answer CORS preflights and add permissive Access-Control-* headers, so a browser page on another origin can call
   * the fake (scripts/golive's browser spike test). Off by default; FAKE_PAYPAL_CORS=1.
   */
  cors: boolean;
  log: boolean;
}

export const DEFAULT_CONFIG: FakeConfig = {
  webhookId: '0FAKEWEBHOOK0NEIGHBORLINE01',
  processingDelayMs: 1500,
  autoProcess: true,
  tokenTtlSec: 32_400,
  reportingLagMs: 0,
  rejectPhoneRecipients: false,
  unclaimedReceivers: ['rosa.m.delgado@example.com'],
  signingSecret: 'fake-paypal-local-signing-key',
  webhookMaxAttempts: 3,
  cors: false,
  log: false,
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<FakeConfig> & { port: number } {
  const num = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const bool = (v: string | undefined) => (v === undefined || v === '' ? undefined : v === '1' || v.toLowerCase() === 'true');
  const out: Partial<FakeConfig> & { port: number } = { port: num(env.FAKE_PAYPAL_PORT) ?? 4010, log: true };
  const target = env.WEBHOOK_TARGET_URL ?? env.FAKE_PAYPAL_WEBHOOK_TARGET_URL;
  if (target) out.webhookTargetUrl = target;
  if (env.FAKE_PAYPAL_WEBHOOK_ID) out.webhookId = env.FAKE_PAYPAL_WEBHOOK_ID;
  const delay = num(env.FAKE_PAYPAL_PROCESSING_DELAY_MS);
  if (delay !== undefined) out.processingDelayMs = delay;
  const ttl = num(env.FAKE_PAYPAL_TOKEN_TTL_SEC);
  if (ttl !== undefined) out.tokenTtlSec = ttl;
  const lag = num(env.FAKE_PAYPAL_REPORTING_LAG_MS);
  if (lag !== undefined) out.reportingLagMs = lag;
  const phone = bool(env.FAKE_PAYPAL_REJECT_PHONE);
  if (phone !== undefined) out.rejectPhoneRecipients = phone;
  if (env.FAKE_PAYPAL_UNCLAIMED_RECEIVERS !== undefined) {
    out.unclaimedReceivers = env.FAKE_PAYPAL_UNCLAIMED_RECEIVERS.split(',').map((r) => r.trim()).filter(Boolean);
  }
  const cors = bool(env.FAKE_PAYPAL_CORS);
  if (cors !== undefined) out.cors = cors;
  const auto = bool(env.FAKE_PAYPAL_AUTO_PROCESS);
  if (auto !== undefined) out.autoProcess = auto;
  if (env.FAKE_PAYPAL_CLIENT_ID && env.FAKE_PAYPAL_CLIENT_SECRET) {
    out.clientId = env.FAKE_PAYPAL_CLIENT_ID;
    out.clientSecret = env.FAKE_PAYPAL_CLIENT_SECRET;
  }
  return out;
}
