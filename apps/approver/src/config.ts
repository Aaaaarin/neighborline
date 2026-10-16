/**
 * Approver configuration. This process is the only one that ever sees Payouts credentials.
 *
 *   PAYPAL_MODE                      fake (default) | sandbox | live
 *   PAYPAL_PAYOUTS_CLIENT_ID/SECRET  a PayPal REST app used ONLY for Payouts (required in sandbox/live)
 *   PAYPAL_PAYOUTS_WEBHOOK_ID        that app's webhook id (lets the web app verify payout webhooks via us)
 *   PAYPAL_CLIENT_ID/SECRET          fallback only in fake mode, or with APPROVER_ALLOW_SHARED_CREDENTIALS=true
 *                                    (local sandbox experiments) — logged as a loud warning
 *   NEIGHBORLINE_APPROVER_SECRET     HMAC key shared with the web app (≥ 32 chars)
 *   DATABASE_URL                     Postgres (production) or the local dev database (tools/dev-db)
 *   APPROVER_PORT / APPROVER_HOST    default 4020 / 127.0.0.1
 *   NEIGHBORLINE_REQUIRE_PASSKEYS    true → every approver needs a verified WebAuthn assertion
 *   DEMO_MODE                        true → demo rehearsals (req_demo_*) excluded from caps, demo keys accepted
 */
import { resolvePayPalEnv } from '@neighborline/paypal';
import { APPROVER_MIN_SECRET_LENGTH, DEFAULT_APPROVER_PORT } from './protocol.js';

export type Env = Record<string, string | undefined>;

export interface ApproverConfig {
  port: number;
  host: string;
  secret: string;
  databaseUrl: string | undefined;
  paypal: {
    mode: 'fake' | 'sandbox' | 'live';
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    credentials: 'fake' | 'dedicated' | 'shared-fallback';
    webhookId: string | undefined;
  };
  requirePasskeys: boolean;
  demoMode: boolean;
  version: string | undefined;
  warnings: string[];
}

export class ConfigError extends Error {}

const truthy = (v: string | undefined) => /^(1|true|yes)$/i.test(v ?? '');

export function readConfig(env: Env = process.env): ApproverConfig {
  const warnings: string[] = [];
  const secret = env.NEIGHBORLINE_APPROVER_SECRET ?? '';
  if (secret.length < APPROVER_MIN_SECRET_LENGTH) {
    throw new ConfigError(`NEIGHBORLINE_APPROVER_SECRET must be at least ${APPROVER_MIN_SECRET_LENGTH} characters (pnpm dev generates one per run)`);
  }

  const mode = (env.PAYPAL_MODE ?? 'fake').toLowerCase();
  if (mode !== 'fake' && mode !== 'sandbox' && mode !== 'live') throw new ConfigError(`PAYPAL_MODE must be fake|sandbox|live (got "${mode}")`);

  let clientId = env.PAYPAL_PAYOUTS_CLIENT_ID ?? '';
  let clientSecret = env.PAYPAL_PAYOUTS_CLIENT_SECRET ?? '';
  let credentials: ApproverConfig['paypal']['credentials'] = 'dedicated';
  let baseUrl: string;
  if (mode === 'fake') {
    const r = resolvePayPalEnv({ ...env, PAYPAL_MODE: 'fake' });
    baseUrl = r.baseUrl;
    if (!clientId || !clientSecret) {
      clientId = r.clientId;
      clientSecret = r.clientSecret;
      credentials = 'fake';
    }
  } else {
    if (!clientId || !clientSecret) {
      if (!truthy(env.APPROVER_ALLOW_SHARED_CREDENTIALS)) {
        throw new ConfigError(
          `PAYPAL_MODE=${mode} requires PAYPAL_PAYOUTS_CLIENT_ID and PAYPAL_PAYOUTS_CLIENT_SECRET: a separate PayPal REST app used only for Payouts (docs/DEPLOY.md §4). ` +
            'For a local sandbox experiment only, APPROVER_ALLOW_SHARED_CREDENTIALS=true falls back to PAYPAL_CLIENT_ID/SECRET.',
        );
      }
      clientId = env.PAYPAL_CLIENT_ID ?? '';
      clientSecret = env.PAYPAL_CLIENT_SECRET ?? '';
      if (!clientId || !clientSecret) throw new ConfigError(`PAYPAL_MODE=${mode} needs PAYPAL_PAYOUTS_CLIENT_ID/SECRET (or PAYPAL_CLIENT_ID/SECRET with APPROVER_ALLOW_SHARED_CREDENTIALS=true)`);
      credentials = 'shared-fallback';
      warnings.push(
        '!!! APPROVER_ALLOW_SHARED_CREDENTIALS=true: using the MAIN PayPal app (PAYPAL_CLIENT_ID) for Payouts. The web process holds the same keys, ' +
          'so "only the approver can move money" is NOT true at the PayPal level. Local experiments only; never deploy this. !!!',
      );
    }
    baseUrl = env.PAYPAL_BASE_URL || (mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
  }
  if (mode === 'live') warnings.push('PAYPAL_MODE=live: real money. Neighborline is a hackathon project; review THREAT_MODEL.md residual risks first.');

  const port = Number(env.APPROVER_PORT ?? DEFAULT_APPROVER_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError('APPROVER_PORT must be a port number');

  const demoMode = (env.DEMO_MODE ?? 'true').toLowerCase() !== 'false';
  const requirePasskeys = truthy(env.NEIGHBORLINE_REQUIRE_PASSKEYS);
  if (!requirePasskeys && mode !== 'fake') {
    warnings.push('NEIGHBORLINE_REQUIRE_PASSKEYS is off: approvals without a WebAuthn signature are executed and audited as "unsigned".');
  }

  return {
    port,
    host: env.APPROVER_HOST || '127.0.0.1',
    secret,
    databaseUrl: env.DATABASE_URL || undefined,
    paypal: {
      mode,
      baseUrl,
      clientId,
      clientSecret,
      credentials,
      webhookId: env.PAYPAL_PAYOUTS_WEBHOOK_ID || undefined,
    },
    requirePasskeys,
    demoMode,
    version: env.RENDER_GIT_COMMIT || env.NEIGHBORLINE_VERSION || undefined,
    warnings,
  };
}
