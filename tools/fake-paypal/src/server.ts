/** Assembles the fake: node:http server + router + state + webhook emitter. */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_CONFIG, type FakeConfig } from './config.js';
import { isoSeconds, type FakeContext } from './context.js';
import { errorBody, setDebugIdGenerator } from './errors.js';
import { headerValue, HttpError, readBody, Router, type Ctx, type Reply } from './http.js';
import { createIdFactory, seededRng } from './ids.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerControlRoutes, type Fault } from './routes/control.js';
import { applyGenericMock } from './routes/mock.js';
import { registerOAuthRoutes, requireBearer } from './routes/oauth.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerPayoutRoutes } from './routes/payouts.js';
import { registerReportingRoutes } from './routes/reporting.js';
import { registerWebhookAdminRoutes } from './routes/webhook-admin.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { createState, type FakeState } from './state.js';
import { WebhookEmitter } from './webhook-emitter.js';

export interface FakePayPalOptions extends Partial<FakeConfig> {
  /** 0 (default) = random free port. */
  port?: number;
  host?: string;
  /** Seed for deterministic ids. */
  seed?: number;
  /** Clock override for tests. */
  now?: () => number;
}

export interface FakePayPal {
  url: string;
  port: number;
  config: FakeConfig;
  state: FakeState;
  /** Waits for queued webhook deliveries to finish. */
  idle(): Promise<void>;
  reset(): void;
  close(): Promise<void>;
}

/** Permissive CORS for FAKE_PAYPAL_CORS=1: any origin, the methods and headers PayPal clients send, debug id readable. */
export function corsHeaders(h: import('node:http').IncomingHttpHeaders): Record<string, string> {
  const origin = headerValue(h, 'origin');
  const asked = headerValue(h, 'access-control-request-headers');
  return {
    'access-control-allow-origin': origin ?? '*',
    ...(origin ? { vary: 'Origin' } : {}),
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': asked ?? 'authorization, content-type, accept, paypal-request-id, paypal-mock-response, prefer, paypal-auth-assertion, paypal-partner-attribution-id',
    'access-control-expose-headers': 'paypal-debug-id, retry-after',
  };
}

export async function createFakePayPal(options: FakePayPalOptions = {}): Promise<FakePayPal> {
  const { port = 0, host = '127.0.0.1', seed, now: nowOpt, ...cfg } = options;
  const config: FakeConfig = { ...DEFAULT_CONFIG, ...cfg };
  const rng = seed === undefined ? Math.random : seededRng(seed);
  const ids = createIdFactory(rng);
  setDebugIdGenerator(ids.debugId);
  const now = nowOpt ?? Date.now;
  const timers = new Set<NodeJS.Timeout>();
  const faults: Fault[] = [];
  let baseUrl = '';
  const log = (msg: string) => {
    if (config.log) console.log(`[fake-paypal] ${msg}`);
  };

  const ctx: FakeContext = {
    state: createState(),
    config,
    ids,
    baseUrl: () => baseUrl,
    now,
    iso: (ms = now()) => isoSeconds(ms),
    schedule(fn, ms) {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    },
    webhooks: undefined as unknown as WebhookEmitter,
  };
  ctx.webhooks = new WebhookEmitter({ state: ctx.state, config, ids, baseUrl: ctx.baseUrl, iso: () => ctx.iso(), log });

  const router = new Router();
  const reset = () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    faults.length = 0;
    // Business state is wiped; issued access tokens survive so connected clients keep working.
    const { tokens, tokenClients } = ctx.state;
    Object.assign(ctx.state, createState(), { tokens, tokenClients });
  };
  registerOAuthRoutes(router, ctx);
  registerPayoutRoutes(router, ctx);
  registerOrderRoutes(router, ctx);
  registerBillingRoutes(router, ctx);
  registerReportingRoutes(router, ctx);
  registerWebhookRoutes(router, ctx);
  registerWebhookAdminRoutes(router, ctx);
  registerControlRoutes(router, ctx, { reset, faults });

  const handle = async (method: string, url: URL, c: Ctx): Promise<Reply> => {
    const m = router.match(method, url.pathname);
    if (m === null) throw new HttpError(404, errorBody('RESOURCE_NOT_FOUND', `No route for ${method} ${url.pathname} in fake-paypal.`));
    if (m === 'method_not_allowed') throw new HttpError(405, errorBody('METHOD_NOT_SUPPORTED', 'The server does not implement the requested HTTP method.'));
    c.params = m.params;
    if (m.route.auth) {
      requireBearer(ctx, c);
      const fault = faults.find((f) => f.remaining > 0 && url.pathname.startsWith(f.pathPrefix));
      if (fault) {
        fault.remaining--;
        const name = fault.name ?? (fault.status === 429 ? 'RATE_LIMIT_REACHED' : fault.status === 503 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_SERVER_ERROR');
        return { status: fault.status, body: errorBody(name), ...(fault.retryAfterSec !== undefined ? { headers: { 'retry-after': String(fault.retryAfterSec) } } : {}) };
      }
      applyGenericMock(c);
    }
    return m.route.handler(c);
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake.local');
    const method = (req.method ?? 'GET').toUpperCase();
    const cors = config.cors ? corsHeaders(req.headers) : {};
    if (config.cors && method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'access-control-max-age': '600' });
      res.end();
      return;
    }
    let reply: Reply;
    try {
      const rawBody = await readBody(req);
      const c: Ctx = {
        method,
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        rawBody,
        params: {},
        header: (n) => headerValue(req.headers, n),
        json<T>() {
          if (!rawBody) return {} as T;
          try {
            return JSON.parse(rawBody) as T;
          } catch {
            throw new HttpError(400, errorBody('MALFORMED_REQUEST_JSON'));
          }
        },
      };
      reply = await handle(method, url, c);
    } catch (err) {
      if (err instanceof HttpError) reply = { status: err.status, body: err.body };
      else {
        log(`unhandled error: ${(err as Error).stack ?? String(err)}`);
        reply = { status: 500, body: errorBody('INTERNAL_SERVER_ERROR') };
      }
    }
    const headers: Record<string, string> = { 'paypal-debug-id': ids.debugId(), ...(reply.headers ?? {}), ...cors };
    if (reply.raw) {
      res.writeHead(reply.status, { ...headers, 'content-type': reply.raw.contentType });
      res.end(reply.raw.text);
    } else if (reply.body === undefined) {
      res.writeHead(reply.status, headers);
      res.end();
    } else {
      res.writeHead(reply.status, { ...headers, 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    }
    if (!url.pathname.startsWith('/__fake/state')) log(`${method} ${url.pathname} → ${reply.status}`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${addr.port}`;

  return {
    url: baseUrl,
    port: addr.port,
    config,
    state: ctx.state,
    idle: () => ctx.webhooks.idle(),
    reset,
    async close() {
      reset();
      ctx.webhooks.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
