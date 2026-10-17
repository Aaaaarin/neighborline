import 'server-only';
import { NextResponse } from 'next/server';
import type { ZodType, ZodTypeDef } from 'zod';
import { HttpError, isHttpError } from './errors';
import { errorText, log } from './log';
import { assertJson, assertSameOrigin, readCapped } from './security/guard';

/**
 * Wrap a route handler: HttpError → status + {error}, anything else → 500 without leaking internals.
 * Every non-GET call is checked for a cross-site origin first (security/guard.ts), whatever its
 * content type: multipart uploads and body-less POSTs included.
 */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response | unknown>) {
  return async (...args: A): Promise<Response> => {
    try {
      if (args[0] instanceof Request) assertSameOrigin(args[0]);
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (err) {
      if (isHttpError(err)) {
        const { headers, code } = err as { headers?: Record<string, string>; code?: string };
        return NextResponse.json({ error: err.message, ...(code ? { code } : {}) }, { status: err.status, ...(headers ? { headers } : {}) });
      }
      log.error('api.unhandled', { error: errorText(err) });
      return NextResponse.json({ error: 'Something went wrong on our side. Try again in a moment.' }, { status: 500 });
    }
  };
}

/**
 * Parse a JSON body: Content-Type must be application/json (415 otherwise: a cross-site form or a
 * no-cors fetch cannot send it without a CORS preflight), at most 64 KB (413), then zod.
 */
export async function body<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  assertJson(req);
  const text = await readCapped(req);
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'Expected a JSON body');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return parsed.data;
}

export type Params<K extends string> = { params: Promise<Record<K, string>> };
