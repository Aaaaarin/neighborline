/**
 * /__fake/* control plane (no auth) for demos and tests. Not part of PayPal's API.
 *   GET  /__fake/health | /__fake/state | /__fake/webhooks
 *   POST /__fake/reset
 *   POST /__fake/config                 {webhookTargetUrl?, processingDelayMs?, autoProcess?, reportingLagMs?, ...}
 *   POST /__fake/claim/:payoutItemId    UNCLAIMED → SUCCESS (+ PAYMENT.PAYOUTS-ITEM.SUCCEEDED)
 *   POST /__fake/items/:id/status       {status} any transition, emits the matching item event
 *   POST /__fake/batches/:id/process    finish a batch now (ignores processing delay)
 *   POST /__fake/orders/:id/approve     {payerEmail?, fundingSource?: 'paypal'|'venmo'}
 *   POST /__fake/subscriptions/:id/activate
 *   POST /__fake/tokens/expire          expire every issued access token (test token refresh)
 *   POST /__fake/faults                 {pathPrefix, status, count, retryAfterSec?} fail the next N matching calls
 */
import type { FakeConfig } from '../config.js';
import type { FakeContext } from '../context.js';
import { ppError } from '../errors.js';
import { HttpError, type Router } from '../http.js';
import { snapshot, type TransactionStatus } from '../state.js';
import { activateSubscription } from './billing.js';
import { approveOrder, orderView } from './orders.js';
import { finalizeBatch, itemView, setItemStatus } from './payouts.js';

export interface Fault {
  pathPrefix: string;
  status: number;
  remaining: number;
  retryAfterSec?: number;
}

const SETTABLE: Array<TransactionStatus | 'CANCELED'> = ['SUCCESS', 'FAILED', 'PENDING', 'UNCLAIMED', 'RETURNED', 'ONHOLD', 'BLOCKED', 'REFUNDED', 'REVERSED', 'CANCELED'];
const CONFIG_KEYS: Array<keyof FakeConfig> = ['webhookTargetUrl', 'webhookId', 'processingDelayMs', 'autoProcess', 'tokenTtlSec', 'reportingLagMs', 'rejectPhoneRecipients', 'unclaimedReceivers', 'webhookMaxAttempts', 'log'];

export function registerControlRoutes(router: Router, ctx: FakeContext, hooks: { reset(): void; faults: Fault[] }): void {
  const open = { auth: false };
  const item = (id: string) => {
    const it = ctx.state.items.get(id);
    if (!it) throw ppError(404, 'INVALID_RESOURCE_ID');
    return it;
  };
  router
    .add('GET', '/__fake/health', () => ({ status: 200, body: { ok: true, baseUrl: ctx.baseUrl() } }), open)
    .add('GET', '/__fake/state', () => ({ status: 200, body: { config: publicConfig(ctx.config), ...snapshot(ctx.state) } }), open)
    .add('GET', '/__fake/webhooks', () => ({ status: 200, body: ctx.state.webhooks.map(({ rawBody, transmissionSig: _s, ...w }) => ({ ...w, event: JSON.parse(rawBody) })) }), open)
    .add('POST', '/__fake/reset', () => {
      hooks.reset();
      return { status: 200, body: { ok: true } };
    }, open)
    .add('POST', '/__fake/config', (c) => {
      const patch = c.json<Partial<FakeConfig>>();
      for (const k of CONFIG_KEYS) if (k in patch) (ctx.config as unknown as Record<string, unknown>)[k] = patch[k];
      return { status: 200, body: publicConfig(ctx.config) };
    }, open)
    .add('POST', '/__fake/claim/:id', (c) => {
      const it = item(c.params.id!);
      if (it.transaction_status !== 'UNCLAIMED') throw new HttpError(409, { name: 'ITEM_INCORRECT_STATUS', message: `Item is ${it.transaction_status}, not UNCLAIMED.` });
      setItemStatus(ctx, it, 'SUCCESS');
      return { status: 200, body: itemView(ctx, it, 'self') };
    }, open)
    .add('POST', '/__fake/items/:id/status', (c) => {
      const it = item(c.params.id!);
      const { status } = c.json<{ status?: TransactionStatus | 'CANCELED' }>();
      if (!status || !SETTABLE.includes(status)) throw new HttpError(400, { name: 'VALIDATION_ERROR', message: `status must be one of ${SETTABLE.join(', ')}` });
      setItemStatus(ctx, it, status);
      return { status: 200, body: itemView(ctx, it, 'self') };
    }, open)
    .add('POST', '/__fake/batches/:id/process', (c) => {
      if (!ctx.state.batches.has(c.params.id!)) throw ppError(404, 'INVALID_RESOURCE_ID');
      finalizeBatch(ctx, c.params.id!);
      return { status: 200, body: ctx.state.batches.get(c.params.id!) };
    }, open)
    .add('POST', '/__fake/orders/:id/approve', (c) => {
      const b = c.rawBody ? c.json<{ payerEmail?: string; fundingSource?: 'paypal' | 'venmo' }>() : {};
      return { status: 200, body: orderView(ctx, approveOrder(ctx, c.params.id!, b)) };
    }, open)
    .add('POST', '/__fake/subscriptions/:id/activate', (c) => ({ status: 200, body: activateSubscription(ctx, c.params.id!) }), open)
    .add('POST', '/__fake/tokens/expire', () => {
      for (const k of ctx.state.tokens.keys()) ctx.state.tokens.set(k, 0);
      return { status: 200, body: { expired: ctx.state.tokens.size } };
    }, open)
    .add('POST', '/__fake/faults', (c) => {
      const f = c.json<{ pathPrefix?: string; status?: number; count?: number; retryAfterSec?: number }>();
      const fault: Fault = { pathPrefix: f.pathPrefix ?? '/', status: f.status ?? 500, remaining: f.count ?? 1 };
      if (f.retryAfterSec !== undefined) fault.retryAfterSec = f.retryAfterSec;
      hooks.faults.push(fault);
      return { status: 200, body: fault };
    }, open);
}

function publicConfig(cfg: FakeConfig) {
  const { signingSecret: _s, clientSecret: _c, ...rest } = cfg;
  return rest;
}
