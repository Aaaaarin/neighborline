import { NextResponse } from 'next/server';
import { HttpError } from '@/lib/server/errors';
import { route } from '@/lib/server/http';
import { verifyInternalRequest } from '@/lib/server/internal-auth';
import { log } from '@/lib/server/log';
import { demoModeOn } from '@/lib/server/passkeys/demo-signer';
import { readCapped } from '@/lib/server/security/guard';
import { services } from '@/lib/server/services';

/**
 * Reseed the shared demo database. NOT public any more (QA P1-3): one visitor resetting froze every
 * other judge's stage. It needs the same HMAC as /api/internal/* (NEIGHBORLINE_INTERNAL_SECRET,
 * ±300 s), so only the nightly Render job (or an operator) can call it. Stages with a run in flight
 * receive `event: reset` and offer a replay. Visitors never need it: their runs are already separate.
 */
export const POST = route(async (req: Request) => {
  if (!demoModeOn(process.env)) throw new HttpError(403, 'Demo controls are off (DEMO_MODE is off).');
  const rawBody = await readCapped(req, 4 * 1024);
  const path = new URL(req.url).pathname;
  const v = verifyInternalRequest({ secret: process.env.NEIGHBORLINE_INTERNAL_SECRET, method: req.method, path, rawBody, headers: req.headers });
  if (!v.ok) {
    log.warn('demo.reset_rejected', { reason: v.reason });
    return NextResponse.json({ error: `unauthorized (${v.reason})` }, { status: 401 });
  }
  await services().resetDemo();
  log.info('demo.reset', {});
  return { ok: true };
});
