/**
 * PayPal setup calls golive needs and @neighborline/paypal does not ship (the app never manages its own webhooks):
 * OAuth introspection (scopes, app id), and idempotent webhook subscriptions.
 */
import { PayPalApiError, PayPalClient, createPayPal, type PayPal } from '@neighborline/paypal';
import { paypalBase, type Env } from './env.js';

export type AppKind = 'main' | 'payouts';

export function credentials(env: Env, app: AppKind): { clientId: string; clientSecret: string } | null {
  const id = app === 'main' ? env.PAYPAL_CLIENT_ID : env.PAYPAL_PAYOUTS_CLIENT_ID;
  const secret = app === 'main' ? env.PAYPAL_CLIENT_SECRET : env.PAYPAL_PAYOUTS_CLIENT_SECRET;
  return id && secret ? { clientId: id, clientSecret: secret } : null;
}

export function paypalFor(env: Env, app: AppKind, f: typeof fetch = fetch): PayPal {
  const c = credentials(env, app);
  if (!c) throw new Error(`no credentials for the ${app} app (${app === 'main' ? 'PAYPAL_CLIENT_ID/SECRET' : 'PAYPAL_PAYOUTS_CLIENT_ID/SECRET'})`);
  return createPayPal(new PayPalClient({ ...c, baseUrl: paypalBase(env), fetch: f, timeoutMs: 45_000 }));
}

export const SCOPES = {
  payouts: 'https://uri.paypal.com/payments/payouts',
  reporting: 'https://uri.paypal.com/services/reporting/search/read',
  webhooks: 'https://uri.paypal.com/services/applications/webhooks',
  subscriptions: 'https://uri.paypal.com/services/subscriptions',
} as const;

export interface OAuthInfo {
  ok: boolean;
  status: number | null;
  appId?: string;
  scopes: string[];
  expiresIn?: number;
  error?: string;
  ms: number;
}

/** POST /v1/oauth2/token and read what PayPal says the app may do (the `scope` string). */
export async function oauthInfo(env: Env, app: AppKind, f: typeof fetch = fetch): Promise<OAuthInfo> {
  const c = credentials(env, app);
  const started = Date.now();
  if (!c) return { ok: false, status: null, scopes: [], error: 'missing credentials', ms: 0 };
  try {
    const res = await f(`${paypalBase(env)}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { scope?: string; app_id?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok) return { ok: false, status: res.status, scopes: [], error: `${body.error ?? res.status}: ${body.error_description ?? 'token request failed'}`, ms: Date.now() - started };
    return { ok: true, status: res.status, scopes: (body.scope ?? '').split(/\s+/).filter(Boolean), ...(body.app_id ? { appId: body.app_id } : {}), ...(body.expires_in ? { expiresIn: body.expires_in } : {}), ms: Date.now() - started };
  } catch (err) {
    return { ok: false, status: null, scopes: [], error: (err as Error).message, ms: Date.now() - started };
  }
}

// ── Webhook subscriptions ─────────────────────────────────────────────────────────────────────────

/** Main app: donations (Orders v2, Subscriptions). Matches what packages/paypal/src/webhook-events.ts parses. */
export const MAIN_EVENTS = ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.REFUNDED', 'BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.CANCELLED', 'PAYMENT.SALE.COMPLETED'] as const;
/** Payouts app: every batch and item event (REVERSED is not an official type; it is dropped if PayPal does not list it). */
export const PAYOUT_EVENTS = [
  'PAYMENT.PAYOUTSBATCH.PROCESSING',
  'PAYMENT.PAYOUTSBATCH.SUCCESS',
  'PAYMENT.PAYOUTSBATCH.DENIED',
  ...['SUCCEEDED', 'UNCLAIMED', 'RETURNED', 'FAILED', 'BLOCKED', 'CANCELED', 'DENIED', 'HELD', 'REFUNDED', 'REVERSED'].map((s) => `PAYMENT.PAYOUTS-ITEM.${s}`),
] as const;

export interface Webhook {
  id: string;
  url: string;
  event_types: Array<{ name: string }>;
}

export const webhookPath = '/api/webhooks/paypal';
const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();

export async function listWebhooks(pp: PayPal): Promise<Webhook[]> {
  const res = await pp.client.request<{ webhooks?: Webhook[] }>({ path: '/v1/notifications/webhooks', query: { anchor_type: 'APPLICATION' } });
  return res.data.webhooks ?? [];
}

export async function availableEventTypes(pp: PayPal): Promise<string[] | null> {
  try {
    const res = await pp.client.request<{ event_types?: Array<{ name: string }> }>({ path: '/v1/notifications/webhooks-event-types' });
    return (res.data.event_types ?? []).map((t) => t.name);
  } catch {
    return null;
  }
}

export interface EnsureWebhookResult {
  id: string;
  url: string;
  action: 'created' | 'updated' | 'unchanged';
  events: string[];
  /** Wanted but not offered by PayPal (e.g. PAYMENT.PAYOUTS-ITEM.REVERSED). */
  dropped: string[];
  /** Other subscriptions on this app that point at a Neighborline webhook path on another host. */
  stale: Array<{ id: string; url: string }>;
}

/** Make sure exactly one subscription for `url` exists with `wanted` events. Safe to run any number of times. */
export async function ensureWebhook(pp: PayPal, url: string, wanted: readonly string[]): Promise<EnsureWebhookResult> {
  const offered = await availableEventTypes(pp);
  const events = offered ? wanted.filter((e) => offered.includes(e)) : [...wanted];
  const dropped = wanted.filter((e) => !events.includes(e));
  const all = await listWebhooks(pp);
  const stale = all.filter((w) => norm(w.url) !== norm(url) && w.url.includes(webhookPath)).map((w) => ({ id: w.id, url: w.url }));
  const existing = all.find((w) => norm(w.url) === norm(url));
  if (existing) {
    const have = new Set(existing.event_types.map((t) => t.name));
    const same = have.has('*') || (events.every((e) => have.has(e)) && have.size === events.length);
    if (same) return { id: existing.id, url: existing.url, action: 'unchanged', events: [...have], dropped, stale };
    await pp.client.request({ method: 'PATCH', path: `/v1/notifications/webhooks/${encodeURIComponent(existing.id)}`, body: [{ op: 'replace', path: '/event_types', value: events.map((name) => ({ name })) }] });
    return { id: existing.id, url: existing.url, action: 'updated', events, dropped, stale };
  }
  try {
    const res = await pp.client.request<Webhook>({ method: 'POST', path: '/v1/notifications/webhooks', body: { url, event_types: events.map((name) => ({ name })) } });
    return { id: res.data.id, url: res.data.url, action: 'created', events, dropped, stale };
  } catch (err) {
    if (err instanceof PayPalApiError && err.hasIssue('WEBHOOK_URL_ALREADY_EXISTS')) {
      // Lost a race with another run (or the list was stale): take the one that exists.
      const again = (await listWebhooks(pp)).find((w) => norm(w.url) === norm(url));
      if (again) return { id: again.id, url: again.url, action: 'unchanged', events: again.event_types.map((t) => t.name), dropped, stale };
    }
    if (err instanceof PayPalApiError && err.hasIssue('WEBHOOK_NUMBER_LIMIT_EXCEEDED')) {
      throw new Error(`PayPal allows 10 webhooks per app and this app has ${all.length}. Delete old ones (developer.paypal.com → the app → Webhooks), e.g. ${stale.map((s) => s.url).join(', ') || 'unused test URLs'}, then re-run. debug_id ${err.debugId}`);
    }
    throw err;
  }
}

export async function deleteWebhook(pp: PayPal, id: string): Promise<void> {
  await pp.client.request({ method: 'DELETE', path: `/v1/notifications/webhooks/${encodeURIComponent(id)}` });
}

export interface WebhookPair {
  url: string;
  main?: EnsureWebhookResult;
  payouts?: EnsureWebhookResult;
}

/** Both apps' subscriptions for `${origin}/api/webhooks/paypal`. Real PayPal refuses non-https URLs, so we check first. */
export async function ensureAppWebhooks(env: Env, origin: string, opts: { fetch?: typeof fetch; target: 'sandbox' | 'fake' }): Promise<WebhookPair> {
  const url = `${origin.replace(/\/+$/, '')}${webhookPath}`;
  if (opts.target === 'sandbox' && !url.startsWith('https://')) throw new Error(`PayPal webhooks need an https URL; got ${url}`);
  const out: WebhookPair = { url };
  if (credentials(env, 'main')) out.main = await ensureWebhook(paypalFor(env, 'main', opts.fetch), url, MAIN_EVENTS);
  if (credentials(env, 'payouts')) out.payouts = await ensureWebhook(paypalFor(env, 'payouts', opts.fetch), url, PAYOUT_EVENTS);
  return out;
}

/** A compact, loggable form of a PayPal error: status, name, first issue, debug_id. */
export function errorShape(err: unknown): { status?: number; name: string; issue?: string; message: string; debugId?: string; details?: unknown; links?: unknown; body?: unknown } {
  if (err instanceof PayPalApiError) {
    const body = err.body as Record<string, unknown> | undefined;
    return {
      status: err.status,
      name: err.name,
      ...(err.issue ? { issue: err.issue } : {}),
      message: String(body?.message ?? err.message),
      ...(err.debugId ? { debugId: err.debugId } : {}),
      ...(err.details.length ? { details: err.details } : {}),
      ...(err.links.length ? { links: err.links } : {}),
      body,
    };
  }
  return { name: (err as Error)?.name ?? 'Error', message: (err as Error)?.message ?? String(err) };
}
