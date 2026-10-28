/**
 * Verify a REAL webhook delivery before the app is deployed: a local receiver behind a public tunnel
 * (GOLIVE_WEBHOOK_CAPTURE_URL → 127.0.0.1:GOLIVE_WEBHOOK_CAPTURE_PORT, e.g. `cloudflared tunnel --url
 * http://localhost:4345`), a temporary subscription on the Payouts app, then PayPal's own postback API on the exact
 * bytes received, plus a tampered copy that must FAIL. If the payouts already ran, an earlier event is resent to the
 * capture subscription. Without a tunnel, the hosted e2e after deploy-render does the same check through the app.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PayPal } from '@neighborline/paypal';
import { deleteWebhook, ensureWebhook, errorShape, PAYOUT_EVENTS } from '../paypal-admin.js';

export interface Delivery {
  at: string;
  headers: Record<string, string>;
  rawBody: string;
  eventId: string;
  eventType: string;
}

export interface Receiver {
  port: number;
  deliveries: Delivery[];
  waitFor(pred: (d: Delivery) => boolean, timeoutMs: number): Promise<Delivery | null>;
  close(): Promise<void>;
}

export async function startReceiver(port: number): Promise<Receiver> {
  const deliveries: Delivery[] = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
    try {
      const ev = JSON.parse(rawBody) as { id?: string; event_type?: string };
      deliveries.push({ at: new Date().toISOString(), headers, rawBody, eventId: ev.id ?? '?', eventType: ev.event_type ?? '?' });
    } catch {
      /* not JSON: ignore */
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return {
    port: (server.address() as AddressInfo).port,
    deliveries,
    async waitFor(pred, timeoutMs) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        const d = deliveries.find(pred);
        if (d) return d;
        await new Promise((r) => setTimeout(r, 250));
      }
      return deliveries.find(pred) ?? null;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export interface CaptureProbe {
  url: string;
  webhookId?: string;
  received: number;
  event?: { id: string; type: string; transmissionId?: string; at: string };
  resentFrom?: string;
  verification?: string;
  tamperedVerification?: string;
  error?: ReturnType<typeof errorShape> | { message: string };
  cleanedUp: boolean;
  status: 'ok' | 'warn' | 'failed';
}

export async function registerCapture(pp: PayPal, url: string): Promise<string> {
  return (await ensureWebhook(pp, url, PAYOUT_EVENTS)).id;
}

/** After the payouts: wait for a delivery (or resend a recent event to our subscription), then verify it twice. */
export async function verifyCaptured(pp: PayPal, rx: Receiver, opts: { url: string; webhookId: string; batchIds: string[]; sinceIso: string; waitMs: number; keep: boolean }): Promise<CaptureProbe> {
  const probe: CaptureProbe = { url: opts.url, webhookId: opts.webhookId, received: 0, cleanedUp: false, status: 'failed' };
  const isOurs = (d: Delivery) => d.eventType.startsWith('PAYMENT.PAYOUTS') && opts.batchIds.some((b) => d.rawBody.includes(b));
  let d = await rx.waitFor(isOurs, opts.waitMs);
  if (!d) {
    // The payouts happened in an earlier run (or before the subscription existed): resend one of their events.
    try {
      const list = await pp.webhooks.listEvents({ startTime: opts.sinceIso, endTime: new Date(Date.now() + 60_000), pageSize: 50 });
      const ev = list.find((e) => e.eventType.startsWith('PAYMENT.PAYOUTS') && opts.batchIds.some((b) => JSON.stringify(e.resource ?? {}).includes(b)));
      if (ev) {
        await pp.client.request({ method: 'POST', path: `/v1/notifications/webhooks-events/${encodeURIComponent(ev.id)}/resend`, body: { webhook_ids: [opts.webhookId] } });
        probe.resentFrom = ev.id;
        d = await rx.waitFor((x) => x.eventId === ev.id, opts.waitMs);
      }
    } catch (err) {
      probe.error = errorShape(err);
    }
  }
  probe.received = rx.deliveries.length;
  if (d) {
    probe.event = { id: d.eventId, type: d.eventType, ...(d.headers['paypal-transmission-id'] ? { transmissionId: d.headers['paypal-transmission-id'] } : {}), at: d.at };
    try {
      const ok = await pp.webhooks.verifyWebhookSignature({ headers: d.headers, rawBody: d.rawBody, webhookId: opts.webhookId });
      probe.verification = ok.status;
      const tampered = d.rawBody.replace(/"value":"(\d+)\.(\d\d)"/, (_m, a: string, b: string) => `"value":"${Number(a) + 100}.${b}"`);
      const bad = await pp.webhooks.verifyWebhookSignature({ headers: d.headers, rawBody: tampered === d.rawBody ? d.rawBody.replace('"id":"', '"id":"X') : tampered, webhookId: opts.webhookId });
      probe.tamperedVerification = bad.status;
      probe.status = ok.verified && !bad.verified ? 'ok' : 'failed';
    } catch (err) {
      probe.error = errorShape(err);
    }
  } else if (!probe.error) probe.error = { message: `no payout webhook arrived at ${opts.url} within ${Math.round(opts.waitMs / 1000)} s (is the tunnel up and pointing at port ${rx.port}?)` };
  if (!opts.keep) {
    try {
      await deleteWebhook(pp, opts.webhookId);
      probe.cleanedUp = true;
    } catch {
      /* leave it; the summary says so */
    }
  }
  return probe;
}
