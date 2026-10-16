/**
 * Shared wrapper for POST /api/internal/* (Render Workflows → web). Reads the RAW body, verifies the
 * HMAC (NEIGHBORLINE_INTERNAL_SECRET, ±300 s) over exactly those bytes and the URL path, then
 * zod-validates. 401 on any signature problem; 501 when the engine has no background jobs (mock).
 * These routes cannot move money: the web process has no Payouts client.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import type { ZodType, ZodTypeDef } from 'zod';
import { HttpError } from './errors';
import { route } from './http';
import { verifyInternalRequest } from './internal-auth';
import { log } from './log';
import { readCapped } from './security/guard';
import { services, type InternalOps } from './services';

export function internalRoute<T>(schema: ZodType<T, ZodTypeDef, unknown>, fn: (ops: InternalOps, input: T) => Promise<unknown>) {
  return route(async (req: Request) => {
    const rawBody = await readCapped(req, 256 * 1024);
    const path = new URL(req.url).pathname;
    const v = verifyInternalRequest({ secret: process.env.NEIGHBORLINE_INTERNAL_SECRET, method: req.method, path, rawBody, headers: req.headers });
    if (!v.ok) {
      log.warn('internal.auth_rejected', { path, reason: v.reason });
      return NextResponse.json({ error: `unauthorized (${v.reason})` }, { status: 401 });
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody || '{}');
    } catch {
      throw new HttpError(400, 'Expected a JSON body');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const ops = services().internal;
    if (!ops) throw new HttpError(501, 'Background jobs need the real engine (ENGINE is mock)');
    return fn(ops, parsed.data);
  });
}
