/**
 * node:http front for the approver. Every route except GET /v1/health requires an HMAC signature
 * (protocol.ts) with a fresh nonce; a replayed nonce is refused before any work is done.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ZodType, ZodTypeDef } from 'zod';
import { Approver, ApproverFailure, type ApproverDeps } from './approver.js';
import type { ApproverConfig } from './config.js';
import {
  APPROVER_ROUTES,
  CancelUnclaimedRequest,
  ExecuteRequest,
  NonceCache,
  RecordManualRequest,
  VerifyWebhookRequest,
  verifyApproverRequest,
  type ApproverError,
  type ApproverHealth,
} from './protocol.js';

const MAX_BODY = 1_100_000;

export interface ApproverServerOptions extends ApproverDeps {
  secret: string;
  health: Omit<ApproverHealth, 'ok' | 'service'>;
  port?: number;
  host?: string;
  nonces?: NonceCache;
  nowMs?: () => number;
}

export interface RunningApprover {
  url: string;
  server: Server;
  approver: Approver;
  close(): Promise<void>;
}

class BodyTooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new BodyTooLarge();
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

const err = (res: ServerResponse, status: number, code: ApproverError['code'], error: string, extra: Pick<ApproverError, 'batchId' | 'railReason'> = {}) =>
  send(res, status, { error, code, ...extra } satisfies ApproverError);

function parse<T>(raw: string, schema: ZodType<T, ZodTypeDef, unknown>): T {
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new ApproverFailure(400, 'bad_request', 'body is not JSON');
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new ApproverFailure(400, 'bad_request', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

export function createApproverHandler(opts: ApproverServerOptions) {
  const approver = new Approver(opts);
  const nonces = opts.nonces ?? new NonceCache();
  const now = opts.nowMs ?? Date.now;
  const prune = setInterval(() => nonces.prune(now()), 60_000);
  prune.unref?.();

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://approver');
    const path = url.pathname;
    const method = (req.method ?? 'GET').toUpperCase();
    try {
      if (method === 'GET' && path === APPROVER_ROUTES.health) {
        return send(res, 200, { ok: true, service: 'neighborline-approver', ...opts.health } satisfies ApproverHealth);
      }
      if (method !== 'POST') return err(res, 405, 'bad_request', 'POST only');
      const raw = await readBody(req);
      const v = verifyApproverRequest({ secret: opts.secret, method, path, rawBody: raw, headers: req.headers, nowMs: now() });
      if (!v.ok) {
        opts.log('warn', 'auth.rejected', { path, reason: v.reason });
        return err(res, 401, 'unauthorized', `signature rejected (${v.reason})`);
      }
      if (!nonces.accept(v.nonce, now())) {
        opts.log('warn', 'auth.replay_rejected', { path });
        return err(res, 409, 'replayed', 'this signed request was already used (nonce replay)');
      }

      if (path === APPROVER_ROUTES.execute) return send(res, 200, await approver.execute(parse(raw, ExecuteRequest)));
      if (path === APPROVER_ROUTES.verifyWebhook) return send(res, 200, await approver.verifyWebhook(parse(raw, VerifyWebhookRequest)));
      let m = /^\/v1\/poll\/([^/]+)$/.exec(path);
      if (m) return send(res, 200, await approver.poll(decodeURIComponent(m[1]!)));
      m = /^\/v1\/cancel-unclaimed\/([^/]+)$/.exec(path);
      if (m) return send(res, 200, await approver.cancelUnclaimed(decodeURIComponent(m[1]!), parse(raw, CancelUnclaimedRequest)));
      m = /^\/v1\/record-manual\/([^/]+)$/.exec(path);
      if (m) return send(res, 200, await approver.recordManual(decodeURIComponent(m[1]!), parse(raw, RecordManualRequest)));
      return err(res, 404, 'not_found', 'no such route');
    } catch (e) {
      if (e instanceof BodyTooLarge) return err(res, 413, 'bad_request', 'body too large');
      if (e instanceof ApproverFailure) return err(res, e.status, e.code, e.message, e.extra);
      opts.log('error', 'internal_error', { path, error: e instanceof Error ? e.message : String(e) });
      return err(res, 500, 'internal', 'approver internal error; nothing was sent');
    }
  };
  return { handler, approver, stop: () => clearInterval(prune) };
}

export async function startApproverServer(opts: ApproverServerOptions): Promise<RunningApprover> {
  const { handler, approver, stop } = createApproverHandler(opts);
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', () => resolve());
  });
  const { port, address } = server.address() as AddressInfo;
  return {
    url: `http://${address.includes(':') ? `[${address}]` : address}:${port}`,
    server,
    approver,
    close: () =>
      new Promise<void>((resolve) => {
        stop();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

export function healthFrom(cfg: ApproverConfig): ApproverServerOptions['health'] {
  return {
    paypalMode: cfg.paypal.mode,
    credentials: cfg.paypal.credentials,
    requirePasskeys: cfg.requirePasskeys,
    demoMode: cfg.demoMode,
    ...(cfg.version ? { version: cfg.version } : {}),
  };
}
