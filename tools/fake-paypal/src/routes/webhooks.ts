/**
 * Notifications API subset:
 *  - POST /v1/notifications/verify-webhook-signature → SUCCESS only for events this fake signed and delivered,
 *    with matching headers, the configured webhook_id, and a webhook_event structurally equal to what was sent.
 *  - POST /v1/notifications/simulate-event → 202 + sample event, delivered but (like real PayPal) unverifiable.
 *  - GET  /v1/notifications/webhooks-events/:id
 */
import type { FakeContext } from '../context.js';
import { ppError, validation } from '../errors.js';
import type { Ctx, Reply, Router } from '../http.js';
import { jsonEqual, safeEqual, sign, signedString } from '../signing.js';
import { sampleResource } from './webhook-samples.js';

const API = 'webhooks/v1';
const REQUIRED = ['auth_algo', 'cert_url', 'transmission_id', 'transmission_sig', 'transmission_time', 'webhook_id', 'webhook_event'] as const;

export function registerWebhookRoutes(router: Router, ctx: FakeContext): void {
  router
    .add('POST', '/v1/notifications/verify-webhook-signature', (c) => verify(ctx, c))
    .add('POST', '/v1/notifications/simulate-event', (c) => simulate(ctx, c))
    .add('GET', '/v1/notifications/webhooks-events/:id', (c) => {
      const ev = ctx.state.events.get(c.params.id!);
      if (!ev) throw ppError(404, 'INVALID_RESOURCE_ID', 'Requested resource ID was not found.', undefined, API);
      return { status: 200, body: ev };
    });
}

function verify(ctx: FakeContext, c: Ctx): Reply {
  const b = c.json<Record<string, unknown>>();
  const missing = REQUIRED.filter((k) => b[k] === undefined || b[k] === null || b[k] === '');
  if (missing.length) throw validation(missing.map((f) => ({ field: f, location: 'body' as const, issue: 'MISSING_REQUIRED_PARAMETER' })), API);
  const failure: Reply = { status: 200, body: { verification_status: 'FAILURE' } };
  const sent = ctx.state.webhooks.find((w) => w.transmissionId === b.transmission_id);
  if (!sent || sent.simulated) return failure;
  if (b.webhook_id !== sent.webhookId) return failure;
  if (b.transmission_time !== sent.transmissionTime || b.cert_url !== sent.certUrl || b.auth_algo !== sent.authAlgo) return failure;
  // Recompute the signature over the original bytes, then require the posted event to be the same document.
  const expected = sign(ctx.config.signingSecret, signedString(sent.transmissionId, sent.transmissionTime, String(b.webhook_id), sent.rawBody));
  if (typeof b.transmission_sig !== 'string' || !safeEqual(b.transmission_sig, expected)) return failure;
  if (!jsonEqual(b.webhook_event, JSON.parse(sent.rawBody))) return failure;
  return { status: 200, body: { verification_status: 'SUCCESS' } };
}

function simulate(ctx: FakeContext, c: Ctx): Reply {
  const b = c.json<{ webhook_id?: string; url?: string; event_type?: string; resource_version?: string }>();
  if (!b.event_type) throw validation([{ field: 'event_type', location: 'body', issue: 'MISSING_REQUIRED_PARAMETER' }], API);
  if (!b.webhook_id && !b.url) throw validation([{ field: 'webhook_id', location: 'body', issue: 'Either webhook_id or url is required.' }], API);
  const sample = sampleResource(ctx, b.event_type);
  if (!sample) throw validation([{ field: 'event_type', location: 'body', issue: 'INVALID_EVENT_TYPE', description: 'Event type is not supported by the fake simulator.' }], API);
  const registered = b.webhook_id ? ctx.state.registeredWebhooks.get(b.webhook_id) : undefined;
  const target = b.url ?? (b.webhook_id === ctx.config.webhookId ? ctx.config.webhookTargetUrl : undefined);
  const opts = {
    simulated: true,
    ...(registered && !b.url ? { only: [registered] } : target ? { target } : {}),
    ...(b.resource_version ? { resourceVersion: b.resource_version } : {}),
  };
  const event = ctx.webhooks.emit(b.event_type, sample.resourceType, sample.resource, sample.summary, opts);
  return { status: 202, body: event };
}
