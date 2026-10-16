import 'server-only';
import { NextResponse } from 'next/server';
import type { ZodType, ZodTypeDef } from 'zod';
import { HttpError, isHttpError } from './errors';
import { errorText, log } from './log';

/** Wrap a route handler: HttpError → status + {error}, anything else → 500 without leaking internals. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response | unknown>) {
  return async (...args: A): Promise<Response> => {
    try {
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (err) {
      if (isHttpError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
      log.error('api.unhandled', { error: errorText(err) });
      return NextResponse.json({ error: 'Something went wrong on our side. Try again in a moment.' }, { status: 500 });
    }
  };
}

export async function body<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'Expected a JSON body');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return parsed.data;
}

export type Params<K extends string> = { params: Promise<Record<K, string>> };
