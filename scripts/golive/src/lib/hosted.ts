/**
 * The hosted end-to-end check: play a /demo scenario on the deployed app through its own API (POST /api/demo/play as
 * a visitor), follow its SSE stream, and record the PayPal batch id, the item's final status and the app's
 * `webhook.verified` event. In PAYPAL_MODE=sandbox that is a real sandbox payout approved with two signatures and
 * settled by a webhook the app verified with PayPal's postback API; the event id is then looked up at PayPal.
 */
import type { HostedEvidence } from './evidence.js';

const TERMINAL = new Set(['SUCCESS', 'UNCLAIMED', 'RETURNED', 'BLOCKED', 'FAILED', 'REFUNDED', 'REVERSED', 'CANCELED']);

interface StageEvent {
  type: string;
  at: string;
  status?: string;
  paypalBatchId?: string;
  eventType?: string;
  eventId?: string;
  requestId?: string;
  reason?: string;
}

export async function hostedE2E(f: typeof fetch, origin: string, opts: { scenario?: string; timeoutMs?: number; afterTerminalMs?: number; speed?: number } = {}): Promise<HostedEvidence & { events: Array<{ type: string; at: string; status?: string }> }> {
  const scenario = opts.scenario ?? 'lan';
  const started = Date.now();
  const out: HostedEvidence & { events: Array<{ type: string; at: string; status?: string }> } = { url: origin, scenario, events: [] };
  try {
    const health = (await (await f(`${origin}/api/health`, { signal: AbortSignal.timeout(30_000) })).json()) as { paypalMode?: string };
    out.paypalMode = health.paypalMode ?? '?';
    const play = await f(`${origin}/api/demo/play`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario, mode: 'auto', speed: opts.speed ?? 2 }), signal: AbortSignal.timeout(30_000) });
    if (!play.ok) throw new Error(`POST /api/demo/play → ${play.status} ${(await play.text()).slice(0, 200)}`);
    const run = (await play.json()) as { requestId?: string };
    out.requestId = run.requestId;
    const cookie = (play.headers.getSetCookie?.() ?? [play.headers.get('set-cookie') ?? ''])
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');
    const ac = new AbortController();
    const deadline = setTimeout(() => ac.abort(), opts.timeoutMs ?? 240_000);
    let terminalAt = 0;
    try {
      const res = await f(`${origin}/api/stream?requestId=${encodeURIComponent(run.requestId ?? '')}`, { headers: { accept: 'text/event-stream', ...(cookie ? { cookie } : {}) }, signal: ac.signal });
      if (!res.ok || !res.body) throw new Error(`GET /api/stream → ${res.status}`);
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          if (!data) continue;
          const m = JSON.parse(data.slice(6)) as { kind?: string; event?: StageEvent };
          if (m.kind !== 'stage' || !m.event) continue;
          const e = m.event;
          out.events.push({ type: e.type, at: e.at, ...(e.status ? { status: e.status } : {}) });
          if (e.type === 'payout.batch_created' && e.paypalBatchId) out.paypalBatchId = e.paypalBatchId;
          if (e.type === 'payout.rail_refused') out.error = `PayPal refused the batch: ${e.reason ?? 'account-level refusal'}`;
          if (e.type === 'payout.item_updated' && e.status) {
            out.itemStatus = e.status;
            if (TERMINAL.has(e.status) && !terminalAt) terminalAt = Date.now();
          }
          if (e.type === 'webhook.verified' && e.eventId && e.eventType?.startsWith('PAYMENT.PAYOUTS')) out.webhookVerified = { eventType: e.eventType, eventId: e.eventId, at: e.at };
        }
        const settled = terminalAt && (out.webhookVerified || Date.now() - terminalAt > (opts.afterTerminalMs ?? 30_000));
        if (settled || out.error) break;
      }
    } catch (err) {
      if (!ac.signal.aborted) throw err;
      out.error ??= `timed out after ${Math.round((opts.timeoutMs ?? 240_000) / 1000)} s (item ${out.itemStatus ?? 'not created'})`;
    } finally {
      clearTimeout(deadline);
      ac.abort();
    }
  } catch (err) {
    out.error = (err as Error).message;
  }
  out.seconds = Math.round((Date.now() - started) / 100) / 10;
  return out;
}
