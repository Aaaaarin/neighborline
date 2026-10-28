/**
 * Webhook verification via POST /v1/notifications/verify-webhook-signature.
 *
 * PayPal signs `transmission_id|transmission_time|webhook_id|crc32(raw body)`. Re-serializing the body
 * (JSON.parse → JSON.stringify) can change bytes (key order, unicode escapes, number formatting) and make a
 * genuine event fail. So the request body is assembled by splicing the *raw* body in as `webhook_event`.
 */
import type { PayPalClient } from './client.js';
import { toRfc3339 } from './reporting.js';

export type HeaderBag = Headers | Record<string, string | string[] | undefined>;

export interface VerifyWebhookInput {
  headers: HeaderBag;
  /** The exact request body bytes as received (read it with `await req.text()` before parsing). */
  rawBody: string;
  /** Webhook id from the PayPal developer dashboard (env PAYPAL_WEBHOOK_ID). */
  webhookId: string;
}

export type VerifyWebhookResult =
  | { verified: true; status: 'SUCCESS' }
  | { verified: false; status: 'FAILURE'; reason: 'paypal_failure' | 'missing_headers' | 'invalid_body' };

export const WEBHOOK_HEADERS = {
  transmissionId: 'paypal-transmission-id',
  transmissionTime: 'paypal-transmission-time',
  transmissionSig: 'paypal-transmission-sig',
  certUrl: 'paypal-cert-url',
  authAlgo: 'paypal-auth-algo',
} as const;

export function getHeader(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const bag = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(bag).find((k) => k.toLowerCase() === name);
  const v = key === undefined ? undefined : bag[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Build the verify request body with the raw event spliced in byte-for-byte. Exported for tests. */
export function buildVerifyRequestBody(input: VerifyWebhookInput): string | { error: 'missing_headers' | 'invalid_body' } {
  const h = {
    auth_algo: getHeader(input.headers, WEBHOOK_HEADERS.authAlgo),
    cert_url: getHeader(input.headers, WEBHOOK_HEADERS.certUrl),
    transmission_id: getHeader(input.headers, WEBHOOK_HEADERS.transmissionId),
    transmission_sig: getHeader(input.headers, WEBHOOK_HEADERS.transmissionSig),
    transmission_time: getHeader(input.headers, WEBHOOK_HEADERS.transmissionTime),
    webhook_id: input.webhookId,
  };
  if (Object.values(h).some((v) => !v)) return { error: 'missing_headers' };
  // Splicing is only safe for a single JSON object; anything else is rejected rather than injected.
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { error: 'invalid_body' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'invalid_body' };
  const head = JSON.stringify(h);
  return `${head.slice(0, -1)},"webhook_event":${input.rawBody.trim()}}`;
}

/** One event from `GET /v1/notifications/webhooks-events`. */
export interface WebhookEventSummary {
  id: string;
  eventType: string;
  createTime: string | undefined;
  resource: unknown;
  raw: unknown;
}

export interface ListWebhookEventsInput {
  startTime: Date | string;
  /** Default: now. PayPal answered 400 VALIDATION_ERROR without it (observed 2026-10-28). */
  endTime?: Date | string;
  /** 1–300. Default 50. */
  pageSize?: number;
  eventType?: string;
  transactionId?: string;
}

/**
 * Query for `GET /v1/notifications/webhooks-events` (pure). `start_time` and `end_time` are always both sent, in
 * second-precision UTC (`YYYY-MM-DDTHH:MM:SSZ`): the sandbox refused a millisecond `toISOString()` start_time with no
 * end_time (400 VALIDATION_ERROR) and accepted this form (200), observed 2026-10-28.
 */
export function webhookEventsQuery(input: ListWebhookEventsInput, now: Date = new Date()): Record<string, string | number> {
  const pageSize = input.pageSize ?? 50;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 300) throw new RangeError('pageSize must be 1–300');
  const start = toRfc3339(input.startTime);
  const end = toRfc3339(input.endTime ?? now);
  if (Date.parse(end) < Date.parse(start)) throw new RangeError('endTime is before startTime');
  return {
    start_time: start,
    end_time: end,
    page_size: pageSize,
    ...(input.eventType ? { event_type: input.eventType } : {}),
    ...(input.transactionId ? { transaction_id: input.transactionId } : {}),
  };
}

export class WebhooksApi {
  constructor(private readonly client: PayPalClient) {}

  /** Ask PayPal whether this delivery is genuine. Never throws for FAILURE; throws PayPalApiError on API errors. */
  async verifyWebhookSignature(input: VerifyWebhookInput): Promise<VerifyWebhookResult> {
    const body = buildVerifyRequestBody(input);
    if (typeof body !== 'string') return { verified: false, status: 'FAILURE', reason: body.error };
    const res = await this.client.request<{ verification_status?: string }>({
      method: 'POST',
      path: '/v1/notifications/verify-webhook-signature',
      rawBody: body,
    });
    return res.data.verification_status === 'SUCCESS' ? { verified: true, status: 'SUCCESS' } : { verified: false, status: 'FAILURE', reason: 'paypal_failure' };
  }

  /** Events PayPal emitted for this app in a time window (newest first, one page). */
  async listEvents(input: ListWebhookEventsInput): Promise<WebhookEventSummary[]> {
    const res = await this.client.request<{ events?: Array<{ id: string; event_type: string; create_time?: string; resource?: unknown }> }>({
      path: '/v1/notifications/webhooks-events',
      query: webhookEventsQuery(input),
    });
    return (res.data.events ?? []).map((e) => ({ id: e.id, eventType: e.event_type, createTime: e.create_time, resource: e.resource, raw: e }));
  }

  /**
   * Sandbox webhook simulator. Sends sample data (not tied to real resources) and, per PayPal's docs, simulated
   * events CANNOT be verified with verify-webhook-signature — handle them in a dev-only path.
   */
  async simulateEvent(input: { eventType: string; webhookId?: string; url?: string; resourceVersion?: string }): Promise<{ id: string; event_type: string; raw: unknown }> {
    if (!input.webhookId && !input.url) throw new Error('simulateEvent needs webhookId or url');
    const res = await this.client.request<{ id: string; event_type: string }>({
      method: 'POST',
      path: '/v1/notifications/simulate-event',
      body: {
        event_type: input.eventType,
        ...(input.webhookId ? { webhook_id: input.webhookId } : {}),
        ...(input.url ? { url: input.url } : {}),
        ...(input.resourceVersion ? { resource_version: input.resourceVersion } : {}),
      },
    });
    return { id: res.data.id, event_type: res.data.event_type, raw: res.data };
  }
}
