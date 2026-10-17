import { HttpError } from '@/lib/server/errors';
import { clientIp, enforceLimit } from '@/lib/server/security/rate-limit';
import { streamMessageFor } from '@/lib/server/security/redact';
import { accessTo, viewerOf } from '@/lib/server/security/viewer';
import { services } from '@/lib/server/services';
import type { StreamMessage } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

declare global {
  // eslint-disable-next-line no-var
  var __neighborlineStreams: Map<string, number> | undefined;
}
const open = () => (globalThis.__neighborlineStreams ??= new Map());
const MAX_STREAMS_PER_VISITOR = 12;

/**
 * Server-Sent Events: `event: stage` carries a StreamMessage ({event: StageEvent, requestIds}).
 * ?requestId=… filters to one request and replays its history first (reloads, late joiners).
 *
 * Viewer-scoped (QA P1-3, P1-4): organizers get everything; a visitor gets their own runs in full,
 * other requests redacted (no transcript or message text), and in DEMO_MODE never another visitor's
 * runs. `event: reset` tells a stage that the demo database was reset under it.
 */
export async function GET(req: Request) {
  const requestId = new URL(req.url).searchParams.get('requestId');
  const viewer = await viewerOf(req);
  try {
    await enforceLimit(req, 'demo', { visitorTag: viewer.visitor?.tag ?? null });
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  if (requestId && accessTo(viewer, requestId) === 'hidden') return Response.json({ error: 'No such request' }, { status: 404 });
  // Anonymous streams count per client IP as Render saw it (the raw X-Forwarded-For is client-controlled).
  const key = viewer.visitor?.tag ?? `anon:${clientIp(req)}`;
  if ((open().get(key) ?? 0) >= MAX_STREAMS_PER_VISITOR) return Response.json({ error: 'Too many open streams from this browser.' }, { status: 429 });
  const svc = services();
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      open().set(key, (open().get(key) ?? 0) + 1);
      let closed = false;
      const send = (raw: StreamMessage) => {
        if (requestId && raw.kind === 'stage' && raw.requestIds.length && !raw.requestIds.includes(requestId)) return;
        const m = streamMessageFor(viewer, raw);
        if (!m) return;
        try {
          controller.enqueue(enc.encode(`event: ${m.kind}\ndata: ${JSON.stringify(m)}\n\n`));
        } catch {
          cleanup();
        }
      };
      send({ kind: 'hello', serverTime: new Date().toISOString() });
      if (requestId) for (const m of svc.replay(requestId)) send(m);
      const unsubscribe = svc.subscribe(send);
      const ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 15_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        const n = (open().get(key) ?? 1) - 1;
        if (n <= 0) open().delete(key);
        else open().set(key, n);
      };
      req.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
