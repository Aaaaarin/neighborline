/**
 * Webhook management (Notifications API v1), the REST side of the dashboard's "Add webhook":
 *  - GET    /v1/notifications/webhooks                       → {webhooks: [...]}
 *  - POST   /v1/notifications/webhooks {url, event_types}    → 201 webhook
 *  - GET    /v1/notifications/webhooks/:id                   → webhook
 *  - PATCH  /v1/notifications/webhooks/:id  [{op:'replace', path:'/url'|'/event_types', value}] → 200 webhook
 *  - DELETE /v1/notifications/webhooks/:id                   → 204
 *  - GET    /v1/notifications/webhooks/:id/event-types       → {event_types}
 *  - GET    /v1/notifications/webhooks-event-types           → {event_types} (every type this fake can send)
 *  - GET    /v1/notifications/webhooks-events?page_size&start_time&end_time&event_type&transaction_id → {events, count, links}
 *  - POST   /v1/notifications/webhooks-events/:id/resend {webhook_ids} → 202 event (a new, verifiable transmission)
 *
 * Shapes follow https://docs.paypal.ai/api-reference/notifications_webhooks_v1.json (fetched Oct 17 2026). The error
 * names for a duplicate URL (`WEBHOOK_URL_ALREADY_EXISTS`), the 10-per-app limit (`WEBHOOK_NUMBER_LIMIT_EXCEEDED`) and an
 * unknown event type (`INVALID_EVENT_TYPE` issue) are not in that spec: they are what scripts/golive expects and records,
 * and the sandbox run (golive-out/SANDBOX_EVIDENCE.md) is what confirms or corrects them.
 */
import type { FakeContext } from '../context.js';
import { ppError, validation } from '../errors.js';
import type { Ctx, Reply, Router } from '../http.js';
import type { RegisteredWebhook } from '../state.js';

const API = 'webhooks/v1';
export const MAX_WEBHOOKS_PER_APP = 10;

/** Event types this fake emits, minus PAYMENT.PAYOUTS-ITEM.REVERSED, which PayPal does not list (the fake still sends it). */
export const FAKE_EVENT_TYPES: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'PAYMENT.PAYOUTSBATCH.PROCESSING', description: 'A batch payout payment is processing.' },
  { name: 'PAYMENT.PAYOUTSBATCH.SUCCESS', description: 'A batch payout payment completes successfully.' },
  { name: 'PAYMENT.PAYOUTSBATCH.DENIED', description: 'A batch payout payment is denied.' },
  ...['SUCCEEDED', 'UNCLAIMED', 'RETURNED', 'BLOCKED', 'CANCELED', 'DENIED', 'FAILED', 'HELD', 'REFUNDED'].map((s) => ({
    name: `PAYMENT.PAYOUTS-ITEM.${s}`,
    description: `A payout item is ${s.toLowerCase()}.`,
  })),
  { name: 'CHECKOUT.ORDER.APPROVED', description: 'A buyer approved a checkout order.' },
  { name: 'CHECKOUT.ORDER.COMPLETED', description: 'A checkout order is processed.' },
  { name: 'PAYMENT.CAPTURE.COMPLETED', description: 'A payment capture completes.' },
  { name: 'PAYMENT.CAPTURE.DENIED', description: 'A payment capture is denied.' },
  { name: 'PAYMENT.CAPTURE.REFUNDED', description: 'A merchant refunds a payment capture.' },
  { name: 'BILLING.SUBSCRIPTION.CREATED', description: 'A subscription is created.' },
  { name: 'BILLING.SUBSCRIPTION.ACTIVATED', description: 'A subscription is activated.' },
  { name: 'BILLING.SUBSCRIPTION.CANCELLED', description: 'A subscription is cancelled.' },
  { name: 'BILLING.SUBSCRIPTION.SUSPENDED', description: 'A subscription is suspended.' },
  { name: 'PAYMENT.SALE.COMPLETED', description: 'A sale completes.' },
];
const KNOWN = new Set(FAKE_EVENT_TYPES.map((t) => t.name));

export function registerWebhookAdminRoutes(router: Router, ctx: FakeContext): void {
  router
    .add('GET', '/v1/notifications/webhooks', () => ({ status: 200, body: { webhooks: [...ctx.state.registeredWebhooks.values()].map((w) => view(ctx, w)) } }))
    .add('POST', '/v1/notifications/webhooks', (c) => create(ctx, c))
    .add('GET', '/v1/notifications/webhooks/:id', (c) => ({ status: 200, body: view(ctx, requireWebhook(ctx, c.params.id!)) }))
    .add('PATCH', '/v1/notifications/webhooks/:id', (c) => patch(ctx, c))
    .add('DELETE', '/v1/notifications/webhooks/:id', (c) => {
      requireWebhook(ctx, c.params.id!);
      ctx.state.registeredWebhooks.delete(c.params.id!);
      return { status: 204 };
    })
    .add('GET', '/v1/notifications/webhooks/:id/event-types', (c) => ({ status: 200, body: { event_types: requireWebhook(ctx, c.params.id!).event_types } }))
    .add('GET', '/v1/notifications/webhooks-event-types', () => ({
      status: 200,
      body: { event_types: FAKE_EVENT_TYPES.map((t) => ({ ...t, status: 'ENABLED', resource_versions: ['1.0', '2.0'] })) },
    }))
    .add('GET', '/v1/notifications/webhooks-events', (c) => listEvents(ctx, c))
    .add('POST', '/v1/notifications/webhooks-events/:id/resend', (c) => resend(ctx, c));
}

function view(ctx: FakeContext, w: RegisteredWebhook) {
  return {
    id: w.id,
    url: w.url,
    event_types: w.event_types,
    links: [
      { href: `${ctx.baseUrl()}/v1/notifications/webhooks/${w.id}`, rel: 'self', method: 'GET' },
      { href: `${ctx.baseUrl()}/v1/notifications/webhooks/${w.id}`, rel: 'update', method: 'PATCH' },
      { href: `${ctx.baseUrl()}/v1/notifications/webhooks/${w.id}`, rel: 'delete', method: 'DELETE' },
    ],
  };
}

function requireWebhook(ctx: FakeContext, id: string): RegisteredWebhook {
  const w = ctx.state.registeredWebhooks.get(id);
  if (!w) throw ppError(404, 'INVALID_RESOURCE_ID', 'Webhook id not found.', undefined, API);
  return w;
}

function checkUrl(url: unknown): string {
  if (typeof url !== 'string' || !url) throw validation([{ field: 'url', location: 'body', issue: 'MISSING_REQUIRED_PARAMETER' }], API);
  if (url.length > 2048) throw validation([{ field: 'url', location: 'body', issue: 'Max length is 2048.' }], API);
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
  } catch {
    throw validation([{ field: 'url', location: 'body', issue: 'INVALID_PARAMETER_SYNTAX', description: 'url must be an http(s) URL.' }], API);
  }
  return url;
}

function checkEventTypes(value: unknown): RegisteredWebhook['event_types'] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    throw validation([{ field: 'event_types', location: 'body', issue: 'MISSING_REQUIRED_PARAMETER', description: 'Give 1-500 event types.' }], API);
  }
  const names = value.map((t) => (t && typeof t === 'object' ? (t as { name?: unknown }).name : undefined));
  const bad = names.filter((n) => typeof n !== 'string' || (n !== '*' && !KNOWN.has(n)));
  if (bad.length) throw validation([{ field: 'event_types', location: 'body', issue: 'INVALID_EVENT_TYPE', description: `Unknown event type(s): ${bad.join(', ')}` }], API);
  const uniq = [...new Set(names as string[])];
  return uniq.map((name) => ({ name, description: FAKE_EVENT_TYPES.find((t) => t.name === name)?.description ?? 'ALL', status: 'ENABLED' }));
}

function create(ctx: FakeContext, c: Ctx): Reply {
  const b = c.json<{ url?: unknown; event_types?: unknown }>();
  const url = checkUrl(b.url);
  const event_types = checkEventTypes(b.event_types);
  if ([...ctx.state.registeredWebhooks.values()].some((w) => w.url === url)) {
    throw ppError(400, 'WEBHOOK_URL_ALREADY_EXISTS', 'Webhook URL already exists.', undefined, API);
  }
  if (ctx.state.registeredWebhooks.size >= MAX_WEBHOOKS_PER_APP) {
    throw ppError(400, 'WEBHOOK_NUMBER_LIMIT_EXCEEDED', 'Maximum number of webhooks has been reached.', undefined, API);
  }
  const w: RegisteredWebhook = { id: ctx.ids.webhook(), url, event_types, create_time: ctx.iso() };
  ctx.state.registeredWebhooks.set(w.id, w);
  return { status: 201, body: view(ctx, w) };
}

function patch(ctx: FakeContext, c: Ctx): Reply {
  const w = requireWebhook(ctx, c.params.id!);
  const ops = c.json<unknown>();
  if (!Array.isArray(ops) || ops.length === 0) throw validation([{ location: 'body', issue: 'INVALID_REQUEST', description: 'Body must be a JSON patch array.' }], API);
  const next = { ...w };
  for (const op of ops as Array<{ op?: string; path?: string; value?: unknown }>) {
    if (op.op !== 'replace') throw validation([{ field: 'op', location: 'body', issue: 'INVALID_PARAMETER_VALUE', description: 'Only replace is supported.' }], API);
    if (op.path === '/url') next.url = checkUrl(op.value);
    else if (op.path === '/event_types') next.event_types = checkEventTypes(op.value);
    else throw validation([{ field: 'path', location: 'body', issue: 'INVALID_PARAMETER_VALUE', description: 'path must be /url or /event_types.' }], API);
  }
  if (next.url !== w.url && [...ctx.state.registeredWebhooks.values()].some((o) => o.id !== w.id && o.url === next.url)) {
    throw ppError(400, 'WEBHOOK_URL_ALREADY_EXISTS', 'Webhook URL already exists.', undefined, API);
  }
  ctx.state.registeredWebhooks.set(w.id, next);
  return { status: 200, body: view(ctx, next) };
}

function listEvents(ctx: FakeContext, c: Ctx): Reply {
  const pageSize = Math.min(300, Math.max(1, Number(c.query.get('page_size') ?? 10) || 10));
  const start = c.query.get('start_time');
  const end = c.query.get('end_time');
  const type = c.query.get('event_type');
  const txn = c.query.get('transaction_id');
  type Ev = { id: string; create_time: string; event_type: string; resource?: Record<string, unknown> };
  let events = [...ctx.state.events.values()] as Ev[];
  if (start) events = events.filter((e) => e.create_time >= start.replace(/\.\d+Z$/, 'Z'));
  if (end) events = events.filter((e) => e.create_time <= end.replace(/\.\d+Z$/, 'Z'));
  if (type) events = events.filter((e) => e.event_type === type);
  if (txn) events = events.filter((e) => e.resource?.transaction_id === txn || e.resource?.id === txn);
  events = events.reverse().slice(0, pageSize);
  return { status: 200, body: { events, count: events.length, links: [] } };
}

function resend(ctx: FakeContext, c: Ctx): Reply {
  const b = c.rawBody ? c.json<{ webhook_ids?: unknown }>() : {};
  const ids = Array.isArray(b.webhook_ids) ? (b.webhook_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const targets = ids.length ? ids.map((id) => requireWebhook(ctx, id)) : [...ctx.state.registeredWebhooks.values()];
  const event = ctx.webhooks.resend(c.params.id!, targets);
  if (!event) throw ppError(404, 'INVALID_RESOURCE_ID', 'Requested resource ID was not found.', undefined, API);
  return { status: 202, body: event };
}
