/**
 * Engine test harness: in-memory PGlite + in-process fake PayPal whose webhooks are delivered to the
 * engine through a tiny HTTP receiver (the same raw-body path as /api/webhooks/paypal).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createFakePayPal, type FakePayPal } from '@neighborline/fake-paypal';
import type { StageEvent } from '@neighborline/core';
import { Engine } from '../lib/server/engine/engine';

export interface Harness {
  engine: Engine;
  fake: FakePayPal;
  /** Every raw webhook delivery the engine received (for replay tests). */
  deliveries: Array<{ headers: Record<string, string>; rawBody: string; status: number }>;
  events(requestId: string): StageEvent[];
  close(): Promise<void>;
}

export async function startHarness(opts: { processingDelayMs?: number; beatScale?: number } = {}): Promise<Harness> {
  const deliveries: Harness['deliveries'] = [];
  let engine: Engine | undefined;
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
    try {
      const r = await engine!.handlePaypalWebhook({ headers, rawBody });
      const status = r.verified ? 200 : 400;
      deliveries.push({ headers, rawBody, status });
      res.writeHead(status).end();
    } catch (err) {
      deliveries.push({ headers, rawBody, status: 500 });
      res.writeHead(500).end(String(err));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  const fake = await createFakePayPal({ webhookTargetUrl: `http://127.0.0.1:${port}/api/webhooks/paypal`, processingDelayMs: opts.processingDelayMs ?? 300 });
  engine = new Engine({
    env: {
      PAYPAL_MODE: 'fake',
      FAKE_PAYPAL_URL: fake.url,
      AI_MODE: 'fixture',
      NEIGHBORLINE_BEAT_SCALE: String(opts.beatScale ?? 0.02),
    },
  });
  await engine.ready();
  return {
    engine,
    fake,
    deliveries,
    events: (id) => engine!.bus.eventsFor(id),
    async close() {
      await fake.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export async function waitFor<T>(fn: () => Promise<T | undefined | null | false> | T | undefined | null | false, timeoutMs = 15_000, label = 'condition'): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
