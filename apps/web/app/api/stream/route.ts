import { services } from '@/lib/server/services';
import type { StreamMessage } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Server-Sent Events: `event: stage` carries a StreamMessage ({event: StageEvent, requestIds}).
 * ?requestId=… filters to one request and replays its history first (reloads, late joiners).
 */
export async function GET(req: Request) {
  const requestId = new URL(req.url).searchParams.get('requestId');
  const svc = services();
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (m: StreamMessage) => {
        if (requestId && m.kind === 'stage' && m.requestIds.length && !m.requestIds.includes(requestId)) return;
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
        clearInterval(ping);
        unsubscribe();
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
