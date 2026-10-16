/**
 * Builds PayPal-shaped webhook events, signs them and delivers them in emission order (one queue) to the
 * configured target with PayPal's headers. Every delivery is recorded so verify-webhook-signature can check it.
 */
import type { FakeConfig } from './config.js';
import type { IdFactory } from './ids.js';
import { sign, signedString } from './signing.js';
import type { FakeState, Link, SentWebhook } from './state.js';

export interface WebhookEvent {
  id: string;
  event_version: string;
  create_time: string;
  resource_type: string;
  resource_version?: string;
  event_type: string;
  summary: string;
  resource: unknown;
  links: Link[];
}

export interface EmitOptions {
  resourceVersion?: string;
  /** Simulator events: delivered with headers but NOT verifiable (matches real PayPal). */
  simulated?: boolean;
  /** Override target (simulate-event `url`). */
  target?: string;
}

interface Deps {
  state: FakeState;
  config: FakeConfig;
  ids: IdFactory;
  baseUrl: () => string;
  iso: () => string;
  log: (msg: string) => void;
}

export class WebhookEmitter {
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly deps: Deps) {}

  emit(eventType: string, resourceType: string, resource: unknown, summary: string, opts: EmitOptions = {}): WebhookEvent {
    const { ids, config, state, baseUrl, iso } = this.deps;
    const id = ids.webhookEvent();
    const event: WebhookEvent = {
      id,
      event_version: '1.0',
      create_time: iso(),
      resource_type: resourceType,
      ...(opts.resourceVersion ? { resource_version: opts.resourceVersion } : {}),
      event_type: eventType,
      summary,
      resource: structuredClone(resource),
      links: [
        { href: `${baseUrl()}/v1/notifications/webhooks-events/${id}`, rel: 'self', method: 'GET' },
        { href: `${baseUrl()}/v1/notifications/webhooks-events/${id}/resend`, rel: 'resend', method: 'POST' },
      ],
    };
    const rawBody = JSON.stringify(event);
    const transmissionId = ids.transmissionId();
    const transmissionTime = new Date().toISOString();
    const signature = sign(config.signingSecret, signedString(transmissionId, transmissionTime, config.webhookId, rawBody));
    const record: SentWebhook = {
      eventId: id,
      eventType,
      transmissionId,
      transmissionTime,
      // Simulator signatures are random: they look real but can never verify.
      transmissionSig: opts.simulated ? sign(`${config.signingSecret}:simulator:${Math.random()}`, transmissionId) : signature,
      certUrl: `${baseUrl()}/v1/notifications/certs/CERT-360caa42-fca2a594-fakecert`,
      authAlgo: 'SHA256withRSA',
      webhookId: config.webhookId,
      rawBody,
      simulated: Boolean(opts.simulated),
      deliveryStatus: 'PENDING',
      attempts: 0,
    };
    const target = opts.target ?? config.webhookTargetUrl;
    if (target) record.target = target;
    else record.deliveryStatus = 'NO_TARGET';
    state.webhooks.push(record);
    state.events.set(id, event);
    if (target) this.queue = this.queue.then(() => this.deliver(record, target));
    return event;
  }

  /** Resolves when every queued delivery has finished (delivered or given up). */
  idle(): Promise<void> {
    return this.queue;
  }

  close(): void {
    this.closed = true;
  }

  private async deliver(record: SentWebhook, target: string): Promise<void> {
    const { config, log } = this.deps;
    for (let attempt = 1; attempt <= config.webhookMaxAttempts && !this.closed; attempt++) {
      record.attempts = attempt;
      try {
        const res = await fetch(target, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'PayPal/AUHD-214.0-58164414',
            'paypal-transmission-id': record.transmissionId,
            'paypal-transmission-time': record.transmissionTime,
            'paypal-transmission-sig': record.transmissionSig,
            'paypal-cert-url': record.certUrl,
            'paypal-auth-algo': record.authAlgo,
            'correlation-id': record.transmissionId.slice(0, 13),
          },
          body: record.rawBody,
          signal: AbortSignal.timeout(5_000),
        });
        record.lastResponseStatus = res.status;
        await res.arrayBuffer().catch(() => undefined);
        if (res.ok) {
          record.deliveryStatus = 'DELIVERED';
          log(`webhook ${record.eventType} ${record.eventId} → ${target} [${res.status}]`);
          return;
        }
      } catch (err) {
        log(`webhook ${record.eventType} → ${target} failed: ${(err as Error).message}`);
      }
      if (attempt < config.webhookMaxAttempts) await new Promise((r) => setTimeout(r, 150 * attempt));
    }
    record.deliveryStatus = 'FAILED';
  }
}
