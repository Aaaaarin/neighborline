/** Minimal router + request/response plumbing on node:http. No framework, no deps. */
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  rawBody: string;
  params: Record<string, string>;
  /** Parse the body as JSON; throws a PayPal-style 400 when malformed. */
  json<T = Record<string, unknown>>(): T;
  header(name: string): string | undefined;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Send `body` verbatim (already serialized) with this content type. */
  raw?: { contentType: string; text: string };
}

export type Handler = (ctx: Ctx) => Reply | Promise<Reply>;

/** Thrown by handlers; rendered as `status` + JSON `body`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
  }
}

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
  auth: boolean;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, opts: { auth?: boolean } = {}): this {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler, auth: opts.auth ?? true });
    return this;
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | 'method_not_allowed' | null {
    const segs = path.split('/').filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchParts(route.parts, segs);
      if (!params) continue;
      pathMatched = true;
      if (route.method === method) return { route, params };
    }
    return pathMatched ? 'method_not_allowed' : null;
  }
}

function matchParts(parts: string[], segs: string[]): Record<string, string> | null {
  if (parts.length !== segs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const s = segs[i]!;
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(s);
    else if (p !== s) return null;
  }
  return params;
}

export async function readBody(req: IncomingMessage, limitBytes = 5_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limitBytes) throw new HttpError(413, { name: 'REQUEST_ENTITY_TOO_LARGE', message: 'Body too large.' });
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}
